//! Crate-wide error type. Adapters and aggregation surface failures via
//! `Result<T, Error>` so callers (CLI, Tauri commands) can decide how to
//! report or recover. No `Box<dyn std::error::Error>` in public APIs — see
//! modularity rule #6 in `docs/11-tauri-rust-rewrite-spec.md`.

use std::io;
use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("I/O error reading {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },

    /// A single row inside a JSONL file failed to parse. The adapter
    /// typically swallows these and moves on; the variant exists so that a
    /// caller asking for *strict* mode can surface them later.
    #[error("malformed JSONL row in {path} (line {line}): {message}")]
    JsonlRow {
        path: PathBuf,
        line: usize,
        message: String,
    },

    #[error("malformed JSON in {path}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    #[error("SQLite error reading {path}: {source}")]
    Sqlite {
        path: PathBuf,
        #[source]
        source: rusqlite::Error,
    },

    /// A required record field was missing or had the wrong shape. Used
    /// sparingly — most adapters skip bad rows silently and keep scanning.
    #[error("invalid record in {context}: {message}")]
    InvalidRecord { context: String, message: String },

    /// Settings TOML failed to parse. See `core/src/settings.rs`.
    #[error("malformed settings TOML at {path}: {source}")]
    TomlParse {
        path: PathBuf,
        #[source]
        source: toml::de::Error,
    },

    /// Settings TOML failed to serialize before writing.
    #[error("failed to encode settings TOML for {path}: {source}")]
    TomlSerialize {
        path: PathBuf,
        #[source]
        source: toml::ser::Error,
    },
}

impl Error {
    pub fn io(path: impl Into<PathBuf>, source: io::Error) -> Self {
        Error::Io {
            path: path.into(),
            source,
        }
    }

    pub fn json(path: impl Into<PathBuf>, source: serde_json::Error) -> Self {
        Error::Json {
            path: path.into(),
            source,
        }
    }

    pub fn sqlite(path: impl Into<PathBuf>, source: rusqlite::Error) -> Self {
        Error::Sqlite {
            path: path.into(),
            source,
        }
    }
}
