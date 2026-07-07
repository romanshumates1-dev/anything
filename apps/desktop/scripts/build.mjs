// Build pipeline for the Electron app.
//
// Uses esbuild to compile + bundle the three process boundaries:
//   1. main    → dist/main/main.js        (CommonJS, Node platform)
//   2. preload → dist/preload/preload.js  (bundled single file — REQUIRED
//                because the window uses sandbox:true, and sandboxed preloads
//                cannot require local modules; everything must be inlined)
//   3. renderer settings/offline → dist/renderer/*.js (browser IIFE)
// Then copies the static HTML/CSS into dist/renderer.
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "src");
const dist = path.join(root, "dist");

// Runtime deps that must stay external for the main process (resolved from
// node_modules at runtime / packaged into the asar by electron-builder).
const mainExternal = [
  "electron",
  "electron-log",
  "electron-store",
  "electron-updater",
];

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
  target: "node18",
};

async function run() {
  await mkdir(dist, { recursive: true });

  // 1) Main process
  await build({
    ...common,
    entryPoints: [path.join(src, "main", "main.ts")],
    outfile: path.join(dist, "main", "main.js"),
    platform: "node",
    format: "cjs",
    external: mainExternal,
  });

  // 2) Preload — fully bundled, only `electron` stays external (whitelisted in
  //    the sandbox). No other requires may survive in the output.
  await build({
    ...common,
    entryPoints: [path.join(src, "preload", "preload.ts")],
    outfile: path.join(dist, "preload", "preload.js"),
    platform: "node",
    format: "cjs",
    external: ["electron"],
  });

  // 3) Renderer scripts — browser context, no Node builtins.
  await build({
    ...common,
    target: "chrome120",
    entryPoints: [
      path.join(src, "renderer", "settings.ts"),
      path.join(src, "renderer", "offline.ts"),
    ],
    outdir: path.join(dist, "renderer"),
    platform: "browser",
    format: "iife",
  });

  // 4) Static assets for the renderer.
  const rendererDist = path.join(dist, "renderer");
  await mkdir(rendererDist, { recursive: true });
  for (const file of ["settings.html", "offline.html", "styles.css"]) {
    await cp(path.join(src, "renderer", file), path.join(rendererDist, file));
  }

  console.log("[build] complete → dist/");
}

run().catch((err) => {
  console.error("[build] failed:", err);
  process.exit(1);
});
