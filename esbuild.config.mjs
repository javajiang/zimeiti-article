import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const watch = process.argv.includes("--watch");
const root = process.cwd();
const outdir = resolve(root, "../vault/.obsidian/plugins/zimeiti-article");

const syncStaticFiles = () => {
  mkdirSync(outdir, { recursive: true });
  const files = ["manifest.json", "styles.css"];
  for (const file of files) {
    copyFileSync(resolve(root, file), resolve(outdir, file));
  }
};

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: [resolve(root, "src/main.ts")],
  bundle: true,
  outfile: resolve(outdir, "main.js"),
  format: "cjs",
  platform: "browser",
  target: "es2020",
  sourcemap: "inline",
  external: ["obsidian", "electron", "@codemirror/*"],
  logLevel: "info",
  banner: {
    js: "var global = globalThis;"
  }
};

const ctx = await esbuild.context(config);
syncStaticFiles();

if (watch) {
  await ctx.watch();
  console.log(`Watching plugin build in ${dirname(resolve(outdir, "main.js"))}`);
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
