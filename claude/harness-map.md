# pstack on Claude Code: omp → Claude Code map

pstack is installed as a Claude Code plugin. Its skills are written for omp (oh-my-pi). When a pstack skill, playbook, or reference says an omp term on the left, do the Claude Code thing on the right. pstack root: `{{PSTACK_ROOT}}`.

## Skills and files
- `/skill:<name>` → `/pstack:<name>` (user-typed command).
- `skill://<name>` → Read `{{PSTACK_ROOT}}/skills/<name>/SKILL.md`. Use Read, not the Skill tool: most pstack skills set `disable-model-invocation`.
- `skill://<name>/<path>` → `{{PSTACK_ROOT}}/skills/<name>/<path>`, e.g. `bun {{PSTACK_ROOT}}/skills/poteto-mode/scripts/orch/orch.ts`, `node {{PSTACK_ROOT}}/skills/poteto-mode/scripts/check-plan.mjs <plan.md>`.
- Relative paths inside a skill (`playbooks/x.md`, `references/y.md`) resolve from that skill's directory under `{{PSTACK_ROOT}}/skills/`.

## Tools
- `read` / `edit` / `write` / `bash` / `grep` / `find` → `Read` / `Edit` / `Write` / `Bash` / `Grep` / `Glob`.
- `task` → `Agent`. A `task` batch → several `Agent` calls in one message. OMP's 8-at-once cap does not apply.
- `agent: "pstack-code"` (any `pstack-*` role, `poteto-agent`) → `subagent_type: "pstack:<same name>"`. `agent: "Comment Sicko"` → `subagent_type: "pstack:comment-sicko"`. Pass `{{PSTACK_ROOT}}` in the prompt when the worker must read pstack files.
- `agent: "scout"` (the **ticket-intake** skill's read-only exploration) → `subagent_type: "Explore"`.
- `isolated: true` → `isolation: "worktree"`.
- `agent://<id>` (parked subagent) → `SendMessage` to that agent, or read its transcript.
- Long-running background `task` + `hub wait` / `hub jobs` heartbeat → `Agent` or `Bash` with `run_in_background: true`; wait for the completion notification, use `Monitor` to watch a condition.
- `ask` → `AskUserQuestion`.
- `browser` → a browser MCP server (e.g. Playwright) if one is connected; otherwise tell the user the verification step needs one.
- `tab.recordStart` / `tab.recordStop` (the **video-evidence** skill) → Playwright MCP started with `--save-video=<width>x<height>` (WebM in its output dir), or a Playwright script with `browser.newContext({ recordVideo: { dir, size } })`. Load `scripts/overlay.js` with `page.addInitScript({ path })`. Build the storyboard from the WebM with the same `ffmpeg` line. Puppeteer's `page.waitForFileChooser({ timeout })` → Playwright's `page.waitForEvent("filechooser", { timeout })`.
- `tab.screenshot` (the **Ship to green** playbook's evidence capture) → Playwright MCP `browser_take_screenshot` with a `filename`, or `page.screenshot({ path })` in a Playwright script.
- `manage_skill` → `Write` the SKILL.md under `.claude/skills/<name>/` (project) or `~/.claude/skills/<name>/` (user).

## Config and paths
- `~/.omp/agent/config.yml`, `.omp/config.yml`, `modelRoles.pstack-*`, `task.agentModelOverrides`, `task.eager`, `skills.enableSkillCommands` → not used. Role models live in the `model:` field of `{{PSTACK_ROOT}}/claude/agents/*.md`.
- `task.maxConcurrency` → no Claude Code setting. Keep the playbook's own live-agent limit as written.
- `/skill:setup-pstack` → omp only, except lesson memory and PR review. On Claude Code, confirm `/agents` lists the `pstack:*` agents and point the user to `claude/agents/*.md` to change role models. Do not write omp config. Do ask step 3(c), the lesson-memory question, and write it with `node {{PSTACK_ROOT}}/skills/lessons/scripts/lessons.mjs configure` as step 5 shows. Skip 3(d). Ask step 3(e) and run step 7 as written, with `node {{PSTACK_ROOT}}/skills/setup-pstack/scripts/pr-review.mjs`.
- `memory.backend`, `autolearn.enabled`, omp's `learn` tool → no plugin equivalent. Claude Code's own auto memory is on by default and the plugin cannot change it. pstack lessons (`.pstack/`, `~/.pstack/`) are the same files on both harnesses.
- `OMPCODE=1` → omp sets it in every shell; Claude Code does not. Both harnesses set `CLAUDECODE=1`, so only `OMPCODE` tells them apart.
- `omp models`, `omp --model ... -p` → `claude --model <id> -p "ok"` to smoke-test a model.
- `~/.omp/agent/sessions/<encoded-cwd>/` → `~/.claude/projects/<cwd with every / and . replaced by ->/` (`*.jsonl` per session; subagent transcripts under `<sessionId>/subagents/`).
- `.omp/skills/` → `.claude/skills/`. `~/.omp/agent/skills/` → `~/.claude/skills/`. `.omp/mcp.json`, `~/.omp/agent/mcp.json` → `.mcp.json`, `claude mcp add`.
- "OMP" in prose means the running harness, here Claude Code.
