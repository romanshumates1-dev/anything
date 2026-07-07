// Remove previous build output so each build starts from a clean slate.
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

for (const dir of ["dist", "release"]) {
  await rm(path.join(root, dir), { recursive: true, force: true });
}

console.log("[clean] removed dist/ and release/");
