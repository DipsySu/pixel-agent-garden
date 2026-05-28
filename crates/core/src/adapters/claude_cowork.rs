//! Claude Desktop Cowork adapter.
//!
//! Cowork stores an embedded Claude Code project tree under
//! `~/Library/Application Support/Claude/local-agent-mode-sessions/<account>/<workspace>/`.
//! We intentionally read the embedded `.claude/projects/**/*.jsonl` files
//! because they have the same message/usage shape as Claude Code. The host
//! `audit.jsonl` files are the better long-term audit source, but they need a
//! separate parser and reconciliation pass.

use crate::adapter::{Adapter, AdapterContext};
use crate::adapters::util::{
    JsonlRow, as_int_opt, list_jsonl_recursive, parse_rfc3339_utc, read_jsonl,
};
use crate::error::Error;
use crate::event::AgentEvent;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub struct ClaudeCoworkAdapter;

#[derive(Debug, Clone, Default)]
struct CoworkSessionMeta {
    local_session_id: Option<String>,
    cli_session_id: Option<String>,
    title: Option<String>,
    process_name: Option<String>,
    cwd: Option<String>,
    space_id: Option<String>,
    space_path: Option<String>,
    selected_folders: Vec<String>,
    archived: Option<bool>,
}

impl CoworkSessionMeta {
    fn preferred_root(&self) -> Option<&str> {
        self.selected_folders
            .first()
            .map(String::as_str)
            .or(self.space_path.as_deref())
    }
}

impl ClaudeCoworkAdapter {
    pub const NAME: &'static str = "claude-cowork";

    fn root(ctx: &AdapterContext) -> PathBuf {
        ctx.home
            .join("Library")
            .join("Application Support")
            .join("Claude")
            .join("local-agent-mode-sessions")
    }

    fn workspace_dirs(ctx: &AdapterContext) -> Vec<PathBuf> {
        let root = Self::root(ctx);
        let Ok(accounts) = std::fs::read_dir(root) else {
            return Vec::new();
        };
        let mut dirs = Vec::new();
        for account in accounts
            .flatten()
            .map(|entry| entry.path())
            .filter(|p| p.is_dir())
        {
            let Ok(workspaces) = std::fs::read_dir(account) else {
                continue;
            };
            for workspace in workspaces
                .flatten()
                .map(|entry| entry.path())
                .filter(|p| p.is_dir())
            {
                dirs.push(workspace);
            }
        }
        dirs.sort();
        dirs
    }

    fn collect_workspace(&self, workspace_dir: &Path) -> Vec<AgentEvent> {
        let spaces = load_spaces(&workspace_dir.join("spaces.json"));
        let mut events = Vec::new();
        for meta_path in local_meta_files(workspace_dir) {
            let session_dir = meta_path.with_extension("");
            let project_root = session_dir.join(".claude").join("projects");
            if !project_root.is_dir() {
                continue;
            }
            let meta = load_session_meta(&meta_path, &spaces);
            for session_path in list_jsonl_recursive(&project_root) {
                let fallback_project_path =
                    project_path_for_cowork_jsonl(&project_root, &session_path);
                let fallback_session_id = session_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                for row in read_jsonl(&session_path) {
                    if let Some(event) = row_to_event(
                        row,
                        &session_path,
                        fallback_project_path.as_deref(),
                        fallback_session_id,
                        &meta,
                    ) {
                        events.push(event);
                    }
                }
            }
        }
        events
    }
}

impl Adapter for ClaudeCoworkAdapter {
    fn name(&self) -> &str {
        Self::NAME
    }

    fn discover(&self, ctx: &AdapterContext) -> bool {
        !Self::workspace_dirs(ctx).is_empty()
    }

    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error> {
        let mut events = Vec::new();
        for workspace in Self::workspace_dirs(ctx) {
            events.extend(self.collect_workspace(&workspace));
        }
        Ok(events)
    }

    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        let root = Self::root(ctx);
        if root.is_dir() {
            vec![root]
        } else {
            Vec::new()
        }
    }
}

fn row_to_event(
    row: JsonlRow,
    path: &Path,
    fallback_project_path: Option<&str>,
    fallback_session_id: &str,
    meta: &CoworkSessionMeta,
) -> Option<AgentEvent> {
    let value = row.value;
    let timestamp_str = value.get("timestamp")?.as_str()?;
    let timestamp = parse_rfc3339_utc(timestamp_str)?;

    let message = value.get("message").and_then(|m| m.as_object());
    let usage = message
        .and_then(|m| m.get("usage"))
        .and_then(|u| u.as_object());
    let content = message.and_then(|m| m.get("content"));

    let tool_calls = count_tool_uses(content);
    let input_tokens = as_int_opt(usage.and_then(|u| u.get("input_tokens")));
    let output_tokens = as_int_opt(usage.and_then(|u| u.get("output_tokens")));
    let cache_read = as_int_opt(usage.and_then(|u| u.get("cache_read_input_tokens")));
    let cache_write = as_int_opt(usage.and_then(|u| u.get("cache_creation_input_tokens")));

    let has_any_signal = input_tokens > 0
        || output_tokens > 0
        || cache_read > 0
        || cache_write > 0
        || tool_calls > 0;
    if !has_any_signal {
        let row_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if row_type != "user" && row_type != "assistant" {
            return None;
        }
    }

    let session_id = value
        .get("sessionId")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| fallback_session_id.to_string());
    let event_type = value
        .get("type")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| "message".to_string());
    let model = message
        .and_then(|m| m.get("model"))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let project_path = value
        .get("cwd")
        .and_then(|v| v.as_str())
        .and_then(|cwd| map_cowork_cwd(cwd, meta))
        .or_else(|| meta.preferred_root().map(str::to_string))
        .or_else(|| fallback_project_path.map(str::to_string));

    let mut event = AgentEvent::new(ClaudeCoworkAdapter::NAME, timestamp);
    event.project_path = project_path;
    event.session_id = Some(session_id);
    event.event_type = event_type;
    event.usage.input_tokens = input_tokens;
    event.usage.output_tokens = output_tokens;
    event.usage.cache_read_tokens = cache_read;
    event.usage.cache_write_tokens = cache_write;
    event.tool_calls = tool_calls;
    event.model = model;
    event.raw_ref = Some(format!("{}:{}", path.display(), row.line_no));
    event.metadata = metadata_for_row(&value, meta);
    event.normalize_totals();
    Some(event)
}

fn metadata_for_row(value: &Value, meta: &CoworkSessionMeta) -> BTreeMap<String, Value> {
    let mut metadata = BTreeMap::new();
    if let Some(branch) = value.get("gitBranch").and_then(|v| v.as_str()) {
        metadata.insert("git_branch".to_string(), Value::String(branch.to_string()));
    }
    if let Some(uuid) = value.get("uuid").and_then(|v| v.as_str()) {
        metadata.insert("uuid".to_string(), Value::String(uuid.to_string()));
    }
    insert_string(
        &mut metadata,
        "cowork_session_id",
        meta.local_session_id.as_deref(),
    );
    insert_string(
        &mut metadata,
        "cowork_cli_session_id",
        meta.cli_session_id.as_deref(),
    );
    insert_string(&mut metadata, "cowork_title", meta.title.as_deref());
    insert_string(
        &mut metadata,
        "cowork_process_name",
        meta.process_name.as_deref(),
    );
    insert_string(&mut metadata, "cowork_cwd", meta.cwd.as_deref());
    insert_string(&mut metadata, "cowork_space_id", meta.space_id.as_deref());
    if let Some(archived) = meta.archived {
        metadata.insert("cowork_archived".to_string(), Value::Bool(archived));
    }
    metadata
}

fn insert_string(map: &mut BTreeMap<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        map.insert(key.to_string(), Value::String(value.to_string()));
    }
}

fn count_tool_uses(content: Option<&Value>) -> u32 {
    let Some(items) = content.and_then(|v| v.as_array()) else {
        return 0;
    };
    items
        .iter()
        .filter(|item| {
            matches!(
                item.get("type").and_then(|v| v.as_str()),
                Some("tool_use" | "server_tool_use")
            )
        })
        .count() as u32
}

fn local_meta_files(workspace_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(workspace_dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("local_") && name.ends_with(".json"))
        })
        .collect();
    files.sort();
    files
}

fn load_spaces(path: &Path) -> BTreeMap<String, String> {
    let data = read_json_object(path);
    let Some(items) = data.get("spaces").and_then(|v| v.as_array()) else {
        return BTreeMap::new();
    };
    let mut spaces = BTreeMap::new();
    for item in items {
        let Some(space_id) = item.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let first_path = item
            .get("folders")
            .and_then(|v| v.as_array())
            .and_then(|folders| {
                folders
                    .iter()
                    .find_map(|folder| folder.get("path").and_then(|v| v.as_str()))
            });
        if let Some(first_path) = first_path {
            spaces.insert(space_id.to_string(), first_path.to_string());
        }
    }
    spaces
}

fn load_session_meta(path: &Path, spaces: &BTreeMap<String, String>) -> CoworkSessionMeta {
    let data = read_json_object(path);
    let selected_folders = data
        .get("userSelectedFolders")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let space_id = string_field(&data, "spaceId");
    let space_path = space_id.as_ref().and_then(|id| spaces.get(id).cloned());
    CoworkSessionMeta {
        local_session_id: string_field(&data, "sessionId"),
        cli_session_id: string_field(&data, "cliSessionId"),
        title: string_field(&data, "title"),
        process_name: string_field(&data, "processName"),
        cwd: string_field(&data, "cwd"),
        space_id,
        space_path,
        selected_folders,
        archived: data.get("isArchived").and_then(|v| v.as_bool()),
    }
}

fn string_field(data: &Value, key: &str) -> Option<String> {
    data.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

fn read_json_object(path: &Path) -> Value {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Value::Object(Default::default());
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(value @ Value::Object(_)) => value,
        _ => Value::Object(Default::default()),
    }
}

fn map_cowork_cwd(cwd: &str, meta: &CoworkSessionMeta) -> Option<String> {
    if !cwd.starts_with("/sessions/") {
        return Some(cwd.to_string());
    }
    let folders: Vec<&str> = if meta.selected_folders.is_empty() {
        meta.space_path.iter().map(String::as_str).collect()
    } else {
        meta.selected_folders.iter().map(String::as_str).collect()
    };
    if let Some((_, mount_suffix)) = cwd.split_once("/mnt/") {
        let mount_head = mount_suffix.split('/').next().unwrap_or("");
        for folder in &folders {
            if Path::new(folder).file_name().and_then(|v| v.to_str()) == Some(mount_head) {
                // Deliberately collapse to the selected folder root. That
                // keeps project aggregation stable even when Cowork reports a
                // subdirectory such as `/mnt/repo/src/foo`.
                return Some((*folder).to_string());
            }
        }
    }
    meta.preferred_root().map(str::to_string)
}

fn project_path_for_cowork_jsonl(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let first = relative.components().next()?.as_os_str().to_str()?;
    if !first.starts_with('-') {
        return None;
    }
    let parts: Vec<&str> = first.split('-').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        None
    } else {
        Some(format!("/{}", parts.join("/")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan;
    use serde_json::json;

    fn workspace(home: &Path, account: &str, workspace: &str) -> PathBuf {
        home.join("Library")
            .join("Application Support")
            .join("Claude")
            .join("local-agent-mode-sessions")
            .join(account)
            .join(workspace)
    }

    fn write_cowork_session(workspace: &Path, local_id: &str, meta: Value, row: Value) -> PathBuf {
        std::fs::create_dir_all(workspace).unwrap();
        std::fs::write(
            workspace.join(format!("{local_id}.json")),
            serde_json::to_string(&meta).unwrap(),
        )
        .unwrap();
        let session = workspace
            .join(local_id)
            .join(".claude")
            .join("projects")
            .join("-sessions-demo-project")
            .join("session-1.jsonl");
        std::fs::create_dir_all(session.parent().unwrap()).unwrap();
        std::fs::write(&session, format!("{}\n", row)).unwrap();
        session
    }

    #[test]
    fn collect_reads_local_agent_mode_project_jsonl() {
        let home = std::env::temp_dir().join(format!("lag-cowork-{}", std::process::id()));
        let ws = workspace(&home, "account", "workspace");
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::write(
            ws.join("spaces.json"),
            json!({
                "spaces": [{
                    "id": "space-1",
                    "folders": [{ "path": "/Users/me/demo-project" }]
                }]
            })
            .to_string(),
        )
        .unwrap();
        write_cowork_session(
            &ws,
            "local_abc",
            json!({
                "sessionId": "local_abc",
                "cliSessionId": "cli-abc",
                "spaceId": "space-1",
                "title": "Demo project",
                "processName": "demo-project",
                "cwd": "/sessions/demo-project",
                "userSelectedFolders": ["/Users/me/demo-project"],
                "isArchived": true
            }),
            json!({
                "type": "assistant",
                "uuid": "row-1",
                "timestamp": "2026-05-28T02:00:00Z",
                "sessionId": "s1",
                "cwd": "/sessions/demo-project/mnt/demo-project/src",
                "message": {
                    "model": "claude-test",
                    "usage": { "input_tokens": 10, "output_tokens": 5 }
                }
            }),
        );

        let events = ClaudeCoworkAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].source, "claude-cowork");
        assert_eq!(events[0].usage.total_tokens, 15);
        assert_eq!(
            events[0].project_path.as_deref(),
            Some("/Users/me/demo-project")
        );
        assert_eq!(
            events[0].metadata.get("uuid"),
            Some(&Value::String("row-1".to_string()))
        );
        assert_eq!(
            events[0].metadata.get("cowork_title"),
            Some(&Value::String("Demo project".to_string()))
        );
        assert_eq!(
            events[0].metadata.get("cowork_archived"),
            Some(&Value::Bool(true))
        );
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn scan_dedupes_duplicate_cowork_rows_by_uuid() {
        let home = std::env::temp_dir().join(format!("lag-cowork-dedupe-{}", std::process::id()));
        let ws = workspace(&home, "account", "workspace");
        let session = write_cowork_session(
            &ws,
            "local_abc",
            json!({
                "sessionId": "local_abc",
                "cliSessionId": "cli-abc",
                "title": "Demo project",
                "userSelectedFolders": ["/Users/me/demo-project"]
            }),
            json!({
                "type": "assistant",
                "uuid": "duplicate-row",
                "timestamp": "2026-05-28T02:00:00Z",
                "sessionId": "s1",
                "cwd": "/sessions/demo-project",
                "message": {
                    "model": "claude-test",
                    "usage": { "input_tokens": 10, "output_tokens": 5 }
                }
            }),
        );
        let copy = session.with_file_name("session-1-copy.jsonl");
        std::fs::copy(&session, copy).unwrap();

        let result = scan::collect_events(
            &AdapterContext::with_home(&home),
            Some(&["claude-cowork".to_string()]),
        )
        .unwrap();

        assert_eq!(result.active_sources, vec!["claude-cowork"]);
        assert_eq!(result.events.len(), 1);
        assert_eq!(result.events[0].usage.total_tokens, 15);
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn supports_multiple_workspaces_and_missing_spaces_json() {
        let home = std::env::temp_dir().join(format!("lag-cowork-multi-{}", std::process::id()));
        for name in ["one", "two"] {
            let ws = workspace(&home, "account", name);
            write_cowork_session(
                &ws,
                "local_abc",
                json!({
                    "sessionId": format!("local-{name}"),
                    "userSelectedFolders": [format!("/Users/me/{name}")]
                }),
                json!({
                    "type": "assistant",
                    "timestamp": "2026-05-28T02:00:00Z",
                    "sessionId": format!("s-{name}"),
                    "cwd": format!("/sessions/{name}"),
                    "message": { "usage": { "input_tokens": 1 } }
                }),
            );
        }

        let events = ClaudeCoworkAdapter
            .collect(&AdapterContext::with_home(&home))
            .unwrap();

        assert_eq!(events.len(), 2);
        let paths: Vec<&str> = events
            .iter()
            .filter_map(|event| event.project_path.as_deref())
            .collect();
        assert!(paths.contains(&"/Users/me/one"));
        assert!(paths.contains(&"/Users/me/two"));
        std::fs::remove_dir_all(&home).ok();
    }
}
