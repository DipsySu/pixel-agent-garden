//! Built-in adapter implementations. Each adapter is one file. Adapters
//! never call each other — cross-adapter logic (dedup, source mixing) lives
//! in `crate::scan`.

pub mod antigravity;
pub mod claude_code;
pub mod claude_cowork;
pub mod cline;
pub mod codex;
pub mod copilot_cli;
pub mod cursor;
pub mod gemini_cli;
pub mod goose;
pub mod kiro;
pub mod manual_jsonl;
pub mod opencode;
pub mod qwen_code;
pub mod util;
