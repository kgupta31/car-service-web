// One-off generation script — not part of the build pipeline. Run manually
// whenever the source SVGs change: node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

mkdirSync("public/icons", { recursive: true });

await sharp("public/logo.svg").resize(192, 192).png().toFile("public/icons/icon-192.png");
await sharp("public/logo.svg").resize(512, 512).png().toFile("public/icons/icon-512.png");
await sharp("public/icons/icon-maskable-source.svg")
  .resize(512, 512)
  .png()
  .toFile("public/icons/icon-maskable-512.png");

console.log("Generated public/icons/icon-192.png, icon-512.png, icon-maskable-512.png");
