import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import { HIGHLIGHT_REBUILD_DEBOUNCE_MS } from "../constants";
import type { DeckMatcher } from "../matching/matcher";
import type { DeckMatch } from "../types";

/**
 * How the extension reads plugin state. The extension is registered once, but
 * the matcher is swapped on every deck refresh and settings change; going
 * through a provider avoids re-registering editor extensions.
 */
export type MatcherProvider = {
  /** Returns the current matcher, or null when highlighting is off / deck empty. */
  getMatcher(): DeckMatcher | null;
  /** CSS class for the highlight marks. */
  getHighlightClass(): string;
};

/**
 * Dispatched to an editor to force a rescan — after the debounce timer fires,
 * after a deck refresh, or after a settings change.
 */
export const deckRefreshEffect = StateEffect.define<null>();

export type InohHighlighterValue = PluginValue & {
  decorations: DecorationSet;
  /** Current matches, kept for the hover tooltip to look up by position. */
  matches: DeckMatch[];
};

export type InohHighlighterPlugin = ViewPlugin<InohHighlighterValue>;

/**
 * Builds the CM6 view plugin that underlines deck words.
 *
 * Scans only `view.visibleRanges`, so cost tracks the viewport, not the
 * document. While typing, existing decorations are remapped through the
 * change (visually stable, zero cost) and a debounced full rescan follows.
 */
export function buildHighlightViewPlugin(provider: MatcherProvider): InohHighlighterPlugin {
  class InohHighlighter implements InohHighlighterValue {
    decorations: DecorationSet = Decoration.none;
    matches: DeckMatch[] = [];
    private rebuildTimer: number | null = null;

    constructor(private readonly view: EditorView) {
      this.rebuild(view);
    }

    update(update: ViewUpdate): void {
      const hasRefreshEffect = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(deckRefreshEffect)),
      );
      if (hasRefreshEffect) {
        this.rebuild(update.view);
        return;
      }

      if (update.docChanged) {
        this.decorations = this.decorations.map(update.changes);
        this.matches = this.matches.map((match) => ({
          ...match,
          from: update.changes.mapPos(match.from),
          to: update.changes.mapPos(match.to),
        }));
        this.scheduleRebuild();
      } else if (update.viewportChanged) {
        this.rebuild(update.view);
      }
    }

    destroy(): void {
      if (this.rebuildTimer !== null) {
        window.clearTimeout(this.rebuildTimer);
      }
    }

    private scheduleRebuild(): void {
      if (this.rebuildTimer !== null) {
        window.clearTimeout(this.rebuildTimer);
      }
      this.rebuildTimer = window.setTimeout(() => {
        this.rebuildTimer = null;
        // Dispatching (rather than rebuilding directly) routes the rescan
        // through update(), keeping decorations in sync with view state.
        this.view.dispatch({ effects: deckRefreshEffect.of(null) });
      }, HIGHLIGHT_REBUILD_DEBOUNCE_MS);
    }

    private rebuild(view: EditorView): void {
      const matcher = provider.getMatcher();
      if (!matcher) {
        this.decorations = Decoration.none;
        this.matches = [];
        return;
      }

      const mark = Decoration.mark({ class: provider.getHighlightClass() });
      const builder = new RangeSetBuilder<Decoration>();
      const matches: DeckMatch[] = [];

      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        for (const match of matcher.scanText(text, from)) {
          matches.push(match);
          builder.add(match.from, match.to, mark);
        }
      }

      this.matches = matches;
      this.decorations = builder.finish();
    }
  }

  return ViewPlugin.fromClass(InohHighlighter, {
    decorations: (value) => value.decorations,
  });
}

/** Dispatches a rescan to one editor (exported for the plugin to fan out). */
export function dispatchDeckRefresh(view: EditorView): void {
  view.dispatch({ effects: deckRefreshEffect.of(null) });
}
