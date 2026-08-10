import { MarkdownView, Notice, Platform, Plugin } from "obsidian";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DeckService } from "./deck";
import {
  buildHighlightViewPlugin,
  buildHoverTooltip,
  buildSuggestionTooltip,
  buildTapToOpenCards,
  dispatchDeckRefresh,
  getEditorView,
  suggestionField,
  type MatcherProvider,
} from "./editor";
import { DeckIndex, DeckMatcher } from "./matching";
import { DEFAULT_SETTINGS, InohSettingsTab } from "./settings";
import { AccountService } from "./subscriptions";
import { clearStoredSession, createSupabaseClient, signOutUser } from "./supabase";
import { StatusBar } from "./ui";
import type { DeckCache, DeckCard, InohSettings, PluginData } from "./types";

/**
 * Inoh for Obsidian: highlights words from the user's Inoh vocabulary deck
 * while they write, so they actually use what they're learning.
 */
export default class InohPlugin extends Plugin implements MatcherProvider {
  settings: InohSettings = DEFAULT_SETTINGS;
  supabase!: SupabaseClient;
  deckService!: DeckService;
  /** Subscription plan, display name, and the Stripe flows that change them. */
  account!: AccountService;
  currentUserEmail: string | null = null;
  currentUserId: string | null = null;

  private deckCache: DeckCache | null = null;
  private matcher: DeckMatcher | null = null;
  private statusBar!: StatusBar;
  private settingsTab!: InohSettingsTab;

  override async onload(): Promise<void> {
    await this.loadPluginData();

    this.supabase = createSupabaseClient(this.app);
    this.register(() => void this.supabase.auth.stopAutoRefresh());

    this.deckService = new DeckService(this.supabase, (cache) => {
      this.deckCache = cache;
      return this.persistData();
    });
    this.account = new AccountService(
      this.app,
      this.supabase,
      () => this.currentUserId,
      // The account state only shows in the settings tab, so repaint it on change.
      () => this.settingsTab.refresh(),
    );

    this.statusBar = new StatusBar(this, this.addStatusBarItem());
    this.registerEvent(
      this.deckService.on("deck-changed", () => {
        this.rebuildMatcher();
        this.statusBar.update();
        this.settingsTab.refresh();
      }),
    );

    const highlighterPlugin = buildHighlightViewPlugin(this);
    const onRemoveCard = (card: DeckCard) => this.removeCardFromDeck(card);
    this.registerEditorExtension([
      highlighterPlugin,
      suggestionField,
      // Touch has no hover, so mobile gets the cards in a tap-opened modal.
      // The hover tooltips must stay desktop-only: iOS synthesizes mouse
      // events on tap, so registering them on mobile opens the tooltip and
      // the modal at once.
      ...(Platform.isMobile
        ? [buildTapToOpenCards(this.app, highlighterPlugin, onRemoveCard)]
        : [buildHoverTooltip(highlighterPlugin, onRemoveCard), buildSuggestionTooltip()]),
    ]);

    this.settingsTab = new InohSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    // Suggestions are disabled until their quality improves — uncomment to
    // bring the command back (it lives in ./suggestions/suggest-command).
    // On mobile the selection is lost when the command palette opens, so the
    // command always runs on the whole note there — name it accordingly.
    // this.addCommand({
    //   id: "suggest-deck-words",
    //   name: Platform.isMobile
    //     ? "Suggest deck words for entire note"
    //     : "Suggest deck words for selection or note",
    //   callback: () => void suggestForSelectionOrNote(this),
    // });

    this.addCommand({
      id: "toggle-highlighting",
      name: "Toggle deck word highlighting",
      callback: () => void this.toggleHighlighting(),
    });

    // Stripe Checkout happens in the browser, so the only signal that the user
    // finished is Obsidian regaining focus — the same trigger the Inoh app uses
    // when it returns to the foreground.
    this.registerDomEvent(window, "focus", () => void this.account.pickUpStripeReturn());

    const { data: authListener } = this.supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      const didSignedInUserChange = nextUserId !== this.currentUserId;
      this.currentUserEmail = session?.user.email ?? null;
      this.currentUserId = nextUserId;
      this.statusBar.update();
      this.settingsTab.refresh();

      // The plan belongs to the account, so whoever signs in brings their own.
      // Token refreshes keep the same id and are skipped. Without this, a
      // session that arrives through this listener rather than through
      // initializeSession leaves the plan stuck at its free default.
      if (didSignedInUserChange) {
        void this.account.refresh();
      }
    });
    this.register(() => authListener.subscription.unsubscribe());

    this.deckService.loadFromCache(this.deckCache);
    this.app.workspace.onLayoutReady(() => void this.initializeSession());
  }

  /** MatcherProvider: the editor extension pulls the current matcher from here. */
  getMatcher(): DeckMatcher | null {
    return this.settings.highlightEnabled ? this.matcher : null;
  }

  /** MatcherProvider: highlight mark class for deck words. */
  getHighlightClass(): string {
    return "inoh-deck-word";
  }

  /** Refetches the deck from Supabase, surfacing errors as Notices. */
  async refreshDeck(): Promise<void> {
    try {
      await this.deckService.refresh();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Removes a card from the deck, surfacing the outcome as a Notice.
   * Called from the deck-word card's Remove button.
   *
   * @param card - The deck card to remove
   * @returns True when the card was removed
   */
  async removeCardFromDeck(card: DeckCard): Promise<boolean> {
    try {
      await this.deckService.removeCard(card.id);
      new Notice(`Removed "${card.dictionary.word}" from your deck.`);
      return true;
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async signOut(): Promise<void> {
    await signOutUser(this.supabase);
    // supabase-js leaves the stored session behind when the sign-out errored
    // early (session already missing) — make the local removal unconditional.
    clearStoredSession(this.app);
    await this.deckService.clear();
    this.account.reset();
    // Normally the SIGNED_OUT auth event clears these, but that event never
    // fires when the session was already missing — clear them directly so
    // the account row cannot stay stuck on "Sign out".
    this.currentUserEmail = null;
    this.currentUserId = null;
    this.statusBar.update();
    this.settingsTab.refresh();
  }

  async saveSettings(): Promise<void> {
    await this.persistData();
    this.rebuildMatcher();
  }

  /** Command: flip deck-word highlighting, mirrored by the settings toggle. */
  private async toggleHighlighting(): Promise<void> {
    this.settings.highlightEnabled = !this.settings.highlightEnabled;
    await this.saveSettings();
    this.settingsTab.refresh();
    new Notice(
      this.settings.highlightEnabled ? "Deck word highlighting on." : "Deck word highlighting off.",
    );
  }

  /**
   * Rebuilds the deck index and pushes a rescan to every open editor.
   * Cheap (~ms for 300 cards), so it simply runs on every deck or settings change.
   */
  private rebuildMatcher(): void {
    const cards = this.deckService.getCards();
    this.matcher =
      cards.length > 0 ? new DeckMatcher(new DeckIndex(cards), { tolerant: false }) : null;

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) {
        continue;
      }
      const editorView = getEditorView(leaf.view.editor);
      if (editorView) {
        dispatchDeckRefresh(editorView);
      }
    }
  }

  /** Restores the session and refreshes the deck once the workspace is ready. */
  private async initializeSession(): Promise<void> {
    try {
      const {
        data: { session },
      } = await this.supabase.auth.getSession();
      this.currentUserEmail = session?.user.email ?? null;
      this.currentUserId = session?.user.id ?? null;
      this.statusBar.update();
      if (session) {
        await Promise.all([this.deckService.refresh(), this.account.refresh()]);
      }
    } catch (error) {
      // Offline or token refresh failed: keep highlighting from the cached deck.
      console.error("Inoh: could not refresh deck on startup", error);
    }
  }

  private async loadPluginData(): Promise<void> {
    const data = ((await this.loadData()) ?? null) as Partial<PluginData> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data?.settings };
    this.deckCache = data?.deckCache ?? null;
  }

  /** Single write path for data.json: settings + deck cache, never auth tokens. */
  private async persistData(): Promise<void> {
    await this.saveData({ settings: this.settings, deckCache: this.deckCache });
  }
}
