//! Visual workflow canvas persistence — DSL documents on Fly NVMe volumes.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use thiserror::Error;
use tracing::{info, warn};
use uuid::Uuid;

pub const DEFAULT_WORKFLOW_DB_PATH: &str = "/data/workflows.db";

#[derive(Debug, Error)]
pub enum WorkflowStoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("mutex poisoned")]
    Poisoned,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WorkflowRecord {
    pub workflow_id: String,
    pub name: String,
    pub dsl_json: String,
    pub created_at: f64,
    pub updated_at: f64,
    pub published_count: i64,
}

pub struct WorkflowStore {
    path: PathBuf,
    conn: Mutex<Connection>,
}

impl WorkflowStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, WorkflowStoreError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=5000;
             CREATE TABLE IF NOT EXISTS workflows (
               workflow_id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               dsl_json TEXT NOT NULL,
               created_at REAL NOT NULL,
               updated_at REAL NOT NULL,
               published_count INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS idx_workflows_updated
               ON workflows (updated_at DESC);",
        )?;
        info!("Workflow persistence online: {}", path.display());
        Ok(Self {
            path,
            conn: Mutex::new(conn),
        })
    }

    pub fn resolve_db_path() -> PathBuf {
        std::env::var("WORKFLOW_DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_WORKFLOW_DB_PATH))
    }

    pub fn open_with_fallback() -> Self {
        let primary = Self::resolve_db_path();
        match Self::open(&primary) {
            Ok(store) => return store,
            Err(err) => {
                warn!(
                    "Primary workflow DB unavailable at {} ({err}); using /tmp fallback",
                    primary.display()
                );
            }
        }
        let fallback = PathBuf::from("/tmp/workflows.db");
        Self::open(&fallback).unwrap_or_else(|e| {
            panic!("Failed to open workflow DB at {}: {e}", fallback.display());
        })
    }

    pub fn db_path(&self) -> &Path {
        &self.path
    }

    pub fn upsert_workflow(
        &self,
        workflow_id: Option<&str>,
        name: &str,
        dsl_json: &str,
    ) -> Result<WorkflowRecord, WorkflowStoreError> {
        let name = name.trim();
        let dsl_json = dsl_json.trim();
        if name.is_empty() || dsl_json.is_empty() {
            return Err(WorkflowStoreError::InvalidInput(
                "name and dsl_json are required".into(),
            ));
        }

        let now = unix_now_secs();
        let workflow_id = workflow_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let conn = self.conn.lock().map_err(|_| WorkflowStoreError::Poisoned)?;
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM workflows WHERE workflow_id = ?1",
                params![workflow_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();

        if exists {
            conn.execute(
                "UPDATE workflows SET name = ?1, dsl_json = ?2, updated_at = ?3 WHERE workflow_id = ?4",
                params![name, dsl_json, now, workflow_id],
            )?;
        } else {
            conn.execute(
                "INSERT INTO workflows (workflow_id, name, dsl_json, created_at, updated_at, published_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                params![workflow_id, name, dsl_json, now, now],
            )?;
        }
        drop(conn);
        self.get_workflow(&workflow_id)?
            .ok_or_else(|| WorkflowStoreError::InvalidInput("upsert failed".into()))
    }

    pub fn get_workflow(&self, workflow_id: &str) -> Result<Option<WorkflowRecord>, WorkflowStoreError> {
        let workflow_id = workflow_id.trim();
        if workflow_id.is_empty() {
            return Ok(None);
        }
        let conn = self.conn.lock().map_err(|_| WorkflowStoreError::Poisoned)?;
        let row = conn
            .query_row(
                "SELECT workflow_id, name, dsl_json, created_at, updated_at, published_count
                 FROM workflows WHERE workflow_id = ?1",
                params![workflow_id],
                |row| {
                    Ok(WorkflowRecord {
                        workflow_id: row.get(0)?,
                        name: row.get(1)?,
                        dsl_json: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                        published_count: row.get(5)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    pub fn list_workflows(&self, limit: usize) -> Result<Vec<WorkflowRecord>, WorkflowStoreError> {
        let cap = limit.clamp(1, 100) as i64;
        let conn = self.conn.lock().map_err(|_| WorkflowStoreError::Poisoned)?;
        let mut stmt = conn.prepare(
            "SELECT workflow_id, name, dsl_json, created_at, updated_at, published_count
             FROM workflows ORDER BY updated_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![cap], |row| {
            Ok(WorkflowRecord {
                workflow_id: row.get(0)?,
                name: row.get(1)?,
                dsl_json: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                published_count: row.get(5)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn increment_published(&self, workflow_id: &str) -> Result<(), WorkflowStoreError> {
        let conn = self.conn.lock().map_err(|_| WorkflowStoreError::Poisoned)?;
        conn.execute(
            "UPDATE workflows SET published_count = published_count + 1, updated_at = ?1
             WHERE workflow_id = ?2",
            params![unix_now_secs(), workflow_id],
        )?;
        Ok(())
    }
}

fn unix_now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}
