//! Durable telemetry counters — survives container restarts and `fly deploy` rollouts.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};
use thiserror::Error;
use tracing::{info, warn};

pub const DEFAULT_DB_PATH: &str = "/data/telemetry_registry.db";

pub const KEY_TOTAL_QUERIES: &str = "total_queries";
pub const KEY_TOTAL_402: &str = "total_402_rejections";
pub const KEY_MANIFEST_CRAWLS: &str = "manifest_crawl_hits";
pub const KEY_ZERO_RESULTS: &str = "zero_result_queries";
pub const KEY_LATENCY_TOTAL_MS: &str = "latency_total_ms";
pub const KEY_LATENCY_SAMPLES: &str = "latency_sample_count";

const COLLECTION_PREFIX: &str = "collection:";
const AGENT_PREFIX: &str = "agent:";

#[derive(Debug, Error)]
pub enum PersistError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("mutex poisoned")]
    Poisoned,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub struct TelemetryStore {
    path: PathBuf,
    conn: Mutex<Connection>,
}

impl TelemetryStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, PersistError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=5000;
             CREATE TABLE IF NOT EXISTS telemetry_counters (
               metric_key TEXT PRIMARY KEY,
               metric_value INTEGER NOT NULL DEFAULT 0
             );",
        )?;
        let store = Self {
            path,
            conn: Mutex::new(conn),
        };
        store.log_boot_snapshot();
        Ok(store)
    }

    pub fn resolve_db_path() -> PathBuf {
        std::env::var("TELEMETRY_DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_DB_PATH))
    }

    pub fn open_with_fallback() -> Self {
        let primary = Self::resolve_db_path();
        match Self::open(&primary) {
            Ok(store) => {
                info!(
                    "Telemetry persistence online: {}",
                    primary.display()
                );
                return store;
            }
            Err(err) => {
                warn!(
                    "Primary telemetry DB unavailable at {} ({err}); using /tmp fallback",
                    primary.display()
                );
            }
        }
        let fallback = PathBuf::from("/tmp/telemetry_registry.db");
        Self::open(&fallback).unwrap_or_else(|e| {
            panic!("Failed to open telemetry DB at {}: {e}", fallback.display());
        })
    }

    fn log_boot_snapshot(&self) {
        let keys = [
            KEY_TOTAL_QUERIES,
            KEY_TOTAL_402,
            KEY_MANIFEST_CRAWLS,
            KEY_ZERO_RESULTS,
        ];
        for key in keys {
            if let Ok(val) = self.read_persistent_counter(key) {
                if val > 0 {
                    info!("Restored persistent counter {key}={val}");
                }
            }
        }
    }

    pub fn db_path(&self) -> &Path {
        &self.path
    }

    pub fn increment_persistent_counter(
        &self,
        key: &str,
        delta: i64,
    ) -> Result<i64, PersistError> {
        let conn = self.conn.lock().map_err(|_| PersistError::Poisoned)?;
        conn.execute(
            "INSERT INTO telemetry_counters (metric_key, metric_value)
             VALUES (?1, ?2)
             ON CONFLICT(metric_key) DO UPDATE SET
               metric_value = metric_value + excluded.metric_value",
            params![key, delta],
        )?;
        Self::read_locked(&conn, key)
    }

    pub fn read_persistent_counter(&self, key: &str) -> Result<i64, PersistError> {
        let conn = self.conn.lock().map_err(|_| PersistError::Poisoned)?;
        Self::read_locked(&conn, key)
    }

    fn read_locked(conn: &Connection, key: &str) -> Result<i64, PersistError> {
        let value: Result<i64, rusqlite::Error> = conn.query_row(
            "SELECT metric_value FROM telemetry_counters WHERE metric_key = ?1",
            params![key],
            |row| row.get(0),
        );
        match value {
            Ok(v) => Ok(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(0),
            Err(e) => Err(e.into()),
        }
    }

    pub fn read_prefixed_counters(&self, prefix: &str) -> Result<HashMap<String, u64>, PersistError> {
        let conn = self.conn.lock().map_err(|_| PersistError::Poisoned)?;
        let mut stmt = conn.prepare(
            "SELECT metric_key, metric_value FROM telemetry_counters
             WHERE metric_key LIKE ?1",
        )?;
        let pattern = format!("{prefix}%");
        let rows = stmt.query_map(params![pattern], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;

        let mut out = HashMap::new();
        for row in rows {
            let (key, value) = row?;
            if let Some(suffix) = key.strip_prefix(prefix) {
                if value > 0 {
                    out.insert(suffix.to_string(), value as u64);
                }
            }
        }
        Ok(out)
    }

    pub fn bump_collection(&self, collection: &str) -> Result<u64, PersistError> {
        let key = format!("{COLLECTION_PREFIX}{collection}");
        Ok(self.increment_persistent_counter(&key, 1)? as u64)
    }

    pub fn bump_agent(&self, agent_id: &str) -> Result<u64, PersistError> {
        let key = format!("{AGENT_PREFIX}{agent_id}");
        Ok(self.increment_persistent_counter(&key, 1)? as u64)
    }

    pub fn collection_totals(&self) -> HashMap<String, u64> {
        self.read_prefixed_counters(COLLECTION_PREFIX)
            .unwrap_or_default()
    }

    pub fn agent_totals(&self) -> HashMap<String, u64> {
        self.read_prefixed_counters(AGENT_PREFIX)
            .unwrap_or_default()
    }

    /// Remove telemetry keys matching a SQL LIKE pattern (e.g. `agent:ip:%`).
    pub fn delete_keys_matching(&self, like_pattern: &str) -> Result<usize, PersistError> {
        let conn = self.conn.lock().map_err(|_| PersistError::Poisoned)?;
        let deleted = conn.execute(
            "DELETE FROM telemetry_counters WHERE metric_key LIKE ?1",
            params![like_pattern],
        )?;
        Ok(deleted)
    }

    /// Drop scanner/NAT noise — ephemeral edge `ip:*` identities and orphan heartbeats.
    pub fn prune_noise_agent_keys(&self) -> Result<usize, PersistError> {
        let mut total = 0usize;
        for pattern in [
            "agent:ip:%",
            "registry_heartbeat:ip:%",
            "agent:anonymous",
            "registry_heartbeat:anonymous",
        ] {
            total += self.delete_keys_matching(pattern)?;
        }
        Ok(total)
    }
}

pub fn increment_persistent_counter(
    store: &TelemetryStore,
    key: &str,
    delta: i64,
) -> i64 {
    match store.increment_persistent_counter(key, delta) {
        Ok(v) => v,
        Err(err) => {
            warn!("increment_persistent_counter({key}) degraded: {err}");
            0
        }
    }
}

pub fn read_persistent_counter(store: &TelemetryStore, key: &str) -> i64 {
    match store.read_persistent_counter(key) {
        Ok(v) => v,
        Err(err) => {
            warn!("read_persistent_counter({key}) degraded: {err}");
            0
        }
    }
}
