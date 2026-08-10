import type { Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";

/**
 * Reaches the CodeMirror view behind an Obsidian editor. `cm` is not in the
 * public typings but is the documented community way to attach CM6 behaviour.
 *
 * @param editor - The Obsidian editor to unwrap
 * @returns The underlying CodeMirror view, or null when it is not exposed
 */
export function getEditorView(editor: Editor): EditorView | null {
  return (editor as unknown as { cm?: EditorView }).cm ?? null;
}
