// Baixa references.json.gz (3M vetores) para resources/.
// Necessário antes de `npm run build:index`. O arquivo é gitignored por tamanho (~16MB).
// URL configurável via DATASET_URL; default = repo oficial da Rinha 2026.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "resources", "references.json.gz");

const DATASET_URL =
  process.env.DATASET_URL ||
  "https://raw.githubusercontent.com/zanfranceschi/rinha-de-backend-2026/main/resources/references.json.gz";

function log(...a) {
  console.log(`[fetch-dataset ${new Date().toISOString()}]`, ...a);
}

async function main() {
  log("baixando", DATASET_URL);
  const res = await fetch(DATASET_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} ao baixar dataset`);

  const tmp = `${OUT}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));

  const size = fs.statSync(tmp).size;
  // Pointer de git-lfs tem ~130 bytes — sinal de que a URL não serve o binário real.
  if (size < 1_000_000) {
    fs.unlinkSync(tmp);
    throw new Error(
      `Arquivo baixado tem só ${size} bytes — provável pointer git-lfs ou URL errada. ` +
        `Defina DATASET_URL apontando para o references.json.gz real (~16MB).`,
    );
  }

  fs.renameSync(tmp, OUT);
  log(`pronto: ${OUT} (${(size / 1e6).toFixed(1)}MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
