import esbuild from "esbuild";
import builtinModules from "builtin-modules";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const isProductionBuild = process.argv.includes("production");

// Dev builds go straight into the test vault so the hot-reload plugin picks them up.
const DEV_PLUGIN_DIR = path.join("test-vault", ".obsidian", "plugins", "inoh");
const outputDir = isProductionBuild ? "." : DEV_PLUGIN_DIR;

/**
 * Copies manifest.json and styles.css next to main.js after each build,
 * so the dev plugin folder is always a complete, loadable plugin.
 */
const copyPluginAssetsPlugin = {
  name: "copy-plugin-assets",
  setup(build) {
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
    ...builtinModules,
  ],
  plugins: [copyPluginAssetsPlugin],
});

if (isProductionBuild) {
  await buildContext.rebuild();
  await buildContext.dispose();
} else {
  await buildContext.watch();
}
