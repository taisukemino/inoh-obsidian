// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { removeModalCloseButtons } from "./remove-modal-close-buttons";

/**
 * Replicates the modal DOM Obsidian 1.13 desktop builds (obsidian.asar):
 * modal-container > modal-bg + modal > modal-close-button + modal-header +
 * modal-content.
 */
function buildDesktopModalDom(): HTMLElement {
  const containerEl = document.createElement("div");
  containerEl.className = "modal-container";
  containerEl.innerHTML = `
    <div class="modal-bg"></div>
    <div class="modal">
      <div class="modal-close-button"></div>
      <div class="modal-header"><div class="modal-title"></div></div>
      <div class="modal-content"></div>
    </div>`;
  return containerEl;
}

/**
 * Replicates the modal DOM Obsidian 1.13 mobile builds (APK bundle): the
 * close button is a modal-header-button with an x icon, not a
 * modal-close-button.
 */
function buildMobileModalDom(): HTMLElement {
  const containerEl = document.createElement("div");
  containerEl.className = "modal-container";
  containerEl.innerHTML = `
    <div class="modal-bg"></div>
    <div class="modal">
      <div class="modal-header-button mod-raised clickable-icon"><svg></svg></div>
      <div class="modal-header"><div class="modal-title"></div></div>
      <div class="modal-content"></div>
    </div>`;
  return containerEl;
}

describe("removeModalCloseButtons", () => {
  it("removes the desktop close button", () => {
    const containerEl = buildDesktopModalDom();
    removeModalCloseButtons(containerEl);
    expect(containerEl.querySelector(".modal-close-button")).toBeNull();
  });

  it("removes the mobile header close button", () => {
    const containerEl = buildMobileModalDom();
    removeModalCloseButtons(containerEl);
    expect(containerEl.querySelector(".modal-header-button")).toBeNull();
  });

  it("keeps the rest of the modal intact", () => {
    for (const containerEl of [buildDesktopModalDom(), buildMobileModalDom()]) {
      removeModalCloseButtons(containerEl);
      expect(containerEl.querySelector(".modal-bg")).not.toBeNull();
      expect(containerEl.querySelector(".modal-header")).not.toBeNull();
      expect(containerEl.querySelector(".modal-content")).not.toBeNull();
    }
  });
});
