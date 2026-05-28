import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vectorize, type FraudPayload, type Normalization, type MccRisk } from "../src/vectorize.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const norm: Normalization = JSON.parse(
  readFileSync(path.join(ROOT, "resources", "normalization.json"), "utf8"),
);
const mccRisk: MccRisk = JSON.parse(
  readFileSync(path.join(ROOT, "resources", "mcc_risk.json"), "utf8"),
);

const r4 = (v: number): number => (v === -1 ? -1 : Math.round(v * 1e4) / 1e4);

test("transação legítima (exemplo do doc)", () => {
  const payload: FraudPayload = {
    id: "tx-1329056812",
    transaction: { amount: 41.12, installments: 2, requested_at: "2026-03-11T18:45:53Z" },
    customer: { avg_amount: 82.24, tx_count_24h: 3, known_merchants: ["MERC-003", "MERC-016"] },
    merchant: { id: "MERC-016", mcc: "5411", avg_amount: 60.25 },
    terminal: { is_online: false, card_present: true, km_from_home: 29.23 },
    last_transaction: null,
  };
  const got = Array.from(vectorize(payload, norm, mccRisk)).map(r4);
  const exp = [0.0041, 0.1667, 0.05, 0.7826, 0.3333, -1, -1, 0.0292, 0.15, 0, 1, 0, 0.15, 0.006];
  assert.deepEqual(got, exp);
});

test("transação fraudulenta (exemplo do doc)", () => {
  const payload: FraudPayload = {
    id: "tx-3330991687",
    transaction: { amount: 9505.97, installments: 10, requested_at: "2026-03-14T05:15:12Z" },
    customer: { avg_amount: 81.28, tx_count_24h: 20, known_merchants: ["MERC-008", "MERC-007", "MERC-005"] },
    merchant: { id: "MERC-068", mcc: "7802", avg_amount: 54.86 },
    terminal: { is_online: false, card_present: true, km_from_home: 952.27 },
    last_transaction: null,
  };
  const got = Array.from(vectorize(payload, norm, mccRisk)).map(r4);
  const exp = [0.9506, 0.8333, 1.0, 0.2174, 0.8333, -1, -1, 0.9523, 1.0, 0, 1, 1, 0.75, 0.0055];
  assert.deepEqual(got, exp);
});
