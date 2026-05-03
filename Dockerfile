# -------------------------
# Base image
# -------------------------
FROM node:20-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install system deps (python + git + sudo for semgrep runner)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    git \
    sudo \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install semgrep (Python tool)
RUN pip3 install --no-cache-dir semgrep

# Create restricted user for semgrep
RUN useradd -m -r -s /usr/sbin/nologin semgrep-runner

# Allow running semgrep as that user without password
RUN echo "ALL ALL=(semgrep-runner) NOPASSWD: /usr/local/bin/semgrep" >> /etc/sudoers

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Stabilize pnpm store
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
FROM base AS final

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /usr/src/app/dist ./dist

# Create tmp dir for analysis (important)
RUN mkdir -p /tmp && chmod 777 /tmp

EXPOSE 7860

CMD ["node", "dist/server.js"]