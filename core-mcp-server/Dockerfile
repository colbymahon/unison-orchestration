# ── Stage 1: Dependency cache warm-up ───────────────────────────────────────
# Compile dependencies against a stub main.rs first so Docker layer caching
# avoids re-downloading and re-compiling the entire crate graph on every
# source-only change. Only the final `cargo build --release` layer reruns.
FROM rust:1-slim-bookworm AS builder

WORKDIR /usr/src/unison-mcp

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Cache dependency compilation independently from source changes
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -f src/main.rs \
          target/release/core-mcp-server \
          target/release/deps/core_mcp_server*

# Build the real binary — only this layer reruns on source edits
COPY src ./src
RUN cargo build --release

# ── Stage 2: Minimal runtime image ──────────────────────────────────────────
# Final image contains only the compiled binary + OpenSSL runtime libs.
# No Rust toolchain, no source files, no cargo cache — zero attack surface.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN mkdir -p /data
COPY --from=builder /usr/src/unison-mcp/target/release/core-mcp-server /app/unison-mcp-engine

VOLUME ["/data"]
EXPOSE 3000
ENV RUST_LOG=info
ENV PORT=3000

CMD ["/app/unison-mcp-engine"]
