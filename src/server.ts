import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { loadIndex } from "./index-loader.js";
import { createSearcher } from "./search.js";
import { vectorize, type FraudPayload, type Normalization, type MccRisk } from "./vectorize.js";
import { decide } from "./score.js";
import { DIM } from "./quantize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/src/server.js -> sobe dois níveis até a raiz do repo
const ROOT = path.resolve(__dirname, "..", "..");

const INDEX_PATH = process.env.INDEX_PATH || path.join(ROOT, "resources", "index.bin");
const PORT = Number(process.env.PORT || 9999);
const HOST = process.env.HOST || "0.0.0.0";
const NPROBE = Number(process.env.NPROBE || 24);

const norm: Normalization = JSON.parse(
  readFileSync(path.join(ROOT, "resources", "normalization.json"), "utf8"),
);
const mccRisk: MccRisk = JSON.parse(
  readFileSync(path.join(ROOT, "resources", "mcc_risk.json"), "utf8"),
);

const index = loadIndex(INDEX_PATH);
const search = createSearcher(index, { nprobe: NPROBE });

const app = Fastify({ logger: false });

// reusa o buffer do vetor por request (single-thread, sem reentrância no handler sync)
const qvec = new Float64Array(DIM);

app.get("/ready", async (_req, reply) => {
  reply.code(200).send();
});

app.post<{ Body: FraudPayload }>("/fraud-score", (req, reply) => {
  vectorize(req.body, norm, mccRisk, qvec);
  const fraudScore = search(qvec);
  reply.send(decide(fraudScore));
});

app
  .listen({ port: PORT, host: HOST })
  .then(() => console.log(`fraud-api up :${PORT} (N=${index.n} K=${index.k} nprobe=${NPROBE})`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
