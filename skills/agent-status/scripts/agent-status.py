#!/usr/bin/env python3
"""Agent workflow dashboard: serves <project>/.agent-status on localhost and edits its status.json / usage.json."""
import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

PAGE = Path(__file__).resolve().parent.parent / "assets" / "index.html"
LOG_LIMIT = 300
USAGE_INTERVAL_S = 300
AGENT_STATES = ["idle", "working", "waiting", "done", "failed"]
STEP_STATES = ["pending", "running", "done", "blocked", "skipped"]
DEFAULT_CONFIG = {
    "enabled": True,
    "title": "",
    "port": 55749,
    "stages": [
        {"id": "intake", "label": "Intake"},
        {"id": "research", "label": "Research"},
        {"id": "implement", "label": "Implement"},
        {"id": "review", "label": "Review"},
        {"id": "pr", "label": "Pull request"},
        {"id": "jira", "label": "Jira update"},
    ],
    "orchestrator": ".agent-status/ORCHESTRATOR.md",
    "jiraBaseUrl": "",
    "ticketFilters": {},
    "usageProvider": "",
}


def project_root(cwd: str) -> Path:
    result = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    return Path(result.stdout.strip() if result.returncode == 0 else cwd).resolve()


class Project:
    def __init__(self, root: Path):
        self.root = root
        self.dir = root / ".agent-status"
        self.status = self.dir / "status.json"
        self.usage = self.dir / "usage.json"
        self.config_file = self.dir / "config.json"
        self.server_pid = self.dir / ".server.pid"
        self.loop_pid = self.dir / ".usage-loop.pid"
        self.config = {**DEFAULT_CONFIG, "title": root.name}
        if self.config_file.exists():
            self.config.update(json.loads(self.config_file.read_text()))
        self.stages = [s["id"] for s in self.config["stages"]]
        self.port = int(self.config["port"])
        self.orchestrator = (root / self.config["orchestrator"]).resolve()

    def init(self) -> None:
        self.dir.mkdir(exist_ok=True)
        if not self.config_file.exists():
            write_json(self.config_file, {**DEFAULT_CONFIG, "title": self.root.name})
        if not self.orchestrator.exists():
            self.orchestrator.parent.mkdir(parents=True, exist_ok=True)
            self.orchestrator.write_text(f"# {self.config['title']} progress\n")
        exclude = subprocess.run(["git", "-C", str(self.root), "rev-parse", "--git-path", "info/exclude"], capture_output=True, text=True)
        if exclude.returncode == 0:
            path = self.root / exclude.stdout.strip()
            lines = path.read_text().splitlines() if path.exists() else []
            if ".agent-status/" not in lines:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("\n".join(lines + [".agent-status/"]) + "\n")
        shutil.copyfile(PAGE, self.dir / "index.html")


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


def load(p: Project) -> dict:
    data = json.loads(p.status.read_text()) if p.status.exists() else {}
    data.setdefault("request", "")
    data.setdefault("current", {"step": "Idle", "detail": ""})
    data.setdefault("steps", [])
    data.setdefault("tickets", [])
    data.setdefault("log", [])
    agents = data.setdefault("agents", {})
    for stage in p.stages:
        agents.setdefault(stage, {"state": "idle", "ticket": None, "step": "", "at": None})
    return data


def save(p: Project, data: dict) -> None:
    p.dir.mkdir(exist_ok=True)
    data["updatedAt"] = now()
    write_json(p.status, data)


def log(data: dict, text: str, agent: str | None = None, ticket: str | None = None, cls: str = "") -> None:
    entry = {"at": now(), "text": text}
    if agent:
        entry["agent"] = agent
    if ticket:
        entry["ticket"] = ticket
    if cls:
        entry["cls"] = cls
    data["log"] = (data["log"] + [entry])[-LOG_LIMIT:]


def ticket_row(data: dict, key: str) -> dict:
    row = next((t for t in data["tickets"] if t["key"] == key), None)
    if row is None:
        row = {"key": key}
        data["tickets"].append(row)
    return row


def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def live_pid(pid_file: Path) -> int | None:
    try:
        pid = int(pid_file.read_text())
        os.kill(pid, 0)
        return pid
    except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError):
        return None


def detach(argv: list[str]) -> int:
    return subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True).pid


def serve(p: Project, _args) -> None:
    p.init()
    if not p.status.exists():
        save(p, load(p))
    url = f"http://localhost:{p.port}"
    if live_pid(p.server_pid):
        print(f"already serving {p.dir} on {url}")
    elif port_open(p.port):
        print(f"port {p.port} is held by another process (likely another project's dashboard); set \"port\" in {p.config_file}")
    else:
        p.server_pid.write_text(str(detach([sys.executable, "-m", "http.server", str(p.port), "--bind", "127.0.0.1", "--directory", str(p.dir)])))
        print(f"serving {p.dir} on {url}")
    if shutil.which("omp") and not live_pid(p.loop_pid):
        p.loop_pid.write_text(str(detach([sys.executable, __file__, "--root", str(p.root), "usage-loop"])))


def stop(p: Project, _args) -> None:
    for pid_file in (p.server_pid, p.loop_pid):
        pid = live_pid(pid_file)
        if pid:
            os.kill(pid, signal.SIGTERM)
        pid_file.unlink(missing_ok=True)
    print(f"stopped the dashboard for {p.root}")


def refresh_usage(p: Project, _args=None) -> None:
    if not shutil.which("omp"):
        return
    result = subprocess.run(["omp", "usage", "--json"], capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        prev = json.loads(p.usage.read_text()) if p.usage.exists() else {"limits": []}
        prev["error"] = (result.stderr or result.stdout).strip()[:300]
        write_json(p.usage, prev)
        return
    limits = []
    for report in json.loads(result.stdout).get("reports", []):
        for limit in report.get("limits", []):
            amount = limit.get("amount", {})
            reset = limit.get("window", {}).get("resetsAt")
            limits.append({
                "provider": report["provider"],
                "label": limit.get("label", limit.get("id")),
                "window": limit.get("window", {}).get("label", ""),
                "remainingFraction": amount.get("remainingFraction"),
                "remaining": amount.get("remaining"),
                "limit": amount.get("limit"),
                "unit": amount.get("unit"),
                "resetsAt": datetime.fromtimestamp(reset / 1000, timezone.utc).isoformat() if reset else None,
                "status": limit.get("status"),
            })
    write_json(p.usage, {"fetchedAt": now(), "limits": limits})


def usage_loop(p: Project, _args) -> None:
    while True:
        try:
            refresh_usage(p)
        except Exception:
            pass
        time.sleep(USAGE_INTERVAL_S)


def show_paths(p: Project, _args) -> None:
    print(json.dumps({
        "enabled": bool(p.config["enabled"]),
        "url": f"http://localhost:{p.port}",
        "dir": str(p.dir),
        "orchestrator": str(p.orchestrator),
        "stages": p.stages,
    }))


def request(p: Project, args) -> None:
    data = load(p)
    data["request"] = args.text
    data["steps"] = []
    data["current"] = {"step": "Reading the request", "detail": ""}
    log(data, f"New request: {args.text[:160]}", agent=p.stages[0] if p.stages else None)
    save(p, data)


def current(p: Project, args) -> None:
    data = load(p)
    data["current"] = {"step": args.step, "detail": args.detail or ""}
    for s in data["steps"]:
        if s["name"] == args.step and s["status"] != "done":
            s["status"] = "running"
    log(data, f"Now: {args.step}")
    save(p, data)


def step(p: Project, args) -> None:
    data = load(p)
    found = next((s for s in data["steps"] if s["name"] == args.name), None)
    if found is None:
        found = {"name": args.name, "status": args.status, "note": ""}
        data["steps"].append(found)
    found["status"] = args.status
    if args.note is not None:
        found["note"] = args.note
    if args.status in ("done", "blocked", "skipped"):
        log(data, f"{args.status}: {args.name}" + (f" ({args.note})" if args.note else ""), cls={"done": "ok", "blocked": "bad"}.get(args.status, ""))
    save(p, data)


def agent(p: Project, args) -> None:
    data = load(p)
    a = data["agents"][args.stage]
    a.update(state=args.state, ticket=None if args.state == "idle" else args.ticket or a.get("ticket"), step=args.step or "", at=now())
    key = a["ticket"]
    if key:
        t = ticket_row(data, key)
        t["stage"] = p.stages.index(args.stage) + (1 if args.state == "done" else 0)
        t["agentStatus"] = args.state
    text = args.step or args.state
    if args.message:
        text += f": {args.message}"
    log(data, text, agent=args.stage, ticket=key, cls={"done": "ok", "failed": "bad", "waiting": "warn"}.get(args.state, ""))
    save(p, data)


def ticket(p: Project, args) -> None:
    data = load(p)
    row = ticket_row(data, args.key)
    old = row.get("status")
    for field in ("summary", "epic", "status", "assignee", "pr", "note"):
        value = getattr(args, field)
        if value is not None:
            row[field] = value
    if args.stage is not None:
        row["stage"] = args.stage
    if args.status and old and args.status != old:
        log(data, f"Jira: {old} → {args.status}", ticket=args.key, cls="jira")
    save(p, data)


def add_log(p: Project, args) -> None:
    data = load(p)
    log(data, args.text, agent=args.agent, ticket=args.ticket)
    save(p, data)


def main() -> None:
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--root", default=os.getcwd())
    known, _ = pre.parse_known_args()
    p = Project(project_root(known.root))

    parser = argparse.ArgumentParser(description=__doc__, parents=[pre])
    sub = parser.add_subparsers(required=True)
    sub.add_parser("serve", help="create .agent-status if missing, start the server and the usage refresher unless running").set_defaults(fn=serve)
    sub.add_parser("stop", help="stop this project's server and usage refresher").set_defaults(fn=stop)
    sub.add_parser("paths", help="print the dashboard URL, data dir, ORCHESTRATOR.md path and stages as JSON").set_defaults(fn=show_paths)
    sub.add_parser("usage", help="refresh usage.json from `omp usage --json` once").set_defaults(fn=refresh_usage)
    sub.add_parser("usage-loop", help=argparse.SUPPRESS).set_defaults(fn=usage_loop)
    r = sub.add_parser("request", help="new user request; clears the step list")
    r.add_argument("text")
    r.set_defaults(fn=request)
    c = sub.add_parser("now", help="set the running step")
    c.add_argument("step")
    c.add_argument("--detail")
    c.set_defaults(fn=current)
    s = sub.add_parser("step", help="add or update a todo step")
    s.add_argument("name")
    s.add_argument("status", choices=STEP_STATES)
    s.add_argument("--note")
    s.set_defaults(fn=step)
    a = sub.add_parser("agent", help="set a pipeline agent's state (moves its ticket along the pipeline)")
    a.add_argument("stage", choices=p.stages)
    a.add_argument("state", choices=AGENT_STATES)
    a.add_argument("--ticket")
    a.add_argument("--step")
    a.add_argument("--message")
    a.set_defaults(fn=agent)
    t = sub.add_parser("ticket", help="add or update a ticket row")
    t.add_argument("key")
    for field in ("summary", "epic", "status", "assignee", "pr", "note"):
        t.add_argument(f"--{field}")
    t.add_argument("--stage", type=int, help=f"0-{len(p.stages)} pipeline position; {len(p.stages)} = finished")
    t.set_defaults(fn=ticket)
    lg = sub.add_parser("log", help="append to the live log")
    lg.add_argument("text")
    lg.add_argument("--agent", choices=p.stages)
    lg.add_argument("--ticket")
    lg.set_defaults(fn=add_log)
    args = parser.parse_args()
    args.fn(p, args)


if __name__ == "__main__":
    main()
