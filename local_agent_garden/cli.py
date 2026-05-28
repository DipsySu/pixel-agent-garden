from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from local_agent_garden.adapters.registry import default_adapters
from local_agent_garden.core.aggregate import summarize
from local_agent_garden.core.scan import collect_events
from local_agent_garden.core.storage import default_state_dir, load_events, save_events
from local_agent_garden.ui.ascii_wall import render_garden, render_project_detail


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        return 130


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="agent-garden",
        description="Private local AI-agent activity garden.",
    )
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI color.")
    sub = parser.add_subparsers(dest="command", required=False)

    adapters = sub.add_parser("adapters", help="List available adapters.")
    _add_color_arg(adapters)
    adapters.set_defaults(func=cmd_adapters)

    scan = sub.add_parser("scan", help="Scan local agent data and write normalized events.")
    _add_color_arg(scan)
    _add_scan_args(scan)
    scan.add_argument(
        "--out",
        type=Path,
        default=default_state_dir() / "events.json",
        help="Output JSON path.",
    )
    scan.set_defaults(func=cmd_scan)

    garden = sub.add_parser("garden", help="Render the ASCII vine wall.")
    _add_color_arg(garden)
    _add_scan_args(garden)
    garden.add_argument("--from-cache", type=Path, help="Render a previously saved events JSON.")
    garden.add_argument("--width", type=int, default=min(88, shutil.get_terminal_size((80, 24)).columns))
    garden.add_argument("--height", type=int, default=18)
    garden.set_defaults(func=cmd_garden)

    projects = sub.add_parser("projects", help="List project growth summaries.")
    _add_color_arg(projects)
    _add_scan_args(projects)
    projects.add_argument("--from-cache", type=Path)
    projects.set_defaults(func=cmd_projects)

    inspect = sub.add_parser("inspect", help="Show one project's details.")
    _add_color_arg(inspect)
    _add_scan_args(inspect)
    inspect.add_argument("--from-cache", type=Path)
    inspect.add_argument("--project", required=True, help="Project path or display name.")
    inspect.set_defaults(func=cmd_inspect)

    export_web = sub.add_parser("export-web", help="Export summary JSON for the web prototype.")
    _add_color_arg(export_web)
    _add_scan_args(export_web)
    export_web.add_argument("--from-cache", type=Path)
    export_web.add_argument(
        "--out",
        type=Path,
        default=Path("web") / "data" / "garden-summary.json",
        help="Output summary JSON path.",
    )
    export_web.set_defaults(func=cmd_export_web)

    parser.set_defaults(func=cmd_garden)
    return parser


def _add_color_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--no-color",
        action="store_true",
        default=argparse.SUPPRESS,
        help=argparse.SUPPRESS,
    )


def _add_scan_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--source",
        action="append",
        choices=[adapter.name for adapter in default_adapters()],
        help="Limit to a source adapter. Can be repeated.",
    )
    parser.add_argument(
        "--manual-jsonl",
        action="append",
        type=Path,
        default=[],
        help="Import extra JSONL events from another local agent.",
    )


def cmd_adapters(args: argparse.Namespace) -> int:
    events, used = collect_events(sources=None, manual_jsonl=getattr(args, "manual_jsonl", []))
    del events
    for adapter in default_adapters():
        status = "active" if adapter.name in used else "available"
        print(f"{adapter.name:14} {status}")
    return 0


def cmd_scan(args: argparse.Namespace) -> int:
    events, used = collect_events(sources=args.source, manual_jsonl=args.manual_jsonl)
    save_events(events, args.out)
    print(f"wrote {len(events)} events from {', '.join(used) or 'no adapters'} to {args.out}")
    return 0


def cmd_garden(args: argparse.Namespace) -> int:
    events = _events_from_args(args)
    summary = summarize(events)
    print(render_garden(summary, width=args.width, height=args.height, color=not args.no_color))
    return 0


def cmd_projects(args: argparse.Namespace) -> int:
    events = _events_from_args(args)
    summary = summarize(events)
    for project in summary.projects:
        print(
            f"{project.display_name:28} "
            f"stage={project.stage} events={project.event_count:<5} "
            f"tokens={project.total_tokens:<10} path={project.project_path or '-'}"
        )
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    summary = summarize(_events_from_args(args))
    needle = args.project.lower()
    for project in summary.projects:
        haystack = " ".join(
            [project.display_name, project.project_path or "", project.project_key]
        ).lower()
        if needle in haystack:
            print(render_project_detail(project, color=not args.no_color))
            return 0
    print(f"No project matched: {args.project}", file=sys.stderr)
    return 1


def cmd_export_web(args: argparse.Namespace) -> int:
    summary = summarize(_events_from_args(args))
    out = args.out.expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary.to_json(), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {summary.active_projects} projects to {out}")
    return 0


def _events_from_args(args: argparse.Namespace):
    if getattr(args, "from_cache", None):
        return load_events(args.from_cache)
    events, _used = collect_events(sources=args.source, manual_jsonl=args.manual_jsonl)
    return events


if __name__ == "__main__":
    raise SystemExit(main())
