FROM oven/bun:1-alpine

WORKDIR /app

# Copy root workspace files for dependency resolution
COPY package.json bun.lock tsconfig.json ./
COPY massive/package.json massive/
COPY questdb/package.json questdb/
COPY orchestrator/package.json orchestrator/

# Install dependencies (skip native build scripts — bufferutil/utf-8-validate
# are optional ws optimizations; ws falls back to pure JS without them)
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source code for all workspaces (orchestrator imports from both)
COPY massive/ massive/
COPY questdb/ questdb/
COPY orchestrator/ orchestrator/

CMD ["bun", "run", "orchestrator/index.ts"]
