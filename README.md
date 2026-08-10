# Inoh for Obsidian

<!-- Suggestions are disabled until their quality improves. Original tagline:
Highlights words from your [Inoh](https://inoh.app) vocabulary deck while you write and suggests places to use them — so you actually use what you're learning.
-->
Highlights words from your [Inoh](https://inoh.app) vocabulary deck while you write — so you actually use what you're learning.

## Features

- **Deck-word highlighting.** Words from your deck get a dotted underline as you write, including inflected forms (*crossed* for *cross*, *went* for *go*) and multi-word idioms (*counted my blessings* for *count one's blessings*, *gave the idea up* for *give up*). Matching is exact against real English forms — *brain* never lights up *brainy*.
- **Hover — or tap — to review.** Hovering a highlighted word shows its definition, phonetic, example sentence, and pronunciation audio, with a link to the word in the Inoh app — plus a "Remove from deck" action for words you've finished learning. On mobile, where hover doesn't exist, tapping a highlighted word opens the same card in a dialog.
<!-- Suggestions are disabled until their quality improves. Original bullets:
- **Hover — or tap — to review.** … On mobile, where hover doesn't exist, tapping a highlighted word or suggested phrase opens the same card in a dialog.
- **AI suggestions.** Run **Suggest deck words for selection or note** — it works on the selected passage, or the entire note when nothing is selected. On mobile the selection is lost when the command palette opens, so there the command is named **Suggest deck words for entire note** and always covers the whole note. Phrases that could be rewritten with one of your deck words get a wavy underline; hover one to see the deck word, its definition, the rewrite, and a one-sentence explanation of why it fits — then Apply or Dismiss. Free accounts get a limited number of suggestion requests per day; Inoh Pro is unlimited — you can upgrade from the plugin settings without leaving Obsidian.
-->
- **Add words without leaving Obsidian.** Select a word (or phrase) and a **＋ Add to Inoh** button pops up right above it; on mobile the same action lives in the long-press menu. There's also an **Add selected word to deck** command, which works on the word under the cursor too. Inflected forms find their entry (*flipped* adds *flip*), and if the word has several meanings you pick the right one from a list.
- **Works offline.** Your deck is cached locally, so highlighting keeps working without a connection.

## Getting started

1. Enable the plugin, then open its settings.
2. Click **Sign in or sign up** — enter your email and the six-digit code you receive. A new email creates an Inoh account automatically.
3. Build your vocabulary deck at [inoh.app](https://inoh.app) (or in the Inoh iOS app), then hit **Refresh** — or just click the status bar item.
4. Write. Deck words light up as you type; the status bar shows how many words are loaded.

## Network use disclosure

- The plugin talks to Inoh's backend (Supabase) to sign you in and download your vocabulary deck.
<!-- Suggestions are disabled until their quality improves. Original disclosure:
- When you run the suggestion command, your selected text (up to 2,000 characters) and your deck words are sent to Inoh's backend, which uses OpenAI to generate suggestions. Nothing else from your vault is ever uploaded.
-->
- When you add a word to your deck, that word is sent to Inoh's backend to look it up in the dictionary. Nothing else from your vault is ever uploaded.
- If you choose to upgrade, the plugin asks Inoh's backend for a Stripe Checkout link and opens it in your browser. Payment details go to Stripe and are never seen by the plugin; it only reads back whether your account is on the Free, Plus, or Pro plan.
- Auth tokens are stored in device-local storage, never in vault files, so they are not carried along by vault sync services.

## Development

```bash
pnpm install
pnpm dev        # watch build into your vault, against the production backend
pnpm dev:local  # same, but against a local Supabase stack (Stripe test mode)
pnpm test       # vitest — matching engine
pnpm typecheck  # tsc --noEmit
pnpm lint       # eslint (type-checked rules); pnpm lint:fix to autofix
pnpm format     # prettier --write src; pnpm format:check to verify only
pnpm build      # typecheck + lint + minified production build to ./main.js
```

Backend selection follows the Inoh app's `APP_ENV` convention: `.env.<APP_ENV>` is loaded on top of `.env`, and `APP_ENV` defaults to `prod`. **The production project runs live Stripe keys, so completing checkout against it charges a real card.** To exercise the upgrade flow safely, run `supabase start` in `inoh-backend`, put the URL and publishable key it prints into `.env.local`, and use `pnpm dev:local` — that stack runs Stripe test keys, so card `4242 4242 4242 4242` works. Every dev build prints which backend it targets. `pnpm build` ignores the env files entirely and always targets production, so a local URL can never ship.

`pnpm dev` writes straight into a vault. It defaults to `~/Obsidian` and needs no setup if your vault lives there; otherwise copy `.env.example` to `.env` (gitignored) and point `OBSIDIAN_VAULT` at your vault's root — the folder containing `.obsidian/`. An `OBSIDIAN_VAULT` already in your environment wins over `.env`, so `OBSIDIAN_VAULT=~/Notes pnpm dev` works for a one-off. The build refuses to run if the resolved path has no `.obsidian/`, rather than creating directories somewhere unexpected. Install [hot-reload](https://github.com/pjeby/hot-reload) in the same vault and the plugin reloads on every rebuild.

```
src/
├── main.ts                  # plugin wiring
├── supabase/                # backend URL/key (per APP_ENV), client factory, email-OTP auth
├── deck/                    # fetch + cache + deck-changed events, add-word flow (lookup, sense picker)
├── matching/                # deck index + token-driven matcher (pure TS, unit-tested)
├── editor/                  # CM6 extensions: highlight decorations, hover tooltip, inline suggestions
├── suggestions/             # suggest-deck-words edge function client
├── subscriptions/           # Stripe checkout client + upgrade modal
├── settings/                # settings tab + sign-in modal
└── ui/status-bar.ts
```

Implementation notes: the highlighter is a CodeMirror 6 view plugin that scans only the visible viewport, debounced 200 ms after the last keystroke; each deck word is expanded into its exact surface forms at index time, so a rescan is a map lookup per token. Obsidian's own `@codemirror/*` packages are `external` in the build — bundling a second copy breaks decoration rendering.

## License

[MIT](LICENSE)
