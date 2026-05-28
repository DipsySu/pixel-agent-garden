from __future__ import annotations

import math
from datetime import datetime, timezone

from local_agent_garden.core.aggregate import GardenSummary, ProjectGrowth

RESET = "\033[0m"
DIM = "\033[2m"
GREEN = "\033[32m"
BRIGHT_GREEN = "\033[92m"
YELLOW = "\033[33m"
MAGENTA = "\033[35m"
BOLD = "\033[1m"


def render_garden(
    summary: GardenSummary, width: int = 84, height: int = 18, color: bool = True
) -> str:
    width = min(96, max(58, width))
    height = min(24, max(12, height))
    canvas = _blank_wall(width, height)
    projects = summary.projects[: min(5, max(1, width // 18))]

    if projects:
        spacing = (width - 8) // len(projects)
        for idx, project in enumerate(projects):
            start_x = 4 + spacing * idx + spacing // 2
            _draw_vine(canvas, project, start_x, idx)

    art = ["".join(row).rstrip() for row in canvas]
    if color:
        art = [_tint_wall(line) for line in art]
    return "\n".join([_header(summary, width, color), *art, _footer(summary, projects, width, color)])


def render_project_detail(project: ProjectGrowth, color: bool = True) -> str:
    c = _colors(color)
    lines = [
        f"{c['bold']}{project.display_name}{c['reset']}",
        f"path      {project.project_path or project.project_key}",
        f"sources   {', '.join(f'{k} x{v}' for k, v in project.sources.most_common())}",
        f"sessions  {len(project.sessions)}",
        f"events    {project.event_count}",
        f"tokens    {_fmt(project.total_tokens)}",
        f"tools     {project.tool_calls}",
        f"stage     {_stage_name(project.stage)}",
        f"score     {project.activity_score}",
        f"cache     {project.cache_ratio:.0%}",
        f"first     {_fmt_dt(project.first_seen)}",
        f"latest    {_fmt_dt(project.last_seen)}",
        f"models    {', '.join(name for name, _ in project.models.most_common(3)) or '-'}",
        "",
        _sparkline(project),
    ]
    return "\n".join(lines)


def _blank_wall(width: int, height: int) -> list[list[str]]:
    inner_width = width - 2
    wall = [list("╭" + "─" * inner_width + "╮")]
    for y in range(1, height - 1):
        row = ["│"]
        for x in range(inner_width):
            if y in {4, 9, 14} and 8 < x < inner_width - 8 and x % 3 == 0:
                row.append("·")
            elif y in {2, 7, 12} and (x + (y // 2) * 7) % 29 == 0:
                row.append("╎")
            else:
                row.append(" ")
        row.append("│")
        wall.append(row)
    wall.append(list("╰" + "─" * inner_width + "╯"))
    return wall


def _draw_vine(canvas: list[list[str]], project: ProjectGrowth, start_x: int, seed: int) -> None:
    height = len(canvas)
    width = len(canvas[0])
    vine_height = min(height - 3, 2 + project.stage * 2)
    base_y = height - 2
    sway = 1.2 + seed * 0.28

    for step in range(vine_height):
        y = base_y - step
        x = round(start_x + math.sin((step + seed) * 0.9) * sway)
        if 1 <= x < width - 1:
            canvas[y][x] = "┃" if project.stage >= 5 and step < vine_height // 2 else "│"

        if step % 3 == 1:
            leaf_x = x + (-1 if (step + seed) % 4 < 2 else 1)
            if 1 <= leaf_x < width - 1:
                canvas[y][leaf_x] = "◆" if project.cache_ratio >= 0.25 else "◇"

        if project.stage >= 3 and step in {4, 9, 14}:
            flower_x = x + (1 if seed % 2 == 0 else -1)
            if 1 <= flower_x < width - 1:
                canvas[y][flower_x] = "✿"

        if project.stage >= 2 and step % 6 == 2:
            tendril_x = x + (2 if (step + seed) % 2 == 0 else -2)
            if 1 <= tendril_x < width - 1:
                canvas[y][tendril_x] = "〜"

    top_y = max(1, base_y - vine_height)
    if project.stage >= 4 and project.recent_activity > 0:
        butterfly_x = min(width - 2, max(1, start_x + 3))
        canvas[top_y][butterfly_x] = "ɞ"
    if project.stage >= 6:
        nest_x = min(width - 2, max(1, start_x - 3))
        canvas[top_y + 1][nest_x] = "◖"
    if 1 <= start_x < width - 1:
        canvas[height - 2][start_x] = str((seed + 1) % 10)


def _header(summary: GardenSummary, width: int, color: bool) -> str:
    c = _colors(color)
    title = "Local Agent Garden"
    stats = f"{summary.active_projects} projects · {summary.total_events} events · {_fmt(summary.total_tokens)} tokens"
    padding = max(1, width - len(title) - len(stats) - 1)
    return f"{c['bold']}{title}{c['reset']}{' ' * padding}{c['dim']}{stats}{c['reset']}"


def _footer(summary: GardenSummary, projects: list[ProjectGrowth], width: int, color: bool) -> str:
    c = _colors(color)
    source_text = ", ".join(f"{k} x{v}" for k, v in summary.sources.most_common()) or "no sources"
    labels = []
    for idx, project in enumerate(projects, start=1):
        name = project.display_name
        if len(name) > 24:
            name = name[:23] + "…"
        labels.append(f"{idx}. {name:<24} {_stage_name(project.stage):<10} {_fmt(project.total_tokens):>8}")
    return "\n".join(
        [
            f"{c['green']}" + "\n".join(labels) + f"{c['reset']}",
            f"{c['dim']}sources: {source_text}{c['reset']}",
        ]
    )


def _tint_wall(line: str) -> str:
    out = []
    for char in line:
        if char in "│┃〜◆◇1234567890":
            out.append(f"{BRIGHT_GREEN}{char}{RESET}")
        elif char == "✿":
            out.append(f"{MAGENTA}{char}{RESET}")
        elif char in "ɞ◖":
            out.append(f"{YELLOW}{char}{RESET}")
        elif char in "╭╮╰╯─╎·":
            out.append(f"{DIM}{char}{RESET}")
        else:
            out.append(char)
    return "".join(out)


def _sparkline(project: ProjectGrowth) -> str:
    today = datetime.now(timezone.utc).date()
    days = [(today.fromordinal(today.toordinal() - i)).isoformat() for i in range(29, -1, -1)]
    values = [project.daily_activity.get(day, 0) for day in days]
    blocks = "▁▂▃▄▅▆▇█"
    max_value = max(values) if values else 0
    if max_value <= 0:
        return "activity  " + blocks[0] * len(days)
    chars = [blocks[min(7, int((value / max_value) * 7))] for value in values]
    return "activity  " + "".join(chars)


def _stage_name(stage: int) -> str:
    return {
        1: "sprout",
        2: "climbing",
        3: "budding",
        4: "blooming",
        5: "dense vine",
        6: "old vine",
    }[stage]


def _fmt(value: int) -> str:
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    if value >= 1_000:
        return f"{value / 1_000:.1f}k"
    return str(value)


def _fmt_dt(value: datetime | None) -> str:
    if not value:
        return "-"
    return value.astimezone().strftime("%Y-%m-%d %H:%M")


def _colors(enabled: bool) -> dict[str, str]:
    if not enabled:
        return {"reset": "", "dim": "", "green": "", "bold": ""}
    return {"reset": RESET, "dim": DIM, "green": GREEN, "bold": BOLD}
