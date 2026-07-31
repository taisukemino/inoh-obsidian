import type { App } from "obsidian";

/**
 * Supabase auth storage backed by Obsidian's vault-scoped local storage.
 *
 * Sessions deliberately do NOT live in the plugin's data.json: data.json syncs
 * with the vault (Obsidian Sync, iCloud, git), and refresh tokens must stay on
 * this device. `app.saveLocalStorage` is per-device and already scoped to the
 * vault, so two vaults on one machine keep separate sessions.
 */
export type SupabaseAuthStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export function createAuthStorage(app: App): SupabaseAuthStorage {
  const namespacedKey = (key: string): string => `inoh/${key}`;

  return {
    getItem: (key) => {
      const stored: unknown = app.loadLocalStorage(namespacedKey(key));
      return typeof stored === "string" ? stored : null;
    },
    setItem: (key, value) => app.saveLocalStorage(namespacedKey(key), value),
    // Obsidian clears the entry when the value is null.
    removeItem: (key) => app.saveLocalStorage(namespacedKey(key), null),
  };
}
