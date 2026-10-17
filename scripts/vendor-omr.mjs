import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const commit = "18b38f2602ec5a4cf6230ebee391595a4d18d9fd";
const sourceBase = `https://raw.githubusercontent.com/pzfreo/partsong/${commit}/`;
const assetBase = "https://partsong.app/";
const output = fileURLToPath(new URL("../public/omr-worker-core.js", import.meta.url));

const response = await fetch(`${sourceBase}omr-worker.js`);
if (!response.ok) throw new Error(`Could not fetch Partsong OMR worker (${response.status}).`);

const upstream = await response.text();
const transformed = upstream
  .replace(
    'const modelUrl = (name) => new URL("models/" + name, location.href).href;',
    `const modelUrl = (name) => new URL("models/" + name, "${assetBase}").href;`,
  )
  .replace('const v = location.search;', 'const v = "";')
  .replace('fetch("vendor/homr.zip" + v)', `fetch("${assetBase}vendor/homr.zip")`)
  .replace('fetch("omr/" + f + v)', `fetch("${sourceBase}omr/" + f)`);

const banner = `// Generated from Partsong ${commit} (AGPL-3.0).\n// Regenerate with: npm run omr:vendor\n`;
writeFileSync(output, `${banner}${transformed}\n`, "utf8");
console.log(`Updated ${output} (${readFileSync(output).byteLength} bytes)`);
