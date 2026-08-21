/**
 * The Obsidian plugin's core promise: deck words you write in a note get
 * underlined, you can add a new word from the editor, and the toggle turns
 * highlighting off.
 */

import { expect, test } from '@playwright/test';
import {
  assertLocalStackReady,
  readAccountState,
  readSignInCode,
  resetAccount,
  type SeededAccount,
} from '../fixtures/backend';
import {
  closeSettings,
  openNote,
  openPluginSettings,
  runCommand,
  selectWordInEditor,
  signInThroughSettings,
  startObsidian,
  type ObsidianSession,
} from '../fixtures/obsidian';

const EMAIL = 'e2e-obsidian@test.com';
/** Matches `getHighlightClass()` in src/main.ts. */
const HIGHLIGHT_CLASS = 'inoh-deck-word';

let session: ObsidianSession;
let account: SeededAccount;

test.beforeAll(async () => {
  assertLocalStackReady();
  account = resetAccount({ email: EMAIL, profile: 'learner' });
  session = await startObsidian();

  // Sign in through the plugin's own settings tab and sign-in modal, which
  // live in Obsidian's separate settings window.
  const settings = await openPluginSettings(session.page);
  await signInThroughSettings(settings, EMAIL, (sinceMs) => readSignInCode(EMAIL, sinceMs));
  await closeSettings(session.page);
});

test.afterAll(async () => {
  await session?.close();
});

/** The words currently underlined in the open note. */
const readHighlightedWords = () => session.page.locator(`.${HIGHLIGHT_CLASS}`).allTextContents();

test('the status bar reports the signed-in deck size', async () => {
  // Scoped to the plugin's own status item: Obsidian's word-count item also
  // renders "<n> words" into the same status bar.
  await expect(session.page.locator('.status-bar')).toContainText(
    `Inoh: ${account.cardCount} words`,
    { timeout: 30_000 },
  );
});

test('a deck word written in a note is underlined; a non-deck word is not', async () => {
  const deckWord = account.words[0];
  const otherWord = account.spareWords[0];
  await openNote(session.page, 'reading.md', `I met ${deckWord} today, then ${otherWord}.`);

  await expect.poll(readHighlightedWords, { timeout: 30_000 }).toContain(deckWord);
  expect(await readHighlightedWords()).not.toContain(otherWord);
});

test('toggling highlighting off removes the underlines', async () => {
  await openNote(session.page, 'reading.md', `Reading about ${account.words[0]}.`);
  await expect.poll(readHighlightedWords, { timeout: 30_000 }).not.toEqual([]);

  expect(await runCommand(session.page, 'inoh:toggle-highlighting')).toBe(true);
  await expect.poll(readHighlightedWords, { timeout: 20_000 }).toEqual([]);

  expect(await runCommand(session.page, 'inoh:toggle-highlighting')).toBe(true);
  await expect.poll(readHighlightedWords, { timeout: 20_000 }).not.toEqual([]);
});

test('adding a selected word from the editor puts it in the deck', async () => {
  const newWord = account.spareWords[0];
  await openNote(session.page, 'capture.md', `The word ${newWord} is worth learning.`);

  expect(await selectWordInEditor(session.page, newWord)).toBe(true);
  expect(await runCommand(session.page, 'inoh:add-word-to-deck')).toBe(true);

  await expect
    .poll(() => readAccountState(EMAIL).words, { timeout: 30_000 })
    .toContain(newWord);
  // And once it is a deck word, it starts getting underlined.
  await expect.poll(readHighlightedWords, { timeout: 30_000 }).toContain(newWord);
});
