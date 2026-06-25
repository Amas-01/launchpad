#!/usr/bin/env python3
"""
Create one GitHub issue per entry in a SoroPad wave document (e.g. wave6.md).

Each issue section in the wave file looks like:

    ### 57. Token: whale protection + `revoke_admin` permanently bricks all transfers

    🔴 **High** · `contracts` `token` `security`

    ...body markdown...

    ---

This script splits the file on the `### <num>. <title>` headers, derives a title,
body, and labels for each, and creates the issues via the `gh` CLI.

By default it runs in DRY-RUN mode and creates nothing — pass --apply to actually
create issues.

Usage:
    python3 scripts/create_wave_issues.py [wave6.md] [options]

Options:
    --apply            Actually create issues (default is dry-run).
    --repo OWNER/NAME  Target repo (defaults to the current dir's gh remote).
    --limit N          Only process the first N issues (handy for a test run).
    --milestone NAME   Attach this milestone to every created issue.
    --no-skip-existing Do not skip issues whose title already exists.
    -h, --help         Show this help.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

# A section header: "### 57. Some title"
HEADER_RE = re.compile(r"^###\s+(\d+)\.\s+(.*)$")
# The complexity/tags line: "🔴 **High** · `contracts` `token` `security`"
COMPLEXITY_RE = re.compile(r"\*\*(Trivial|Medium|High)\*\*", re.IGNORECASE)
TAG_RE = re.compile(r"`([^`]+)`")

COMPLEXITY_LABELS = {
    "trivial": ("trivial", "2EA043"),
    "medium": ("medium", "D4A72C"),
    "high": ("high", "D73A4A"),
}

# Tags we recognise as area labels and the colour to create them with.
KNOWN_TAG_COLORS = {
    "frontend": "1D76DB",
    "contracts": "5319E7",
    "token": "5319E7",
    "vesting": "5319E7",
    "deploy": "0E8A16",
    "rpc": "0E8A16",
    "network": "0E8A16",
    "admin": "FBCA04",
    "dashboard": "FBCA04",
    "ux": "C5DEF5",
    "quality": "BFDADC",
    "security": "B60205",
    "architecture": "5319E7",
    "repo": "EDEDED",
    "docs": "EDEDED",
}
DEFAULT_TAG_COLOR = "CCCCCC"


def strip_markdown(text: str) -> str:
    """Turn a header title into a plain-ish issue title (drop backticks/bold)."""
    text = text.replace("`", "").replace("**", "")
    return text.strip()


def parse_sections(content: str):
    """Yield dicts: {num, title, body, complexity, tags} for each issue section."""
    lines = content.splitlines()
    sections = []
    current = None

    for line in lines:
        m = HEADER_RE.match(line)
        if m:
            if current:
                sections.append(current)
            current = {
                "num": int(m.group(1)),
                "raw_title": m.group(2).strip(),
                "body_lines": [],
                "complexity": None,
                "tags": [],
            }
            continue

        if current is None:
            # Skip the document preamble before the first issue.
            continue

        # A horizontal rule terminates the current section.
        if line.strip() == "---":
            sections.append(current)
            current = None
            continue

        # First complexity line we see for the section.
        if current["complexity"] is None:
            cm = COMPLEXITY_RE.search(line)
            if cm:
                current["complexity"] = cm.group(1).lower()
                current["tags"] = [t.lower() for t in TAG_RE.findall(line)]
                # Don't include the chip line itself in the body — gh renders it oddly.
                continue

        current["body_lines"].append(line)

    if current:
        sections.append(current)

    for s in sections:
        s["title"] = strip_markdown(s["raw_title"])
        s["body"] = "\n".join(s["body_lines"]).strip()
    return sections


def labels_for(section):
    labels = []
    if section["complexity"] in COMPLEXITY_LABELS:
        labels.append(COMPLEXITY_LABELS[section["complexity"]][0])
    for tag in section["tags"]:
        labels.append(tag)
    # De-dupe, keep order.
    seen = set()
    out = []
    for lab in labels:
        if lab not in seen:
            seen.add(lab)
            out.append(lab)
    return out


def run(cmd, capture=False):
    return subprocess.run(
        cmd, check=True, text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )


def gh_repo_args(repo):
    return ["--repo", repo] if repo else []


def ensure_labels(all_labels, section_complexities, repo, apply):
    """Create any labels that may be missing (idempotent via --force)."""
    # Build colour map: complexity labels + known tags + fallback.
    colour = {}
    for _, (name, col) in COMPLEXITY_LABELS.items():
        colour[name] = col
    colour.update(KNOWN_TAG_COLORS)

    for lab in sorted(all_labels):
        col = colour.get(lab, DEFAULT_TAG_COLOR)
        cmd = ["gh", "label", "create", lab, "--color", col, "--force", *gh_repo_args(repo)]
        if not apply:
            print("  [dry-run] " + " ".join(cmd))
            continue
        try:
            run(cmd, capture=True)
        except subprocess.CalledProcessError as e:
            print(f"  ! could not ensure label '{lab}': {e.stderr.strip()}", file=sys.stderr)


def existing_titles(repo):
    """Return a set of existing issue titles (open + closed) to avoid duplicates."""
    cmd = [
        "gh", "issue", "list", "--state", "all", "--limit", "500",
        "--json", "title", *gh_repo_args(repo),
    ]
    try:
        res = run(cmd, capture=True)
    except subprocess.CalledProcessError as e:
        print(f"! could not list existing issues: {e.stderr.strip()}", file=sys.stderr)
        return set()
    import json
    return {item["title"] for item in json.loads(res.stdout or "[]")}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wave_file", nargs="?", default="wave6.md")
    ap.add_argument("--apply", action="store_true", help="Actually create issues (default: dry-run).")
    ap.add_argument("--repo", default=None, help="Target repo OWNER/NAME.")
    ap.add_argument("--start", type=int, default=1, help="1-based index of the first issue to process (default: 1).")
    ap.add_argument("--limit", type=int, default=None, help="Only process N issues (after --start).")
    ap.add_argument("--milestone", default=None, help="Milestone to attach to each issue.")
    ap.add_argument("--no-skip-existing", action="store_true", help="Do not skip titles that already exist.")
    args = ap.parse_args()

    path = Path(args.wave_file)
    if not path.is_file():
        print(f"error: wave file not found: {path}", file=sys.stderr)
        return 1

    sections = parse_sections(path.read_text(encoding="utf-8"))
    if args.start > 1:
        sections = sections[args.start - 1 :]
    if args.limit is not None:
        sections = sections[: args.limit]

    if not sections:
        print("error: no issue sections found (expected '### <num>. <title>' headers).", file=sys.stderr)
        return 1

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"Parsed {len(sections)} issue(s) from {path} — mode: {mode}\n")

    all_labels = set()
    for s in sections:
        all_labels.update(labels_for(s))

    print("Ensuring labels exist:")
    ensure_labels(all_labels, None, args.repo, args.apply)
    print()

    skip_titles = set()
    if not args.no_skip_existing and args.apply:
        skip_titles = existing_titles(args.repo)

    created = 0
    skipped = 0
    for s in sections:
        labels = labels_for(s)
        if s["title"] in skip_titles:
            print(f"- SKIP (exists): {s['title']}")
            skipped += 1
            continue

        cmd = [
            "gh", "issue", "create",
            "--title", s["title"],
            "--body", s["body"],
            *gh_repo_args(args.repo),
        ]
        for lab in labels:
            cmd += ["--label", lab]
        if args.milestone:
            cmd += ["--milestone", args.milestone]

        if not args.apply:
            print(f"- {s['title']}")
            print(f"    labels: {', '.join(labels) or '(none)'}")
            print(f"    body:   {len(s['body'])} chars")
            continue

        try:
            res = run(cmd, capture=True)
            url = (res.stdout or "").strip()
            print(f"- CREATED: {s['title']}  ->  {url}")
            created += 1
        except subprocess.CalledProcessError as e:
            print(f"- FAILED:  {s['title']}\n    {e.stderr.strip()}", file=sys.stderr)

    print()
    if args.apply:
        print(f"Done. Created {created}, skipped {skipped}.")
    else:
        print("Dry-run complete. Re-run with --apply to create these issues.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
