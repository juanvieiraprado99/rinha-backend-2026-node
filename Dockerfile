FROM node:22-slim AS build

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
COPY scripts ./scripts
COPY test ./test
RUN npm run build

FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist/src ./dist/src
# index.bin precisa ser gerado antes (npm run build:index)
COPY resources/index.bin resources/normalization.json resources/mcc_risk.json ./resources/

ENV NODE_ENV=production
EXPOSE 9999

CMD ["node", "--max-old-space-size=128", "dist/src/server.js"]
