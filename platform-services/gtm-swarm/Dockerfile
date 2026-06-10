# Unison platform-services — consolidated Fly.io mesh (creator API + swarms + watchdog)
FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.11-slim AS runtime

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates bash \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash unison

COPY --from=builder /install /usr/local

COPY src/ ./src/
COPY scripts/ ./scripts/
COPY vendor/ ./vendor/

RUN chmod +x scripts/*.sh \
    && mkdir -p /data/.agent_state /data/logs \
    && chown -R unison:unison /app /data

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UNISON_STATE_ROOT=/data \
    CREATOR_API_HOST=0.0.0.0 \
    CREATOR_API_PORT=8742

USER unison

EXPOSE 8742

CMD ["bash", "scripts/run-platform-mesh.sh"]
