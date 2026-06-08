//! Async task queue — durable background execution tracking on Fly NVMe volumes.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use thiserror::Error;
use tracing::{info, warn};
use uuid::Uuid;

pub const DEFAULT_TASK_DB_PATH: &str = "/data/task_queue.db";

#[derive(Debug, Error)]
pub enum TaskQueueError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("mutex poisoned")]
    Poisoned,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TaskRecord {
    pub task_id: String,
    pub agent_id: String,
    pub session_id: String,
    pub collection: String,
    pub query: String,
    pub status: String,
    pub created_at: f64,
    pub completed_at: Option<f64>,
    pub result_digest: Option<String>,
}

pub struct TaskQueueStore {
    path: PathBuf,
    conn: Mutex<Connection>,
}

impl TaskQueueStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, TaskQueueError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=5000;
             CREATE TABLE IF NOT EXISTS task_queue (
               task_id TEXT PRIMARY KEY,
               agent_id TEXT NOT NULL,
               session_id TEXT NOT NULL,
               collection TEXT NOT NULL,
               query TEXT NOT NULL,
               status TEXT NOT NULL DEFAULT 'pending',
               created_at REAL NOT NULL,
               completed_at REAL,
               result_digest TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_task_queue_status_created
               ON task_queue (status, created_at ASC);",
        )?;
        info!("Task queue persistence online: {}", path.display());
        Ok(Self {
            path,
            conn: Mutex::new(conn),
        })
    }

    pub fn resolve_db_path() -> PathBuf {
        std::env::var("TASK_QUEUE_DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_TASK_DB_PATH))
    }

    pub fn open_with_fallback() -> Self {
        let primary = Self::resolve_db_path();
        match Self::open(&primary) {
            Ok(store) => return store,
            Err(err) => {
                warn!(
                    "Primary task queue DB unavailable at {} ({err}); using /tmp fallback",
                    primary.display()
                );
            }
        }
        let fallback = PathBuf::from("/tmp/task_queue.db");
        Self::open(&fallback).unwrap_or_else(|e| {
            panic!("Failed to open task queue DB at {}: {e}", fallback.display());
        })
    }

    pub fn db_path(&self) -> &Path {
        &self.path
    }

    pub fn enqueue_task(
        &self,
        agent_id: &str,
        session_id: &str,
        collection: &str,
        query: &str,
    ) -> Result<TaskRecord, TaskQueueError> {
        let agent_id = agent_id.trim();
        let session_id = session_id.trim();
        let collection = collection.trim();
        let query = query.trim();
        if agent_id.is_empty()
            || session_id.is_empty()
            || collection.is_empty()
            || query.is_empty()
        {
            return Err(TaskQueueError::InvalidInput(
                "agent_id, session_id, collection, and query are required".into(),
            ));
        }

        let task_id = Uuid::new_v4().to_string();
        let created_at = unix_now_secs();
        let conn = self.conn.lock().map_err(|_| TaskQueueError::Poisoned)?;
        conn.execute(
            "INSERT INTO task_queue
             (task_id, agent_id, session_id, collection, query, status,
              created_at, completed_at, result_digest)
             VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, NULL, NULL)",
            params![task_id, agent_id, session_id, collection, query, created_at],
        )?;
        Ok(TaskRecord {
            task_id,
            agent_id: agent_id.to_string(),
            session_id: session_id.to_string(),
            collection: collection.to_string(),
            query: query.to_string(),
            status: "pending".to_string(),
            created_at,
            completed_at: None,
            result_digest: None,
        })
    }

    pub fn get_task(&self, task_id: &str) -> Result<Option<TaskRecord>, TaskQueueError> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Ok(None);
        }
        let conn = self.conn.lock().map_err(|_| TaskQueueError::Poisoned)?;
        let row = conn
            .query_row(
                "SELECT task_id, agent_id, session_id, collection, query, status,
                        created_at, completed_at, result_digest
                 FROM task_queue WHERE task_id = ?1",
                params![task_id],
                row_to_task,
            )
            .optional()?;
        Ok(row)
    }

    pub fn fetch_next_pending_task(&self) -> Result<Option<TaskRecord>, TaskQueueError> {
        let conn = self.conn.lock().map_err(|_| TaskQueueError::Poisoned)?;
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let row = conn
            .query_row(
                "SELECT task_id, agent_id, session_id, collection, query, status,
                        created_at, completed_at, result_digest
                 FROM task_queue
                 WHERE status = 'pending'
                 ORDER BY created_at ASC
                 LIMIT 1",
                [],
                row_to_task,
            )
            .optional()?;

        let Some(mut task) = row else {
            conn.execute_batch("ROLLBACK")?;
            return Ok(None);
        };

        conn.execute(
            "UPDATE task_queue SET status = 'running', completed_at = NULL WHERE task_id = ?1",
            params![task.task_id],
        )?;
        conn.execute_batch("COMMIT")?;
        task.status = "running".to_string();
        task.completed_at = None;
        Ok(Some(task))
    }

    pub fn update_task_status(
        &self,
        task_id: &str,
        status: &str,
        result_digest: Option<&str>,
    ) -> Result<Option<TaskRecord>, TaskQueueError> {
        let task_id = task_id.trim();
        let status = status.trim().to_lowercase();
        if task_id.is_empty() {
            return Err(TaskQueueError::InvalidInput("task_id is required".into()));
        }
        if !matches!(
            status.as_str(),
            "pending" | "running" | "completed" | "failed" | "cancelled"
        ) {
            return Err(TaskQueueError::InvalidInput(format!(
                "invalid status: {status}"
            )));
        }

        let completed_at = if matches!(status.as_str(), "completed" | "failed" | "cancelled") {
            Some(unix_now_secs())
        } else {
            None
        };

        let conn = self.conn.lock().map_err(|_| TaskQueueError::Poisoned)?;
        let updated = conn.execute(
            "UPDATE task_queue
             SET status = ?1,
                 result_digest = COALESCE(?2, result_digest),
                 completed_at = COALESCE(?3, completed_at)
             WHERE task_id = ?4",
            params![status, result_digest, completed_at, task_id],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        drop(conn);
        self.get_task(task_id)
    }
}

fn row_to_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRecord> {
    Ok(TaskRecord {
        task_id: row.get(0)?,
        agent_id: row.get(1)?,
        session_id: row.get(2)?,
        collection: row.get(3)?,
        query: row.get(4)?,
        status: row.get(5)?,
        created_at: row.get(6)?,
        completed_at: row.get(7)?,
        result_digest: row.get(8)?,
    })
}

fn unix_now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}
