---
name: setup-pstack
description: Configure which models pstack's role agents use and at what reasoning budget, and whether agents keep a lesson memory across sessions. Detects the models this machine can actually spawn and writes the pstack-* entries into the project's .omp/config.yml or the global ~/.omp/agent/config.yml, whichever the user picks. Use for /setup-pstack, "configure pstack models", "pstack budget", changing pstack's model choices, or turning pstack memory on or off.
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

The role list and their intents are in step 5. Check the project's `.omp/config.yml` first, then `~/.omp/agent/config.yml`. If either already defines `modelRoles.pstack-*`, read those values and the `# pstack budget:` comment above them, treat them as the current choices, and name which file they came from when you ask the scope question in step 3. Otherwise start from the defaults for each intent. Also run `node skill://lessons/scripts/lessons.mjs config` and keep its `enabled`, `projectStore`, and `source` as the current lesson-memory choice.

### 3. Scope, budget, memory, map, and confirm

Ask (a), (b), (c), and (d) together in one `ask` call, as four questions in one batch, so the user sees every setup choice at once. Never move a question to the end of the run or leave one out.

**(a) Ask for scope.** Offer these two options with these exact labels, and name whichever file step 2 found current values in as the default.

- `this project only — write .omp/config.yml` (recommended: leaves every other project's settings alone)
- `every project on this machine — write ~/.omp/agent/config.yml`

**(b) Ask for a budget.** Offer these four options with these exact labels, and name the current budget when the config records one.

- `unlimited — keep max`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(c) Ask about lesson memory.** Agents can keep lessons across sessions: verified root causes from bug fixes, and the gaps users corrected during ticket intake (the **lessons** skill). The user decides whether it is on and where project lessons go. Never pick for them. Offer these five options with these exact labels, and name the current choice from step 2 as the default, or `off` when `config` reported no source.

- `off`
- `this project, local — lessons stay on this machine` (`.pstack/lessons.local.jsonl`, git-excluded)
- `this project, remote — lessons are committed and shared with the team` (`.pstack/lessons.jsonl`, reaches the git remote through PRs, and the agent shows each diff before staging it)
- `every project, local`
- `every project, remote`

Global lessons, such as standing preferences, always stay in `~/.pstack/` on this machine.

**(d) Ask about omp's own memory (omp only).** omp has a built-in session memory that learns untyped facts from past sessions in the background. State its cost in the question. At session start it sends each finished session to the `default` model role (up to 4000 input tokens each, at most 64 sessions per startup), consolidates with the `smol` role, and injects up to 5000 tokens of summary into every system prompt, subagents included. pstack lessons cost nothing until a playbook step runs `match`. Offer `no` (the default) and `yes`. Ignore the answer when (c) is `off`.

**(e) Apply it.** `unlimited` leaves every effort where it already is. `large`, `medium`, and `small` set the effort on every real selector to `xhigh`, `high`, or `medium`, panel entries included. `pstack-watch` is the exception: it always takes the account's cheapest fast model that can run shell (haiku-class) at `medium`, whatever the budget, because it mostly waits on a script. The ladder is `off` < `minimal` < `low` < `medium` < `high` < `xhigh` < `max`. When the target level is not in that model's detected `thinking` array, take the highest detected level at or below the target. Never invent a level, and probe whatever you choose as step 1 describes. On a re-run, keep any role you changed by family.

**(f) Show the roles and confirm.** Show every role with its selector, marking any selector step 1 did not confirm as needing a choice. Ask whether to accept as-is or change specific roles, offering the detected selectors as the options. Prefer `ask` over free text. `pstack-panel-1` through `pstack-panel-4` are four independent roles and one `pstack-panel-<n>` agent runs per configured panel entry, so their values set how many models a review panel actually spans. Give them four different families when the account carries four. Collapsing them to fewer weakens the panel, so say so rather than letting it happen silently.

### 4. Validate

Every selector written must have passed step 1's probe, suffix included. Write a role bare when its suffixed form failed and the bare selector passed. If the bare selector failed too, stop and ask again.

### 5. Write the roles

Read the file step 3(a) chose, the project's `.omp/config.yml` or the global `~/.omp/agent/config.yml`, replace the eight `modelRoles.pstack-*` keys and the eight `task.agentModelOverrides` entries named `pstack-*`, and write the file back. Create the file, and the `.omp/` directory, if the project scope was chosen and neither exists yet.

Your write set is exactly those sixteen values, plus `memory.backend: local` and `autolearn.enabled: true` only when the user said `yes` in step 3(d) and (c) is not `off`. Everything else is out of scope, including anything that looks like it ought to be tidy:

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

**Write the lesson-memory choice from step 3(c).** `off` and the `this project` options write the project config. The `every project` options write the global config:

```sh
node skill://lessons/scripts/lessons.mjs configure --where project --enabled false
node skill://lessons/scripts/lessons.mjs configure --where project --enabled true --project-store local
node skill://lessons/scripts/lessons.mjs configure --where global --enabled true --project-store remote
```

A project config overrides the global one, so `off` wins inside this repo even when another project turned memory on for the machine. Switching stores moves nothing. Old lessons stay readable from both files, and new ones go to the chosen store. If the user goes from `remote` to `local`, ask before deleting the committed `.pstack/lessons.jsonl`, because the team reads it.

### 6. Confirm

Re-read the file you wrote and show the user the final `modelRoles.pstack-*` values as they now stand in it, naming the file's path. Confirm each `agentModelOverrides` value you wrote is the alias, and say so if one is not. Tell them the roles apply to new task dispatches, since dispatch reloads settings before it resolves an agent. Re-running this skill updates them. Run `lessons.mjs config` again and show what it reports for lesson memory.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with `/skill:create-verification-skill`." On yes, read `skill://create-verification-skill` and follow it (resolves wherever pstack is installed: project, user, or plugin). On no, move on without pushing.
