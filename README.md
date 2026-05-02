---
title: GHReview Bot
emoji: 🤖
colorFrom: blue
colorTo: indigo
sdk: docker
app_file: src/server.ts
pinned: false
---

# GHReview 🤖
A repo-aware PR reviewer that starts deterministic and compounds with memory.

## Current Phase: 0.5 (Deterministic Analysis)
GHReview currently uses AST-based parsing to analyze PR diffs without LLM overhead.

### Features
- [x] **AST Parser**: Scans JS/TS diffs for patterns.
- [x] **Inline Comments**: Posts findings directly to the PR line.
- [x] **Zero LLM Cost**: 100% deterministic logic for high speed/low cost.

### Getting Started
1. `pnpm install`
2. Place your `key.pem` in `/key`.
3. `docker-compose up --build`