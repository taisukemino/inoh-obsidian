/**
 * Removes every close button a modal renders, so the card is the whole
 * dialog and closing is done by tapping/clicking outside it.
 *
 * The button's class differs per platform (verified in each Obsidian 1.13
 * app bundle): desktop creates `.modal-close-button`, mobile creates
 * `.modal-header-button`. Both are built once in the Modal constructor and
 * never re-created, so removing them in `onOpen` is final.
 *
 * @param containerEl - The modal's outermost element (`Modal.containerEl`)
 */
export function removeModalCloseButtons(containerEl: HTMLElement): void {
  containerEl
    .querySelectorAll(".modal-close-button, .modal-header-button")
    .forEach((buttonEl) => buttonEl.remove());
}
