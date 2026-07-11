//! Built-in adapter registry. Adding a new agent = one line here plus its
//! file under `adapters/`.

use crate::adapter::Adapter;
use crate::adapters::{
    antigravity::AntigravityAdapter, claude_code::ClaudeCodeAdapter,
    claude_cowork::ClaudeCoworkAdapter, cline::ClineAdapter, codex::CodexAdapter,
    copilot_cli::CopilotCliAdapter, gemini_cli::GeminiCliAdapter, goose::GooseAdapter,
    manual_jsonl::ManualJsonlAdapter, opencode::OpenCodeAdapter,
};

/// Construct one fresh instance of every built-in adapter. Cheap — adapters
/// are stateless structs. `manual-jsonl` stays last: it is the catch-all
/// bridge for sources without a native adapter.
pub fn default_adapters() -> Vec<Box<dyn Adapter>> {
    vec![
        Box::new(AntigravityAdapter),
        Box::new(ClaudeCodeAdapter),
        Box::new(ClaudeCoworkAdapter),
        Box::new(ClineAdapter),
        Box::new(CodexAdapter),
        Box::new(CopilotCliAdapter),
        Box::new(GeminiCliAdapter::gemini()),
        Box::new(GooseAdapter),
        Box::new(OpenCodeAdapter),
        Box::new(ManualJsonlAdapter),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_lists_builtin_adapters() {
        // Bind to a local so the returned `&str`s outlive the iteration —
        // see E0716. Collecting to Vec<String> would also work; binding is
        // cheaper and matches how real callers consume the registry.
        let adapters = default_adapters();
        let names: Vec<&str> = adapters.iter().map(|a| a.name()).collect();
        assert_eq!(
            names,
            vec![
                "antigravity",
                "claude-code",
                "claude-cowork",
                "cline",
                "codex",
                "copilot-cli",
                "gemini-cli",
                "goose",
                "opencode",
                "manual-jsonl"
            ]
        );
    }
}
