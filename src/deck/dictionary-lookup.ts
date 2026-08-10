import type { SupabaseClient } from "@supabase/supabase-js";
import { generateLemmaCandidates } from "../matching";
import type { DictionaryLookupEntry } from "../types";

/** Homographs share a spelling; more than 8 senses of one word never happens. */
const LOOKUP_RESULT_LIMIT = 8;

/**
 * Finds dictionary entries matching the selected text or any of its lemma
 * candidates ("flipped" also finds "flip"). Exact spelling matches sort first
 * so the picked sense defaults to what the user actually selected.
 *
 * @param supabase - Signed-in Supabase client (dictionary has public read RLS)
 * @param selectedText - Raw selection from the editor
 * @returns Matching entries, exact matches first; empty when nothing matches
 * @throws {Error} When the dictionary query fails
 */
export async function findDictionaryEntries(
  supabase: SupabaseClient,
  selectedText: string,
): Promise<DictionaryLookupEntry[]> {
  const candidates = generateLemmaCandidates(selectedText);
  if (candidates.length === 0) {
    return [];
  }

  // ilike without wildcards = case-insensitive equality; candidates are
  // validated against SAFE_CANDIDATE_PATTERN, so embedding them is safe.
  const candidateFilter = candidates.map((candidate) => `word.ilike.${candidate}`).join(",");
  const { data, error } = await supabase
    .from("dictionary")
    .select("id, word, definition")
    .or(candidateFilter)
    .order("id")
    .limit(LOOKUP_RESULT_LIMIT);
  if (error) {
    throw new Error(`Dictionary lookup failed: ${error.message}`);
  }

  const selectionLowercase = selectedText.trim().toLowerCase();
  // Supabase types untyped-table selects loosely; the select above matches
  // DictionaryLookupEntry exactly.
  const entries = (data ?? []) as DictionaryLookupEntry[];
  return entries.sort(
    (left, right) =>
      Number(right.word.toLowerCase() === selectionLowercase) -
      Number(left.word.toLowerCase() === selectionLowercase),
  );
}
