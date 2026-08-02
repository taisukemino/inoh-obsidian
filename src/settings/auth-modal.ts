import { App, Modal, Notice, Setting } from "obsidian";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requestEmailCode, verifyEmailCode } from "../supabase/auth";

/**
 * Two-step email OTP sign-in: enter email → receive a six-digit code → verify.
 * Mirrors the Inoh iOS app and Raycast extension; there is no password flow.
 */
export class AuthModal extends Modal {
  private email = "";
  private code = "";
  private step: "email" | "code" = "email";
  private isBusy = false;

  constructor(
    app: App,
    private readonly supabase: SupabaseClient,
    private readonly onSignedIn: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("inoh-modal");
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    this.setTitle("Sign in or create your Inoh account");

    if (this.step === "email") {
      this.renderEmailStep();
    } else {
      this.renderCodeStep();
    }
  }

  private renderEmailStep(): void {
    new Setting(this.contentEl)
      .setName("Email")
      .setDesc("We'll email you a six-digit sign-in code. A new email creates an account.")
      .addText((text) => {
        text
          .setPlaceholder("you@example.com")
          .setValue(this.email)
          .onChange((value) => {
            this.email = value.trim();
          });
        this.submitOnEnter(text.inputEl, () => void this.sendCode());
        text.inputEl.focus();
      });

    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("Send code")
        .setCta()
        .onClick(() => void this.sendCode()),
    );
  }

  private renderCodeStep(): void {
    new Setting(this.contentEl)
      .setName("Verification code")
      .setDesc(`Enter the six-digit code sent to ${this.email}.`)
      .addText((text) => {
        text
          .setPlaceholder("123456")
          .setValue(this.code)
          .onChange((value) => {
            this.code = value.trim();
          });
        this.submitOnEnter(text.inputEl, () => void this.verifyCode());
        text.inputEl.focus();
      });

    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText("Verify")
          .setCta()
          .onClick(() => void this.verifyCode()),
      )
      .addButton((button) =>
        button.setButtonText("Use a different email").onClick(() => {
          this.step = "email";
          this.code = "";
          this.render();
        }),
      );
  }

  private async sendCode(): Promise<void> {
    if (this.isBusy) {
      return;
    }
    if (!this.email) {
      new Notice("Enter your email address first.");
      return;
    }

    this.isBusy = true;
    try {
      await requestEmailCode(this.supabase, this.email);
      this.step = "code";
      this.render();
    } catch (error) {
      new Notice(`Could not send the code: ${errorMessage(error)}`);
    } finally {
      this.isBusy = false;
    }
  }

  private async verifyCode(): Promise<void> {
    if (this.isBusy) {
      return;
    }
    if (!this.code) {
      new Notice("Enter the code from your email first.");
      return;
    }

    this.isBusy = true;
    try {
      await verifyEmailCode(this.supabase, this.email, this.code);
      new Notice("Signed in to Inoh.");
      this.close();
      this.onSignedIn();
    } catch (error) {
      new Notice(`Verification failed: ${errorMessage(error)}`);
    } finally {
      this.isBusy = false;
    }
  }

  private submitOnEnter(inputEl: HTMLInputElement, submit: () => void): void {
    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
