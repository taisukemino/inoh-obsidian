import { MarkdownView, Notice, Plugin } from "obsidian";
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
import { requestDeckWordSuggestions } from "./suggestions/suggestion-service";
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

  private deckCache: DeckCache | null = null;
  private matcher: DeckMatcher | null = null;
  private statusBar!: StatusBar;

  override async onload(): Promise<void> {
    await this.loadPluginData();

    this.supabase = createSupabaseClient(this.getVaultId());
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

    this.addCommand({
      id: "suggest-deck-words",
      name: "Suggest deck words for selection",
      callback: () => void this.suggestForSelection(),
    });

    const { data: authListener } = this.supabase.auth.onAuthStateChange((_event, session) => {
      this.currentUserEmail = session?.user.email ?? null;
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

  /** MatcherProvider: highlight mark classes for deck words. */
  getHighlightClass(): string {
    return "inoh-deck-word inoh-underline";
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
  }

  /** Command: ask the backend where the selected text could use a deck word. */
  private async suggestForSelection(): Promise<void> {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView?.file) {
      new Notice("Open a note and select some text first.");
      return;
    }
    if (!this.currentUserEmail) {
      new Notice("Sign in to Inoh first (plugin settings).");
      return;
    }
    const editor = markdownView.editor;
    const selectedText = editor.getSelection().trim();
    if (!selectedText) {
      new Notice("Select the text you want suggestions for.");
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
    const selectionFrom = editor.posToOffset(editor.getCursor("from"));
    const selectionTo = editor.posToOffset(editor.getCursor("to"));

    const loadingNotice = new Notice("Inoh: looking for places to use your deck words…", 0);
    try {
      const result = await requestDeckWordSuggestions(
        this.supabase,
        selectedText.slice(0, MAX_SUGGESTION_TEXT_LENGTH),
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
      if (resolved.length === 0) {
        new Notice("No good fits in this selection — keep writing!");
        return;
      }
      editorView.dispatch({ effects: setSuggestionsEffect.of(resolved) });
      const suggestionCount = `${resolved.length} suggestion${resolved.length === 1 ? "" : "s"}`;
      const quotaSuffix =
        result.remainingSuggestionsToday !== undefined
          ? ` ${result.remainingSuggestionsToday} free suggestions left today.`
          : "";
      new Notice(`${suggestionCount} marked — hover a phrase to apply.${quotaSuffix}`);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      loadingNotice.hide();
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
      this.statusBar.update();
      if (session) {
        await this.deckService.refresh();
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

  /** Stable per-vault id so two vaults on one machine keep separate sessions. */
  private getVaultId(): string {
    const appWithId = this.app as unknown as { appId?: string };
    return appWithId.appId ?? this.app.vault.getName();
  }
}
