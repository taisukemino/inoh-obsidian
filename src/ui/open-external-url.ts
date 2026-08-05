import { Platform } from "obsidian";

type CapacitorBrowser = { open: (options: { url: string }) => Promise<void> };
type CapacitorGlobal = { Plugins?: { Browser?: CapacitorBrowser } };

/**
 * Opens a URL in the system browser on every platform.
 *
 * `window.open` is a silent no-op inside Obsidian's mobile app — core itself
 * routes external links through the Capacitor Browser plugin there (verified
 * in the mobile app bundle), so this does the same and falls back to
 * `window.open` on desktop.
 *
 * @param url - The https URL to open
 */
export function openExternalUrl(url: string): void {
  const capacitor = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  const capacitorBrowser = capacitor?.Plugins?.Browser;
  if (Platform.isMobileApp && capacitorBrowser) {
    void capacitorBrowser.open({ url });
    return;
  }
  window.open(url);
}
