export const DIM = 14;
export const SENTINEL_BYTE = 255;
export const QMAX = 254;

// [0,1] -> 0..254 ; sentinela -1 -> 255
export function quantizeValue(v: number): number {
  if (v === -1) return SENTINEL_BYTE;
  let q = Math.round(v * QMAX);
  if (q < 0) q = 0;
  else if (q > QMAX) q = QMAX;
  return q;
}

export function quantizeVector(vec: ArrayLike<number>, out: Uint8Array, offset: number): void {
  for (let i = 0; i < DIM; i++) out[offset + i] = quantizeValue(vec[i]);
}

// lookup byte -> float (255 -> -1)
export function buildDequantLUT(): Float32Array {
  const lut = new Float32Array(256);
  for (let b = 0; b <= QMAX; b++) lut[b] = b / QMAX;
  lut[SENTINEL_BYTE] = -1;
  return lut;
}
