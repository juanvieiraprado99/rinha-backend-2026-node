import { DIM, buildDequantLUT } from "./quantize.js";
import type { FraudIndex } from "./index-loader.js";

const LUT = buildDequantLUT();
const K_NEIGH = 5;

// Mantém os `nprobe` clusters mais próximos do query (centroids float).
function topClusters(
  query: Float64Array,
  centroids: Float32Array,
  k: number,
  nprobe: number,
  outIdx: Int32Array,
  outDist: Float64Array,
): void {
  for (let i = 0; i < nprobe; i++) {
    outDist[i] = Infinity;
    outIdx[i] = -1;
  }
  for (let c = 0; c < k; c++) {
    const cb = c * DIM;
    let d = 0;
    for (let i = 0; i < DIM; i++) {
      const diff = query[i] - centroids[cb + i];
      d += diff * diff;
    }
    if (d < outDist[nprobe - 1]) {
      let j = nprobe - 1;
      while (j > 0 && outDist[j - 1] > d) {
        outDist[j] = outDist[j - 1];
        outIdx[j] = outIdx[j - 1];
        j--;
      }
      outDist[j] = d;
      outIdx[j] = c;
    }
  }
}

export interface SearcherOptions {
  nprobe?: number;
}

export type Searcher = (query: Float64Array) => number;

export function createSearcher(index: FraudIndex, opts: SearcherOptions = {}): Searcher {
  const nprobe = Math.min(opts.nprobe || 24, index.k);
  const { centroids, offsets, labels, vectors, k } = index;

  const cIdx = new Int32Array(nprobe);
  const cDist = new Float64Array(nprobe);
  const nnDist = new Float64Array(K_NEIGH);
  const nnFraud = new Uint8Array(K_NEIGH);

  // query: Float64Array(DIM) já vetorizado e normalizado.
  // retorna fraud_score (fração de fraudes entre os 5 vizinhos).
  return function search(query: Float64Array): number {
    topClusters(query, centroids, k, nprobe, cIdx, cDist);

    for (let i = 0; i < K_NEIGH; i++) {
      nnDist[i] = Infinity;
      nnFraud[i] = 0;
    }
    let worst = Infinity;
    let filled = 0;

    for (let pc = 0; pc < nprobe; pc++) {
      const c = cIdx[pc];
      if (c < 0) continue;
      const start = offsets[c];
      const end = offsets[c + 1];
      for (let p = start; p < end; p++) {
        const vb = p * DIM;
        let d = 0;
        for (let i = 0; i < DIM; i++) {
          const diff = query[i] - LUT[vectors[vb + i]];
          d += diff * diff;
          if (d >= worst) break;
        }
        if (d < worst || filled < K_NEIGH) {
          // insere em ordem crescente
          let j = K_NEIGH - 1;
          while (j > 0 && nnDist[j - 1] > d) {
            nnDist[j] = nnDist[j - 1];
            nnFraud[j] = nnFraud[j - 1];
            j--;
          }
          nnDist[j] = d;
          nnFraud[j] = labels[p];
          if (filled < K_NEIGH) filled++;
          worst = nnDist[K_NEIGH - 1];
        }
      }
    }

    let frauds = 0;
    for (let i = 0; i < K_NEIGH; i++) frauds += nnFraud[i];
    return frauds / K_NEIGH;
  };
}
