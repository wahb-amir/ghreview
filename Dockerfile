FROM node:20-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@latest --activate

# IMPORTANT: stabilize pnpm store on HF
RUN pnpm config set store-dir /pnpm/store

WORKDIR /usr/src/app

# -------------------------
# Dependencies layer
# -------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

# -------------------------
# Build layer
# -------------------------
FROM base AS build

WORKDIR /usr/src/app

COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .

RUN pnpm build

# -------------------------
# Production layer
# -------------------------
FROM node:20-slim AS final

WORKDIR /usr/src/app

ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm config set store-dir /pnpm/store

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --prod --frozen-lockfile

COPY --from=build /usr/src/app/dist ./dist

EXPOSE 7860

CMD ["node", "dist/server.js"]