import { ItemView, MarkdownView, Notice, WorkspaceLeaf } from "obsidian";
import type { DeckWordSuggestion } from "./suggestion-service";

export const SUGGESTION_VIEW_TYPE = "inoh-suggestions";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "results";
      filePath: string;
      suggestions: DeckWordSuggestion[];
      remainingSuggestionsToday?: number;
    };

/**
 * Right-sidebar panel listing "use a deck word here" suggestions for the
 * paragraph the user requested them on, with Apply / Dismiss per suggestion.
 */
export class SuggestionView extends ItemView {
  private state: ViewState = { kind: "idle" };

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return SUGGESTION_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Inoh suggestions";
  }

  override getIcon(): string {
    return "lightbulb";
  }

  setLoading(): void {
    this.state = { kind: "loading" };
    this.render();
  }

  setError(message: string): void {
    this.state = { kind: "error", message };
    this.render();
  }

  setResults(
    filePath: string,
    suggestions: DeckWordSuggestion[],
    remainingSuggestionsToday?: number,
  ): void {
    this.state = { kind: "results", filePath, suggestions, remainingSuggestionsToday };
    this.render();
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("inoh-suggestions");

    switch (this.state.kind) {
      case "idle":
        container.createDiv({
          cls: "inoh-suggestions-empty",
          text: "Run “Inoh: Suggest deck words for this paragraph” while writing to get suggestions.",
        });
        return;
      case "loading":
        container.createDiv({ cls: "inoh-suggestions-empty", text: "Thinking…" });
        return;
      case "error":
        container.createDiv({ cls: "inoh-suggestions-error", text: this.state.message });
        return;
      case "results":
        this.renderResults(container, this.state);
    }
  }

  private renderResults(
    container: HTMLElement,
    state: Extract<ViewState, { kind: "results" }>,
  ): void {
    if (state.suggestions.length === 0) {
      container.createDiv({
        cls: "inoh-suggestions-empty",
        text: "No good fits in this paragraph — keep writing!",
      });
    }

    for (const suggestion of state.suggestions) {
      const item = container.createDiv({ cls: "inoh-suggestion" });
      item.createDiv({ cls: "inoh-suggestion-word", text: suggestion.word });
      const diff = item.createDiv({ cls: "inoh-suggestion-diff" });
      diff.createSpan({ cls: "inoh-suggestion-original", text: suggestion.original });
      diff.createSpan({ text: " → " });
      diff.createSpan({ cls: "inoh-suggestion-replacement", text: suggestion.replacement });

      const buttonRow = item.createDiv({ cls: "inoh-suggestion-buttons" });
      const applyButton = buttonRow.createEl("button", { text: "Apply", cls: "mod-cta" });
      applyButton.addEventListener("click", () => {
        if (this.applySuggestion(state.filePath, suggestion)) {
          this.removeSuggestion(suggestion);
        }
      });
      const dismissButton = buttonRow.createEl("button", { text: "Dismiss" });
      dismissButton.addEventListener("click", () => this.removeSuggestion(suggestion));
    }

    if (state.remainingSuggestionsToday !== undefined) {
      container.createDiv({
        cls: "inoh-suggestions-quota",
        text: `${state.remainingSuggestionsToday} free suggestions left today.`,
      });
    }
  }

  private removeSuggestion(suggestion: DeckWordSuggestion): void {
    if (this.state.kind !== "results") {
      return;
    }
    this.state.suggestions = this.state.suggestions.filter((s) => s !== suggestion);
    this.render();
  }

  /**
   * Replaces the suggestion's original phrase in the note it was generated
   * for. Searches the current document text so edits made since the request
   * don't break the offsets.
   */
  private applySuggestion(filePath: string, suggestion: DeckWordSuggestion): boolean {
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    const targetView = markdownLeaves
      .map((leaf) => leaf.view)
      .filter((view): view is MarkdownView => view instanceof MarkdownView)
      .find((view) => view.file?.path === filePath);

    if (!targetView) {
      new Notice("Open the note this suggestion was made for, then apply it.");
      return false;
    }

    const editor = targetView.editor;
    const documentText = editor.getValue();
    const matchOffset = documentText.indexOf(suggestion.original);
    if (matchOffset === -1) {
      new Notice("That phrase has changed since the suggestion was made.");
      return false;
    }

    editor.replaceRange(
      suggestion.replacement,
      editor.offsetToPos(matchOffset),
      editor.offsetToPos(matchOffset + suggestion.original.length),
    );
    return true;
  }
}
