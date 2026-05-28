//! Built-in adapter registry. Adding a new agent = one line here plus its
//! file under `adapters/`.

use crate::adapter::Adapter;
use crate::adapters::{
    claude_code::ClaudeCodeAdapter, claude_cowork::ClaudeCoworkAdapter, codex::CodexAdapter,
    manual_jsonl::ManualJsonlAdapter,
};

/// Construct one fresh instance of every built-in adapter. Cheap — adapters
/// are stateless structs.
pub fn default_adapters() -> Vec<Box<dyn Adapter>> {
    vec![
        Box::new(ClaudeCodeAdapter),
        Box::new(ClaudeCoworkAdapter),
        Box::new(CodexAdapter),
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
            vec!["claude-code", "claude-cowork", "codex", "manual-jsonl"]
        );
    }
}
