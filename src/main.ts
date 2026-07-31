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
import { DeckIndex } from "./matching/deck-index";
import { DeckMatcher } from "./matching/matcher";
import { DEFAULT_SETTINGS } from "./settings/settings";
import { InohSettingsTab } from "./settings/settings-tab";
import { signOutUser } from "./supabase/auth";
import { createSupabaseClient } from "./supabase/client";
import { StatusBar } from "./ui/status-bar";
import type { DeckCache, InohSettings, PluginData } from "./types";

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
    this.registerEditorExtension([highlighterPlugin, buildHoverTooltip(highlighterPlugin)]);

    this.addSettingTab(new InohSettingsTab(this.app, this));
    this.addCommand({
      id: "refresh-deck",
      name: "Refresh deck",
      callback: () => void this.refreshDeck(),
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

  /** MatcherProvider: highlight mark classes, driven by the style setting. */
  getHighlightClass(): string {
    return `inoh-deck-word inoh-${this.settings.highlightStyle}`;
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

  async saveSettings(): Promise<void> {
    await this.persistData();
    this.rebuildMatcher();
  }

  /**
   * Rebuilds the deck index and pushes a rescan to every open editor.
   * Cheap (~ms for 300 cards), so it simply runs on every deck or settings change.
   */
  private rebuildMatcher(): void {
    const cards = this.deckService.getCards(this.settings.selectedDeckId);
    this.matcher =
      cards.length > 0
        ? new DeckMatcher(new DeckIndex(cards), { tolerant: this.settings.tolerantMatching })
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
