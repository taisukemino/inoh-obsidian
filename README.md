# Inoh for Obsidian

Highlights words from your [Inoh](https://inoh.app) vocabulary deck while you write and suggests places to use them — so you actually use what you're learning.

## Features

- **Deck-word highlighting.** Words from your deck get a dotted underline as you write, including inflected forms (*crossed* for *cross*, *went* for *go*) and multi-word idioms (*counted my blessings* for *count one's blessings*, *gave the idea up* for *give up*). Matching is exact against real English forms — *brain* never lights up *brainy*.
- **Hover to review.** Hovering a highlighted word shows its definition, phonetic, example sentence, and pronunciation audio, with a link to the word in the Inoh app.
- **AI suggestions.** Select a passage and run **Suggest deck words for selection**. Phrases that could be rewritten with one of your deck words get a wavy underline; hover one to see the deck word, its definition, the rewrite, and a one-sentence explanation of why it fits — then Apply or Dismiss. Free accounts get 10 suggestion requests per day; [Inoh Pro](https://inoh.app) is unlimited.
- **Works offline.** Your deck is cached locally, so highlighting keeps working without a connection.

## Getting started

1. Enable the plugin, then open its settings.
2. Click **Sign in or sign up** — enter your email and the six-digit code you receive. A new email creates an Inoh account automatically.
3. Build your vocabulary deck at [inoh.app](https://inoh.app) (or in the Inoh iOS app), then hit **Refresh deck** — or just click the status bar item.
4. Write. Deck words light up as you type; the status bar shows how many words are loaded.

## Network use disclosure

- The plugin talks to Inoh's backend (Supabase) to sign you in and download your vocabulary deck.
- When you run the suggestion command, your selected text (up to 2,000 characters) and your deck words are sent to Inoh's backend, which uses OpenAI to generate suggestions. Nothing else from your vault is ever uploaded.
- Auth tokens are stored in device-local storage, never in vault files, so they are not carried along by vault sync services.

## Development

```bash
pnpm install
pnpm dev        # watch build into test-vault/.obsidian/plugins/inoh/
pnpm test       # vitest — matching engine
pnpm typecheck  # tsc --noEmit
pnpm build      # typecheck + minified production build to ./main.js
```

Open `test-vault/` in Obsidian (trust it and enable community plugins). The vault ships with the [hot-reload](https://github.com/pjeby/hot-reload) plugin, so the plugin reloads on every rebuild.

```
src/
├── main.ts                  # plugin wiring
├── supabase/                # client factory, email-OTP auth, localStorage adapter
├── deck/deck-service.ts     # fetch + cache + deck-changed events
├── matching/                # deck index + token-driven matcher (pure TS, unit-tested)
├── editor/                  # CM6 extensions: highlight decorations, hover tooltip, inline suggestions
├── suggestions/             # suggest-deck-words edge function client
├── settings/                # settings tab + sign-in modal
└── ui/status-bar.ts
```

Implementation notes: the highlighter is a CodeMirror 6 view plugin that scans only the visible viewport, debounced 200 ms after the last keystroke; each deck word is expanded into its exact surface forms at index time, so a rescan is a map lookup per token. Obsidian's own `@codemirror/*` packages are `external` in the build — bundling a second copy breaks decoration rendering.

## License

[MIT](LICENSE)
