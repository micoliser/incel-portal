// Copies libsodium's browser builds into public/vendor, so the service worker
// (public/sw.js) can load them with importScripts to decrypt chat
// notification previews. Runs on install, before `next dev` and `next build`.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "vendor");
mkdirSync(out, { recursive: true });

const files = [
  // Each package's main file is its browser-ready build.
  [require.resolve("libsodium-sumo"), "libsodium-sumo.js"],
  [require.resolve("libsodium-wrappers-sumo"), "libsodium-wrappers.js"],
];
for (const [from, name] of files) copyFileSync(from, join(out, name));
console.log("Copied libsodium for the service worker into public/vendor.");
