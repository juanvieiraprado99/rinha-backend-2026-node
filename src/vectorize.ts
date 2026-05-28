import { DIM } from "./quantize.js";

export interface Transaction {
  amount: number;
  installments: number;
  requested_at: string;
}

export interface Customer {
  avg_amount: number;
  tx_count_24h: number;
  known_merchants: string[];
}

export interface Merchant {
  id: string;
  mcc: string;
  avg_amount: number;
}

export interface Terminal {
  is_online: boolean;
  card_present: boolean;
  km_from_home: number;
}

export interface LastTransaction {
  timestamp: string;
  km_from_current: number;
}

export interface FraudPayload {
  id: string;
  transaction: Transaction;
  customer: Customer;
  merchant: Merchant;
  terminal: Terminal;
  last_transaction: LastTransaction | null;
}

export interface Normalization {
  max_amount: number;
  max_installments: number;
  amount_vs_avg_ratio: number;
  max_minutes: number;
  max_km: number;
  max_tx_count_24h: number;
  max_merchant_avg_amount: number;
}

export type MccRisk = Record<string, number>;

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// Converte payload da transação no vetor de 14 dimensões (REGRAS_DE_DETECCAO.md).
// `norm` = normalization.json, `mccRisk` = mcc_risk.json.
export function vectorize(
  p: FraudPayload,
  norm: Normalization,
  mccRisk: MccRisk,
  out?: Float64Array,
): Float64Array {
  const vec = out || new Float64Array(DIM);
  const tx = p.transaction;
  const cust = p.customer;
  const merch = p.merchant;
  const term = p.terminal;
  const last = p.last_transaction;

  vec[0] = clamp01(tx.amount / norm.max_amount);
  vec[1] = clamp01(tx.installments / norm.max_installments);
  vec[2] = clamp01((tx.amount / cust.avg_amount) / norm.amount_vs_avg_ratio);

  const d = new Date(tx.requested_at);
  vec[3] = d.getUTCHours() / 23;
  vec[4] = ((d.getUTCDay() + 6) % 7) / 6; // JS dom=0..sab=6 -> seg=0..dom=6

  if (last == null) {
    vec[5] = -1;
    vec[6] = -1;
  } else {
    const minutes = (d.getTime() - new Date(last.timestamp).getTime()) / 60000;
    vec[5] = clamp01(minutes / norm.max_minutes);
    vec[6] = clamp01(last.km_from_current / norm.max_km);
  }

  vec[7] = clamp01(term.km_from_home / norm.max_km);
  vec[8] = clamp01(cust.tx_count_24h / norm.max_tx_count_24h);
  vec[9] = term.is_online ? 1 : 0;
  vec[10] = term.card_present ? 1 : 0;
  vec[11] = cust.known_merchants.includes(merch.id) ? 0 : 1;

  const risk = mccRisk[merch.mcc];
  vec[12] = risk === undefined ? 0.5 : risk;

  vec[13] = clamp01(merch.avg_amount / norm.max_merchant_avg_amount);
  return vec;
}
