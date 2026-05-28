//! Event names emitted from Rust → frontend. Centralized here so the
//! constants are the only place a typo could happen.

use serde::Serialize;

/// Emitted whenever a scan completes successfully with new data.
/// Payload: `GardenSummary`.
pub const GARDEN_UPDATED: &str = "garden:updated";

/// Emitted while a scan is running. Lets the frontend show a spinner if
/// the rescan ever takes long enough to be noticeable.
/// Payload: `ScanningPayload`.
#[allow(dead_code)]
pub const GARDEN_SCANNING: &str = "garden:scanning";

/// Emitted when a scan, watcher, or settings operation fails. The frontend
/// turns this into a toast — see `web/error-toast.js`.
/// Payload: `ErrorPayload`.
pub const GARDEN_ERROR: &str = "garden:error";

/// Payload for `garden:error`. `source` is a short hint for grouping
/// (e.g. `"watcher"`, `"scan"`, `"settings"`); `adapter` is the optional
/// adapter name when the error came from a specific source.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorPayload {
    pub source: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter: Option<String>,
}

impl ErrorPayload {
    pub fn new(source: &'static str, message: impl Into<String>) -> Self {
        Self {
            source,
            message: message.into(),
            adapter: None,
        }
    }
}

/// Payload for `garden:scanning`. Reserved for the future progress signal.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub struct ScanningPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_payload_omits_none_adapter() {
        // Frontend expects { source, message } when no adapter is attached.
        // If `adapter: null` leaks through, the toast UI would still work but
        // the wire shape would differ from the spec — pin it down here.
        let payload = ErrorPayload::new("watcher", "scan failed");
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["source"], "watcher");
        assert_eq!(json["message"], "scan failed");
        assert!(json.get("adapter").is_none(), "adapter should be omitted when None");
    }

    #[test]
    fn error_payload_emits_adapter_when_set() {
        let payload = ErrorPayload {
            source: "scan",
            message: "claude-code read failed".to_string(),
            adapter: Some("claude-code".to_string()),
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["adapter"], "claude-code");
    }
}
