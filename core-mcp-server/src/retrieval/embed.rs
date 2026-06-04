//! Query embeddings with in-memory LRU/TTL cache (moka) and pooled HTTP/2 to OpenAI.

use std::sync::Arc;
use std::time::Duration;

use blake3::hash;
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use tracing::{debug, info, instrument};

const OPENAI_EMBED_URL: &str = "https://api.openai.com/v1/embeddings";
const DEFAULT_MODEL: &str = "text-embedding-3-small";

#[derive(Debug, Clone)]
pub struct EmbedTimings {
    pub cache_hit: bool,
    pub latency_ms: u64,
}

#[derive(Serialize)]
struct EmbedRequest<'a> {
    model: &'a str,
    input: &'a str,
    encoding_format: &'a str,
}

#[derive(Deserialize)]
struct EmbedResponse {
    data: Vec<EmbedData>,
}

#[derive(Deserialize)]
struct EmbedData {
    embedding: Vec<f32>,
}

pub struct EmbedService {
    openai_key: String,
    model: String,
    http: reqwest::Client,
    cache: Cache<String, Arc<Vec<f32>>>,
}

impl EmbedService {
    pub fn new(openai_key: String, http: reqwest::Client, max_entries: u64, ttl_secs: u64) -> Self {
        let cache = Cache::builder()
            .max_capacity(max_entries)
            .time_to_live(Duration::from_secs(ttl_secs))
            .build();
        Self {
            openai_key,
            model: DEFAULT_MODEL.to_string(),
            http,
            cache,
        }
    }

    fn cache_key(text: &str) -> String {
        let normalized = text.trim().to_lowercase();
        hash(normalized.as_bytes()).to_hex().to_string()
    }

    #[instrument(skip(self))]
    pub async fn embed(&self, text: &str) -> Result<(Vec<f32>, EmbedTimings), String> {
        let key = Self::cache_key(text);
        if let Some(hit) = self.cache.get(&key).await {
            debug!("embed cache HIT");
            return Ok((
                (*hit).clone(),
                EmbedTimings {
                    cache_hit: true,
                    latency_ms: 0,
                },
            ));
        }

        let t0 = std::time::Instant::now();
        info!("embed cache MISS — OpenAI ({} chars)", text.len());

        let resp = self
            .http
            .post(OPENAI_EMBED_URL)
            .bearer_auth(&self.openai_key)
            .json(&EmbedRequest {
                model: &self.model,
                input: text,
                encoding_format: "float",
            })
            .send()
            .await
            .map_err(|e| format!("transport: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP {status}: {body}"));
        }

        let parsed: EmbedResponse = resp
            .json()
            .await
            .map_err(|e| format!("parse: {e}"))?;

        let vector = parsed
            .data
            .into_iter()
            .next()
            .map(|d| d.embedding)
            .ok_or_else(|| "empty embedding response".to_string())?;

        let latency_ms = t0.elapsed().as_millis() as u64;
        self.cache.insert(key, Arc::new(vector.clone())).await;

        Ok((
            vector,
            EmbedTimings {
                cache_hit: false,
                latency_ms,
            },
        ))
    }

    pub async fn warmup(&self) {
        self.cache.run_pending_tasks().await;
    }
}
