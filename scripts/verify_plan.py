#!/usr/bin/env python3
"""Validate Distributor planning structure; this does not verify the product."""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
# Match complete IDs, not substrings such as CH-20 inside RESEARCH-2026.
ID = re.compile(r"\b(?:D-\d{3}|CH-\d{2}|DEC-\d{2}|REQ-\d{2}|G-UB|G\d)\b")
errors = []


def require(condition, message):
    if not condition:
        errors.append(message)


def read(relative):
    path = ROOT / relative
    require(path.is_file(), f"Missing document: {relative}")
    return path.read_text() if path.is_file() else ""


def rows(text, prefix):
    found = []
    for line in text.splitlines():
        if re.match(r"\| " + prefix, line):
            found.append([cell.strip() for cell in line.split("|")[1:-1]])
    return found


def unique_register(items, expected, name):
    require(len(items) == len(set(items)), f"Duplicate {name} IDs")
    require(set(items) == expected, f"Incomplete {name} register: {set(items) ^ expected}")


def references(cell):
    expanded = set(ID.findall(cell))
    for prefix, first, last in re.findall(
        r"(D-|CH-|DEC-|REQ-)(\d+)[–-](?:D-|CH-|DEC-|REQ-)(\d+)", cell
    ):
        width = len(first)
        require(int(first) <= int(last), f"Reversed range: {cell}")
        expanded.update(f"{prefix}{i:0{width}d}" for i in range(int(first), int(last) + 1))
    for first, last in re.findall(r"G(\d)[–-]G(\d)", cell):
        expanded.update(f"G{i}" for i in range(int(first), int(last) + 1))
    return expanded


def slug(heading):
    heading = re.sub(r"[^\w\- ]", "", heading.lower())
    return heading.replace(" ", "-")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Include exact content hashes")
    args = parser.parse_args()

    tasks = rows(read("docs/TASKS.md"), r"D-\d{3} \|")
    gates = rows(read("docs/CHECKPOINTS.md"), r"G(?:\d|-UB) —")
    scenarios = rows(read("docs/CHECKPOINTS.md"), r"CH-\d{2} \|")
    decisions = rows(read("docs/DECISIONS.md"), r"DEC-\d{2} \|")
    requirements = rows(read("docs/REQUIREMENTS.md"), r"REQ-\d{2} \|")
    discovery = rows(read("docs/DISCOVERY.md"), r"DEC-\d{2} \|")

    task_ids = {f"D-{i:03}" for i in range(1, 45)}
    gate_ids = {f"G{i}" for i in range(9)} | {"G-UB"}
    scenario_ids = {f"CH-{i:02}" for i in range(1, 12)}
    decision_ids = {f"DEC-{i:02}" for i in range(1, 15)}
    requirement_ids = {f"REQ-{i:02}" for i in range(1, 23)}
    unique_register([r[0] for r in tasks], task_ids, "task")
    unique_register([r[0].split(" —")[0] for r in gates], gate_ids, "gate")
    unique_register([r[0] for r in scenarios], scenario_ids, "scenario")
    unique_register([r[0] for r in decisions], decision_ids, "decision")
    unique_register([r[0] for r in requirements], requirement_ids, "requirement")
    unique_register([r[0] for r in discovery], decision_ids, "discovery decision")

    graph = {}
    totals = {"baseline": [0, 0], "optional_ub": [0, 0]}
    for row in tasks:
        require(len(row) == 5, f"Malformed task row: {row[0]}")
        if len(row) != 5:
            continue
        graph[row[0]] = references(row[2])
        effort = re.fullmatch(r"(\d+)–(\d+)", row[3])
        require(effort is not None, f"Invalid effort: {row[0]}")
        if effort:
            low, high = map(int, effort.groups())
            require(low <= high, f"Reversed effort: {row[0]}")
            target = totals["baseline" if int(row[0][2:]) <= 41 else "optional_ub"]
            target[0] += low
            target[1] += high
    for row in gates:
        require(len(row) == 4, f"Malformed gate row: {row[0]}")
        if len(row) == 4:
            graph[row[0].split(" —")[0]] = references(row[1])

    visiting, visited = set(), set()

    def visit(node, path):
        if node not in graph:
            errors.append(f"Unresolved dependency: {' -> '.join(path + [node])}")
            return
        if node in visiting:
            errors.append(f"Dependency cycle: {' -> '.join(path + [node])}")
            return
        if node in visited:
            return
        visiting.add(node)
        for dependency in sorted(graph[node]):
            visit(dependency, path + [node])
        visiting.remove(node)
        visited.add(node)

    for node in graph:
        visit(node, [])
    require(totals["baseline"] == [248, 396], "Baseline effort no longer matches PLAN.md")
    require(totals["optional_ub"] == [8, 14], "Optional UB effort no longer matches PLAN.md")
    plan = read("docs/PLAN.md")
    require("248–396" in plan and "8–14" in plan, "PLAN.md effort ranges missing")

    covered_tasks, covered_scenarios = set(), set()
    for row in requirements:
        require(len(row) == 5, f"Malformed requirement row: {row[0]}")
        if len(row) == 5:
            covered_tasks |= references(row[3]) & task_ids
            covered_scenarios |= references(row[4]) & scenario_ids
            require(bool(references(row[3]) & task_ids), f"No tasks for {row[0]}")
            require(bool(references(row[4]) & gate_ids), f"No gate for {row[0]}")
    require(covered_tasks == task_ids, f"Tasks missing requirement traceability: {task_ids - covered_tasks}")
    require(covered_scenarios == scenario_ids, f"Scenarios missing traceability: {scenario_ids - covered_scenarios}")

    required_files = [
        "AGENTS.md", "README.md", "docs/PLAN.md", "docs/TASKS.md",
        "docs/CHECKPOINTS.md", "docs/ARCHITECTURE.md", "docs/DECISIONS.md",
        "docs/REUSE.md", "docs/HANDOFF.md", "docs/REQUIREMENTS.md",
        "docs/CONTRACTS.md", "docs/DISCOVERY.md", "docs/DELIVERY.md", "docs/PROVIDERS.md",
        "docs/evidence/README.md", "docs/evidence/PLANNING-REVIEW-2026-09-30.md",
    ]
    for relative in required_files:
        require((ROOT / relative).is_file(), f"Missing planning artifact: {relative}")
    markdown = sorted(ROOT.glob("*.md")) + sorted((ROOT / "docs").rglob("*.md"))
    known_ids = task_ids | gate_ids | scenario_ids | decision_ids | requirement_ids
    link_count = 0
    for document in markdown:
        content = document.read_text()
        unknown = references(content) - known_ids
        require(not unknown, f"Unknown IDs in {document.relative_to(ROOT)}: {unknown}")
        for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", content):
            if re.match(r"[a-zA-Z][a-zA-Z0-9+.-]*:", target):
                continue  # No remote URL or license verification is claimed.
            link_count += 1
            relative, _, anchor = unquote(target).partition("#")
            destination = (document.parent / relative).resolve() if relative else document
            require(destination.is_file(), f"Broken link in {document.relative_to(ROOT)}: {target}")
            if anchor and destination.is_file() and destination.suffix == ".md":
                headings = re.findall(r"^#{1,6}\s+(.+)$", destination.read_text(), re.M)
                require(anchor in {slug(h) for h in headings}, f"Broken anchor: {target}")

    hash_files = [ROOT / p for p in required_files if "/PLANNING-REVIEW-" not in p]
    hash_files += [ROOT / ".gitignore", Path(__file__).resolve()]
    hashes = {
        str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(set(hash_files)) if path.is_file()
    }
    summary = {
        "status": "FAIL" if errors else "PASS",
        "scope": "planning structure only; no business decisions, product gates or remote URLs verified",
        "tasks": len(tasks), "gates": len(gates), "scenarios": len(scenarios),
        "decisions": len(decisions), "requirements": len(requirements),
        "markdown_files": len(markdown), "local_links": link_count,
        "effort_developer_days": totals, "errors": errors,
        "sha256": hashes,
    }
    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        print(f"{summary['status']}: {len(tasks)} tasks, {len(gates)} gates, {len(scenarios)} scenarios, "
              f"{len(decisions)} decision sheets, {len(requirements)} requirements; "
              f"{len(markdown)} Markdown files and {link_count} local links.")
        print(f"Effort: baseline {totals['baseline']}, optional UB {totals['optional_ub']} developer-days.")
        print(summary["scope"])
        for error in errors:
            print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
