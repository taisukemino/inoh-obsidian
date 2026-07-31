import type { Editor } from "obsidian";

/**
 * Returns the paragraph containing the cursor: the block of consecutive
 * non-blank lines around it, joined with newlines. Null when the cursor is
 * on a blank line.
 */
export function getParagraphAtCursor(editor: Editor): string | null {
  const cursorLine = editor.getCursor().line;
  if (editor.getLine(cursorLine).trim() === "") {
    return null;
  }

  let firstLine = cursorLine;
  while (firstLine > 0 && editor.getLine(firstLine - 1).trim() !== "") {
    firstLine -= 1;
  }

  let lastLine = cursorLine;
  while (lastLine < editor.lineCount() - 1 && editor.getLine(lastLine + 1).trim() !== "") {
    lastLine += 1;
  }

  const lines: string[] = [];
  for (let line = firstLine; line <= lastLine; line += 1) {
    lines.push(editor.getLine(line));
  }
  return lines.join("\n");
}
