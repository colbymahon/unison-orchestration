//! Search path: embedding generation + Qdrant vector lookup.

pub mod embed;
pub mod qdrant;

pub use embed::EmbedService;
pub use qdrant::QdrantPool;
