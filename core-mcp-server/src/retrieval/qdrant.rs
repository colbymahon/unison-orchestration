//! Pooled Qdrant REST client — single shared reqwest instance per process (keep-alive).

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tracing::{info, instrument};

#[derive(Debug, Clone)]
pub struct QdrantTimings {
    pub latency_ms: u64,
}

#[derive(Serialize)]
struct QdrantSearchRequest {
    vector: Vec<f32>,
    limit: usize,
    with_payload: bool,
}

#[derive(Deserialize)]
struct QdrantSearchResponse {
    result: Vec<QdrantScoredPoint>,
}

#[derive(Clone, Deserialize)]
pub struct QdrantScoredPoint {
    pub payload: Option<QdrantPayload>,
}

#[derive(Clone, Deserialize)]
pub struct QdrantPayload {
    pub text: Option<String>,
    pub source_url: Option<String>,
    pub sequence: Option<serde_json::Value>,
}

pub struct QdrantPool {
    base_url: String,
    api_key: String,
    http: reqwest::Client,
    top_k: usize,
}

impl QdrantPool {
    pub fn new(base_url: String, api_key: String, http: reqwest::Client, top_k: usize) -> Arc<Self> {
        Arc::new(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
            http,
            top_k,
        })
    }

    pub fn search_url(&self, collection: &str) -> String {
        format!(
            "{}/collections/{}/points/search",
            self.base_url, collection
        )
    }

    /// Lightweight health probe — warms TLS + HTTP connection pool.
    pub async fn warmup(&self) -> Result<(), String> {
        let url = format!("{}/collections", self.base_url);
        let resp = self
            .http
            .get(&url)
            .header("api-key", &self.api_key)
            .send()
            .await
            .map_err(|e| format!("warmup transport: {e}"))?;
        if resp.status().is_success() {
            info!("Qdrant pool warmup OK");
            Ok(())
        } else {
            Err(format!("warmup HTTP {}", resp.status()))
        }
    }

    #[instrument(skip(self, vector), fields(collection = %collection))]
    pub async fn search(
        &self,
        vector: Vec<f32>,
        collection: &str,
    ) -> Result<(Vec<QdrantScoredPoint>, QdrantTimings), String> {
        let t0 = Instant::now();
        let url = self.search_url(collection);
        info!("Qdrant search '{}' top-{}", collection, self.top_k);

        let resp = self
            .http
            .post(&url)
            .header("api-key", &self.api_key)
            .json(&QdrantSearchRequest {
                vector,
                limit: self.top_k,
                with_payload: true,
            })
            .send()
            .await
            .map_err(|e| format!("transport: {e}"))?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err("invalid collection".into());
        }
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP {status}: {body}"));
        }

        let parsed: QdrantSearchResponse = resp
            .json()
            .await
            .map_err(|e| format!("parse: {e}"))?;

        let latency_ms = t0.elapsed().as_millis() as u64;
        info!("Qdrant returned {} hits in {}ms", parsed.result.len(), latency_ms);
        Ok((parsed.result, QdrantTimings { latency_ms }))
    }
}

/// Build a dedicated Qdrant HTTP client with aggressive connection reuse.
pub fn build_qdrant_http(pool_idle: usize, timeout_ms: u64) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .use_rustls_tls()
        .pool_max_idle_per_host(pool_idle)
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(30))
        .timeout(Duration::from_millis(timeout_ms))
        .build()
}

/// Build OpenAI embedding HTTP client (separate pool from Qdrant).
pub fn build_embed_http(pool_idle: usize, timeout_ms: u64) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .use_rustls_tls()
        .pool_max_idle_per_host(pool_idle)
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(30))
        .timeout(Duration::from_millis(timeout_ms))
        .build()
}
