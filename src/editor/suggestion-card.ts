import { EditorSelection, type Extension } from "@codemirror/state";
import { hoverTooltip, tooltips, type EditorView } from "@codemirror/view";
import { applySuggestion, dismissSuggestion } from "./suggestion-actions";
import { suggestionField, type ActiveSuggestion } from "./suggestion-extension";

/** Builds the hover tooltip with Apply / Dismiss actions for a marked phrase. */
export function buildSuggestionTooltip(): Extension {
  // Reason: Obsidian's workspace leaves use CSS containment, which clips
  // even fixed-position tooltips at the pane edge and paints the sidebar
  // over them. Rendering into document.body escapes the pane entirely, so
  // CodeMirror can keep the tooltip fully visible inside the window.
  const tooltipPositioning = tooltips({ position: "fixed", parent: document.body });
  const suggestionHoverTooltip = hoverTooltip(
    (view, pos) => {
      const active = view.state
        .field(suggestionField)
        .find((candidate) => candidate.from <= pos && pos <= candidate.to);
      if (!active) {
        return null;
      }
      // Anchor to the phrase's portion on the hovered visual line: a wrapped
      // phrase starts on an earlier line, and a tooltip anchored there can sit
      // too far from the pointer to reach before the hover check hides it.
      const hoveredLineStart = view.moveToLineBoundary(EditorSelection.cursor(pos), false).head;
      return {
        pos: Math.max(active.from, hoveredLineStart),
        end: active.to,
        above: true,
        create: () => ({ dom: renderSuggestionCard(view, active) }),
      };
    },
    { hoverTime: 150 },
  );
  return [tooltipPositioning, suggestionHoverTooltip];
}

/**
 * Renders one suggestion: the deck word, its definition, the original → rewrite
 * diff, the model's explanation, and Apply / Dismiss buttons.
 *
 * Shared by the desktop hover tooltip and the mobile tap modal, so both
 * surfaces show exactly the same content.
 *
 * @param view - The editor holding the suggestion
 * @param active - The suggestion to render
 * @param onAfterAction - Called after any button acts, so a modal can close;
 *   the hover tooltip closes itself and passes nothing
 */
export function renderSuggestionCard(
  view: EditorView,
  active: ActiveSuggestion,
  onAfterAction?: () => void,
): HTMLElement {
  const { suggestion } = active;
  const root = createDiv({ cls: "inoh-tooltip" });

  root.createDiv({ cls: "inoh-suggestion-word", text: suggestion.word });
  if (suggestion.definition) {
    root.createDiv({ cls: "inoh-tooltip-definition", text: suggestion.definition });
  }

  const diff = root.createDiv({ cls: "inoh-suggestion-diff" });
  diff.createSpan({ cls: "inoh-suggestion-original", text: suggestion.original });
  diff.createSpan({ text: " → " });
  diff.createSpan({ cls: "inoh-suggestion-replacement", text: suggestion.replacement });

  if (suggestion.explanation) {
    root.createDiv({ cls: "inoh-suggestion-explanation", text: suggestion.explanation });
  }

  const buttons = root.createDiv({ cls: "inoh-suggestion-buttons" });

  const applyButton = buttons.createEl("button", { text: "Apply", cls: "inoh-suggestion-apply" });
  applyButton.addEventListener("click", () => {
    applySuggestion(view, active.id);
    onAfterAction?.();
  });

  const dismissButton = buttons.createEl("button", {
    text: "Dismiss",
    cls: "inoh-suggestion-dismiss",
  });
  dismissButton.addEventListener("click", () => {
    dismissSuggestion(view, active.id);
    onAfterAction?.();
  });

  return root;
}
