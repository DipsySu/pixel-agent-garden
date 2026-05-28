//! Built-in adapter implementations. Each adapter is one file. Adapters
//! never call each other — cross-adapter logic (dedup, source mixing) lives
//! in `crate::scan`.

pub mod claude_code;
pub mod claude_cowork;
pub mod codex;
pub mod manual_jsonl;
pub mod util;
