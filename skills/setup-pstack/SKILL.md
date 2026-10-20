---
name: setup-pstack
description: Configure which models pstack's role agents use and at what reasoning budget, whether agents keep a lesson memory across sessions, and whether this GitHub repo gets a /review workflow that reviews and approves PRs. Detects the models this machine can actually spawn and writes the pstack-* entries into the project's .omp/config.yml or the global ~/.omp/agent/config.yml, whichever the user picks. Use for /setup-pstack, "configure pstack models", "pstack budget", changing pstack's model choices, turning pstack memory on or off, or adding automated PR review and approval.
---

# Setup pstack

Write the eight `pstack-*` entries into one config file: a `modelRoles` key holding the concrete selector, and a `task.agentModelOverrides` entry pointing the role agent at it. Those two keys decide which model each pstack worker runs on. Step 3(a) asks whether that file is the project's `.omp/config.yml` or the global `~/.omp/agent/config.yml`; the project file only affects this repo, the global file affects every project on this machine.

## Steps

### 1. Detect available models

`omp models --json` is the dependable source. It lists every model this machine can spawn, each with `provider`, `id`, `selector`, `name`, `reasoning`, `thinking`, and `cost`. If the command is unavailable, ask the user to paste the selectors they have access to. Never write a selector that is not in that list.

**Probe the effort suffix separately.** A model's `thinking` array is catalog metadata, not a promise. `opencode-go/deepseek-v4.1-flash` advertises `low`, `high`, and `max` and rejects all three, while `anthropic/claude-fable-5` accepts `xhigh`. Only a spawn settles it:

```sh
for s in "anthropic/claude-fable-5:xhigh" "opencode-go/deepseek-v4.1-flash:max"; do
  omp --model "$s" -p --no-session ok >/dev/null 2>&1 && echo "OK   $s" || echo "FAIL $s"
done
```

`OK` means the selector resolves. On `FAIL`, drop the suffix and probe the bare selector. If the bare selector also fails, that model is not spawnable and the role needs another choice.

### 2. Load current state

The role list and their intents are in step 5. Check the project's `.omp/config.yml` first, then `~/.omp/agent/config.yml`. If either already defines `modelRoles.pstack-*`, read those values and the `# pstack budget:` comment above them, treat them as the current choices, and name which file they came from when you ask the scope question in step 3. Otherwise start from the defaults for each intent.

### 3. Scope, budget, map, and confirm

**(a) Ask for scope.** Prefer `ask` over free text. Offer these two options with these exact labels, and name whichever file step 2 found current values in as the default.

- `this project only — write .omp/config.yml` (recommended: leaves every other project's settings alone)
- `every project on this machine — write ~/.omp/agent/config.yml`

**(b) Ask for a budget.** Prefer `ask` over free text. Offer these four options with these exact labels, and name the current budget when the config records one.

- `unlimited — keep max`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(c) Apply it.** `unlimited` leaves every effort where it already is. `large`, `medium`, and `small` set the effort on every real selector to `xhigh`, `high`, or `medium`, panel entries included. `pstack-watch` is the exception: it always takes the account's cheapest fast model that can run shell (haiku-class) at `medium`, whatever the budget, because it mostly waits on a script. The ladder is `off` < `minimal` < `low` < `medium` < `high` < `xhigh` < `max`. When the target level is not in that model's detected `thinking` array, take the highest detected level at or below the target. Never invent a level, and probe whatever you choose as step 1 describes. On a re-run, keep any role you changed by family.

**(d) Show the roles and confirm.** Show every role with its selector, marking any selector step 1 did not confirm as needing a choice. Ask whether to accept as-is or change specific roles, offering the detected selectors as the options. Prefer `ask` over free text. `pstack-panel-1` through `pstack-panel-4` are four independent roles and one `pstack-panel-<n>` agent runs per configured panel entry, so their values set how many models a review panel actually spans. Give them four different families when the account carries four. Collapsing them to fewer weakens the panel, so say so rather than letting it happen silently.

### 4. Validate

Every selector written must have passed step 1's probe, suffix included. Write a role bare when its suffixed form failed and the bare selector passed. If the bare selector failed too, stop and ask again.

### 5. Write the roles

Read the file step 3(a) chose, the project's `.omp/config.yml` or the global `~/.omp/agent/config.yml`, replace the eight `modelRoles.pstack-*` keys and the eight `task.agentModelOverrides` entries named `pstack-*`, and write the file back. Create the file, and the `.omp/` directory, if the project scope was chosen and neither exists yet.

Your write set is exactly those sixteen values, plus the two memory keys only when the user says yes in step 8(c). Everything else is out of scope, including anything that looks like it ought to be tidy:

- Other `modelRoles` keys (`advisor`, `task`, `smol`, …) keep their values.
- Other `agentModelOverrides` entries (`project-advisor`, …) keep theirs. Merge into the existing map, leave every sibling entry alone, and if `task.agentModelOverrides` is absent, create it holding the eight pstack entries and nothing more.
- Every other top-level block (`providers`, `theme`, `task.eager`, `compaction`, `retry`, …) is untouched, formatting and key order included. Don't reorder, re-indent, or normalize the file.
- Never copy a selector into an override entry for some *other* agent, and never add a `pstack-*` key beyond the eight.

Re-runs stay idempotent because you rewrite the same sixteen values.

Both blocks are needed. An agent installed from a marketplace does not get its frontmatter `model` applied, so the settings-level override is what actually routes it, and its alias resolves through `modelRoles`. That keeps each concrete selector in exactly one place.

```yaml
modelRoles:
  # every existing role (advisor, smol, slow, task, …) is left untouched
  # pstack budget: large (xhigh)
  pstack-code: <selector>:xhigh
  pstack-judgment: <selector>:xhigh
  pstack-tooling: <selector>:xhigh
  pstack-panel-1: <selector>:xhigh
  pstack-panel-2: <selector>:xhigh
  pstack-panel-3: <selector>:xhigh
  pstack-panel-4: <selector>:xhigh
  pstack-watch: <cheapest-fast-selector>:medium
task:
  # every existing task setting and override entry is left untouched
  agentModelOverrides:
    pstack-code: "@pstack-code"
    pstack-judgment: "@pstack-judgment"
    pstack-tooling: "@pstack-tooling"
    pstack-panel-1: "@pstack-panel-1"
    pstack-panel-2: "@pstack-panel-2"
    pstack-panel-3: "@pstack-panel-3"
    pstack-panel-4: "@pstack-panel-4"
    pstack-watch: "@pstack-watch"
```

Inside `agentModelOverrides` the value is the quoted alias `"@pstack-<role>"`, never the selector. The selector is written once, in `modelRoles`; putting it in the override too makes that copy win, so a later model change silently fails.

`<selector>` is a `provider/model-id` from step 1, carrying the level its probe accepted. Selectors are account-specific, so fill them from detection rather than copying an example.

With no override entry and no `modelRoles` key, a pstack worker runs on the session model. Remove a role's override entry along with its `modelRoles` key to stop overriding that role.

Role intents:

- `pstack-code`: your fastest strong code model. Serves feature, refactoring, bug-fix, perf-issue, and hillclimb work, swarm workers, how-explorers, and why-investigators.
- `pstack-judgment`: your strongest reasoning model. Serves judgment and prose, the hardest tasks, how-explainers, why-synthesizers, the reflect judgment, divergent, and synthesizer passes, and arena cross-judges.
- `pstack-tooling`: a strong model from a different family than judgment. Serves the reflect tooling lens, where a second family sees different problems.
- `pstack-panel-1` … `pstack-panel-4`: review-panel seats. Serve arena runners, architect runners, and interrogate reviewers, one agent per entry.
- `pstack-watch`: your cheapest fast model that can run shell (haiku-class), at `medium` (or `low`) thinking regardless of budget. Serves the PR watcher: it runs the watch script, reads CI logs, and returns short status reports.

A project's `.omp/config.yml` model roles override the global ones inside that project, so a repo can pin its own pstack models; step 3(a) is what picks which file this skill writes. The `/model` command's Roles view always writes the global keys, by hand.

### 6. Confirm

Re-read the file you wrote and show the user the final `modelRoles.pstack-*` values as they now stand in it, naming the file's path. Confirm each `agentModelOverrides` value you wrote is the alias, and say so if one is not. Tell them the roles apply to new task dispatches, since dispatch reloads settings before it resolves an agent. Re-running this skill updates them.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with `/skill:create-verification-skill`." On yes, read `skill://create-verification-skill` and follow it (resolves wherever pstack is installed: project, user, or plugin). On no, move on without pushing.

### 8. Lesson memory

Agents can keep lessons across sessions: verified root causes from bug fixes, and the gaps users corrected during ticket intake (the **lessons** skill). The user decides. Never turn it on, and never pick where lessons go, without an answer. Prefer `ask` over free text, and run `node skill://lessons/scripts/lessons.mjs config` first so you can name the current choice as the default.

**(a) Turn it on?** Offer these three options with these exact labels. Default to `off` when `config` reports no source.

- `on for this project`
- `on for every project on this machine`
- `off`

**(b) Where do this project's lessons go?** Ask only when (a) is on.

- `local — stays on this machine` (`.pstack/lessons.local.jsonl`, git-excluded)
- `remote — committed with the repo and shared with the team` (`.pstack/lessons.jsonl`, reaches the git remote through PRs, and the agent shows each diff before staging it)

Global lessons, such as standing preferences, always stay in `~/.pstack/` on this machine.

Write the answer with `configure`. `on for this project` and `off` write the project config. `on for every project` writes the global config:

```sh
node skill://lessons/scripts/lessons.mjs configure --where project --enabled true --project-store local
node skill://lessons/scripts/lessons.mjs configure --where global --enabled true --project-store remote
node skill://lessons/scripts/lessons.mjs configure --where project --enabled false
```

A project config overrides the global one, so `off` here wins inside this repo even when another project turned memory on for the machine. Re-running setup changes the choice. Switching stores moves nothing. Old lessons stay readable from both files, and new ones go to the chosen store. If the user goes from `remote` to `local`, ask before deleting the committed `.pstack/lessons.jsonl`, because the team reads it.

**(c) omp's own memory (omp only).** When (a) is on, offer once to also turn on omp's built-in session memory, which learns untyped facts from past sessions in the background. Tell the user what it costs before they answer. At session start it sends each finished session to the `default` model role (up to 4000 input tokens each, at most 64 sessions per startup) and consolidates with the `smol` role, and it injects up to 5000 tokens of summary into every system prompt, subagents included. pstack lessons cost nothing until a playbook step runs `match`. On yes, set `memory.backend: local` and `autolearn.enabled: true` in the file step 3(a) chose, leaving every other key as step 5 describes. On no, write nothing. pstack lessons work either way.

Confirm by running `config` again and showing the user what it reports.

### 9. Automated PR review (GitHub only)

Run `node skill://setup-pstack/scripts/pr-review.mjs detect`. When it reports `github: false`, skip this step without mentioning it.

**(a) Ask.** Before asking, say what it installs. A collaborator or the PR author comments `/review` on a pull request. A GitHub Agentic Workflow (`gh aw`) reviews the diff and CI results read-only, then submits `APPROVE` or `REQUEST_CHANGES` as `github-actions[bot]` with a short verdict comment. Approval adds `ready-for-merge` and undrafts the PR. A failed run posts a comment asking for a new `/review`. Name the risk too. The bot's approval counts toward required reviews, so anyone who can push a branch to this repo can get their own PR approved.

Prefer `ask`. Offer these options with these exact labels. Default to the engine `detect` reports under `installed`, or to `no` when nothing is installed.

- `yes — Copilot engine` (no secret: it bills the repo's Copilot plan through the workflow token)
- `yes — Claude engine` (needs an `ANTHROPIC_API_KEY` repo secret)
- `no`

An answer may also name a model or a trigger word, for example "copilot, gpt-5.6-luna, /ai-review". Pass those as `--model` and `--command`. Without them the engine's default model and `/review` apply.

When `detect` lists `conflicts`, another workflow already answers that trigger. Name the files and recommend `no` or a different `--command`. Two reviewers on one trigger approve twice.

**(b) Install.** Run `node skill://setup-pstack/scripts/pr-review.mjs install --engine <copilot|claude> [--model <id>] [--command <word>]`. It installs the `gh aw` extension when missing, writes `.github/workflows/pr-review.md` and `pr-review-status.yml`, compiles the lock file, and turns on the repo setting that lets GitHub Actions approve pull requests. Re-running rewrites the same files, so it also changes the engine, model, or trigger. Then report what it returned:

- `canApproveError` means an organization policy blocks Actions from approving. An org owner must allow it under the org's Settings → Actions → General. Until then the review runs but cannot approve.
- `missingSecrets` lists groups of alternatives, and one secret per group is enough. Tell the user to run `gh aw secrets bootstrap` or `gh secret set <NAME>` in their own terminal. Never ask for a secret value or pass one through the chat.

**(c) Land it.** The workflow fires only from the default branch. Commit the returned `files` on a new branch and open a ready PR. Tell the user the review reads `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `.github/copilot-instructions.md`, and `.github/instructions/*.instructions.md` when present. Repo-specific review rules go in `.github/review-rules.md`, which needs no recompile.

`no` writes nothing. If the workflow is already installed, leave it and name the removal: `gh aw remove pr-review`, then delete `.github/workflows/pr-review-status.yml`.
