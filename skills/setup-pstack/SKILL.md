---
name: setup-pstack
description: Configure which models pstack's role agents use and at what reasoning budget. Detects the models this machine can actually spawn and writes the pstack-* entries into ~/.omp/agent/config.yml. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write the seven `pstack-*` entries in `~/.omp/agent/config.yml`: a `modelRoles` key holding the concrete selector, and a `task.agentModelOverrides` entry pointing the role agent at it. Those two keys decide which model each pstack worker runs on.

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

The role list and their intents are in step 5. If `~/.omp/agent/config.yml` already defines `modelRoles.pstack-*`, read those values and the `# pstack budget:` comment above them, and treat them as the current choices. Otherwise start from the defaults for each intent.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer `ask` over free text. Offer these four options with these exact labels, and name the current budget when the config records one.

- `unlimited — keep max`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** `unlimited` leaves every effort where it already is. `large`, `medium`, and `small` set the effort on every real selector to `xhigh`, `high`, or `medium`, panel entries included. The ladder is `off` < `minimal` < `low` < `medium` < `high` < `xhigh` < `max`. When the target level is not in that model's detected `thinking` array, take the highest detected level at or below the target. Never invent a level, and probe whatever you choose as step 1 describes. On a re-run, keep any role you changed by family.

**(c) Show the roles and confirm.** Show every role with its selector, marking any selector step 1 did not confirm as needing a choice. Ask whether to accept as-is or change specific roles, offering the detected selectors as the options. Prefer `ask` over free text. `pstack-panel-1` through `pstack-panel-4` are four independent roles and one `pstack-panel-<n>` agent runs per configured panel entry, so their values set how many models a review panel actually spans. Give them four different families when the account carries four. Collapsing them to fewer weakens the panel, so say so rather than letting it happen silently.

### 4. Validate

Every selector written must have passed step 1's probe, suffix included. Write a role bare when its suffixed form failed and the bare selector passed. If the bare selector failed too, stop and ask again.

### 5. Write the roles

Read `~/.omp/agent/config.yml`, replace the seven `modelRoles.pstack-*` keys and the seven `task.agentModelOverrides` entries named `pstack-*`, and write the file back.

Your write set is exactly those fourteen values. Everything else is out of scope, including anything that looks like it ought to be tidy:

- Other `modelRoles` keys (`advisor`, `task`, `smol`, …) keep their values.
- Other `agentModelOverrides` entries (`project-advisor`, …) keep theirs. Merge into the existing map, leave every sibling entry alone, and if `task.agentModelOverrides` is absent, create it holding the seven pstack entries and nothing more.
- Every other top-level block (`providers`, `theme`, `task.eager`, `compaction`, `retry`, …) is untouched, formatting and key order included. Don't reorder, re-indent, or normalize the file.
- Never copy a selector into an override entry for some *other* agent, and never add a `pstack-*` key beyond the seven.

Re-runs stay idempotent because you rewrite the same fourteen values.

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
```

Inside `agentModelOverrides` the value is the quoted alias `"@pstack-<role>"`, never the selector. The selector is written once, in `modelRoles`; putting it in the override too makes that copy win, so a later model change silently fails.

`<selector>` is a `provider/model-id` from step 1, carrying the level its probe accepted. Selectors are account-specific, so fill them from detection rather than copying an example.

With no override entry and no `modelRoles` key, a pstack worker runs on the session model. Remove a role's override entry along with its `modelRoles` key to stop overriding that role.

Role intents:

- `pstack-code`: your fastest strong code model. Serves feature, refactoring, bug-fix, perf-issue, and hillclimb work, swarm workers, how-explorers, and why-investigators.
- `pstack-judgment`: your strongest reasoning model. Serves judgment and prose, the hardest tasks, how-explainers, why-synthesizers, the reflect judgment, divergent, and synthesizer passes, and arena cross-judges.
- `pstack-tooling`: a strong model from a different family than judgment. Serves the reflect tooling lens, where a second family sees different problems.
- `pstack-panel-1` … `pstack-panel-4`: review-panel seats. Serve arena runners, architect runners, and interrogate reviewers, one agent per entry.

A project's `.omp/config.yml` model roles override the global ones inside that project, so a repo can pin its own pstack models. The `/model` command's Roles view writes the same global keys by hand.

### 6. Confirm

Re-read `~/.omp/agent/config.yml` and show the user the final `modelRoles.pstack-*` values as they now stand in the file. Confirm each `agentModelOverrides` value you wrote is the alias, and say so if one is not. Tell them the roles apply to new task dispatches, since dispatch reloads settings before it resolves an agent. Re-running this skill updates them.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with `/skill:create-verification-skill`." On yes, read `skill://create-verification-skill` and follow it (resolves wherever pstack is installed: project, user, or plugin). On no, move on without pushing.
