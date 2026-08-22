import { setIcon, type SettingDefinition } from "obsidian";
import {
  CHROME_EXTENSION_URL,
  IOS_APP_URL,
  RAYCAST_EXTENSION_URL,
  WEB_APP_URL,
} from "../constants";
import { openExternalUrl } from "../ui";
import { APP_ICON_IDS } from "./app-icons";

/**
 * Cross-promotion rows for the other Inoh ecosystem apps (this plugin
 * excluded). The icon + name itself is the link — no separate button.
 *
 * @returns One setting row per Inoh app, for the settings tab's Apps group
 */
export function appsDefinitions(): SettingDefinition[] {
  const apps: { name: string; icon: string; url: string }[] = [
    { name: "iOS app", icon: APP_ICON_IDS.apple, url: IOS_APP_URL },
    { name: "Web app", icon: "globe", url: WEB_APP_URL },
    { name: "Chrome extension", icon: APP_ICON_IDS.chrome, url: CHROME_EXTENSION_URL },
    { name: "Raycast extension", icon: APP_ICON_IDS.raycast, url: RAYCAST_EXTENSION_URL },
  ];
  return apps.map(({ name, icon, url }) => ({
    name,
    // The settings tab's update() re-runs render on the same row elements: it
    // resets the visible content (the icon) but keeps the elements and their
    // listeners. So the icon is re-added whenever it is missing, while the
    // click handler is assigned (not addEventListener) so a re-render replaces
    // it instead of stacking one opened tab per refresh.
    render: (setting) => {
      if (!setting.nameEl.querySelector(".inoh-app-icon")) {
        const iconElement = setting.nameEl.createSpan({ cls: "inoh-app-icon" });
        setIcon(iconElement, icon);
        setting.nameEl.prepend(iconElement);
      }
      setting.nameEl.addClass("inoh-app-name-link");
      setting.nameEl.setAttribute("role", "link");
      setting.nameEl.onclick = () => {
        openExternalUrl(url);
      };
    },
  }));
}
