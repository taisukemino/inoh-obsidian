# Inoh for Obsidian

Highlights words from your [Inoh](https://inoh.app) vocabulary deck while you write, so you actually use what you're learning. Deck words (including inflected forms — *crossed* for *cross*, *went* for *go*) get a dotted underline in the editor; hovering shows the word's definition, phonetic, CEFR level, and example sentence.

Phase 1 of [PRI-20162]: validate the "surface deck words while writing" workflow before investing in a browser extension.

## How it works

- **Sign in** with your Inoh account (email + six-digit code) from the plugin settings or the status bar.
- Your deck (≤300 cards on the free tier) is fetched wholesale from Supabase and cached in the plugin's `data.json`, so highlighting works instantly on startup and offline. Auth tokens live in `localStorage`, never in the vault.
- A CodeMirror 6 view plugin scans only the **visible viewport**, debounced 200 ms after the last keystroke. Matching is token-driven: each deck word is expanded into its exact set of surface forms at index time, and each typed token is a map lookup.
- **Matching is exact against generated inflection sets.** For every deck-word token the index generates its real English forms — regular -s/-es/-ies, -ed (with e-drop and consonant doubling), -ing, f→ves plurals, irregular noun plurals (*criteria*, *knives*), and irregular verb forms (*went*, *swam*). A typed word matches only if it IS one of those forms. There is no prefix/stem fuzziness: *brain* does not match *brainy*, *crossword* does not match *cross*. Comparatives (-er/-est) and derivations (-ly) are deliberately excluded.
- **Idioms** (roughly 12k dictionary entries are multi-word) match per-token with the same inflection rules (*cough drops* ← *cough drop*), plus: possessive placeholders (*counted my blessings* / *put Maria's back up* ← *count one's blessings*, *put someone's back up*), person placeholders (*have him by the short hairs* ← *have someone by the short hairs*), separable phrasal verbs bridging up to two filler tokens (*gave the idea up* ← *give up*), and hyphen/space equivalence (*state of the art* ← *state-of-the-art*).
- The weak tiers — consonant-skeleton equality and typo-level Levenshtein edits — are behind the off-by-default "Tolerant matching" setting because they over-match ordinary prose (*voice* vs deck word *vice*).

## Development

```bash
pnpm install
pnpm dev        # watch build into test-vault/.obsidian/plugins/inoh/
pnpm test       # vitest — matching engine
pnpm typecheck  # tsc --noEmit
pnpm build      # typecheck + minified production build to ./main.js
```

Open `test-vault/` in Obsidian (trust it and enable community plugins). The vault ships with the [hot-reload](https://github.com/pjeby/hot-reload) plugin, so the plugin reloads on every rebuild.

### Layout

```
src/
├── main.ts                  # plugin wiring
├── supabase/                # client factory, email-OTP auth, localStorage adapter
├── deck/deck-service.ts     # fetch + cache + deck-changed events
├── matching/                # deck index + token-driven matcher (pure TS, unit-tested)
├── editor/                  # CM6 ViewPlugin (decorations) + hover tooltip
├── settings/                # settings tab + sign-in modal
└── ui/status-bar.ts
```

Ported code: Supabase layer from `inoh-raycast`, matching primitives from the Inoh iOS app's `sentence-utils.ts` / `irregular-verb-forms.ts`.

## Obsidian constraints found (PRI-20162 deliverable)

1. **Don't bundle `@codemirror/*` / `@lezer/*`** — Obsidian ships its own CodeMirror 6; a second copy breaks facet identity and decorations silently stop rendering. They are `external` in `esbuild.config.mjs`.
2. **Editing views only** — CM6 decorations cover Live Preview and source mode. Reading mode would need a separate `MarkdownPostProcessor`; skipped for the prototype.
3. **Performance** — viewport-only scanning + the token-driven index keeps a rescan under ~1 ms for a 300-word deck; naive per-deck-word regex would be O(300 × document).
4. **Deck sync** — `user_cards` has no `updated_at` cursor, so sync is a full refetch (fine at ≤300 rows): on startup, on demand via the status bar / "Refresh deck" command.
5. **Token security** — `data.json` syncs with the vault, so sessions go in `localStorage` (per-device, per-vault key prefix) instead.
6. **Desktop only for now** (`isDesktopOnly: true`) — nothing is fundamentally desktop-bound; mobile is a flag-flip + testing exercise.

## Phase 2 (not built)

LLM synonym suggestions ("you wrote *very good* — try **superb**") with a bring-your-own API key (Anthropic/OpenAI/Gemini). Settings placeholders exist; calls must go through Obsidian's `requestUrl` (plain `fetch` is CORS-blocked in the renderer).

[PRI-20162]: https://linear.app/tai-lab/issue/PRI-20162/build-the-obsidian-plugin
