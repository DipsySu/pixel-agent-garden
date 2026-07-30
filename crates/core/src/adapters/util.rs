//! Shared helpers used by multiple adapters.

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const MAX_JSONL_LINE_BYTES: usize = 8 * 1024 * 1024;

/// Validate an absolute local path by its serialized spelling rather than the
/// host running the parser. Adapter fixtures and synchronized agent data can
/// contain POSIX paths on Windows (or drive paths on Unix), so
/// `Path::is_absolute()` would incorrectly make parsing host-dependent.
pub(crate) fn is_portable_absolute_path(path: &str) -> bool {
    if path.starts_with('/') {
        return true;
    }
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

use chrono::{DateTime, Utc};

/// One parsed JSONL row plus its 1-indexed line number. The line number is
/// surfaced for downstream raw_ref strings and debugging.
pub struct JsonlRow {
    pub line_no: usize,
    pub value: serde_json::Value,
}

/// Stable-enough signature for append-only local logs. Size catches appends
/// even on coarse-mtime filesystems; mtime catches same-size rewrites.
pub fn file_signature(path: &Path) -> Option<(u64, u64)> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let modified_ms = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))?;
    Some((metadata.len(), modified_ms))
}

/// Iterate parsed JSONL rows from `path`. Bad lines are silently skipped
/// Returns an empty iterator if the file is missing.
pub fn read_jsonl(path: &Path) -> impl Iterator<Item = JsonlRow> {
    jsonl_rows_with_limit(path, MAX_JSONL_LINE_BYTES)
}

struct JsonlRows {
    reader: Option<BufReader<File>>,
    line_no: usize,
    max_line_bytes: usize,
    buffer: Vec<u8>,
}

fn jsonl_rows_with_limit(path: &Path, max_line_bytes: usize) -> JsonlRows {
    JsonlRows {
        reader: File::open(path).ok().map(BufReader::new),
        line_no: 0,
        max_line_bytes,
        buffer: Vec::new(),
    }
}

impl Iterator for JsonlRows {
    type Item = JsonlRow;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            let reader = self.reader.as_mut()?;
            self.buffer.clear();
            let (read, oversized) =
                read_bounded_line(reader, &mut self.buffer, self.max_line_bytes).ok()?;
            if read == 0 {
                self.reader = None;
                return None;
            }
            self.line_no += 1;
            if oversized {
                continue;
            }
            let Some((start, end)) = trimmed_ascii_range(&self.buffer) else {
                continue;
            };
            let Ok(value) = serde_json::from_slice::<serde_json::Value>(&self.buffer[start..end])
            else {
                continue;
            };
            if !value.is_object() {
                continue;
            }
            return Some(JsonlRow {
                line_no: self.line_no,
                value,
            });
        }
    }
}

fn read_bounded_line(
    reader: &mut BufReader<File>,
    output: &mut Vec<u8>,
    limit: usize,
) -> std::io::Result<(usize, bool)> {
    let mut total = 0;
    let mut oversized = false;
    loop {
        let (consume_len, data_len, found_newline) = {
            let available = reader.fill_buf()?;
            if available.is_empty() {
                return Ok((total, oversized));
            }
            match available.iter().position(|byte| *byte == b'\n') {
                Some(position) => (position + 1, position, true),
                None => (available.len(), available.len(), false),
            }
        };

        {
            let available = reader.fill_buf()?;
            let remaining = limit.saturating_sub(output.len());
            let copy_len = data_len.min(remaining);
            output.extend_from_slice(&available[..copy_len]);
            if copy_len < data_len {
                oversized = true;
            }
        }
        reader.consume(consume_len);
        total += consume_len;
        if found_newline {
            return Ok((total, oversized));
        }
    }
}

fn trimmed_ascii_range(bytes: &[u8]) -> Option<(usize, usize)> {
    let start = bytes.iter().position(|byte| !byte.is_ascii_whitespace())?;
    let end = bytes.iter().rposition(|byte| !byte.is_ascii_whitespace())? + 1;
    Some((start, end))
}

/// Convert a Claude project directory name back to its absolute path.
///
/// Claude encodes POSIX `/Users/demo/Developer/foo` as
/// `-Users-demo-Developer-foo` and Windows `D:\code\demo-notes` as
/// `D--code-demo-notes`. Returns None when the directory name doesn't look encoded
/// (e.g. tests, scratch dirs).
///
/// LOSSY/AMBIGUOUS: both encodings collapse path separators and literal `-`
/// characters into the same byte. Callers therefore mark any path that comes
/// from this fallback as inferred (see `event::PATH_SOURCE_INFERRED`) rather
/// than trusting it. Windows decoding improves the common drive-letter shape
/// and uses an existing-path candidate as a best-effort disambiguator, but it
/// still remains an inferred path.
///
/// ENVIRONMENT-DEPENDENT: the Windows branch reads the filesystem
/// (`Path::exists`) to disambiguate literal hyphens, so the result depends on
/// what is present on disk. On a host where the candidate dirs don't exist
/// (CI, a different machine), it deterministically returns the separator-split
/// form. The decode logic is unit-tested through the injectable
/// `decode_windows_claude_project_name_with` variant.
pub fn project_from_claude_dir(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    decode_windows_claude_project_name(name).or_else(|| decode_posix_claude_project_name(name))
}

fn decode_posix_claude_project_name(name: &str) -> Option<String> {
    if !name.starts_with('-') {
        return None;
    }
    let parts: Vec<&str> = name.split('-').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }
    Some(format!("/{}", parts.join("/")))
}

fn decode_windows_claude_project_name(name: &str) -> Option<String> {
    decode_windows_claude_project_name_with(name, |candidate| Path::new(candidate).exists())
}

fn decode_windows_claude_project_name_with<F>(name: &str, path_exists: F) -> Option<String>
where
    F: Fn(&str) -> bool,
{
    let mut chars = name.chars();
    let drive = chars.next()?.to_ascii_uppercase();
    if !drive.is_ascii_alphabetic() {
        return None;
    }
    let rest = name.get(1..)?.strip_prefix("--")?;
    let parts: Vec<&str> = rest.split('-').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }

    let fallback = windows_candidate_from_mask(drive, &parts, all_separator_mask(parts.len()));
    let Some(max_mask) = candidate_mask_limit(parts.len()) else {
        return Some(fallback);
    };

    let mut existing = Vec::new();
    for mask in 0..max_mask {
        let candidate = windows_candidate_from_mask(drive, &parts, mask);
        if path_exists(&candidate) {
            existing.push(candidate);
            if existing.len() > 1 {
                break;
            }
        }
    }

    if existing.len() == 1 {
        existing.pop()
    } else {
        Some(fallback)
    }
}

/// Exclusive upper bound `2^boundary_count` on the hyphen-boundary masks to
/// brute-force when disambiguating a Windows name. Capped at 12 boundaries
/// (4096 candidates) so a pathological hyphen-rich name can't trigger an
/// unbounded number of `exists()` probes — longer names skip disambiguation and
/// take the separator-split fallback. The `usize::BITS` guard is subsumed by the
/// 12 cap but documents that the `1 << boundary_count` shift can never overflow.
fn candidate_mask_limit(part_count: usize) -> Option<usize> {
    const MAX_BOUNDARIES: usize = 12;
    let boundary_count = part_count.checked_sub(1)?;
    if boundary_count > MAX_BOUNDARIES || boundary_count >= usize::BITS as usize {
        return None;
    }
    Some(1usize << boundary_count)
}

fn all_separator_mask(part_count: usize) -> usize {
    candidate_mask_limit(part_count)
        .map(|limit| limit - 1)
        .unwrap_or(usize::MAX)
}

fn windows_candidate_from_mask(drive: char, parts: &[&str], mask: usize) -> String {
    let mut decoded = format!("{drive}:\\{}", parts[0]);
    for (idx, part) in parts.iter().enumerate().skip(1) {
        let boundary = idx - 1;
        let separator = boundary >= usize::BITS as usize || (mask & (1usize << boundary)) != 0;
        if separator {
            decoded.push('\\');
        } else {
            decoded.push('-');
        }
        decoded.push_str(part);
    }
    decoded
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

/// Coerce any JSON-ish value to a non-negative u64: null, missing keys, and
/// bad strings → 0; negatives clamp to 0.
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

/// Recursively list every `.jsonl` file below `dir`, sorted by path.
pub fn list_jsonl_recursive(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    fn visit(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        paths.sort();
        for path in paths {
            if path.is_dir() {
                visit(&path, out);
            } else if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                out.push(path);
            }
        }
    }
    visit(dir, &mut out);
    out
}

/// `~/.claude/projects/*/**/*.jsonl` style enumeration: list every project dir,
/// then every nested `.jsonl` session file inside. Returns a flat sorted list of
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
        for session in list_jsonl_recursive(&project_dir) {
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
    fn as_int_handles_json_quirks() {
        assert_eq!(as_int(&json!(42)), 42);
        assert_eq!(as_int(&json!(-7)), 0); // negatives clamp to 0
        assert_eq!(as_int(&json!(null)), 0);
        assert_eq!(as_int(&json!("123")), 123);
        assert_eq!(as_int(&json!("abc")), 0);
        assert_eq!(as_int(&json!(1.7)), 1); // truncates
        assert_eq!(as_int(&json!({})), 0);
    }

    #[test]
    fn portable_absolute_paths_do_not_depend_on_test_host() {
        assert!(is_portable_absolute_path("/Users/demo/project"));
        assert!(is_portable_absolute_path("C:/Users/demo/project"));
        assert!(is_portable_absolute_path(r"d:\Users\demo\project"));
        assert!(!is_portable_absolute_path("relative/project"));
        assert!(!is_portable_absolute_path("C:relative"));
        assert!(!is_portable_absolute_path(r"\\server\share"));
    }

    #[test]
    fn project_from_claude_dir_decodes_dashes() {
        let path = PathBuf::from("-Users-demo-Developer-demo-pay");
        let decoded = project_from_claude_dir(Path::new(&path));
        // NB: this is the same lossy mapping Claude's dash encoding forces —
        // paths with real dashes in their components get split too
        // ("demo-pay" comes back as "demo/pay").
        assert_eq!(decoded, Some("/Users/demo/Developer/demo/pay".to_string()));
    }

    #[test]
    fn project_from_claude_dir_decodes_windows_drive_names() {
        let path = PathBuf::from("D--code-notes");
        let decoded = project_from_claude_dir(Path::new(&path));
        assert_eq!(decoded, Some(r"D:\code\notes".to_string()));
    }

    #[test]
    fn project_from_claude_dir_decodes_lowercase_windows_drive_names() {
        let decoded = decode_windows_claude_project_name_with("d--code-notes", |_| false);
        assert_eq!(decoded, Some(r"D:\code\notes".to_string()));
    }

    #[test]
    fn windows_claude_decode_uses_single_existing_candidate_for_hyphenated_names() {
        let decoded =
            decode_windows_claude_project_name_with("D--code-lody-title-agent", |candidate| {
                candidate == r"D:\code\lody-title-agent"
            });
        assert_eq!(decoded, Some(r"D:\code\lody-title-agent".to_string()));
    }

    #[test]
    fn windows_claude_decode_falls_back_when_candidates_are_ambiguous() {
        let decoded =
            decode_windows_claude_project_name_with("D--code-lody-title-agent", |candidate| {
                candidate == r"D:\code\lody-title-agent" || candidate == r"D:\code\lody\title-agent"
            });
        assert_eq!(decoded, Some(r"D:\code\lody\title\agent".to_string()));
    }

    #[test]
    fn project_from_claude_dir_rejects_non_dash_names() {
        let path = PathBuf::from("plain_name");
        assert!(project_from_claude_dir(Path::new(&path)).is_none());
        assert!(project_from_claude_dir(Path::new("1--code-x")).is_none());
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

    #[test]
    fn read_jsonl_skips_oversized_line_and_keeps_following_rows() {
        let tmp =
            std::env::temp_dir().join(format!("lag-test-bounded-{}.jsonl", std::process::id()));
        let oversized = format!("{{\"blob\":\"{}\"}}\n", "x".repeat(128));
        std::fs::write(&tmp, format!("{oversized}{{\"kept\":true}}\n")).unwrap();

        let rows = jsonl_rows_with_limit(&tmp, 64).collect::<Vec<_>>();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].line_no, 2);
        assert_eq!(rows[0].value["kept"], true);
        std::fs::remove_file(&tmp).ok();
    }
}
