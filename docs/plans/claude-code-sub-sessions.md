# pstack on Claude Code desktop with sub sessions plan

pstack on Claude Code treats every omp `task` as an in-context `Agent` subagent and claims subagents cannot spawn. That second claim is now false.
This plan makes the heavy coordinator roles open as linked sub sessions when pstack runs in the Claude Code desktop app, through its `mcp__ccd_session__start_session` tool.
Heavy roles are the Ship to green batch owner, the Orchestrate sub-coordinator, the Autopilot-full and Autopilot-stack owners, and a Builder whose checkpoint names three or more workstreams.
Every other role stays on `Agent`, now with nesting allowed. Outside the desktop app nothing changes and heavy roles stay on `Agent`.
The rule it enforces. A role that coordinates other agents or outlives one turn opens a sub session on desktop. A role that returns one summary is a subagent.
Shared `skills/` text does not change. All routing lives in `claude/harness-map.md`.
PR ids in order. S1 drops the stale no-nesting rule. S2 routes heavy roles to desktop sub sessions and bumps the version.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `skill://poteto-mode/playbooks/autopilot-stack.md`. The operator (Cang) lands the stack. S1 and S2 both stop at merge-ready.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] On the operator's go, arm a `/goal` with this exact text. "Run docs/plans/claude-code-sub-sessions.md. PRs S1 then S2 as one stack. A PR is verified only when its unit, live, and perf boxes are all checked. The operator lands. Done when both are merge-ready with verdicts at their head SHAs."
- [ ] Read these at program start. Re-read them at every tick. Read a pstack skill from its installed path, and a project file from trunk.
  - [ ] `skill://poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `skill://swarm/SKILL.md`
  - [ ] `git show origin/main:claude/harness-map.md`
  - [ ] `skill://poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `skill://poteto-mode/playbooks/ship-to-green.md`, `skill://poteto-mode/playbooks/orchestrate.md`, `skill://poteto-mode/playbooks/autopilot-full.md`, `skill://poteto-mode/references/builder-brief.md`
- [ ] Arm the 30-minute audit tick. Drive it with a long-running background `task` agent and re-check the finish condition on a heartbeat (`hub wait` / `hub jobs`). Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from its installed path and the armed /goal. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] S1 is first and branches from `main`.
  - [ ] S2 after S1, based on the S1 branch.
- [ ] Hold the file boundaries. S1 touches only `claude/harness-map.md` and `docs/guide/**`. S2 touches only `claude/harness-map.md`, `docs/guide/**`, and the four manifests. No PR edits shared `skills/**` text.
- [ ] Hold the review gate. No PR changes a UI interaction, so none waits for a video review.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, with `gh pr create --base <base-branch>`. A stack child targets its parent branch.
- [ ] Run `claude plugin validate .` once before the PR-facing push. Push with hooks on.
- [ ] Sweep the diff for slop before each commit and again before review. Run the **no-comments** skill over comments and delete dead weight per **principle-subtract-before-you-add**.
- [ ] Triage every code-review-bot and security-reviewer comment per `../references/code-review-bot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, or on a CI failure that comes from a change on trunk.

### Verdict and merge, for every PR

- [ ] At the code-ready head SHA and at each later push that changes the patch, run the swarm per `skill://swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note. A new head gets a fresh swarm and a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] Append each verified PR to the base-branch stack. The operator lands it bottom-up. A rebase keeps the verdict only when the patch-id is unchanged per `playbooks/shipping.md`.

### Boot recipe, for every live lane

Each live lane runs in its own isolated git worktree at the PR head. There is no browser surface. S1 lanes drive `claude --plugin-dir . -p` headless. S2 lanes need the desktop app, so they run in a desktop Code tab session opened on the worktree with the plugin loaded from it.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Run `claude plugin validate .` and confirm it exits 0.
- [ ] Deliver input only as a user prompt in that session. Read-only diagnostics are `mcp__ccd_session_mgmt__list_sessions` with `linked: true` and the session JSONL under `~/.claude/projects/`.
- [ ] Save every transcript to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.jsonl` and every sidebar capture to the same folder, and return the paths with the report.

## Drop the stale no-nesting rule from the Claude map (S1)

**Depends on.** None.

**Files.**

- [ ] Edit `claude/harness-map.md`.
- [ ] Edit `docs/guide/11-omp-and-claude-code.md`.

**Build.**

- [ ] Replace the `spawns: "*"` row in `claude/harness-map.md`. It now says Claude Code subagents can spawn subagents up to `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (default three layers), so a Builder fans out and runs its review pass exactly as `references/builder-brief.md` says. Delete the `agents: none (Claude Code)` and `checkpoint: one worker (Claude Code)` exemption.
- [ ] Update the Subagent tool row and the Known gaps list in `docs/guide/11-omp-and-claude-code.md` to match. Add the depth and concurrency env vars to the Config section.

**You see.**

- [ ] A Ship to green Builder on Claude Code reports a real `agents:` line naming its child workers instead of `none (Claude Code)`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `rg -n "cannot spawn|agents: none" claude docs/guide` and confirm zero hits.
- [ ] Run `claude plugin validate .` and confirm exit 0.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `pstack-code` workers at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run a Builder brief on a one-file change at trunk and head. Trunk reports `agents: none (Claude Code)`. Save `builder-trunk-head.jsonl`. Pass when head reports at least one child agent.
- [ ] Lane 2. `pstack:pstack-code` spawns an `Explore` child. Save `nest-1.jsonl`. Pass when the child reply reaches the parent.
- [ ] Lane 3. Three-layer chain from the session to `pstack-code` to `pstack-code` to `Explore`. Save `nest-3.jsonl`. Pass when the deepest reply reaches the root.
- [ ] Lane 4. Fourth layer attempt. Save `nest-4.jsonl`. Pass when the spawn is refused with a depth error and the parent reports it.
- [ ] Lane 5. `how` skill on a small subsystem. Save `how.jsonl`. Pass when explorers and the synthesizer run as subagents and the answer cites `file:line`.
- [ ] Lane 6. `swarm` with two isolated workers. Save `swarm.jsonl`. Pass when each worker got its own worktree.
- [ ] Lane 7. SessionStart output. Save `map.txt`. Pass when the injected map has the new nesting row and an absolute plugin root.
- [ ] Lane 8. `poteto-agent` reads poteto-mode then spawns a `pstack-code` child. Save `poteto-nest.jsonl`. Pass when both spawns appear in the transcript.
- [ ] Lane 9. omp unchanged. Run `omp --plugin-dir .` and load `skill://poteto-mode`. Save `omp.txt`. Pass when skills and `pstack-*` agents load.
- [ ] Lane 10. `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` with a Builder brief. Save `depth1.jsonl`. Pass when the Builder falls back to doing the work itself and says why.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Coordinator main-thread tokens for one Ship to green Builder phase on a fixed one-file fixture.
- [ ] Probe. Run the fixture three times at trunk and three times at head, interleaved, and read `usage` from the result frame.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Head median coordinator tokens must not exceed trunk by more than 10 percent. Child tokens are reported, not gated.

**Review gate.** None. S1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Code-review-bot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends S1 to the base-branch stack and the operator lands it bottom-up.

## Route heavy roles to desktop sub sessions (S2)

**Depends on.** S1.

**Files.**

- [ ] Edit `claude/harness-map.md`.
- [ ] Edit `docs/guide/11-omp-and-claude-code.md`.
- [ ] Edit `claude/agents/pstack-code.md`, `claude/agents/pstack-judgment.md`, `claude/agents/pstack-watch.md`, `claude/agents/pstack-tooling.md`, `claude/agents/pstack-panel-1.md` to `pstack-panel-4.md`.
- [ ] Edit `.claude-plugin/plugin.json`, `.omp-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.omp-plugin/marketplace.json`.

**Build.**

- [ ] Add a "Sub sessions (Claude Code desktop)" block to `claude/harness-map.md`. Detection. The session has `mcp__ccd_session__start_session`, loaded or deferred. Without it, every `task` stays `Agent` as today.
- [ ] Name the heavy roles in that block. The Ship to green batch owner (one `poteto-agent` per ticket), the Orchestrate sub-coordinator, the Autopilot-full and Autopilot-stack owners, and a Ship to green Builder whose checkpoint names three or more workstreams. Each one becomes `start_session` with `context: "fresh"`, a `name` equal to the unit id, `use_worktree: true` for write work, and `wake_when_done: true`. Every other `task` stays `Agent`.
- [ ] Write the brief rule. The `prompt` is the playbook's brief verbatim plus the pstack root and "Read `<root>/skills/poteto-mode/SKILL.md` in full first". The `background` carries the standing orders. The session ends its turn with the playbook's status report block as its final message, and writes the full report to `.pstack/sessions/<run>/<name>.md` in its worktree when it is longer than 400 characters.
- [ ] Write the initiation rule. When the user's request runs a batch, an orchestrate program, or an autopilot queue, that request counts as asking for the owners, so use `initiation: "user_asked"`. For a single heavy Builder the user did not ask to split, use `"own_initiative"` so the user starts it with a click, and keep the work on `Agent` if they don't.
- [ ] Map the omp follow-ups. `agent://<id>` for an owner becomes `SendMessage` to its `local_` id. `hub wait` on owners becomes the side-session event the app sends when owners end their turn. Reconcile owners with `mcp__ccd_session_mgmt__list_sessions` and `linked: true`. Never poll.
- [ ] Record the limits. `start_session` takes no `--agent`, so an owner runs on the coordinator's model or a cheaper `model` id, and role models still apply to the subagents it spawns. `permission_mode` must be the coordinator's mode or lower. A session is a new spawn root, so its own subagents get the full depth.
- [ ] Add the routing table from Appendix D to `claude/harness-map.md` verbatim. The coordinator scores each unit with the signals there before it spawns, and passes `model` and `effort` to `start_session`, or `model` to `Agent`.
- [ ] Set role defaults in `claude/agents/*.md` to match the table. `pstack-code` gets `model: sonnet` and `effort: medium`. `pstack-judgment` keeps `opus` and gets `effort: high`. `pstack-watch`, `pstack-tooling`, and `pstack-panel-1` to `pstack-panel-4` get `effort: medium` and keep their models. The omp files in `agents/` stay unchanged, because omp reads models from `modelRoles`.
- [ ] Cap effort at `high` everywhere. No row, role file, or escalation uses `xhigh` or `max`.
- [ ] Bump `version` in all four manifests in one step.

**You see.**

- [ ] On desktop, `/pstack:poteto-mode` with two tickets on Ship to green shows two linked sessions nested under the coordinator in the sidebar. Each runs its own Builder subagents, and the coordinator wakes with one status report per ticket.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `claude plugin validate .` and a `node -e` check over the four manifests that asserts one shared version.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `pstack-code` workers at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Ship to green batch with two fixture tickets on desktop at trunk and head. Save `batch-trunk-head.jsonl`. Pass when trunk spawns `Agent` owners and head starts two linked sessions, both ending with the status report, and each session's model and effort in `get_session` match its routing row (one `docs` ticket on row S1, Sonnet `medium`, one `rebuild` ticket on row S3, Opus `medium`).
- [ ] Lane 2. Orchestrate with two tracks on desktop. Save `orch-tracks.jsonl`. Pass when each sub-coordinator is a linked session and `orch status` lists both.
- [ ] Lane 3. Sidebar. Save `sidebar.png`. Pass when the owner sessions show nested under the coordinator, like the existing news sessions do.
- [ ] Lane 4. CLI without desktop tools. Run the same batch with `claude --plugin-dir . -p`. Save `cli.jsonl`. Pass when no session starts and owners run as `Agent`.
- [ ] Lane 5. Leaf roles unchanged on desktop. Run `how` and `interrogate`. Save `leaf.jsonl`. Pass when no session starts and all spawns are `Agent`.
- [ ] Lane 6. Owner stopped mid-run. Stop one owner from the sidebar. Save `crash.jsonl`. Pass when the coordinator reconciles it as stopped and does not redo its work silently.
- [ ] Lane 7. Escalation. Give a row S1 owner a fixture whose verification fails. Save `escalate.jsonl`. Pass when the coordinator respawns it once on row S2, Sonnet `high`, and logs the reason, and no session or subagent in the run uses `xhigh` or `max`.
- [ ] Lane 8. Long report. An owner with a report over 400 characters. Save `long-report.jsonl`. Pass when the coordinator reads the full file, not the truncated event text.
- [ ] Lane 9. Single ticket Ship to green with a three-workstream Builder. Save `single.jsonl`. Pass when the coordinator shows one New task card for the Builder and runs it as `Agent` if the card is declined.
- [ ] Lane 10. omp unchanged. Run the batch on omp. Save `omp-batch.txt`. Pass when omp still uses `task` owners.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Coordinator context tokens at the end of a two-ticket batch.
- [ ] Probe. Run the batch at trunk and head on desktop, two runs each, interleaved, and read the coordinator's final usage from its JSONL.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Head coordinator tokens must be at least 30 percent below trunk, since owner transcripts no longer flow back into it. Fail above 90 percent of trunk.

**Review gate.** None. S2 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Code-review-bot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends S2 to the base-branch stack and the operator lands it bottom-up.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

Probes run on 2026-11-05 on Claude Code 2.1.310.

- Desktop sub sessions work. `list_sessions` shows "Find OSS repos for news/social aggregation" and "Search today's AI news (2026-11-05)" with `startedBy` set to the session "Subsession tìm kiếm tin tức AI hôm nay". The operator started them through the desktop tool with no error. Measured.
- Nested spawn works. A `pstack:pstack-code` subagent on haiku called `Agent` with `Explore` and got `NESTED-OK` back. Measured. This falsifies the current map row.
- `mcp__ccd_session__start_session` takes `context`, `prompt`, `background`, `name`, `model` (same or cheaper), `permission_mode` (same or lower), `use_worktree`, and `wake_when_done`. It takes no agent type. Read from its schema.
- The CLI path is a separate mechanism. `claude --bg --agent pstack:pstack-code` loaded the plugin agent but stopped at `Login expired`, and refused an untrusted folder. Measured. It is out of scope now.
- Unproven. Whether a skill-driven `"user_asked"` start is accepted when the request came through a `/pstack:` command rather than plain words. S2 lane 1 settles it.

## Appendix B. Alternatives rejected

- Convert every subagent to a session. Rejected by the operator and by cost. A leaf returns one summary in seconds. A session pays a full startup and context.
- A CLI lever around `claude --bg` or `claude -p` stream-json, adapted from `harness-orchestrator/orch.mjs`. Dropped. The operator wants sub sessions only on desktop, and the CLI path needs its own login, folder trust, and a report channel because `claude logs` returns TUI escapes.
- Agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Experimental, env-flag gated, one team per session, no nested teams, and all teammates inherit the lead's permission mode.
- Workflow tool scripts. Workflow agents are subagents, not sessions.
- Rewrite shared `skills/` text. The repo rule keeps skills in omp syntax. Routing goes through `claude/harness-map.md`.

## Appendix C. Risks

- The app's own session rules decide whether a start runs now or waits as a card. If `"user_asked"` is refused for a playbook command, owners arrive as cards and the operator clicks Start all. S2 lane 1 records which.
- The side-session event quotes only the first 400 characters of a report. The report-file rule covers it, and S2 lane 8 gates it.
- Owners run on the coordinator's model, not a `pstack-*` role model. Cost rises when the coordinator is on the strongest model. Pass a cheaper `model` id for mechanical owners.
- Sessions sharing a checkout can overwrite each other. Write owners always get `use_worktree: true`.

## Appendix D. Model routing table and evidence

### Signals the coordinator reads

Ticket `type=` from the intake stamp. Workstream count from the Builder checkpoint. Spec state, meaning an intake stamp that verifies with `--expect`, or not. Risk flags in the ticket or brief (concurrency, auth or security, data migration, public API). The role being spawned.

### Sub sessions, desktop only, through `start_session`

| Row | Model | Effort | Use when |
|---|---|---|---|
| S1 | Sonnet 5.5 | medium | Stamped spec. Type `bug`, `enhancement`, `docs`, `tokens`, or `tooling`. One or two workstreams. No risk flag. Also any unit that is mostly terminal, CI, or script work |
| S2 | Sonnet 5.5 | high | S1 with three or more workstreams. Type `refactor` with a stamped spec and existing tests. A unit that failed once on S1 |
| S3 | Opus 5.5 | medium | Type `rebuild`, `component`, or `spike`. Any risk flag. No verified stamp. The Orchestrate sub-coordinator. A unit that failed once on S2 |
| S4 | Opus 5.5 | high | S3 with three or more workstreams. A unit that failed once on S3 |

Haiku never runs a sub session. An owner session is long and multi-step, where Haiku trails most.

### Subagents, through `Agent`

| Row | Model | Effort | Role | Use when |
|---|---|---|---|---|
| A1 | Haiku 5.5 | medium | `pstack-watch`, `Explore`, the ticket-intake scout, `pstack-code` with `model: "haiku"` | Watching a PR and reading CI logs. Locating files and call sites. Reading docs. `how` explorers |
| A2 | Haiku 5.5 | medium | `pstack-code` with `model: "haiku"` | A mechanical edit in one file of type `docs` or `tokens`. Applying a codemod or script someone else wrote |
| A3 | Sonnet 5.5 | medium | `pstack-code`, `pstack-tooling` | The default for code. Builder workers, swarm workers and live lanes, the Fixer and the Triager, `why` investigators, the `how` synthesizer, the reflect tooling lens. A unit that failed once on A2 |
| A4 | Opus 5.5 | high | `pstack-judgment` | The hardest changes (concurrency, security, cross-cutting design). The `how` explainer, `why` synthesizer, reflect judgment and divergent passes, arena cross-judge. A unit that failed once on A3 |
| P | Opus, Sonnet, Fable, Haiku | medium | `pstack-panel-1` to `pstack-panel-4` | `interrogate`, `arena`, and `architect` reviewers. The four models stay different on purpose, because agreement across models is the signal |

### Coordinator and escalation

- The coordinator in the main chat runs on Opus 5.5 at medium. `start_session` refuses a model or effort above the caller's, so an Opus coordinator can use every row. A Sonnet coordinator caps sessions at S2 and says so in its first status message. `start_session` silently caps effort at the caller's, and a session cannot raise its own effort. For an S2 or S4 row a medium coordinator starts the session with a READY turn, raises it with `set_session_effort`, and then sends the brief with `SendMessage`. Measured on 2026-11-05.
- The ladder is Haiku medium, then Sonnet medium, then Sonnet high, then Opus medium, then Opus high. A failure moves a unit one step, never more. A failure is a failed verification, a second CI fix round on the same check, or a report that says `blocked`.
- Log every row choice and every escalation with its reason in the decision trail. That log is the data for tuning the rows.

### Evidence

| Benchmark | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 | Fable 5.1 |
|---|---|---|---|---|
| SWE-bench Pro | 89.9 | 81.3 | 64.8 | 81.2 |
| SWE-bench Multilingual | 93.9 | 90.3 | 83.7 | 89.1 |
| Terminal-Bench 4.0 | 64.8 | 70.6 | 39.2 | 55.8 |
| DeepSWE v1.1, long-horizon | 74.2 | 71.0 | not reported | not reported |
| FrontierCode v1.1 | 54.4 | 46.2, or 52.1 at xhigh | 46.4 | 50.3 |
| Price per MTok in and out | $4 and $20 | $2 and $10 | $0.10 and $0.50 | $10 and $50 |

Findings that set the rows.

- The Haiku gap grows with difficulty. Against Sonnet it is 6.6 points on Multilingual, 16.5 on Pro, and 31.4 on Terminal-Bench. On older models split by human fix time, Haiku 4.5 trails Opus 4.8 by 11, 26, and 50 points across the under 15 minute, 15 to 60 minute, and 1 to 4 hour buckets (Vals, SWE-bench Verified). Owner sessions are long and multi-step, so Haiku is out.
- The Sonnet to Opus gap is small and uneven. Opus leads by 8.6 on Pro and 3.2 on DeepSWE. Sonnet leads by 5.8 on Terminal-Bench. Sonnet at xhigh closes FrontierCode to 2.3 points at half the price. Effort is the first lever, and Opus is reserved for open-ended or risky work.
- Fable 5.1 trails Opus 5.5 on every reported coding benchmark, including about 20 hour FrontierSWE tasks (56.3 against 62.3), at 2.5 times the price. It is off the table by default.
- Anthropic's guidance matches. Sonnet is "strongest at well-scoped everyday tasks, fixing bugs". Opus "remains clearly stronger at complex, open-ended work". Haiku "pairs well" with them "as a subagent".

Gaps. No METR time horizon and no difficulty-bucket split exist for any 5.x model. Most scores are at max effort, while Claude Code defaults lower. The rows are a starting point, and the escalation log is how this repo corrects them.

Sources. https://www.anthropic.com/claude-opus-5-5-system-card, https://www.anthropic.com/claude-sonnet-5-5-system-card, https://www.anthropic.com/claude-haiku-5-5-system-card, https://www.anthropic.com/claude-sonnet-5-5, https://www.anthropic.com/claude-haiku-5-5, https://www.anthropic.com/claude/fable, https://www.vals.ai/benchmarks/swebench, https://code.claude.com/docs/en/model-config, https://code.claude.com/docs/en/costs.

## Appendix E. Links and reading list

- Claude Code docs read for this plan. https://code.claude.com/docs/en/sub-agents.md, https://code.claude.com/docs/en/desktop.md, https://code.claude.com/docs/en/agent-teams.md, https://code.claude.com/docs/en/workflows.md, https://code.claude.com/docs/en/cross-session-messaging.md.
- Repo files. `claude/harness-map.md`, `docs/guide/11-omp-and-claude-code.md`, `harness-orchestrator/CONTEXT.md`, `skills/poteto-mode/playbooks/ship-to-green.md`, `skills/poteto-mode/playbooks/orchestrate.md`, `skills/poteto-mode/playbooks/autopilot-full.md`, `skills/poteto-mode/references/builder-brief.md`.
- S2 gets `skill://interrogate/SKILL.md` on the initiation rule. The trail follows `skill://show-me-your-work/SKILL.md`.
