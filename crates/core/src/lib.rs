//! Local Agent Garden — domain core.
//!
//! This crate defines the cross-adapter contract (`Adapter` trait + `AgentEvent`),
//! built-in adapters, aggregation logic, and on-disk event cache. It has zero
//! UI / IPC / Tauri dependencies — the same code powers the CLI binary and the
//! Tauri desktop shell.
//!
//! See `docs/11-tauri-rust-rewrite-spec.md` for the architecture rationale.

pub mod adapter;
pub mod adapters;
pub mod aggregate;
pub mod cache;
pub mod error;
pub mod event;
pub mod registry;
pub mod rings;
pub mod scan;
pub mod settings;
pub mod storage;

pub use adapter::{Adapter, AdapterContext};
pub use error::Error;
pub use event::{AgentEvent, TokenUsage};
pub use settings::{
    Appearance, DataSettings, FlowerbedMode, Integrations, Motion, SeasonMode, Settings,
    TerminalKind, TimeMode,
};
