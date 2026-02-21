FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock ./
COPY web/package.json web/

# Install dependencies
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source
COPY web/ web/

# Build frontend
RUN cd web && bun run build

FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY web/package.json web/

RUN bun install --frozen-lockfile --ignore-scripts --production

COPY web/src/server.ts web/src/server.ts
COPY web/src/api/ web/src/api/
COPY --from=builder /app/web/dist/ web/dist/

EXPOSE 3000

CMD ["bun", "run", "web/src/server.ts"]
