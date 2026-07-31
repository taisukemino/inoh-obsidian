/**
 * Supabase auth storage backed by `window.localStorage`.
 *
 * Sessions deliberately do NOT live in the plugin's data.json: data.json syncs
 * with the vault (Obsidian Sync, iCloud, git), and refresh tokens must stay on
 * this device. localStorage is per-device and per-app, matching how the Inoh
 * Raycast extension scopes its sessions.
 *
 * Keys are prefixed per vault so two vaults on one machine keep separate sessions.
 */
export type SupabaseAuthStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export function createAuthStorage(vaultId: string): SupabaseAuthStorage {
  const prefixKey = (key: string): string => `inoh/${vaultId}/${key}`;

  return {
    getItem: (key) => window.localStorage.getItem(prefixKey(key)),
    setItem: (key, value) => window.localStorage.setItem(prefixKey(key), value),
    removeItem: (key) => window.localStorage.removeItem(prefixKey(key)),
  };
}
