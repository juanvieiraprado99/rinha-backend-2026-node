// Pré-processamento OFFLINE: references.json.gz -> resources/index.bin
// Roda na build da imagem (não em runtime de request).
// Faz: parse streaming -> mini-batch k-means (IVF) -> quantiza uint8 -> empacota.
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parser } from "stream-json";
import { streamArray } from "stream-json/streamers/StreamArray.js";
import { DIM, quantizeVector } from "../src/quantize.js";

interface ReferenceRecord {
  vector: number[];
  label: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/scripts/build-index.js -> sobe dois níveis até a raiz do repo
const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "resources", "references.json.gz");
const OUT = path.join(ROOT, "resources", "index.bin");

const EXPECTED_N = 3_000_000;
const K = Number(process.env.KMEANS_K || 1024);
const BATCH = 20000;
const BATCHES = Number(process.env.KMEANS_BATCHES || 220);
const MAGIC = 0x31484e52; // "RNH1"

function log(...a: unknown[]): void {
  console.log(`[build-index ${new Date().toISOString()}]`, ...a);
}

async function loadDataset(): Promise<{ vectors: Float32Array; labels: Uint8Array; n: number }> {
  log("lendo", SRC);
  const vectors = new Float32Array(EXPECTED_N * DIM);
  const labels = new Uint8Array(EXPECTED_N); // 1=fraud, 0=legit
  let n = 0;

  await new Promise<void>((resolve, reject) => {
    const pipeline = fs
      .createReadStream(SRC)
      .pipe(zlib.createGunzip())
      .pipe(parser())
      .pipe(streamArray());

    pipeline.on("data", ({ value }: { value: ReferenceRecord }) => {
      const base = n * DIM;
      const v = value.vector;
      for (let i = 0; i < DIM; i++) vectors[base + i] = v[i];
      labels[n] = value.label === "fraud" ? 1 : 0;
      n++;
      if (n % 500000 === 0) log("lidos", n);
    });
    pipeline.on("end", resolve);
    pipeline.on("error", reject);
  });

  log("total lidos", n);
  return { vectors, labels, n };
}

function nearestCentroid(
  vectors: Float32Array,
  base: number,
  centroids: Float32Array,
  k: number,
): number {
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < k; c++) {
    const cb = c * DIM;
    let d = 0;
    for (let i = 0; i < DIM; i++) {
      const diff = vectors[base + i] - centroids[cb + i];
      d += diff * diff;
    }
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function kmeans(vectors: Float32Array, n: number, k: number): Float32Array {
  log(`k-means: K=${k}, batches=${BATCHES}, batch=${BATCH}`);
  const centroids = new Float32Array(k * DIM);
  // init: amostra k pontos aleatórios distintos
  for (let c = 0; c < k; c++) {
    const idx = ((Math.random() * n) | 0) * DIM;
    centroids.set(vectors.subarray(idx, idx + DIM), c * DIM);
  }
  const counts = new Float64Array(k);
  for (let b = 0; b < BATCHES; b++) {
    for (let s = 0; s < BATCH; s++) {
      const base = ((Math.random() * n) | 0) * DIM;
      const c = nearestCentroid(vectors, base, centroids, k);
      counts[c] += 1;
      const eta = 1 / counts[c];
      const cb = c * DIM;
      for (let i = 0; i < DIM; i++) {
        centroids[cb + i] += eta * (vectors[base + i] - centroids[cb + i]);
      }
    }
    if ((b + 1) % 20 === 0) log("k-means batch", b + 1, "/", BATCHES);
  }
  return centroids;
}

function assignAll(
  vectors: Float32Array,
  n: number,
  centroids: Float32Array,
  k: number,
): { assign: Int32Array; counts: Uint32Array } {
  log("atribuindo todos os pontos aos clusters");
  const assign = new Int32Array(n);
  const counts = new Uint32Array(k);
  for (let p = 0; p < n; p++) {
    const c = nearestCentroid(vectors, p * DIM, centroids, k);
    assign[p] = c;
    counts[c]++;
    if ((p + 1) % 500000 === 0) log("atribuídos", p + 1);
  }
  return { assign, counts };
}

function buildOffsets(counts: Uint32Array, k: number): Uint32Array {
  const offsets = new Uint32Array(k + 1);
  for (let c = 0; c < k; c++) offsets[c + 1] = offsets[c] + counts[c];
  return offsets;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const { vectors, labels, n } = await loadDataset();
  const centroids = kmeans(vectors, n, K);
  const { assign, counts } = assignAll(vectors, n, centroids, K);
  const offsets = buildOffsets(counts, K);

  log("agrupando vetores por cluster + quantizando");
  const groupedVecs = new Uint8Array(n * DIM);
  const groupedLabels = new Uint8Array(n);
  const cursor = offsets.slice(0, K); // posição de escrita por cluster
  const tmp = new Float64Array(DIM);
  for (let p = 0; p < n; p++) {
    const c = assign[p];
    const dst = cursor[c]++;
    const sb = p * DIM;
    for (let i = 0; i < DIM; i++) tmp[i] = vectors[sb + i];
    quantizeVector(tmp, groupedVecs, dst * DIM);
    groupedLabels[dst] = labels[p];
  }

  // empacota: header(16) + centroids(f32 K*DIM) + offsets(u32 K+1) + labels(u8 n) + vecs(u8 n*DIM)
  const header = Buffer.alloc(16);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(n, 4);
  header.writeUInt32LE(DIM, 8);
  header.writeUInt32LE(K, 12);

  log("escrevendo", OUT);
  const ws = fs.createWriteStream(OUT);
  const write = (buf: Buffer): Promise<void> =>
    new Promise((res, rej) => ws.write(buf, (e) => (e ? rej(e) : res())));
  await write(header);
  await write(Buffer.from(centroids.buffer, centroids.byteOffset, centroids.byteLength));
  await write(Buffer.from(offsets.buffer, offsets.byteOffset, offsets.byteLength));
  await write(Buffer.from(groupedLabels.buffer, groupedLabels.byteOffset, groupedLabels.byteLength));
  await write(Buffer.from(groupedVecs.buffer, groupedVecs.byteOffset, groupedVecs.byteLength));
  await new Promise<void>((res) => ws.end(res));

  const sz = fs.statSync(OUT).size;
  log(`pronto: N=${n} K=${K} size=${(sz / 1e6).toFixed(1)}MB em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
