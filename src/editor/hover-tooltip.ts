import type { Extension } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";
import type { DeckCard } from "../types";
import { renderDeckWordCard } from "./deck-word-card";
import type { InohHighlighterPlugin } from "./highlight-extension";

/**
 * Builds the hover tooltip that shows a deck card when the pointer rests on a
 * highlighted word. Reads matches straight off the highlighter view plugin,
 * so there is no second scan. Touch devices get the same card in a modal via
 * the tap handler instead — hover does not exist there.
 *
 * @param highlighterPlugin - Source of the deck-word matches
 * @param onRemoveCard - Removes the card from the deck; resolves true on success
 */
export function buildHoverTooltip(
  highlighterPlugin: InohHighlighterPlugin,
  onRemoveCard: (card: DeckCard) => Promise<boolean>,
): Extension {
  return hoverTooltip(
    (view, pos) => {
      const highlighter = view.plugin(highlighterPlugin);
      const match = highlighter?.matches.find((m) => m.from <= pos && pos <= m.to);
      if (!match) {
        return null;
      }

      return {
        pos: match.from,
        end: match.to,
        above: true,
        create: () => ({ dom: renderDeckWordCard(match.card, { onRemove: onRemoveCard }) }),
      };
    },
    { hoverTime: 200 },
  );
}
