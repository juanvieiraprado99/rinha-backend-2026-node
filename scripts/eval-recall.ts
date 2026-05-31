// Valida recall do IVF vs brute force exato em uma amostra do próprio dataset.
// Reparse do references.json.gz, sorteia M queries, compara fraud_score IVF vs exato.
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parser } from "stream-json";
import { streamArray } from "stream-json/streamers/StreamArray.js";
import { DIM } from "../src/quantize.js";
import { loadIndex } from "../src/index-loader.js";
import { createSearcher } from "../src/search.js";

interface ReferenceRecord {
  vector: number[];
  label: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "resources", "references.json.gz");
const M = Number(process.env.EVAL_M || 300);
const NPROBE = Number(process.env.NPROBE || 24);
const EXPECTED_N = 3_000_000;

// selfIdx: índice da própria query no dataset, ignorado para evitar viés de self-match
// (a query é um ponto do dataset, então ela mesma estaria a distância 0 de si — isso
// inflaria o recall. Pular reproduz o cenário de uma query nova, fora do dataset).
function bruteForceScore(
  vectors: Float32Array,
  labels: Uint8Array,
  n: number,
  q: Float64Array,
  selfIdx: number,
): number {
  const d5 = [Infinity, Infinity, Infinity, Infinity, Infinity];
  const f5 = [0, 0, 0, 0, 0];
  for (let p = 0; p < n; p++) {
    if (p === selfIdx) continue;
    const b = p * DIM;
    let d = 0;
    for (let i = 0; i < DIM; i++) {
      const diff = q[i] - vectors[b + i];
      d += diff * diff;
    }
    if (d < d5[4]) {
      let j = 4;
      while (j > 0 && d5[j - 1] > d) {
        d5[j] = d5[j - 1];
        f5[j] = f5[j - 1];
        j--;
      }
      d5[j] = d;
      f5[j] = labels[p];
    }
  }
  return (f5[0] + f5[1] + f5[2] + f5[3] + f5[4]) / 5;
}

async function load(): Promise<{ vectors: Float32Array; labels: Uint8Array; n: number }> {
  const vectors = new Float32Array(EXPECTED_N * DIM);
  const labels = new Uint8Array(EXPECTED_N);
  let n = 0;
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(SRC)
      .pipe(zlib.createGunzip())
      .pipe(parser())
      .pipe(streamArray())
      .on("data", ({ value }: { value: ReferenceRecord }) => {
        const base = n * DIM;
        for (let i = 0; i < DIM; i++) vectors[base + i] = value.vector[i];
        labels[n] = value.label === "fraud" ? 1 : 0;
        n++;
      })
      .on("end", resolve)
      .on("error", reject);
  });
  return { vectors, labels, n };
}

async function main(): Promise<void> {
  console.log("carregando dataset float...");
  const { vectors, labels, n } = await load();
  console.log("carregando índice...");
  const index = loadIndex(path.join(ROOT, "resources", "index.bin"));
  const search = createSearcher(index, { nprobe: NPROBE });

  const q = new Float64Array(DIM);
  let agree = 0;
  let approveMatch = 0;
  let sumAbs = 0;
  for (let m = 0; m < M; m++) {
    const p = (Math.random() * n) | 0;
    const base = p * DIM;
    for (let i = 0; i < DIM; i++) q[i] = vectors[base + i];
    // ground-truth ignora o próprio ponto (query nova não está no dataset).
    // Resíduo: o IVF ainda tem o ponto no index (quantizado, erro ~0.0075), então
    // pode incluí-lo como vizinho — leve viés otimista, bem menor que o self-match dist-0.
    const exact = bruteForceScore(vectors, labels, n, q, p);
    const ivf = search(q);
    if (exact === ivf) agree++;
    if ((exact < 0.6) === (ivf < 0.6)) approveMatch++;
    sumAbs += Math.abs(exact - ivf);
  }
  console.log(`M=${M} nprobe=${NPROBE}`);
  console.log(`score idêntico: ${((agree / M) * 100).toFixed(1)}%`);
  console.log(`decisão (approved) igual: ${((approveMatch / M) * 100).toFixed(1)}%`);
  console.log(`erro médio |exato-ivf|: ${(sumAbs / M).toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
