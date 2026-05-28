//! Shared helpers used by multiple adapters. Direct port of
//! `local_agent_garden/adapters/utils.py`.

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

/// One parsed JSONL row plus its 1-indexed line number. The line number is
/// surfaced because the Python implementation stitches it into the value as
/// `_line_no` for downstream use (raw_ref strings, debugging). We carry it
/// as a separate field instead of mutating the JSON to keep types tidy —
/// callers can stitch it in if they need the Python-shape value.
pub struct JsonlRow {
    pub line_no: usize,
    pub value: serde_json::Value,
}

/// Iterate parsed JSONL rows from `path`. Bad lines are silently skipped
/// (matches Python). Returns an empty iterator if the file is missing.
pub fn read_jsonl(path: &Path) -> impl Iterator<Item = JsonlRow> {
    // Materialize into a Vec rather than returning a lazy iterator that
    // borrows the file. Each adapter reads at most a few hundred MB total
    // across all sessions; the simplification is worth it.
    let mut rows = Vec::new();
    let Ok(file) = File::open(path) else {
        return rows.into_iter();
    };
    let reader = BufReader::new(file);
    for (idx, line) in reader.lines().enumerate() {
        let Ok(line) = line else { continue };
        let text = line.trim();
        if text.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
            continue;
        };
        if !value.is_object() {
            continue;
        }
        rows.push(JsonlRow {
            line_no: idx + 1,
            value,
        });
    }
    rows.into_iter()
}

/// Convert a Claude project directory name back to its absolute path.
///
/// Claude encodes `/Users/dipsy/Developer/foo` as `-Users-dipsy-Developer-foo`
/// (leading `-`, slashes → `-`). We reverse the encoding. Returns None when
/// the directory name doesn't look encoded (e.g. tests, scratch dirs).
pub fn project_from_claude_dir(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    if !name.starts_with('-') {
        return None;
    }
    let parts: Vec<&str> = name.split('-').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }
    Some(format!("/{}", parts.join("/")))
}

/// Like `as_int` but accepts `Option<&Value>` directly. Returns 0 for None
/// or null. Used to avoid `unwrap_or(&Value::Null)` temporary patterns at
/// the adapter call site.
pub fn as_int_opt(value: Option<&serde_json::Value>) -> u64 {
    match value {
        Some(v) => as_int(v),
        None => 0,
    }
}

/// Coerce any JSON-ish value to a non-negative u64. Mirrors Python `as_int`:
/// `None`, missing keys, bad strings → 0; negatives clamped to 0.
pub fn as_int(value: &serde_json::Value) -> u64 {
    match value {
        serde_json::Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                u
            } else if let Some(i) = n.as_i64() {
                if i > 0 { i as u64 } else { 0 }
            } else if let Some(f) = n.as_f64() {
                if f > 0.0 { f as u64 } else { 0 }
            } else {
                0
            }
        }
        serde_json::Value::String(s) => s
            .trim()
            .parse::<i64>()
            .ok()
            .map(|n| if n > 0 { n as u64 } else { 0 })
            .unwrap_or(0),
        serde_json::Value::Bool(true) => 1,
        _ => 0,
    }
}

/// Parse RFC3339 timestamps from agent logs. Accepts both `Z` and `+00:00`
/// suffixes and always returns UTC.
pub fn parse_rfc3339_utc(value: &str) -> Option<DateTime<Utc>> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let normalized = match trimmed.strip_suffix('Z') {
        Some(stripped) => format!("{stripped}+00:00"),
        None => trimmed.to_string(),
    };
    DateTime::parse_from_rfc3339(&normalized)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// Sorted glob over a directory at depth 1 — finds every direct child file
/// matching the given extension. Used by claude_code (each project dir
/// contains one or more `.jsonl` session files).
pub fn list_session_files(dir: &Path, extension: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return paths;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some(extension) {
            paths.push(path);
        }
    }
    paths.sort();
    paths
}

/// `~/.claude/projects/*/*.jsonl` style enumeration: list every project dir,
/// then every `.jsonl` session file inside. Returns a flat sorted list of
/// `(project_dir, session_file)` pairs.
pub fn list_claude_session_files(projects_root: &Path) -> Vec<(PathBuf, PathBuf)> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(projects_root) else {
        return out;
    };
    let mut project_dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    project_dirs.sort();
    for project_dir in project_dirs {
        for session in list_session_files(&project_dir, "jsonl") {
            out.push((project_dir.clone(), session));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn as_int_handles_python_quirks() {
        assert_eq!(as_int(&json!(42)), 42);
        assert_eq!(as_int(&json!(-7)), 0); // negatives clamp to 0
        assert_eq!(as_int(&json!(null)), 0);
        assert_eq!(as_int(&json!("123")), 123);
        assert_eq!(as_int(&json!("abc")), 0);
        assert_eq!(as_int(&json!(1.7)), 1); // truncates
        assert_eq!(as_int(&json!({})), 0);
    }

    #[test]
    fn project_from_claude_dir_decodes_dashes() {
        let path = PathBuf::from("-Users-dipsy-Developer-pay-module");
        let decoded = project_from_claude_dir(Path::new(&path));
        // NB: this is the same lossy mapping Python uses — paths with real
        // dashes in their components get split too. Documented behavior.
        assert_eq!(
            decoded,
            Some("/Users/dipsy/Developer/pay/module".to_string())
        );
    }

    #[test]
    fn project_from_claude_dir_rejects_non_dash_names() {
        let path = PathBuf::from("plain_name");
        assert!(project_from_claude_dir(Path::new(&path)).is_none());
    }

    #[test]
    fn read_jsonl_skips_blank_and_invalid_rows() {
        let tmp = std::env::temp_dir().join(format!("lag-test-{}.jsonl", std::process::id()));
        std::fs::write(&tmp, "{\"a\":1}\n\n   \nnot-json\n{\"b\":2}\n").unwrap();
        let rows: Vec<JsonlRow> = read_jsonl(&tmp).collect();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].line_no, 1);
        assert_eq!(rows[0].value["a"], 1);
        assert_eq!(rows[1].line_no, 5);
        assert_eq!(rows[1].value["b"], 2);
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn read_jsonl_missing_file_returns_empty() {
        let rows: Vec<_> = read_jsonl(Path::new("/nonexistent/path/x.jsonl")).collect();
        assert!(rows.is_empty());
    }
}
