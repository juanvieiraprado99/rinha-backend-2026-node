import fs from "node:fs";
import { DIM } from "./quantize.js";

const MAGIC = 0x31484e52;

export interface FraudIndex {
  n: number;
  k: number;
  dim: number;
  centroids: Float32Array;
  offsets: Uint32Array;
  labels: Uint8Array;
  vectors: Uint8Array;
  _buf: Buffer;
}

// Carrega index.bin em memória (Buffer único) e expõe views TypedArray.
export function loadIndex(filePath: string): FraudIndex {
  const buf = fs.readFileSync(filePath);
  const magic = buf.readUInt32LE(0);
  if (magic !== MAGIC) throw new Error("index.bin inválido (magic)");
  const n = buf.readUInt32LE(4);
  const dim = buf.readUInt32LE(8);
  const k = buf.readUInt32LE(12);
  if (dim !== DIM) throw new Error(`DIM divergente: ${dim} != ${DIM}`);

  let off = 16;
  const ab = buf.buffer;
  const baseOff = buf.byteOffset;

  const centroids = new Float32Array(ab, baseOff + off, k * DIM);
  off += k * DIM * 4;
  const offsets = new Uint32Array(ab, baseOff + off, k + 1);
  off += (k + 1) * 4;
  const labels = new Uint8Array(ab, baseOff + off, n);
  off += n;
  const vectors = new Uint8Array(ab, baseOff + off, n * DIM);
  off += n * DIM;

  return { n, k, dim, centroids, offsets, labels, vectors, _buf: buf };
}
