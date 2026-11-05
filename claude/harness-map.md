# pstack on Claude Code: omp → Claude Code map

pstack is installed as a Claude Code plugin. Its skills are written for omp (oh-my-pi). When a pstack skill, playbook, or reference says an omp term on the left, do the Claude Code thing on the right. pstack root: `{{PSTACK_ROOT}}`.

## Skills and files
- `/skill:<name>` → `/pstack:<name>` (user-typed command).
- `skill://<name>` → Read `{{PSTACK_ROOT}}/skills/<name>/SKILL.md`. Use Read, not the Skill tool: most pstack skills set `disable-model-invocation`.
- `skill://<name>/<path>` → `{{PSTACK_ROOT}}/skills/<name>/<path>`, e.g. `bun {{PSTACK_ROOT}}/skills/poteto-mode/scripts/watch-pr/cli.ts`, `node {{PSTACK_ROOT}}/skills/poteto-mode/scripts/check-plan.mjs <plan.md>`.
- Relative paths inside a skill (`playbooks/x.md`, `references/y.md`) resolve from that skill's directory under `{{PSTACK_ROOT}}/skills/`.
- `/skill:<name>` inside a prompt for an omp worker (the **omp-orchestrate** skill's tasks.json) → keep it literal. The omp worker expands it, not you.

## Tools
- `read` / `edit` / `write` / `bash` / `grep` / `find` → `Read` / `Edit` / `Write` / `Bash` / `Grep` / `Glob`.
- `task` → `Agent`. A `task` batch → several `Agent` calls in one message. OMP's 8-at-once cap does not apply.
- `agent: "pstack-code"` (any `pstack-*` role, `poteto-agent`) → `subagent_type: "pstack:<same name>"`. `agent: "Comment Sicko"` → `subagent_type: "pstack:comment-sicko"`. Pass `{{PSTACK_ROOT}}` in the prompt when the worker must read pstack files.
- `agent: "scout"` (the **ticket-intake** skill's read-only exploration) → `subagent_type: "Explore"`.
- `isolated: true` → `isolation: "worktree"`.
- `agent://<id>` (parked subagent) → `SendMessage` to that agent, or read its transcript.
- Long-running background `task` + `hub wait` / `hub jobs` heartbeat → `Agent` or `Bash` with `run_in_background: true`; wait for the completion notification, use `Monitor` to watch a condition.
- `bash` with `timeout: 0` (the Watcher's `watch-pr` call in `references/watcher-brief.md`) → `Bash` with `run_in_background: true` and no `timeout`; wait for the completion notification. `write proc://<id>/kill` → `KillShell` / stop the Agent.
- `spawns: "*"` in `agents/*.md` (lets `poteto-agent`, `pstack-code`, and `pstack-judgment` spawn) → nothing to set. Claude Code subagents spawn their own subagents, up to `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` layers (default 3). A Builder on `references/builder-brief.md` fans out and runs its review pass as written. Only when a spawn is refused for depth does it do that work itself and say so in its report.
- `ask` → `AskUserQuestion`.
- `browser` → a browser MCP server (e.g. Playwright) if one is connected; otherwise tell the user the verification step needs one.
- `tab.recordStart` / `tab.recordStop` (the **video-evidence** skill) → Playwright MCP started with `--save-video=<width>x<height>` (WebM in its output dir), or a Playwright script with `browser.newContext({ recordVideo: { dir, size } })`. Load `scripts/overlay.js` with `page.addInitScript({ path })`. Build the storyboard from the WebM with the same `ffmpeg` line. Puppeteer's `page.waitForFileChooser({ timeout })` → Playwright's `page.waitForEvent("filechooser", { timeout })`.
- `tab.screenshot` (the **Ship to green** playbook's evidence capture) → Playwright MCP `browser_take_screenshot` with a `filename`, or `page.screenshot({ path })` in a Playwright script.
- `manage_skill` → `Write` the SKILL.md under `.claude/skills/<name>/` (project) or `~/.claude/skills/<name>/` (user).

## Sub sessions (Claude Code desktop only)
Applies only when this session has `mcp__ccd_session__start_session` (loaded or deferred; load it with ToolSearch). Without it, every `task` stays `Agent` and the S rows below pick that `Agent`'s `model`.
- These spawns become linked sub sessions: the Ship to green batch owner (one `poteto-agent` per ticket), the Orchestrate sub-coordinator, the Autopilot-full and Autopilot-stack owners, and a Ship to green Builder whose checkpoint names three or more workstreams. Every other `task` stays `Agent`.
- Call `start_session` with `context: "fresh"`, `name` = the unit id, `model` and `effort` from the routing table, `use_worktree: true` for write work, `wake_when_done: true`. `prompt` = the playbook's brief verbatim, the pstack root `{{PSTACK_ROOT}}`, and "Read `{{PSTACK_ROOT}}/skills/poteto-mode/SKILL.md` in full first". `background` = the standing orders.
- `initiation: "user_asked"` when the user's request runs a batch, an orchestrate program, or an autopilot queue. For a heavy Builder the user did not ask to split, `"own_initiative"`; if the user does not start it, run it as `Agent`.
- The session ends its turn with the playbook's status report as its final message. A report over 400 characters also goes to `.pstack/sessions/<run>/<name>.md` in its worktree, because the wake event quotes only the first 400.
- `agent://<id>` for an owner → `SendMessage` to its `local_` id. `hub wait` on owners → the side-session event the app sends when they end their turn. Reconcile with `mcp__ccd_session_mgmt__list_sessions` `{"linked": true}`. Never poll.
- `start_session` takes no agent type, and it silently caps `model` and `effort` at this session's. For a `high` row when you run at `medium`, start the session with `prompt` "Reply READY and end your turn.", raise it with `mcp__ccd_session_mgmt__set_session_effort` (`high` applies from its next turn; you cannot raise your own), check it with `mcp__ccd_session_mgmt__get_session`, then send the brief with `SendMessage` to its `local_` id.

## Model routing
Score each unit from what you already hold: the intake stamp's `type=`, the Builder checkpoint's workstream count, whether the intake stamp verifies, risk flags (concurrency, auth or security, data migration, public API), and the role. Effort never goes above `high`.

| Row | Spawn | Model | Effort | Use when |
|---|---|---|---|---|
| S1 | sub session | `sonnet` | medium | Stamped spec; type `bug`, `enhancement`, `docs`, `tokens`, `tooling`; one or two workstreams; no risk flag. Or mostly terminal, CI, or script work |
| S2 | sub session | `sonnet` | high | S1 with three or more workstreams; `refactor` with a stamped spec and tests; failed once on S1 |
| S3 | sub session | `opus` | medium | `rebuild`, `component`, `spike`; any risk flag; no verified stamp; Orchestrate sub-coordinator; failed once on S2 |
| S4 | sub session | `opus` | high | S3 with three or more workstreams; failed once on S3 |
| A1 | `pstack:pstack-watch`, `Explore`, or `pstack:pstack-code` with `model: "haiku"` | `haiku` | medium | Watching a PR, reading CI logs, locating code, reading docs, `how` explorers, the ticket-intake scout |
| A2 | `pstack:pstack-code` with `model: "haiku"` | `haiku` | medium | One-file mechanical edit of type `docs` or `tokens`; applying a codemod or script someone wrote |
| A3 | `pstack:pstack-code`, `pstack:pstack-tooling` | `sonnet` | medium | Default for code: Builder workers, swarm workers and lanes, Fixer, Triager, `why` investigators, `how` synthesizer, reflect tooling; failed once on A2 |
| A4 | `pstack:pstack-judgment` | `opus` | high | Hardest changes (concurrency, security, cross-cutting design), `how` explainer, `why` synthesizer, reflect judgment and divergent, arena cross-judge; failed once on A3 |
| P | `pstack:pstack-panel-1` to `-4` | as set per file | medium | `interrogate`, `arena`, `architect` reviewers. Keep the four models different |

Never start a sub session on Haiku. Never pick Fable unless the user names it. A step that names a role agent keeps it; the row only sets `model`. On a failed verification, a second CI fix round on the same check, or a `blocked` report, respawn one step up the ladder Haiku medium → Sonnet medium → Sonnet high → Opus medium → Opus high, never more, and log the row and reason in the decision trail.

## Config and paths
- `~/.omp/agent/config.yml`, `.omp/config.yml`, `modelRoles.pstack-*`, `task.agentModelOverrides`, `task.eager`, `skills.enableSkillCommands` → not used. Role models and efforts live in the `model:` and `effort:` fields of `{{PSTACK_ROOT}}/claude/agents/*.md`; the Model routing table overrides `model` per spawn.
- `task.enableEffort`, the `task` `effort` parameter (`"hi"` or `"lo"`) → not used. Role effort lives in each agent's `effort:` field; do not override it per spawn.
- `hub wait` / `hub jobs` hourly heartbeat for autopilot and shipping ticks → no `/loop 1h` equivalent needed. Use a background Agent, or `/loop` or `ScheduleWakeup` only if the user runs a loop.
- `task.maxConcurrency` → no Claude Code setting. Keep the playbook's own live-agent limit as written.
- `/skill:setup-pstack` → omp only, except lesson memory and PR review. On Claude Code, confirm `/agents` lists the `pstack:*` agents and point the user to `claude/agents/*.md` to change role models. Do not write omp config. Do ask step 3(c), the lesson-memory question, and write it with `node {{PSTACK_ROOT}}/skills/lessons/scripts/lessons.mjs configure` as step 5 shows. Skip 3(d). Ask step 3(e) and run step 7 as written, with `node {{PSTACK_ROOT}}/skills/setup-pstack/scripts/pr-review.mjs`. Run steps 8 and 9, the verification-skill offers, as written.
- `memory.backend`, `autolearn.enabled`, omp's `learn` tool → no plugin equivalent. Claude Code's own auto memory is on by default and the plugin cannot change it. pstack lessons (`.pstack/`, `~/.pstack/`) are the same files on both harnesses.
- `OMPCODE=1` → omp sets it in every shell; Claude Code does not. Both harnesses set `CLAUDECODE=1`, so only `OMPCODE` tells them apart.
- `omp models`, `omp --model ... -p` → `claude --model <id> -p "ok"` to smoke-test a model.
- `~/.omp/agent/sessions/<encoded-cwd>/` → `~/.claude/projects/<cwd with every / and . replaced by ->/` (`*.jsonl` per session; subagent transcripts under `<sessionId>/subagents/`).
- `.omp/skills/` → `.claude/skills/`. `~/.omp/agent/skills/` → `~/.claude/skills/`. `.omp/mcp.json`, `~/.omp/agent/mcp.json` → `.mcp.json`, `claude mcp add`.
- "OMP" in prose means the running harness, here Claude Code.
