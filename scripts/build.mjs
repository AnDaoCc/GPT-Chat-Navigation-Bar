import { build, context } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");

async function copyStaticFiles() {
  await mkdir("dist/assets", { recursive: true });
  await copyFile("manifest.json", "dist/manifest.json");
  await copyFile("popup.html", "dist/popup.html");
  await copyFile("assets/icon16.png", "dist/assets/icon16.png");
  await copyFile("assets/icon32.png", "dist/assets/icon32.png");
  await copyFile("assets/icon48.png", "dist/assets/icon48.png");
  await copyFile("assets/icon128.png", "dist/assets/icon128.png");
}

const commonOptions = {
  bundle: true,
  logLevel: "info",
  minify: false,
  sourcemap: true,
  target: ["chrome114"],
  define: {
    "process.env.NODE_ENV": '"production"'
  },
  loader: {
    ".css": "css"
  }
};

const buildOptions = [
  {
    ...commonOptions,
    entryPoints: ["src/contentScript.tsx"],
    outfile: "dist/assets/contentScript.js",
    format: "iife",
    platform: "browser"
  },
  {
    ...commonOptions,
    entryPoints: ["src/index.tsx"],
    outfile: "dist/assets/popup.js",
    format: "iife",
    platform: "browser"
  },
  {
    ...commonOptions,
    entryPoints: ["src/background.ts"],
    outfile: "dist/assets/background.js",
    format: "esm",
    platform: "browser"
  }
];

await rm("dist", { recursive: true, force: true });
await copyStaticFiles();

if (watch) {
  const contexts = await Promise.all(buildOptions.map((options) => context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("Watching extension sources. Load the dist folder in chrome://extensions.");
} else {
  await Promise.all(buildOptions.map((options) => build(options)));
}
