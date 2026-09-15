# Harness surface

pstack reads on two harnesses. This file maps what the playbooks name to what each one calls it.

| capability | omp | claude code |
|---|---|---|
| a role's model | `modelRoles.pstack-<role>` in `~/.omp/agent/config.yml`, applied through `task.agentModelOverrides`, written by `/skill:setup-pstack` | the `model:` field in `agents/pstack-<role>.md`, fixed at install. `/model` moves the main thread and every `inherit` agent; `CLAUDE_CODE_SUBAGENT_MODEL` defaults the agents that name no model, and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` overrides the field too |
| loading a skill | read it with `skill://<name>` | invoke the `pstack:<name>` skill |
| a script inside a skill | `skill://<skill>/scripts/<file>` | the same file under the installed plugin; locate it once with `find ~/.claude -name <file>` |
| browser, Electron, and web surfaces | the `browser` tool. `browser.open` returns a tab handle, then `tab.observe`, `tab.click`, `tab.run`, `tab.screenshot` | no bundled browser tool. Use browser tooling the session has, otherwise a headed Playwright script over the same surface |
| CLIs and TUIs | a `hub` PTY process: `hub start`, `hub send`, `hub logs`, `hub wait`, `hub stop` | a background process for a pipe-driven CLI, `tmux` when the program needs a real TTY |
| parallel and background agents | the `task` tool, background by default, drained with `hub jobs` and `hub wait` | your subagent tool, with the `pstack-*` agents this plugin ships |
| authoring a skill | the `manage_skill` tool | write `SKILL.md` with the file tools |

A personal claude code skill lands at `~/.claude/skills/<name>/SKILL.md`, a project one at
`.claude/skills/<name>/SKILL.md`.

The bar does not move with the harness: prove the change on the real surface at the head SHA, with your own
eyes on the evidence. Only the tool name changes.
