//! Built-in adapter implementations. Each adapter is one file. Adapters
//! never call each other — cross-adapter logic (dedup, source mixing) lives
//! in `crate::scan`.

pub mod claude_code;
pub mod claude_cowork;
pub mod cline;
pub mod codex;
pub mod copilot_cli;
pub mod gemini_cli;
pub mod goose;
pub mod manual_jsonl;
pub mod opencode;
pub mod util;
