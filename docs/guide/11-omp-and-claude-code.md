# omp and Claude Code

pstack ships one tree for two harnesses: omp (oh-my-pi) and Claude Code. This page lists what each needs and how the repo serves both. Read it before you add a skill, an agent, a script, or a hook.

Sources: the omp docs at [omp.sh/docs](https://omp.sh/docs) (source markdown in [can1357/oh-my-pi `docs/`](https://github.com/can1357/oh-my-pi/tree/main/docs)) and the Claude Code [plugins reference](https://code.claude.com/docs/en/plugins-reference).

## How the repo serves both

| Path | omp | Claude Code |
|---|---|---|
| `.omp-plugin/plugin.json` | manifest (read first) | ignored |
| `.omp-plugin/marketplace.json` | catalog (preferred) | ignored |
| `.claude-plugin/plugin.json` | ignored, because `.omp-plugin/plugin.json` exists | manifest; `agents` points at `claude/agents/` |
| `.claude-plugin/marketplace.json` | fallback catalog | catalog |
| `skills/` | skills | skills (shared, same files) |
| `agents/` | role agents with `model: "@pstack-*, @task"` | not loaded (the manifest's `agents` list replaces the default) |
| `claude/agents/` | not loaded | role agents with fixed Claude models |
| `hooks/hooks.json` | ignored (omp only loads `hooks/pre|post/*.ts`) | `SessionStart` hook that injects `claude/harness-map.md` |
| `claude/harness-map.md` | not loaded | omp → Claude Code translation sheet with the absolute plugin root filled in |

The skills stay in omp syntax (`skill://`, `task`, `hub`). On Claude Code, a session-start hook prints [`claude/harness-map.md`](../../claude/harness-map.md) into context, and the model translates each omp term as it reads a skill. There's no second copy of any skill.

## Side by side

| Aspect | omp | Claude Code |
|---|---|---|
| Plugin manifest | `.omp-plugin/plugin.json`, falls back to `.claude-plugin/plugin.json`. `package.json` `omp.extensions` (legacy `pi`) for TS extensions | `.claude-plugin/plugin.json`, only `name` required |
| Marketplace | `.omp-plugin/marketplace.json`, falls back to `.claude-plugin/marketplace.json`. Same schema | `.claude-plugin/marketplace.json` |
| Install | `omp plugin marketplace add <src>` then `omp plugin install --scope user pstack@pstack-omp` | `/plugin marketplace add <src>` then `/plugin install pstack@pstack-omp` |
| Reload | `/reload-plugins` or a new session | `/reload-plugins` or a new session |
| Local dev | `omp --plugin-dir .` | `claude --plugin-dir .` |
| Skills layout | `skills/<name>/SKILL.md`, one level deep | same |
| Skill frontmatter | `name`, `description`, `globs`, `alwaysApply`, `hide`, `disable-model-invocation`; other keys kept as metadata (`mode`, `icon`, `color`, `reminder`) | `name`, `description`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `paths`, `context`, `hooks`, …; other keys ignored |
| User runs a skill | `/skill:<name>` (needs `skills.enableSkillCommands`) | `/pstack:<name>` (always namespaced by plugin) |
| Model loads a skill | `skill://<name>` or `skill://<name>/<path>`, which works even with `disable-model-invocation` | `Skill` tool, which respects `disable-model-invocation`, or `Read` the file by absolute path |
| Plugin-root path | `skill://` resolves it, so no path is needed | `${CLAUDE_PLUGIN_ROOT}` in hooks and MCP only, **not** in the Bash tool environment |
| Agents | plugin `agents/*.md`; `name`, `description`, `tools`, `spawns`, `model` (alias list like `"@pstack-code, @task"`), `thinking`, `blocking`, `autoloadSkills` | plugin `agents/` or the manifest `agents` list of files; `name` (lowercase-hyphen), `description`, `tools`, `model` (`inherit`/`opus`/`sonnet`/`fable`/`haiku`/id), `effort`, `skills`, `isolation`. `hooks`, `mcpServers`, `permissionMode` are refused in plugin agents |
| Agent id at spawn | `agent: "pstack-code"` | `subagent_type: "pstack:pstack-code"` |
| Role models | `modelRoles.pstack-*` plus `task.agentModelOverrides` in `~/.omp/agent/config.yml`, written by `/skill:setup-pstack` | the `model:` field in `claude/agents/*.md`. No per-user role config |
| Subagent tool | `task` (batch `tasks[]`, `isolated: true`, max 8 concurrent) | `Agent` (parallel calls in one message, `isolation: "worktree"`) |
| Background work | background `task` and `hub wait` / `hub jobs` | `run_in_background: true` on `Agent`/`Bash`, completion notifications, `Monitor` |
| Other tools | lowercase: `read`, `edit`, `write`, `bash`, `grep`, `find`, `ask`, `browser`, `manage_skill` | PascalCase: `Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `AskUserQuestion`; no built-in browser; no `manage_skill` |
| Hooks | TS/JS factories in `hooks/pre|post/`, `pi.on("tool_call", …)` | `hooks/hooks.json` shell commands (`SessionStart`, `PreToolUse`, `PostToolUse`, …) |
| Commands | `commands/*.md` → `<plugin>:<cmd>` | `commands/*.md` → `/<plugin>:<cmd>` (legacy; prefer skills) |
| MCP | plugin `.mcp.json`; `.omp/mcp.json`; also reads `.claude/.mcp.json`, `~/.claude.json` | plugin `.mcp.json` or manifest `mcpServers` |
| Rules | `rules/*.md`, `.omp/rules`, `RULES.md`, `rule://` | none; use `CLAUDE.md` or `paths` on a skill |
| Context file | `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md` | `CLAUDE.md` |
| Session transcripts | `~/.omp/agent/sessions/<encoded-cwd>/` | `~/.claude/projects/<cwd with / and . → ->/*.jsonl` |
| Project skills dir | `.omp/skills/` | `.claude/skills/` |

## Adding things so both work

- **A skill.** Write it once under `skills/<name>/`, in omp syntax like the rest. If it uses an omp term that isn't in [`claude/harness-map.md`](../../claude/harness-map.md) yet (a new tool, path, or config key), add a row there in the same change.
- **A script.** Put it under a skill's `scripts/` and reference it as `skill://<skill>/scripts/<file>`. The map turns that into an absolute path on Claude Code. Don't reach for `${CLAUDE_PLUGIN_ROOT}` inside skill text, because the Bash tool doesn't have it.
- **An agent.** Add it to both `agents/` (omp frontmatter, `@alias` model) and `claude/agents/` (lowercase-hyphen `name`, a Claude `model`). Then append the file to the `agents` list in `.claude-plugin/plugin.json`. The validator rejects a bare directory there.
- **A hook.** Claude Code: add it to `hooks/hooks.json`. omp: write a TS factory under `hooks/pre/` or `hooks/post/`. They share nothing.
- **Manifest metadata.** Keep `.omp-plugin/plugin.json` and `.claude-plugin/plugin.json` in step on `version` and `description`. Keep Claude Code path fields out of the omp manifest.

## Checking a change

- Claude Code: `claude plugin validate .`, then `claude --plugin-dir .`. Ask it for the pstack root and its `pstack:*` agents, and check that `/pstack:<skill>` runs.
- omp: `omp --plugin-dir .`. Confirm the skills and `pstack-*` agents load, and that `skill://poteto-mode` resolves.

## Known gaps on Claude Code

- No `browser` tool. Visual verification needs a browser MCP server.
- Role models are fixed per file. `/skill:setup-pstack` configures omp only.
- Most skills set `disable-model-invocation`, so they don't show up in the model's skill list. The user types `/pstack:<name>`, or the model reads the file through the map.
