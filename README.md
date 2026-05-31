# Rinha de Backend 2026 — Detecção de fraude (Node + Fastify + TypeScript)

Solução para a [Rinha de Backend 2026](https://github.com/zanfranceschi/rinha-de-backend-2026):
detecção de fraude por **busca vetorial** sobre 3.000.000 de vetores de referência, dentro de
**1 vCPU e 350 MB** totais.

## Abordagem

- **Vetorização** do payload em 14 dimensões (`src/vectorize.ts`), conforme `docs/REGRAS_DE_DETECCAO.md`.
- **Índice IVF** gerado offline (`scripts/build-index.ts`): k-means agrupa os 3M vetores em
  clusters; cada vetor é **quantizado em uint8** (≈42 MB vs 168 MB em float32). Empacotado em
  `resources/index.bin`.
- **Busca** (`src/search.ts`): seleciona os `nprobe` clusters mais próximos do query e faz brute
  force só dentro deles → 5 vizinhos → `fraud_score = fraudes / 5`, `approved = fraud_score < 0.6`.
- **TypeScript** compilado para `dist/` via `tsc` (zero overhead em runtime), **TypedArrays**, sem
  dependências nativas. nginx faz round-robin entre 2 instâncias.

## Estrutura

```
src/            código runtime TS (Fastify, vetorização, busca)
scripts/        build-index.ts (offline) e eval-recall.ts (validação)
test/           testes da vetorização (node --test)
dist/           saída compilada do tsc (gerado por npm run build)
resources/      normalization.json, mcc_risk.json, index.bin (gerado)
docs/           regras oficiais (cópia de docs/br do repo da Rinha)
tsconfig.json, docker-compose.yml, nginx.conf, Dockerfile
```

## Como rodar localmente

```bash
npm install

# 1) baixar o dataset (uma vez) -> resources/references.json.gz (~16MB)
npm run fetch:dataset          # DATASET_URL configurável (default = repo oficial)

# 2) compilar TS -> dist/
npm run build

# 3) gerar o índice (usa dist/, requer build antes)
npm run build:index            # -> resources/index.bin

# 4) testes da vetorização
npm test

# 5) validar recall do IVF vs brute force (ajustar NPROBE)
npm run eval:recall            # EVAL_M e NPROBE configuráveis por env

# 6) subir tudo (build multi-stage compila o TS dentro da imagem)
docker compose up --build
curl http://localhost:9999/ready
curl -X POST http://localhost:9999/fraud-score -H 'content-type: application/json' \
  -d @<(node -e "console.log(JSON.stringify(require('./resources/example-payloads.json')[0]))")
```

## Reprodutibilidade e build da imagem

`references.json.gz` e `index.bin` **não** ficam no git (gitignored por tamanho). A imagem
publicada em `ghcr.io/juanvieiraprado99/rinha-backend-2026-node:latest` já traz o `index.bin`
embutido (auto-contida — não precisa do dataset em runtime).

Para reconstruir a imagem do zero:

```bash
npm run fetch:dataset && npm run build && npm run build:index
docker buildx build --platform linux/amd64 \
  -t ghcr.io/juanvieiraprado99/rinha-backend-2026-node:latest --push .
```

O workflow `.github/workflows/build.yml` automatiza esse fluxo a cada push na `main` (fetch →
build → index → buildx amd64 → push GHCR), garantindo que a imagem `:latest` da branch
`submission` esteja sempre alinhada ao código. Requer o package GHCR **público**.

## Tuning

- `NPROBE` (env): nº de clusters varridos por query. Maior = mais recall, maior latência.
- `KMEANS_K` / `KMEANS_BATCHES` (env do build): nº de clusters e iterações do k-means.

## Endpoints (porta 9999)

- `GET /ready` → 200 quando pronto.
- `POST /fraud-score` → `{ "approved": boolean, "fraud_score": number }`.

## Licença

MIT.
