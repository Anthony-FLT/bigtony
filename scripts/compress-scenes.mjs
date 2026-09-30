// Compresse les illustrations de assets/scenes : PNG ~2 Mo -> WebP ~100 Ko
// Usage (à la racine du projet) :
//   npm i -D sharp
//   node scripts/compress-scenes.mjs
import sharp from "sharp";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const DIR = "assets/scenes";
const WIDTH = 1080; // largeur max en pixels : net même en plein écran sur un téléphone
const QUALITY = 78;

let before = 0;
let after = 0;

for (const file of await readdir(DIR)) {
  if (!file.toLowerCase().endsWith(".png")) continue;
  const src = path.join(DIR, file);
  const out = path.join(DIR, file.replace(/\.png$/i, ".webp"));

  await sharp(src).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: QUALITY }).toFile(out);

  const [a, b] = await Promise.all([stat(src), stat(out)]);
  before += a.size;
  after += b.size;
  console.log(`${file.padEnd(32)} ${Math.round(a.size / 1024)} Ko -> ${Math.round(b.size / 1024)} Ko`);
}

console.log(`\nTotal : ${(before / 1048576).toFixed(1)} Mo -> ${(after / 1048576).toFixed(1)} Mo`);
