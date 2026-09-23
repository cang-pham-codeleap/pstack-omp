# pstack contributor rules

This repo is one plugin for two harnesses: omp (oh-my-pi) and Claude Code. Full comparison: [docs/guide/11-omp-and-claude-code.md](docs/guide/11-omp-and-claude-code.md).

- `skills/` is shared. Write skill text in omp syntax (`skill://`, `task`, `/skill:<name>`). Any new omp-only term (tool, path, config key) gets a row in `claude/harness-map.md` in the same change.
- Agents live twice: `agents/` (omp, `model: "@pstack-<role>, @task"`) and `claude/agents/` (Claude Code, lowercase-hyphen `name`, Claude `model`). Change both, and list new files in `.claude-plugin/plugin.json` `agents`.
- `.omp-plugin/plugin.json` must exist and carry no Claude Code path fields. Its presence stops omp from reading `.claude-plugin/plugin.json`.
- Hooks don't cross over: `hooks/hooks.json` is Claude Code only; omp hooks are TS in `hooks/pre|post/`.
- Keep `version` in step across both `plugin.json` and both `marketplace.json`.
- Verify with `claude plugin validate .` plus `claude --plugin-dir .` and `omp --plugin-dir .`.
