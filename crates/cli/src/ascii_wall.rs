//! Terminal vine wall renderer.
//!
//! Pure rendering — no I/O, no async. Takes a `GardenSummary`, returns a
//! single `String` ready for stdout.

use chrono::{Duration, Utc};
use local_agent_garden_core::aggregate::{GardenSummary, ProjectGrowth};

// ANSI escape codes — wide-character terminals strip these gracefully.
const RESET: &str = "\x1b[0m";
const DIM: &str = "\x1b[2m";
const GREEN: &str = "\x1b[32m";
const BRIGHT_GREEN: &str = "\x1b[92m";
const YELLOW: &str = "\x1b[33m";
const MAGENTA: &str = "\x1b[35m";
const BOLD: &str = "\x1b[1m";

/// Render the wall + header + per-project labels into one string.
pub fn render_garden(summary: &GardenSummary, width: usize, height: usize, color: bool) -> String {
    let width = width.clamp(58, 96);
    let height = height.clamp(12, 24);

    let mut canvas = blank_wall(width, height);

    // Show up to 5 projects (or fewer for narrow terminals).
    let project_cap = (width / 18).clamp(1, 5);
    let projects: Vec<&ProjectGrowth> = summary.projects.iter().take(project_cap).collect();

    if !projects.is_empty() {
        let spacing = (width - 8) / projects.len();
        for (idx, project) in projects.iter().enumerate() {
            let start_x = 4 + spacing * idx + spacing / 2;
            draw_vine(&mut canvas, project, start_x, idx);
        }
    }

    let art: Vec<String> = canvas
        .into_iter()
        .map(|row| {
            let line: String = row.into_iter().collect();
            let trimmed = line.trim_end().to_string();
            if color { tint_wall(&trimmed) } else { trimmed }
        })
        .collect();

    let mut out = String::new();
    out.push_str(&header(summary, width, color));
    out.push('\n');
    for line in art {
        out.push_str(&line);
        out.push('\n');
    }
    out.push_str(&footer(summary, &projects, width, color));
    out
}

/// One-project detail card. Used by `agent-garden inspect`.
pub fn render_project_detail(project: &ProjectGrowth, color: bool) -> String {
    let c = colors(color);
    let path = project
        .project_path
        .clone()
        .unwrap_or_else(|| project.project_key.clone());
    let sources: Vec<String> = project
        .sources
        .iter()
        .map(|(k, v)| format!("{k} x{v}"))
        .collect();
    let sources_text = if sources.is_empty() {
        "-".to_string()
    } else {
        sources.join(", ")
    };
    let models: Vec<&String> = project.models.keys().take(3).collect();
    let models_text = if models.is_empty() {
        "-".to_string()
    } else {
        models
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    };

    let mut out = format!("{}{}{}", c.bold, project.display_name, c.reset);
    out.push('\n');
    out.push_str(&format!("path      {path}\n"));
    out.push_str(&format!("sources   {sources_text}\n"));
    out.push_str(&format!("sessions  {}\n", project.sessions));
    out.push_str(&format!("events    {}\n", project.event_count));
    out.push_str(&format!("tokens    {}\n", fmt_tokens(project.total_tokens)));
    out.push_str(&format!("tools     {}\n", project.tool_calls));
    out.push_str(&format!("stage     {}\n", stage_name(project.stage)));
    out.push_str(&format!("score     {}\n", project.activity_score));
    out.push_str(&format!("cache     {:.0}%\n", project.cache_ratio * 100.0));
    out.push_str(&format!("first     {}\n", fmt_dt(project.first_seen)));
    out.push_str(&format!("latest    {}\n", fmt_dt(project.last_seen)));
    out.push_str(&format!("models    {models_text}\n"));
    out.push('\n');
    out.push_str(&sparkline(project));
    out
}

// ---- internals ------------------------------------------------------------

fn blank_wall(width: usize, height: usize) -> Vec<Vec<char>> {
    let inner_width = width - 2;
    let mut wall = Vec::with_capacity(height);

    // top border
    let mut top = Vec::with_capacity(width);
    top.push('╭');
    top.extend(std::iter::repeat_n('─', inner_width));
    top.push('╮');
    wall.push(top);

    // body
    for y in 1..height - 1 {
        let mut row = Vec::with_capacity(width);
        row.push('│');
        for x in 0..inner_width {
            let ch = if matches!(y, 4 | 9 | 14)
                && (8 < x && x < inner_width.saturating_sub(8))
                && x % 3 == 0
            {
                '·'
            } else if matches!(y, 2 | 7 | 12) && (x + (y / 2) * 7) % 29 == 0 {
                '╎'
            } else {
                ' '
            };
            row.push(ch);
        }
        row.push('│');
        wall.push(row);
    }

    // bottom border
    let mut bot = Vec::with_capacity(width);
    bot.push('╰');
    bot.extend(std::iter::repeat_n('─', inner_width));
    bot.push('╯');
    wall.push(bot);

    wall
}

fn draw_vine(canvas: &mut [Vec<char>], project: &ProjectGrowth, start_x: usize, seed: usize) {
    let height = canvas.len();
    let width = canvas[0].len();
    // stage 1..6 → vine height 4..14, capped at canvas
    let stage = project.stage.clamp(1, 6) as usize;
    let vine_height = std::cmp::min(height.saturating_sub(3), 2 + stage * 2);
    let base_y = height.saturating_sub(2);
    let sway = 1.2_f64 + seed as f64 * 0.28;

    for step in 0..vine_height {
        let y = base_y.saturating_sub(step);
        let x_signed = start_x as f64 + ((step + seed) as f64 * 0.9).sin() * sway;
        let x = x_signed.round() as i64;

        // Main stalk
        if x >= 1 && (x as usize) < width.saturating_sub(1) {
            let ch = if stage >= 5 && step < vine_height / 2 {
                '┃'
            } else {
                '│'
            };
            canvas[y][x as usize] = ch;
        }

        // Leaves every 3 steps
        if step % 3 == 1 {
            let bias = if (step + seed) % 4 < 2 { -1 } else { 1 };
            let leaf_x = x + bias;
            if leaf_x >= 1 && (leaf_x as usize) < width.saturating_sub(1) {
                let ch = if project.cache_ratio >= 0.25 {
                    '◆'
                } else {
                    '◇'
                };
                canvas[y][leaf_x as usize] = ch;
            }
        }

        // Flowers at specific stages
        if stage >= 3 && matches!(step, 4 | 9 | 14) {
            let bias = if seed % 2 == 0 { 1 } else { -1 };
            let flower_x = x + bias;
            if flower_x >= 1 && (flower_x as usize) < width.saturating_sub(1) {
                canvas[y][flower_x as usize] = '✿';
            }
        }

        // Tendrils
        if stage >= 2 && step % 6 == 2 {
            let bias = if (step + seed) % 2 == 0 { 2 } else { -2 };
            let tendril_x = x + bias;
            if tendril_x >= 1 && (tendril_x as usize) < width.saturating_sub(1) {
                canvas[y][tendril_x as usize] = '〜';
            }
        }
    }

    let top_y = std::cmp::max(1, base_y.saturating_sub(vine_height));
    if stage >= 4 && project.recent_activity > 0 {
        let butterfly_x = std::cmp::min(width.saturating_sub(2), std::cmp::max(1, start_x + 3));
        canvas[top_y][butterfly_x] = 'ɞ';
    }
    if stage >= 6 {
        let nest_x = std::cmp::min(
            width.saturating_sub(2),
            std::cmp::max(1, start_x.saturating_sub(3)),
        );
        if top_y + 1 < canvas.len() {
            canvas[top_y + 1][nest_x] = '◖';
        }
    }
    if start_x >= 1 && start_x < width.saturating_sub(1) {
        let label = char::from_digit(((seed + 1) % 10) as u32, 10).unwrap_or('?');
        canvas[height.saturating_sub(2)][start_x] = label;
    }
}

fn header(summary: &GardenSummary, width: usize, color: bool) -> String {
    let c = colors(color);
    let title = "Local Agent Garden";
    let stats = format!(
        "{} projects · {} events · {} tokens",
        summary.active_projects,
        summary.total_events,
        fmt_tokens(summary.total_tokens),
    );
    let stats_width = stats.chars().count();
    let title_width = title.chars().count();
    let padding = width
        .saturating_sub(title_width)
        .saturating_sub(stats_width)
        .saturating_sub(1)
        .max(1);
    format!(
        "{bold}{title}{reset}{pad}{dim}{stats}{reset}",
        bold = c.bold,
        reset = c.reset,
        pad = " ".repeat(padding),
        dim = c.dim,
        title = title,
        stats = stats
    )
}

fn footer(
    summary: &GardenSummary,
    projects: &[&ProjectGrowth],
    _width: usize,
    color: bool,
) -> String {
    let c = colors(color);
    let source_text = if summary.sources.is_empty() {
        "no sources".to_string()
    } else {
        summary
            .sources
            .iter()
            .map(|(k, v)| format!("{k} x{v}"))
            .collect::<Vec<_>>()
            .join(", ")
    };

    let mut labels = Vec::new();
    for (idx, project) in projects.iter().enumerate() {
        let name = if project.display_name.chars().count() > 24 {
            let mut t: String = project.display_name.chars().take(23).collect();
            t.push('…');
            t
        } else {
            project.display_name.clone()
        };
        labels.push(format!(
            "{}. {name:<24} {stage:<10} {tokens:>8}",
            idx + 1,
            name = name,
            stage = stage_name(project.stage),
            tokens = fmt_tokens(project.total_tokens)
        ));
    }

    format!(
        "{green}{}{reset}\n{dim}sources: {sources}{reset}",
        labels.join("\n"),
        green = c.green,
        reset = c.reset,
        dim = c.dim,
        sources = source_text
    )
}

fn tint_wall(line: &str) -> String {
    let mut out = String::with_capacity(line.len() + 32);
    for ch in line.chars() {
        match ch {
            '│' | '┃' | '〜' | '◆' | '◇' | '0'..='9' => {
                out.push_str(BRIGHT_GREEN);
                out.push(ch);
                out.push_str(RESET);
            }
            '✿' => {
                out.push_str(MAGENTA);
                out.push(ch);
                out.push_str(RESET);
            }
            'ɞ' | '◖' => {
                out.push_str(YELLOW);
                out.push(ch);
                out.push_str(RESET);
            }
            '╭' | '╮' | '╰' | '╯' | '─' | '╎' | '·' => {
                out.push_str(DIM);
                out.push(ch);
                out.push_str(RESET);
            }
            _ => out.push(ch),
        }
    }
    out
}

fn sparkline(project: &ProjectGrowth) -> String {
    let blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    let today = Utc::now().date_naive();
    // 30 days ending today, oldest first.
    let mut values: Vec<u64> = Vec::with_capacity(30);
    for i in (0..30).rev() {
        let day = today - Duration::days(i);
        let key = day.format("%Y-%m-%d").to_string();
        values.push(*project.daily_activity.get(&key).unwrap_or(&0));
    }
    let max_value = *values.iter().max().unwrap_or(&0);
    let bars: String = if max_value == 0 {
        std::iter::repeat_n(blocks[0], values.len()).collect()
    } else {
        values
            .into_iter()
            .map(|v| {
                let idx = ((v as f64 / max_value as f64) * 7.0).floor() as usize;
                blocks[idx.min(7)]
            })
            .collect()
    };
    format!("activity  {bars}")
}

fn stage_name(stage: u8) -> &'static str {
    match stage {
        1 => "sprout",
        2 => "climbing",
        3 => "budding",
        4 => "blooming",
        5 => "dense vine",
        6 => "old vine",
        _ => "unknown",
    }
}

fn fmt_tokens(v: u64) -> String {
    if v >= 1_000_000 {
        format!("{:.1}M", v as f64 / 1_000_000.0)
    } else if v >= 1_000 {
        format!("{:.1}k", v as f64 / 1_000.0)
    } else {
        v.to_string()
    }
}

fn fmt_dt(value: Option<chrono::DateTime<chrono::Utc>>) -> String {
    match value {
        None => "-".to_string(),
        // Render in the local timezone so CLI timestamps match the shell.
        Some(dt) => dt
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%d %H:%M")
            .to_string(),
    }
}

struct Colors {
    reset: &'static str,
    dim: &'static str,
    green: &'static str,
    bold: &'static str,
}

fn colors(enabled: bool) -> Colors {
    if enabled {
        Colors {
            reset: RESET,
            dim: DIM,
            green: GREEN,
            bold: BOLD,
        }
    } else {
        Colors {
            reset: "",
            dim: "",
            green: "",
            bold: "",
        }
    }
}
