import { MarkdownView, Notice, Platform, Plugin } from "obsidian";
import type { EditorView } from "@codemirror/view";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DeckService } from "./deck/deck-service";
import {
  buildHighlightViewPlugin,
  dispatchDeckRefresh,
  type MatcherProvider,
} from "./editor/highlight-extension";
import { buildHoverTooltip } from "./editor/hover-tooltip";
import {
  buildSuggestionTooltip,
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
import { fetchIsPro } from "./subscriptions/subscription-service";
import { UpgradeModal } from "./subscriptions/upgrade-modal";
import { signOutUser } from "./supabase/auth";
import { createSupabaseClient } from "./supabase/client";
import { StatusBar } from "./ui/status-bar";
import type { DeckCache, InohSettings, PluginData } from "./types";

/** Server-side text limit (MAX_PARAGRAPH_LENGTH) in the suggest-deck-words edge function. */
const MAX_SUGGESTION_TEXT_LENGTH = 2_000;

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
  isPro = false;

  private deckCache: DeckCache | null = null;
  private matcher: DeckMatcher | null = null;
  private statusBar!: StatusBar;
  /** Blocks a second suggestion request; each one spends the daily free quota. */
  private isSuggesting = false;
  /** True between opening Stripe Checkout and seeing the subscription go Pro. */
  private isAwaitingCheckout = false;

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
      }),
    );

    const highlighterPlugin = buildHighlightViewPlugin(this);
    this.registerEditorExtension([
      highlighterPlugin,
      buildHoverTooltip(highlighterPlugin),
      suggestionField,
      buildSuggestionTooltip(),
    ]);

    this.addSettingTab(new InohSettingsTab(this.app, this));

    // On mobile the selection is lost when the command palette opens, so the
    // command always runs on the whole note there — name it accordingly.
    this.addCommand({
      id: "suggest-deck-words",
      name: Platform.isMobile
        ? "Suggest deck words for entire note"
        : "Suggest deck words for selection or note",
      callback: () => void this.suggestForSelectionOrNote(),
    });

    // Stripe Checkout happens in the browser, so the only signal that the user
    // finished is Obsidian regaining focus — the same trigger the Inoh app uses
    // when it returns to the foreground.
    this.registerDomEvent(window, "focus", () => void this.pickUpFinishedCheckout());

    const { data: authListener } = this.supabase.auth.onAuthStateChange((_event, session) => {
      this.currentUserEmail = session?.user.email ?? null;
      this.currentUserId = session?.user.id ?? null;
      this.statusBar.update();
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

  async signOut(): Promise<void> {
    await signOutUser(this.supabase);
    await this.deckService.clear();
    this.isPro = false;
    this.isAwaitingCheckout = false;
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
    const editorView = (editor as unknown as { cm?: EditorView }).cm;
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
        this.promptUpgrade("You've used today's free suggestions");
        return;
      }
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.isSuggesting = false;
      loadingNotice.hide();
    }
  }

  /**
   * Opens Stripe Checkout for Inoh Pro. Called from the daily-limit path and
   * from the settings tab.
   *
   * @param headline - Modal title naming why the upgrade is being offered
   */
  promptUpgrade(headline: string): void {
    new UpgradeModal(this.app, this.supabase, headline, () => {
      this.isAwaitingCheckout = true;
    }).open();
  }

  /**
   * Re-reads the plan after the user comes back from Stripe. The webhook that
   * flips the account to Pro can land after they switch back, so this stays
   * armed and retries on the next focus until it sees Pro.
   */
  private async pickUpFinishedCheckout(): Promise<void> {
    if (!this.isAwaitingCheckout || !this.currentUserId) {
      return;
    }
    try {
      if (!(await fetchIsPro(this.supabase, this.currentUserId))) {
        return;
      }
      this.isAwaitingCheckout = false;
      this.isPro = true;
      new Notice("You're on Inoh Pro — suggestions are unlimited.");
    } catch (error) {
      console.error("Inoh: could not check the subscription after checkout", error);
    }
  }

  /** Reads the current plan, defaulting to free when the check fails. */
  async refreshProStatus(): Promise<void> {
    if (!this.currentUserId) {
      this.isPro = false;
      return;
    }
    try {
      this.isPro = await fetchIsPro(this.supabase, this.currentUserId);
    } catch (error) {
      console.error("Inoh: could not read the subscription plan", error);
      this.isPro = false;
    }
  }

  async saveSettings(): Promise<void> {
    await this.persistData();
    this.rebuildMatcher();
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
      const editorView = (leaf.view.editor as unknown as { cm?: EditorView }).cm;
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
        await Promise.all([this.deckService.refresh(), this.refreshProStatus()]);
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
