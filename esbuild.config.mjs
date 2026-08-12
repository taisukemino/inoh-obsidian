import esbuild from "esbuild";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const isProductionBuild = process.argv.includes("production");

// Mirrors the Inoh app's APP_ENV convention: `.env.<APP_ENV>` selects the
// backend, and a plain `.env` holds per-machine settings (the vault path).
// Both are gitignored. Anything already in the environment wins, which keeps
// the one-off `OBSIDIAN_VAULT=… pnpm dev` form working.
const appEnv = process.env.APP_ENV ?? "prod";
for (const envFile of [`.env.${appEnv}`, ".env"]) {
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

/** Expands a leading `~`, which .env files (unlike shells) do not do themselves. */
const expandHome = (maybePath) =>
  maybePath.startsWith("~") ? path.join(homedir(), maybePath.slice(1)) : maybePath;

/** A vault is any folder Obsidian has claimed by putting `.obsidian/` in it. */
const isVault = (candidatePath) => existsSync(path.join(candidatePath, ".obsidian"));

// Dev builds go straight into a real vault so the hot-reload plugin picks them
// up. `~/Obsidian` is only a guess — Obsidian imposes no default location — so
// it is used only when it really is a vault, and OBSIDIAN_VAULT overrides it.
const defaultVaultPath = path.join(homedir(), "Obsidian");
const configuredVaultPath = process.env.OBSIDIAN_VAULT;
const vaultPath = configuredVaultPath ? expandHome(configuredVaultPath) : defaultVaultPath;

if (!isProductionBuild && !isVault(vaultPath)) {
  const reason = configuredVaultPath
    ? `OBSIDIAN_VAULT points at ${vaultPath}, which has no .obsidian/ folder.`
    : `No vault found at the default ${vaultPath}.`;
  console.error(
    `${reason}\nCopy .env.example to .env and set OBSIDIAN_VAULT to your vault's ` +
      "root — the folder containing .obsidian/. Or run `pnpm build` instead.",
  );
  process.exit(1);
}
const outputDir = isProductionBuild
  ? "."
  : path.join(vaultPath, ".obsidian", "plugins", "inoh");

// The prod project runs live Stripe keys, so a checkout there is a real charge.
// `APP_ENV=local pnpm dev` points at a local Supabase stack running test keys.
const PRODUCTION_SUPABASE_URL = "https://fsgiabbxanlcaqpgrrki.supabase.co";
const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_DvcLzEYwjUKsuGtzSJbivA_FLaRrKnh";

// Reason: the published build ignores the env files rather than falling back
// through them, so a half-finished .env.local can never ship to the store.
const supabaseUrl = isProductionBuild
  ? PRODUCTION_SUPABASE_URL
  : (process.env.SUPABASE_URL ?? PRODUCTION_SUPABASE_URL);
const supabasePublishableKey = isProductionBuild
  ? PRODUCTION_SUPABASE_PUBLISHABLE_KEY
  : (process.env.SUPABASE_PUBLISHABLE_KEY ?? PRODUCTION_SUPABASE_PUBLISHABLE_KEY);

if (!isProductionBuild) {
  const stripeWarning =
    supabaseUrl === PRODUCTION_SUPABASE_URL
      ? "  ⚠️  Stripe is in LIVE mode here — checkout charges a real card"
      : "";
  console.log(`APP_ENV=${appEnv}  backend=${supabaseUrl}${stripeWarning}`);
}

/**
 * Copies manifest.json and styles.css next to main.js after each dev build,
 * so the plugin folder in the vault is always complete and loadable.
 */
const copyPluginAssetsPlugin = {
  name: "copy-plugin-assets",
  setup(build) {
    // Reason: esbuild's watcher only tracks the JS module graph, so a change
    // to styles.css or manifest.json alone never triggered a rebuild and the
    // vault silently kept stale copies. Registering them as watch files of
    // the entry makes any change rebuild — and therefore re-copy.
    build.onLoad({ filter: /src[\\/]main\.ts$/ }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "ts",
      watchFiles: [path.resolve("styles.css"), path.resolve("manifest.json")],
    }));
    build.onEnd(async (result) => {
      if (result.errors.length > 0 || isProductionBuild) {
        return;
      }
      await mkdir(outputDir, { recursive: true });
      await copyFile("manifest.json", path.join(outputDir, "manifest.json"));
      await copyFile("styles.css", path.join(outputDir, "styles.css"));
      // Marker file telling the hot-reload plugin to watch this plugin.
      await writeFile(path.join(outputDir, ".hotreload"), "");
    });
  },
};

const buildContext = await esbuild.context({
  entryPoints: ["src/main.ts"],
  outfile: path.join(outputDir, "main.js"),
  bundle: true,
  format: "cjs",
  target: "es2020",
  platform: "browser",
  sourcemap: isProductionBuild ? false : "inline",
  minify: isProductionBuild,
  treeShaking: true,
  logLevel: "info",
  define: {
    __SUPABASE_URL__: JSON.stringify(supabaseUrl),
    __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabasePublishableKey),
  },
  // Obsidian ships its own CodeMirror 6 packages. Bundling a second copy breaks
  // instanceof/facet identity and decorations silently stop rendering, so every
  // @codemirror/* and @lezer/* import must resolve to Obsidian's copy at runtime.
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
  ],
  plugins: [copyPluginAssetsPlugin],
});

if (isProductionBuild) {
  await buildContext.rebuild();
  await buildContext.dispose();
} else {
  await buildContext.watch();
}
