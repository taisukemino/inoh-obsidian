/**
 * Launches the real Obsidian app and drives it over the Chrome DevTools
 * Protocol.
 *
 * Obsidian is an Electron app with no official test harness, so this is the
 * closest thing to a user's install: the actual binary, the actual plugin
 * bundle in a vault, and the actual CodeMirror editor.
 *
 * Two isolation guarantees, both important — a developer's real notes are on
 * this machine:
 *   - `--user-data-dir` points Obsidian at a throwaway config directory, so it
 *     never sees the real vault list, and the real install's settings are left
 *     alone.
 *   - The vault is `e2e/fixtures/vault` inside this repo, committed and
 *     disposable.
 */

import { expect, chromium, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const OBSIDIAN_BINARY =
  process.env.OBSIDIAN_BINARY ?? '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const VAULT_PATH = path.resolve(process.cwd(), 'e2e/fixtures/vault');
const PLUGIN_ID = 'inoh';
const DEBUG_PORT = Number(process.env.OBSIDIAN_DEBUG_PORT ?? 9222);
const STARTUP_TIMEOUT_MS = 60_000;

/** Where the real install keeps its self-updated app bundles. */
const INSTALLED_USER_DATA_DIR = path.join(homedir(), 'Library/Application Support/obsidian');

/**
 * Copies the newest self-updated app bundle into the throwaway config
 * directory.
 *
 * Reason: Obsidian ships an older bundle inside the .app and updates itself by
 * writing `obsidian-<version>.asar` into its user data directory. A fresh
 * `--user-data-dir` therefore falls back to whatever the installer shipped —
 * here Obsidian 1.7.7, below the plugin's own `minAppVersion` of 1.13.0. The
 * suite has to run on the version users actually have.
 *
 * @param userDataDir - The throwaway config directory
 * @returns The bundle copied, or null when the install has never updated
 */
function copyUpdatedAppBundle(userDataDir: string): string | null {
  if (!existsSync(INSTALLED_USER_DATA_DIR)) {
    return null;
  }
  const bundles = readdirSync(INSTALLED_USER_DATA_DIR)
    .filter((name) => /^obsidian-[\d.]+\.asar$/.test(name))
    .sort();
  const newest = bundles.at(-1);
  if (!newest) {
    return null;
  }
  copyFileSync(
    path.join(INSTALLED_USER_DATA_DIR, newest),
    path.join(userDataDir, newest),
  );
  return newest;
}

export type ObsidianSession = {
  page: Page;
  vaultPath: string;
  close: () => Promise<void>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for the app to expose a debuggable window. */
async function connectWhenReady(): Promise<Browser> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw new Error(
    `Obsidian never opened a debug port on ${DEBUG_PORT} within ${STARTUP_TIMEOUT_MS}ms. ` +
      `Is ${OBSIDIAN_BINARY} the right binary?\n${lastError}`,
  );
}

/**
 * Starts Obsidian on the fixture vault with the plugin loaded and ready.
 *
 * @returns The app window plus a teardown that quits the app
 */
export async function startObsidian(): Promise<ObsidianSession> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'inoh-obsidian-e2e-'));
  const appBundle = copyUpdatedAppBundle(userDataDir);
  if (!appBundle) {
    console.warn(
      'No self-updated Obsidian bundle found; falling back to the version inside the .app, ' +
        "which may be older than the plugin's minAppVersion.",
    );
  }
  // Registering the vault as already open skips the vault picker.
  writeFileSync(
    path.join(userDataDir, 'obsidian.json'),
    JSON.stringify({ vaults: { e2efixturevault: { path: VAULT_PATH, ts: 1, open: true } } }),
  );

  const app: ChildProcess = spawn(
    OBSIDIAN_BINARY,
    [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${DEBUG_PORT}`],
    { stdio: 'ignore', detached: false },
  );

  const browser = await connectWhenReady();
  const page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => !!(window as never as { app?: unknown }).app, null, {
    timeout: STARTUP_TIMEOUT_MS,
  });

  // A fresh config directory starts in Restricted Mode, where community
  // plugins never load. Lifting it through the API is deterministic, where
  // reverse-engineering which config file holds the flag is not.
  await page.evaluate(async (pluginId) => {
    const obsidian = (window as never as { app: ObsidianApp }).app;
    await obsidian.plugins.setEnable(true);
    await obsidian.plugins.enablePlugin(pluginId);
  }, PLUGIN_ID);
  await page.waitForFunction(
    (pluginId) => !!(window as never as { app: ObsidianApp }).app.plugins.plugins[pluginId],
    PLUGIN_ID,
    { timeout: 30_000 },
  );

  return {
    page,
    vaultPath: VAULT_PATH,
    close: async () => {
      await browser.close().catch(() => undefined);
      app.kill();
      // Reason: Obsidian may still be flushing its caches as it exits, so a
      // failure to delete its scratch directory must not fail the run.
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // Left behind in the OS temp directory; harmless.
      }
    },
  };
}

/** The slice of Obsidian's undocumented `window.app` this suite drives. */
type ObsidianApp = {
  plugins: {
    setEnable: (enabled: boolean) => Promise<void>;
    enablePlugin: (id: string) => Promise<void>;
    plugins: Record<string, unknown>;
  };
  commands: { executeCommandById: (id: string) => boolean };
  setting: { open: () => void; close: () => void };
  vault: {
    getAbstractFileByPath: (filePath: string) => unknown;
    create: (filePath: string, contents: string) => Promise<unknown>;
    modify: (file: unknown, contents: string) => Promise<void>;
  };
  workspace: {
    openLinkText: (link: string, source: string) => Promise<void>;
    activeEditor?: {
      editor?: {
        lineCount: () => number;
        getLine: (line: number) => string;
        setSelection: (
          from: { line: number; ch: number },
          to: { line: number; ch: number },
        ) => void;
      };
    };
  };
};

/**
 * Creates (or rewrites) a note and opens it in the editor.
 *
 * @param page - The Obsidian window
 * @param fileName - Note file name, e.g. `reading.md`
 * @param contents - Markdown body
 */
export async function openNote(page: Page, fileName: string, contents: string): Promise<void> {
  await page.evaluate(
    async ({ fileName: name, contents: body }) => {
      const obsidian = (window as never as { app: ObsidianApp }).app;
      const existing = obsidian.vault.getAbstractFileByPath(name);
      if (existing) {
        await obsidian.vault.modify(existing, body);
      } else {
        await obsidian.vault.create(name, body);
      }
      await obsidian.workspace.openLinkText(name, '');
    },
    { fileName, contents },
  );
}

/** Runs one of the plugin's commands, as the command palette would. */
export const runCommand = (page: Page, commandId: string) =>
  page.evaluate(
    (id) => (window as never as { app: ObsidianApp }).app.commands.executeCommandById(id),
    commandId,
  );

/**
 * Opens Obsidian's settings and navigates to the plugin's tab.
 *
 * Obsidian 1.13 renders Settings in a **separate window**, which shows up as a
 * second CDP page rather than a modal in the main one — that is why
 * `app.setting.open()` looks like it does nothing when you only ever inspect
 * the window you started from.
 *
 * @param page - The main Obsidian window
 * @param pluginName - The plugin's display name from manifest.json
 * @returns The settings window, scrolled to the plugin's tab
 */
export async function openPluginSettings(page: Page, pluginName = 'Inoh'): Promise<Page> {
  const context = page.context();
  const alreadyOpen = context.pages().find((candidate) => candidate !== page);
  if (!alreadyOpen) {
    await page.evaluate(() => {
      (window as never as { app: ObsidianApp }).app.setting.open();
    });
  }
  const settings = await waitForSettingsWindow(page);

  const tab = settings.locator('.vertical-tab-nav-item').filter({ hasText: pluginName }).first();
  await tab.scrollIntoViewIfNeeded();
  // Reason: the community-plugin tabs sit below the fold in a short window, and
  // Obsidian's own nav rows report as not visible to Playwright's actionability
  // check even once scrolled to.
  await tab.click({ force: true });
  return settings;
}

/** Waits for the settings window to appear as a second page. */
async function waitForSettingsWindow(page: Page): Promise<Page> {
  const context = page.context();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const settings = context.pages().find((candidate) => candidate !== page);
    if (settings && (await settings.locator('.vertical-tab-nav-item').count()) > 0) {
      return settings;
    }
    await sleep(250);
  }
  throw new Error('Obsidian never opened its settings window.');
}

/**
 * Signs in the way a user does: the plugin's settings tab, its sign-in modal,
 * and a real emailed code.
 *
 * The modal renders in the settings window, not the main one.
 *
 * @param settings - The settings window, already on the plugin's tab
 * @param email - The seeded test account's address
 * @param readCode - Reads the emailed code, given the instant the request was sent
 */
export async function signInThroughSettings(
  settings: Page,
  email: string,
  readCode: (sinceMs: number) => string,
): Promise<void> {
  await settings.getByText('Sign in or sign up', { exact: true }).first().click({ force: true });

  await settings.getByPlaceholder('you@example.com').fill(email);
  const requestedAtMs = Date.now();
  await settings.getByText('Send code', { exact: true }).first().click({ force: true });

  const codeField = settings.getByPlaceholder('123456');
  await expect(codeField).toBeVisible({ timeout: 30_000 });
  await codeField.fill(readCode(requestedAtMs));
  await settings.getByText('Verify', { exact: true }).first().click({ force: true });

  // The settings tab swaps the sign-in row for the account row once signed in.
  await expect(settings.getByText(email).first()).toBeVisible({ timeout: 30_000 });
}

/** Closes the settings window. */
export const closeSettings = (page: Page) =>
  page.evaluate(() => {
    (window as never as { app: ObsidianApp }).app.setting.close();
  });

/** The plugin's own surface this suite reaches for. */
type InohPlugin = {
  refreshDeck: () => Promise<void>;
  supabase: {
    auth: {
      signInWithOtp: (input: unknown) => Promise<{ error: { message: string } | null }>;
      verifyOtp: (input: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
};

/**
 * Selects a word in the open note, the way a user drags across it.
 *
 * @param page - The Obsidian window
 * @param word - Text to select; the first occurrence in the note is used
 * @returns Whether the word was found
 */
export const selectWordInEditor = (page: Page, word: string) =>
  page.evaluate((target) => {
    const editor = (window as never as { app: ObsidianApp }).app.workspace.activeEditor?.editor;
    if (!editor) {
      return false;
    }
    for (let line = 0; line < editor.lineCount(); line++) {
      const column = editor.getLine(line).indexOf(target);
      if (column !== -1) {
        editor.setSelection({ line, ch: column }, { line, ch: column + target.length });
        return true;
      }
    }
    return false;
  }, word);
