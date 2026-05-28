//! `agent-garden` — terminal interface for Pixel Agent Garden.

mod ascii_wall;

use clap::{Parser, Subcommand};
use local_agent_garden_core::adapter::AdapterContext;
use local_agent_garden_core::aggregate::{self, GardenSummary};
use local_agent_garden_core::registry;
use local_agent_garden_core::scan;
use local_agent_garden_core::storage;
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
    Ok(aggregate::summarize(&events))
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
