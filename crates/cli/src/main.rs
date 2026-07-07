//! `agent-garden` — terminal interface for Pixel Agent Garden.

mod ascii_wall;

use chrono::{Local, NaiveDate};
use clap::{Parser, Subcommand};
use local_agent_garden_core::adapter::AdapterContext;
use local_agent_garden_core::aggregate::{self, GardenSummary};
use local_agent_garden_core::event::AgentEvent;
use local_agent_garden_core::registry;
use local_agent_garden_core::rings;
use local_agent_garden_core::scan;
use local_agent_garden_core::storage;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "agent-garden",
    about = "Private local AI-agent activity garden.",
    version,
    propagate_version = true
)]
struct Cli {
    /// Restrict to a subset of adapters (repeatable).
    #[arg(long = "source", global = true)]
    sources: Vec<String>,

    /// Import extra JSONL events from another local agent (repeatable).
    #[arg(long = "manual-jsonl", global = true)]
    manual_jsonl: Vec<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List adapters and whether each is active on the local filesystem.
    Adapters,

    /// Scan local agent data and write normalized events JSON.
    Scan {
        /// Output path. Defaults to ~/.local-agent-garden/events.json.
        #[arg(long)]
        out: Option<PathBuf>,
    },

    /// Render the ASCII vine wall.
    Garden {
        #[arg(long, default_value_t = 84)]
        width: usize,
        #[arg(long, default_value_t = 18)]
        height: usize,
        /// Disable ANSI color (useful for piping to a file).
        #[arg(long = "no-color", action = clap::ArgAction::SetTrue)]
        no_color: bool,
        /// Render a cached events.json instead of scanning live.
        #[arg(long = "from-cache")]
        from_cache: Option<PathBuf>,
    },

    /// Print a per-project summary table.
    Projects {
        /// Render a cached events.json instead of scanning live.
        #[arg(long = "from-cache")]
        from_cache: Option<PathBuf>,
    },

    /// Show one project's details. `--project` is a substring match against
    /// display name or path.
    Inspect {
        #[arg(long)]
        project: String,
        #[arg(long = "from-cache")]
        from_cache: Option<PathBuf>,
    },

    /// Write the summary JSON the web frontend reads.
    /// Default output: web/data/garden-summary.json.
    ExportWeb {
        #[arg(long)]
        out: Option<PathBuf>,
        #[arg(long = "from-cache")]
        from_cache: Option<PathBuf>,
    },

    /// Show token usage for one local calendar day.
    Usage {
        /// Day to inspect: today, yesterday, or YYYY-MM-DD. Defaults to today.
        #[arg(long, default_value = "today")]
        date: String,
        /// Output machine-readable JSON.
        #[arg(long, action = clap::ArgAction::SetTrue)]
        json: bool,
        /// Read a cached events.json instead of scanning live.
        #[arg(long = "from-cache")]
        from_cache: Option<PathBuf>,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let ctx = AdapterContext::from_env().with_manual_jsonl(cli.manual_jsonl);
    let sources_filter = if cli.sources.is_empty() {
        None
    } else {
        Some(cli.sources.clone())
    };

    match cli.command {
        Command::Adapters => cmd_adapters(&ctx, sources_filter.as_deref()),
        Command::Scan { out } => cmd_scan(&ctx, sources_filter.as_deref(), out),
        Command::Projects { from_cache } => {
            cmd_projects(&ctx, sources_filter.as_deref(), from_cache)
        }
        Command::Inspect {
            project,
            from_cache,
        } => cmd_inspect(&ctx, sources_filter.as_deref(), &project, from_cache),
        Command::ExportWeb { out, from_cache } => {
            cmd_export_web(&ctx, sources_filter.as_deref(), out, from_cache)
        }
        Command::Usage {
            date,
            json,
            from_cache,
        } => cmd_usage(&ctx, sources_filter.as_deref(), &date, json, from_cache),
        Command::Garden {
            width,
            height,
            no_color,
            from_cache,
        } => cmd_garden(
            &ctx,
            sources_filter.as_deref(),
            width,
            height,
            !no_color,
            from_cache,
        ),
    }
}

fn cmd_usage(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    date: &str,
    json_output: bool,
    from_cache: Option<PathBuf>,
) -> ExitCode {
    let day = match parse_usage_day(date) {
        Ok(day) => day,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    let events = match build_events(ctx, sources_filter, from_cache.as_deref()) {
        Ok(events) => events,
        Err(code) => return code,
    };
    let report = summarize_usage(&events, day);
    if json_output {
        println!("{}", usage_report_json(&report));
    } else {
        print_usage_report(&report);
    }
    ExitCode::SUCCESS
}

fn cmd_garden(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    width: usize,
    height: usize,
    color: bool,
    from_cache: Option<PathBuf>,
) -> ExitCode {
    let summary = match build_summary(ctx, sources_filter, from_cache.as_deref()) {
        Ok(s) => s,
        Err(code) => return code,
    };
    println!(
        "{}",
        ascii_wall::render_garden(&summary, width, height, color)
    );
    ExitCode::SUCCESS
}

fn cmd_adapters(ctx: &AdapterContext, sources_filter: Option<&[String]>) -> ExitCode {
    match scan::collect_events(ctx, sources_filter) {
        Ok(result) => {
            let active: std::collections::HashSet<_> =
                result.active_sources.iter().cloned().collect();
            for adapter in registry::default_adapters() {
                let status = if active.contains(adapter.name()) {
                    "active"
                } else {
                    "available"
                };
                println!("{:14} {}", adapter.name(), status);
            }
            ExitCode::SUCCESS
        }
        Err(err) => bail("scan failed", err),
    }
}

fn cmd_scan(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    out: Option<PathBuf>,
) -> ExitCode {
    let out = out.unwrap_or_else(|| storage::default_state_dir().join("events.json"));
    match scan::collect_events(ctx, sources_filter) {
        Ok(result) => match storage::save_events(&result.events, &out) {
            Ok(()) => {
                let sources = if result.active_sources.is_empty() {
                    "no adapters".to_string()
                } else {
                    result.active_sources.join(", ")
                };
                println!(
                    "wrote {} events from {} to {}",
                    result.events.len(),
                    sources,
                    out.display()
                );
                ExitCode::SUCCESS
            }
            Err(err) => bail("write failed", err),
        },
        Err(err) => bail("scan failed", err),
    }
}

fn cmd_projects(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    from_cache: Option<PathBuf>,
) -> ExitCode {
    let summary = match build_summary(ctx, sources_filter, from_cache.as_deref()) {
        Ok(s) => s,
        Err(code) => return code,
    };
    // Compact columns:
    //   <display_name 28>  stage=<n>  events=<n 5>  tokens=<n 10>  path=...
    for p in &summary.projects {
        let path = p.project_path.clone().unwrap_or_else(|| "-".to_string());
        println!(
            "{:<28}  stage={}  events={:<5}  tokens={:<10}  path={}",
            truncate(&p.display_name, 28),
            p.stage,
            p.event_count,
            p.total_tokens,
            path
        );
    }
    ExitCode::SUCCESS
}

fn cmd_inspect(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    needle: &str,
    from_cache: Option<PathBuf>,
) -> ExitCode {
    let summary = match build_summary(ctx, sources_filter, from_cache.as_deref()) {
        Ok(s) => s,
        Err(code) => return code,
    };
    let needle_lc = needle.to_lowercase();
    for p in &summary.projects {
        let haystack = format!(
            "{} {} {}",
            p.display_name,
            p.project_path.as_deref().unwrap_or(""),
            p.project_key
        )
        .to_lowercase();
        if haystack.contains(&needle_lc) {
            // Reuse the canonical ASCII renderer so `garden` and `inspect`
            // stay in sync on formatting.
            println!("{}", ascii_wall::render_project_detail(p, true));
            return ExitCode::SUCCESS;
        }
    }
    eprintln!("No project matched: {}", needle);
    ExitCode::from(1)
}

fn cmd_export_web(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    out: Option<PathBuf>,
    from_cache: Option<PathBuf>,
) -> ExitCode {
    let summary = match build_summary(ctx, sources_filter, from_cache.as_deref()) {
        Ok(s) => s,
        Err(code) => return code,
    };
    let out_path = out.unwrap_or_else(|| {
        PathBuf::from("web")
            .join("data")
            .join("garden-summary.json")
    });
    if let Some(parent) = out_path.parent() {
        if let Err(err) = std::fs::create_dir_all(parent) {
            eprintln!("create dir {} failed: {}", parent.display(), err);
            return ExitCode::FAILURE;
        }
    }
    let json = match serde_json::to_string_pretty(&summary) {
        Ok(s) => s,
        Err(err) => {
            eprintln!("serialize failed: {}", err);
            return ExitCode::FAILURE;
        }
    };
    if let Err(err) = std::fs::write(&out_path, json) {
        eprintln!("write {} failed: {}", out_path.display(), err);
        return ExitCode::FAILURE;
    }
    println!(
        "wrote {} projects to {}",
        summary.active_projects,
        out_path.display()
    );
    ExitCode::SUCCESS
}

// ---- shared plumbing ------------------------------------------------------

/// Build a `GardenSummary` from either a cached events.json or a live scan.
/// Returns ExitCode::from(N) on failure so the caller can propagate.
fn build_summary(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    from_cache: Option<&std::path::Path>,
) -> Result<GardenSummary, ExitCode> {
    let events = build_events(ctx, sources_filter, from_cache)?;
    let summary = aggregate::summarize(&events);
    let rings_path = from_cache
        .map(rings::path_for_events_cache)
        .unwrap_or_else(rings::default_rings_path);
    Ok(rings::record_summary_best_effort(
        summary,
        &rings_path,
        chrono::Utc::now(),
    ))
}

fn build_events(
    ctx: &AdapterContext,
    sources_filter: Option<&[String]>,
    from_cache: Option<&std::path::Path>,
) -> Result<Vec<AgentEvent>, ExitCode> {
    let events = if let Some(cache) = from_cache {
        match storage::load_events(cache) {
            Ok(events) => events,
            Err(err) => {
                eprintln!("read cache {} failed: {}", cache.display(), err);
                return Err(ExitCode::FAILURE);
            }
        }
    } else {
        match scan::collect_events(ctx, sources_filter) {
            Ok(result) => result.events,
            Err(err) => {
                eprintln!("scan failed: {}", err);
                return Err(ExitCode::FAILURE);
            }
        }
    };
    Ok(events)
}

#[derive(Default)]
struct UsageBucket {
    key: String,
    label: String,
    total_tokens: u64,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    event_count: u64,
    sessions: BTreeSet<String>,
    sources: BTreeMap<String, u64>,
}

impl UsageBucket {
    fn new(key: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            label: label.into(),
            ..Default::default()
        }
    }

    fn add(&mut self, event: &AgentEvent) {
        self.total_tokens += event.usage.total_tokens;
        self.input_tokens += event.usage.input_tokens;
        self.output_tokens += event.usage.output_tokens;
        self.cache_read_tokens += event.usage.cache_read_tokens;
        self.cache_write_tokens += event.usage.cache_write_tokens;
        self.event_count += 1;
        *self.sources.entry(event.source.clone()).or_insert(0) += 1;
        if let Some(session_id) = event.session_id.as_ref() {
            self.sessions.insert(session_id.clone());
        }
    }
}

struct UsageReport {
    day: NaiveDate,
    total: UsageBucket,
    by_source: Vec<UsageBucket>,
    by_project: Vec<UsageBucket>,
}

fn summarize_usage(events: &[AgentEvent], day: NaiveDate) -> UsageReport {
    let mut total = UsageBucket::new("all", "all agents");
    let mut by_source: BTreeMap<String, UsageBucket> = BTreeMap::new();
    let mut by_project: BTreeMap<String, UsageBucket> = BTreeMap::new();

    for event in events {
        if event.timestamp.with_timezone(&Local).date_naive() != day {
            continue;
        }
        total.add(event);

        by_source
            .entry(event.source.clone())
            .or_insert_with(|| UsageBucket::new(&event.source, &event.source))
            .add(event);

        let project_key = event.project_key();
        let project_label = event
            .project_path
            .as_deref()
            .map(display_name_from_path)
            .unwrap_or_else(|| project_key.trim_start_matches("unknown:").to_string());
        by_project
            .entry(project_key.clone())
            .or_insert_with(|| UsageBucket::new(project_key, project_label))
            .add(event);
    }

    let mut by_source: Vec<_> = by_source.into_values().collect();
    by_source.sort_by(|a, b| {
        b.total_tokens
            .cmp(&a.total_tokens)
            .then(a.label.cmp(&b.label))
    });
    let mut by_project: Vec<_> = by_project.into_values().collect();
    by_project.sort_by(|a, b| {
        b.total_tokens
            .cmp(&a.total_tokens)
            .then(a.label.cmp(&b.label))
    });

    UsageReport {
        day,
        total,
        by_source,
        by_project,
    }
}

fn parse_usage_day(value: &str) -> Result<NaiveDate, String> {
    let today = Local::now().date_naive();
    match value {
        "" | "today" => Ok(today),
        "yesterday" => Ok(today.pred_opt().unwrap_or(today)),
        other => NaiveDate::parse_from_str(other, "%Y-%m-%d")
            .map_err(|_| format!("invalid --date {other:?}; use today, yesterday, or YYYY-MM-DD")),
    }
}

fn print_usage_report(report: &UsageReport) {
    println!("usage for {}", report.day.format("%Y-%m-%d"));
    println!();
    println!("total");
    print_bucket("all agents", &report.total);

    println!();
    println!("by source");
    if report.by_source.is_empty() {
        println!("  -");
    } else {
        for bucket in &report.by_source {
            print_bucket(&bucket.label, bucket);
        }
    }

    println!();
    println!("by project");
    if report.by_project.is_empty() {
        println!("  -");
    } else {
        for bucket in report.by_project.iter().take(20) {
            print_bucket(&bucket.label, bucket);
        }
        if report.by_project.len() > 20 {
            println!("  ... {} more", report.by_project.len() - 20);
        }
    }
}

fn print_bucket(label: &str, bucket: &UsageBucket) {
    println!(
        "  {:<28} tokens={:<10} input={:<10} output={:<10} cache={:<10} events={:<5} sessions={}",
        truncate(label, 28),
        bucket.total_tokens,
        bucket.input_tokens,
        bucket.output_tokens,
        bucket.cache_read_tokens + bucket.cache_write_tokens,
        bucket.event_count,
        bucket.sessions.len(),
    );
}

fn usage_report_json(report: &UsageReport) -> String {
    let value = json!({
        "date": aggregate::day_key(report.day),
        "total": bucket_json(&report.total),
        "by_source": report.by_source.iter().map(bucket_json).collect::<Vec<_>>(),
        "by_project": report.by_project.iter().map(bucket_json).collect::<Vec<_>>(),
    });
    serde_json::to_string_pretty(&value).expect("usage report JSON is serializable")
}

fn bucket_json(bucket: &UsageBucket) -> serde_json::Value {
    json!({
        "key": bucket.key,
        "label": bucket.label,
        "total_tokens": bucket.total_tokens,
        "input_tokens": bucket.input_tokens,
        "output_tokens": bucket.output_tokens,
        "cache_read_tokens": bucket.cache_read_tokens,
        "cache_write_tokens": bucket.cache_write_tokens,
        "event_count": bucket.event_count,
        "sessions": bucket.sessions.len(),
        "sources": bucket.sources,
    })
}

fn display_name_from_path(path: &str) -> String {
    PathBuf::from(path)
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| path.to_string())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max - 1).collect();
        out.push('…');
        out
    }
}

fn bail<E: std::fmt::Display>(prefix: &str, err: E) -> ExitCode {
    eprintln!("{}: {}", prefix, err);
    ExitCode::FAILURE
}
