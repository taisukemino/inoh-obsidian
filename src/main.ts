import { MarkdownView, Notice, Platform, Plugin, type Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DeckService } from "./deck/deck-service";
import {
  buildHighlightViewPlugin,
  dispatchDeckRefresh,
  type MatcherProvider,
} from "./editor/highlight-extension";
import { buildHoverTooltip } from "./editor/hover-tooltip";
import { buildSuggestionTooltip } from "./editor/suggestion-card";
import { buildTapToOpenCards } from "./editor/tap-modal";
import {
  resolveSuggestionRanges,
  setSuggestionsEffect,
  suggestionField,
} from "./editor/suggestion-extension";
import { DeckIndex } from "./matching/deck-index";
import { DeckMatcher } from "./matching/matcher";
import { DEFAULT_SETTINGS } from "./settings/settings";
import { InohSettingsTab } from "./settings/settings-tab";
import {
  requestDeckWordSuggestions,
  SuggestionLimitError,
} from "./suggestions/suggestion-service";
import {
  fetchSubscriptionState,
  isPaidTier,
  openBillingPortalUrl,
  FREE_SUBSCRIPTION,
  TIER_DISPLAY_NAMES,
  type SubscriptionState,
} from "./subscriptions/subscription-service";
import { UpgradeModal } from "./subscriptions/upgrade-modal";
import { signOutUser } from "./supabase/auth";
import { clearStoredSession } from "./supabase/auth-storage";
import { fetchUsername } from "./supabase/profile";
import { createSupabaseClient } from "./supabase/client";
import { openExternalUrl } from "./ui/open-external-url";
import { StatusBar } from "./ui/status-bar";
import type { DeckCache, DeckCard, InohSettings, PluginData } from "./types";

/** Server-side text limit (MAX_PARAGRAPH_LENGTH) in the suggest-deck-words edge function. */
const MAX_SUGGESTION_TEXT_LENGTH = 2_000;

/**
 * Reaches the CodeMirror view behind an Obsidian editor. `cm` is not in the
 * public typings but is the documented community way to attach CM6 behaviour.
 */
function getEditorView(editor: Editor): EditorView | null {
  return (editor as unknown as { cm?: EditorView }).cm ?? null;
}

/**
 * Inoh for Obsidian: highlights words from the user's Inoh vocabulary deck
 * while they write, so they actually use what they're learning.
 */
export default class InohPlugin extends Plugin implements MatcherProvider {
  settings: InohSettings = DEFAULT_SETTINGS;
  supabase!: SupabaseClient;
  deckService!: DeckService;
  currentUserEmail: string | null = null;
  currentUserId: string | null = null;
  /** Display name from the Inoh app; null for accounts that never set one. */
  currentUsername: string | null = null;
  subscription: SubscriptionState = FREE_SUBSCRIPTION;
  /** True when the last plan read failed, so "Free plan" may be wrong. */
  subscriptionCheckFailed = false;

  private deckCache: DeckCache | null = null;
  private matcher: DeckMatcher | null = null;
  private statusBar!: StatusBar;
  private settingsTab!: InohSettingsTab;
  /** Blocks a second suggestion request; each one spends the daily free quota. */
  private isSuggesting = false;
  /** Which Stripe flow the user was sent to, until they come back from it. */
  private pendingStripeReturn: "checkout" | "portal" | null = null;

  override async onload(): Promise<void> {
    await this.loadPluginData();

    this.supabase = createSupabaseClient(this.app);
    this.register(() => void this.supabase.auth.stopAutoRefresh());

    this.deckService = new DeckService(this.supabase, (cache) => {
      this.deckCache = cache;
      return this.persistData();
    });

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
    // bring the command back.
    // On mobile the selection is lost when the command palette opens, so the
    // command always runs on the whole note there — name it accordingly.
    // this.addCommand({
    //   id: "suggest-deck-words",
    //   name: Platform.isMobile
    //     ? "Suggest deck words for entire note"
    //     : "Suggest deck words for selection or note",
    //   callback: () => void this.suggestForSelectionOrNote(),
    // });

    this.addCommand({
      id: "toggle-highlighting",
      name: "Toggle deck word highlighting",
      callback: () => void this.toggleHighlighting(),
    });

    // Stripe Checkout happens in the browser, so the only signal that the user
    // finished is Obsidian regaining focus — the same trigger the Inoh app uses
    // when it returns to the foreground.
    this.registerDomEvent(window, "focus", () => void this.pickUpStripeReturn());

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
        void this.refreshAccountState();
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
    this.subscription = FREE_SUBSCRIPTION;
    this.subscriptionCheckFailed = false;
    this.currentUsername = null;
    this.pendingStripeReturn = null;
    // Normally the SIGNED_OUT auth event clears these, but that event never
    // fires when the session was already missing — clear them directly so
    // the account row cannot stay stuck on "Sign out".
    this.currentUserEmail = null;
    this.currentUserId = null;
    this.statusBar.update();
    this.settingsTab.refresh();
  }

  /**
   * Command: ask the backend where the text could use a deck word.
   * Uses the selection when there is one, otherwise the entire note —
   * selecting text is fiddly on mobile, so the whole-note fallback keeps
   * the command usable there.
   */
  private async suggestForSelectionOrNote(): Promise<void> {
    if (this.isSuggesting) {
      new Notice("Inoh is already looking — hang on.");
      return;
    }
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView?.file) {
      new Notice("Open a note first.");
      return;
    }
    if (!this.currentUserEmail) {
      new Notice("Sign in to Inoh first (plugin settings).");
      return;
    }
    const editor = markdownView.editor;
    const selectedText = editor.getSelection().trim();
    const hasSelection = selectedText.length > 0;
    const suggestionText = hasSelection ? selectedText : editor.getValue().trim();
    if (!suggestionText) {
      new Notice("This note is empty — write something first.");
      return;
    }
    const cards = this.deckService.getCards();
    if (cards.length === 0) {
      new Notice("Your deck is empty — add words at inoh.app, then refresh from the settings.");
      return;
    }
    const editorView = getEditorView(editor);
    if (!editorView) {
      new Notice("Could not access the editor.");
      return;
    }
    const selectionFrom = hasSelection ? editor.posToOffset(editor.getCursor("from")) : 0;
    const selectionTo = hasSelection
      ? editor.posToOffset(editor.getCursor("to"))
      : editorView.state.doc.length;

    const wasTruncated = suggestionText.length > MAX_SUGGESTION_TEXT_LENGTH;

    this.isSuggesting = true;
    const loadingNotice = new Notice("Inoh: looking for places to use your deck words…", 0);
    try {
      const result = await requestDeckWordSuggestions(
        this.supabase,
        suggestionText.slice(0, MAX_SUGGESTION_TEXT_LENGTH),
        cards,
      );
      // The server only returns the word; its definition lives on the deck card.
      const suggestionsWithDefinitions = result.suggestions.map((suggestion) => ({
        ...suggestion,
        definition: cards.find(
          (card) => card.dictionary.word.toLowerCase() === suggestion.word.toLowerCase(),
        )?.dictionary.definition,
      }));
      const resolved = resolveSuggestionRanges(
        editorView.state.doc.toString(),
        selectionFrom,
        selectionTo,
        suggestionsWithDefinitions,
      );
      const truncationSuffix = describeTruncation(wasTruncated);
      if (resolved.length === 0) {
        const scope = hasSelection ? "selection" : "note";
        new Notice(`No good fits in this ${scope} — keep writing!${truncationSuffix}`);
        return;
      }
      editorView.dispatch({ effects: setSuggestionsEffect.of(resolved) });
      const suggestionCount = `${resolved.length} suggestion${resolved.length === 1 ? "" : "s"}`;
      const quotaSuffix =
        result.remainingSuggestionsToday !== undefined
          ? ` ${result.remainingSuggestionsToday} free suggestions left today.`
          : "";
      new Notice(
        `${suggestionCount} marked — hover a phrase to apply.${quotaSuffix}${truncationSuffix}`,
      );
    } catch (error) {
      if (error instanceof SuggestionLimitError) {
        // The server owns the daily limit, so its message is the only place the
        // real number appears — show it rather than restating it here.
        this.promptUpgrade(error.message);
        return;
      }
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.isSuggesting = false;
      loadingNotice.hide();
    }
  }

  /**
   * Opens the upgrade modal offering Inoh Plus and Pro. Called from the
   * settings tab's Upgrade button.
   *
   * @param reason - The server's explanation of why the upgrade is offered,
   *   or null when the user opened this themselves from settings
   */
  promptUpgrade(reason: string | null): void {
    new UpgradeModal(this.app, this.supabase, reason, () => {
      this.pendingStripeReturn = "checkout";
    }).open();
  }

  /**
   * Re-reads the plan after the user comes back from Stripe. The webhook that
   * flips the account onto a paid plan can land after they switch back, so
   * this stays armed and retries on the next focus until the plan shows up.
   */
  private async pickUpStripeReturn(): Promise<void> {
    const pendingFlow = this.pendingStripeReturn;
    if (!pendingFlow || !this.currentUserId) {
      return;
    }
    try {
      const wasPaid = isPaidTier(this.subscription.tier);
      this.subscription = await fetchSubscriptionState(this.supabase, this.currentUserId);
      // The user is often still looking at the settings tab they launched the
      // Stripe flow from, so repaint it with whatever the read found —
      // including a cancellation notice, not just an upgrade.
      this.settingsTab.refresh();

      // The portal writes its changes before the user leaves it, so one read is
      // enough — and it may well have cancelled rather than upgraded.
      if (pendingFlow === "portal") {
        this.pendingStripeReturn = null;
        return;
      }
      // Checkout's webhook can land after the user switches back, so stay armed
      // and retry on each focus until the paid plan actually shows up.
      if (!wasPaid && isPaidTier(this.subscription.tier)) {
        this.pendingStripeReturn = null;
        new Notice(`You're on Inoh ${TIER_DISPLAY_NAMES[this.subscription.tier]} — thanks for subscribing!`);
      }
    } catch (error) {
      console.error("Inoh: could not re-read the subscription after Stripe", error);
    }
  }

  /**
   * Reads the current plan. Falls back to free so features stay gated, but
   * records the failure — silently showing "Free plan" to a paying subscriber
   * is indistinguishable from them genuinely not having paid.
   */
  async refreshAccountState(): Promise<void> {
    const userId = this.currentUserId;
    if (!userId) {
      this.subscription = FREE_SUBSCRIPTION;
      this.subscriptionCheckFailed = false;
      this.currentUsername = null;
      this.settingsTab.refresh();
      return;
    }
    try {
      this.subscription = await fetchSubscriptionState(this.supabase, userId);
      this.subscriptionCheckFailed = false;
    } catch (error) {
      console.error("Inoh: could not read the subscription plan", error);
      this.subscription = FREE_SUBSCRIPTION;
      this.subscriptionCheckFailed = true;
    }
    try {
      this.currentUsername = await fetchUsername(this.supabase, userId);
    } catch (error) {
      // A missing display name is cosmetic; the email still identifies them.
      console.error("Inoh: could not read the profile", error);
      this.currentUsername = null;
    }
    this.settingsTab.refresh();
  }

  /**
   * Opens the Stripe billing portal, where the user can change payment details
   * or cancel. Reached from the settings Manage button.
   */
  async openBillingPortal(): Promise<void> {
    try {
      openExternalUrl(await openBillingPortalUrl(this.supabase));
      // The portal can change the plan, so re-read it when the user returns.
      this.pendingStripeReturn = "portal";
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
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
      this.settings.highlightEnabled
        ? "Deck word highlighting on."
        : "Deck word highlighting off.",
    );
  }

  /**
   * Rebuilds the deck index and pushes a rescan to every open editor.
   * Cheap (~ms for 300 cards), so it simply runs on every deck or settings change.
   */
  private rebuildMatcher(): void {
    const cards = this.deckService.getCards();
    this.matcher =
      cards.length > 0
        ? new DeckMatcher(new DeckIndex(cards), { tolerant: false })
        : null;

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
        await Promise.all([this.deckService.refresh(), this.refreshAccountState()]);
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

/**
 * Says that only the head of the text was checked. Without this the dropped
 * tail reads as the model having missed things.
 *
 * @param wasTruncated - Whether the text exceeded the server's limit
 * @returns A sentence to append to the result notice, or an empty string
 */
function describeTruncation(wasTruncated: boolean): string {
  if (!wasTruncated) {
    return "";
  }
  const checkedLength = MAX_SUGGESTION_TEXT_LENGTH.toLocaleString();
  // Opening the command palette drops the selection on mobile, so only suggest
  // selecting a section where that actually works.
  const advice = Platform.isMobile ? "" : " — select a section to check the rest";
  return ` Only the first ${checkedLength} characters were checked${advice}.`;
}
