---
name: agent-status
description: "Per-project agent workflow dashboard on localhost: pipeline agents, todo steps, tickets with tracker status and PRs, live log, model usage. Use to start, stop, locate, or configure the dashboard, or to post progress to it by hand."
---

# Agent status

A local dashboard for the project the agent works in. On omp, `hooks/pre/agent-status.ts` runs `serve` and records the prompt as the request on every prompt, then injects an `<agent-dashboard>` block with the update commands. On other harnesses run the commands below yourself.

Every command takes `--root <dir>` (default: the cwd) and resolves it to the git top-level, so each project, and each worktree, has its own dashboard.

## Commands

`python3 scripts/agent-status.py <command>`:

- `serve`. Create `<project>/.agent-status/` if missing, add it to `.git/info/exclude`, start the server and the 5-minute `omp usage --json` refresher unless running. Idempotent.
- `stop`. Kill this project's server and usage refresher.
- `paths`. Print the URL, data dir, progress-log path, and stage ids as JSON.
- `request "<text>"`, `now "<step>" [--detail]`, `step "<todo>" pending|running|done|blocked|skipped [--note]`.
- `agent <stage> idle|working|waiting|done|failed --ticket <KEY> --step "<what>" [--message]`. Moves the ticket along the pipeline.
- `ticket <KEY> --status --summary --pr --assignee --epic --note [--stage N]`.
- `log "<text>" [--agent <stage>] [--ticket <KEY>]`.

## Files in `<project>/.agent-status/`

- `config.json`. Written with defaults on first `serve`. Edit to change the dashboard:
  - `enabled`. `false` stops the omp hook for this project.
  - `title`. Page header. Default: the project directory name.
  - `port`. Default `55749`. Two projects on one port: the first one served keeps it, `serve` in the second prints a notice. Give each its own port to run both.
  - `stages`. `[{ "id", "label" }]`, the pipeline columns. Default: intake, research, implement, review, pr, jira.
  - `orchestrator`. Progress log the agent updates in the same turn a ticket or PR changes, relative to the project root. Default `.agent-status/ORCHESTRATOR.md`.
  - `jiraBaseUrl`. When set, ticket keys link to `<jiraBaseUrl>/browse/<KEY>`.
  - `ticketFilters`. `{ "<button>": "<regex on summary>" }`, extra filter buttons next to Active and All.
  - `usageProvider`. Provider highlighted in the usage panel and the headline stat. Empty: tightest window across all.
- `status.json`, `usage.json`. Page data. The usage panel stays hidden when `omp` is not installed.
- `index.html`. Copied from `assets/index.html` on every `serve`, so plugin updates reach the page.
