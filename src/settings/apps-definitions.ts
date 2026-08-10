import { setIcon, type SettingDefinition } from "obsidian";
import { CHROME_EXTENSION_URL, RAYCAST_EXTENSION_URL, WEB_APP_URL } from "../constants";
import { openExternalUrl } from "../ui";
import { APP_ICON_IDS } from "./app-icons";

/**
 * Cross-promotion rows for the other Inoh ecosystem apps (this plugin
 * excluded). The icon + name itself is the link — no separate button. Apps
 * without a `url` are unreleased — the iOS App Store listing is mid-rebrand
 * — so they get a muted non-clickable "Coming soon" label instead.
 *
 * @returns One setting row per Inoh app, for the settings tab's Apps group
 */
export function appsDefinitions(): SettingDefinition[] {
  const apps: { name: string; icon: string; url?: string }[] = [
    { name: "iOS app", icon: APP_ICON_IDS.apple },
    { name: "Web app", icon: "globe", url: WEB_APP_URL },
    { name: "Chrome extension", icon: APP_ICON_IDS.chrome, url: CHROME_EXTENSION_URL },
    { name: "Raycast extension", icon: APP_ICON_IDS.raycast, url: RAYCAST_EXTENSION_URL },
  ];
  return apps.map(({ name, icon, url }) => ({
    name,
    render: (setting) => {
      const iconElement = setting.nameEl.createSpan({ cls: "inoh-app-icon" });
      setIcon(iconElement, icon);
      setting.nameEl.prepend(iconElement);
      if (url) {
        setting.nameEl.addClass("inoh-app-name-link");
        setting.nameEl.setAttribute("role", "link");
        setting.nameEl.addEventListener("click", () => {
          openExternalUrl(url);
        });
      } else {
        setting.controlEl.createSpan({ cls: "inoh-coming-soon", text: "Coming soon" });
      }
    },
  }));
}
