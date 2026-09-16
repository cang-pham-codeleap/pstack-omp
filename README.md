# pstack

> a community port of [cursor/plugins#pstack](https://github.com/cursor/plugins/tree/main/pstack) to [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`). the skills, playbooks, principles, and prose are [poteto](https://x.com/poteto)'s work, MIT licensed. this port rewrites the cursor-specific mechanics into omp's: `task` role agents instead of `subagent_type` plus per-spawn models, `modelRoles.pstack-*` with matching `task.agentModelOverrides` entries in `~/.omp/agent/config.yml` instead of a cursor rules file, and omp's `browser` / `hub` PTY tools instead of `cursor-team-kit`. [not shipped here](#not-shipped-here) lists what did not come across.

this repo forks [poteto](https://x.com/poteto)'s pstack workflow. poteto is a developer at SpaceX who once shipped 800 PRs in half a month.

there's a growing sense that ai writes too much slop code. poteto agrees. poteto doesn't want to ship like a team of twenty slop artists. throughput without quality is not a goal poteto aspires to. if you want to go fast, go deep first.

**pstack is poteto's answer.** these are the same skills poteto uses everyday to ship high quality code. this turns omp into a real engineering team. the goal is not to maximize loc, in fact it's the opposite. pstack helps you write less, but higher quality code.

**pstack gives you fearless parallelism.** when you can go deep on one agent and trust it to write good, verifiable code, you can truly parallelize with confidence. start multiple agents up with `poteto-mode` and trust that they'll apply rigorous engineering principles to their work.

**omp gives you the best of all worlds.** every frontier model has its strengths and weaknesses. use any model with pstack. in fact, many of poteto's skills use multi-model workflows to take advantage of each model's unique strengths.

fork it. improve it. make it yours. PRs are welcome! 

## install

```bash
omp plugin marketplace add cang-pham-codeleap/pstack-omp
omp plugin install --scope user pstack@pstack-omp
```

discovery happens at session start, so start a new session after installing or run `/reload-plugins` in the one you're in. skill commands are `/skill:<name>` when `skills.enableSkillCommands` is on; reading `skill://<name>` works either way.

## get started

two steps:

1. run [`/skill:setup-pstack`](./skills/setup-pstack/SKILL.md), pick a reasoning budget, and choose which models you want.
2. use [`/skill:poteto-mode`](./skills/poteto-mode/SKILL.md) whenever you're doing anything that requires rigor.

new here? the [pstack guide](./docs/guide/README.md) walks you through a first real task, from setup and prompting through verification and overnight runs.

that's it. the other skills are situational; the mode skill uses them for you as needed. out of the box the mode splits work by role: code delegates (feature, refactoring, bug fix, perf, hillclimb) spawn `pstack-code`, while the hardest changes, prose, and judgment spawn `pstack-judgment`. review panels fan out one `pstack-panel-1` through `pstack-panel-4` agent per configured entry. each role's model comes from the seven `pstack-*` entries in `~/.omp/agent/config.yml`, and runs on your session model until you point it elsewhere. [`/skill:setup-pstack`](./skills/setup-pstack/SKILL.md) changes any of it.

## usage

use [`/skill:poteto-mode`](./skills/poteto-mode/SKILL.md) at the start of a task. it reads your request, picks from a set of playbooks, and runs the other skills as the steps need them.

### just use [`/skill:poteto-mode`](./skills/poteto-mode/SKILL.md)

this skill is the main shortcut. poteto uses it whenever poteto needs the agent to do rigorous engineering work. it comes with twenty-three playbooks:

```
/skill:poteto-mode this pr has a subtle bug where the scroll drifts every 750ms even when idle. repro
first, then fix and verify.
```

```
/skill:poteto-mode i'm going to bed. land the stack even if ci flakes. i want everything merged by
morning.
```

<details>
<summary>the twenty-three playbooks</summary>

| playbook | for |
|---|---|
| [investigation](./skills/poteto-mode/playbooks/investigation.md) | a read-only question. how does x work, why was y built this way, are we sure. |
| [bug fix](./skills/poteto-mode/playbooks/bug-fix.md) | reproduce a defect, root-cause it, and fix with runtime evidence. |
| [perf](./skills/poteto-mode/playbooks/perf-issue.md) | trace a measured slowness and improve it against a baseline. |
| [hillclimb](./skills/poteto-mode/playbooks/hillclimb.md) | sustained, scientific improvement of one metric against a target, looping hypotheses with before/after measurement and one commit per accepted win. |
| [runtime forensics](./skills/poteto-mode/playbooks/runtime-forensics.md) | diagnose a live symptom (leak, idle-cpu spin, glitch) from instrumentation. |
| [trace forensics](./skills/poteto-mode/playbooks/trace-forensics.md) | diagnose a captured profiling artifact (cpuprofile, trace, spindump, heap snapshot). |
| [feature](./skills/poteto-mode/playbooks/feature.md) | new or changed behavior, built from a named data shape. |
| [refactoring](./skills/poteto-mode/playbooks/refactoring.md) | a behavior-preserving change to structure or shape. |
| [prototype](./skills/poteto-mode/playbooks/prototype.md) | a throwaway sketch to make a design or behavioral decision cheaply, or to settle an empirical fork by observing it. |
| [visual parity](./skills/poteto-mode/playbooks/visual-parity.md) | pixel-exact ui equivalence between two implementations. |
| [authoring a skill](./skills/poteto-mode/playbooks/authoring-a-skill.md) | writing or editing a SKILL.md. |
| [eval](./skills/poteto-mode/playbooks/eval.md) | test how a skill or prompt change affects agent behavior, blinded. |
| [babysit](./skills/poteto-mode/playbooks/babysit.md) | drive a pr or a stack to merge-ready: conflicts, review threads, ci. |
| [shipping](./skills/poteto-mode/playbooks/shipping.md) | independently verify a green stack, then land the contiguous verified run bottom-up through github by default or origin when available. |
| [autonomous run](./skills/poteto-mode/playbooks/autonomous-run.md) | drive a long task to completion without stopping. |
| [orchestrate](./skills/poteto-mode/playbooks/orchestrate.md) | a standing project handed to one coordinator chat: multi-day, many stacked prs, fleets of subagents. |
| [autopilot-full](./skills/poteto-mode/playbooks/autopilot-full.md) | run independent prs to merged with one owner per pr and root verification of each merge-ready head. |
| [autopilot-stack](./skills/poteto-mode/playbooks/autopilot-stack.md) | build and verify one linear base-branch stack for the operator to review and land. |
| [session pickup](./skills/poteto-mode/playbooks/session-pickup.md) | resume or take over a prior agent's in-flight work. |
| [pause safely](./skills/poteto-mode/playbooks/pause-safely.md) | suspend in-flight work cleanly so it can be resumed later. |
| [multi-phase plan](./skills/poteto-mode/playbooks/multi-phase-plan.md) | work that spans phases or stacked PRs. |
| [worktree cleanup](./skills/poteto-mode/playbooks/worktree-cleanup.md) | reclaim disk by pruning merged or abandoned worktrees and stale ios simulators, safety-gated. |
| [opening a pr](./skills/poteto-mode/playbooks/opening-a-pr.md) | open a ready pr from small ordered commits with a conventional commits title and a briefing-style body. invoked at the end of every playbook that lands a diff. |

</details>



when invoked it:

1. matches your task to a [playbook](./skills/poteto-mode/playbooks/) and opens a todo list whose first items are its steps, copied in verbatim.
2. routes to the other skills as the steps fire.
3. writes unslopped replies framed for the consumer and the maintainer.

the full rules and playbooks live in [`skills/poteto-mode/SKILL.md`](./skills/poteto-mode/SKILL.md).

[`/skill:poteto-mode`](./skills/poteto-mode/SKILL.md) is also a sticky mode: once entered it stays on across turns, applying itself when a playbook matches or the task needs rigor and staying out of the way otherwise. opt out any time by saying so.

[`/skill:poteto-mode`](./skills/poteto-mode/SKILL.md) works extremely well for long runs: drive it with a long-running background `task` agent and re-check the finish condition on a heartbeat (`hub wait` / `hub jobs`), so you can make omp work for many hours without sacrificing rigor.

## skills

[`/skill:poteto-mode`](./skills/poteto-mode/SKILL.md) runs most of these for you when a step needs them (`how`, `why`, `architect`, `arena`, `swarm`, `interrogate`, `unslop`, `no-comments`, `technical-writing`, `tdd`, and the principles). the table below is for when you want one directly:

```
/skill:how do we cancel runs? do we have an n+1 when we look up every run to cancel?
```

```
/skill:interrogate review this pr.
```

<details>
<summary>all skills</summary>

| skill | use it when |
|---|---|
| [`/skill:poteto-mode`](./skills/poteto-mode/SKILL.md) | default entry point for any non-trivial task. |
| [`/skill:how`](./skills/how/SKILL.md) | you want a walkthrough of how a subsystem works. |
| [`/skill:why`](./skills/why/SKILL.md) | you want to know why something was built this way. discovers available MCPs at run time and queries each evidence category in parallel (source control, issue tracker, long-form docs, real-time chat, infra observability, error tracking, analytics warehouse). |
| [`/skill:recall`](./skills/recall/SKILL.md) | you're starting or resuming work and want your recent context on a topic rebuilt from your own chat history and the shared record, handed back as a tight current-state brief. |
| [`/skill:blast-radius`](./skills/blast-radius/SKILL.md) | you have a small-looking change and want to know what else it could break, with the one fact it's safe because of proven by running code, not asserted. |
| [`/skill:architect`](./skills/architect/SKILL.md) | you're about to write code that crosses a function boundary and want the caller's usage, types, and module shape settled first. |
| [`/skill:arena`](./skills/arena/SKILL.md) | you want N parallel attempts at the same thing, then to grab the best parts of each. |
| [`/skill:swarm`](./skills/swarm/SKILL.md) | you want N parallel workers across different slices or races, then one aggregated report. |
| [`/skill:interrogate`](./skills/interrogate/SKILL.md) | you have a diff and want several different models to try to break it, including a strict code-quality lens. |
| [`/skill:automate-me`](./skills/automate-me/SKILL.md) | you want your own `-mode` skill, drafted from how you've actually worked. |
| [`/skill:setup-pstack`](./skills/setup-pstack/SKILL.md) | you want to pick which models pstack uses per role. probes what this machine can spawn and merges the seven `pstack-code`, `pstack-judgment`, `pstack-tooling`, and `pstack-panel-1..4` entries into `~/.omp/agent/config.yml`'s `modelRoles` and `task.agentModelOverrides`, leaving every other key untouched. |
| [`/skill:reflect`](./skills/reflect/SKILL.md) | a long task landed and you want the recipe captured as a skill edit. |
| [`/skill:teach`](./skills/teach/SKILL.md) | you want to actually understand a change or subsystem, not just have it summarized. runs how + why and weaves one plain explanation, built up diagram by diagram. |
| [`/skill:tdd`](./skills/tdd/SKILL.md) | you're fixing a bug and there's a cheap local test path. write the failing test first, then the fix. |
| [`/skill:no-comments`](./skills/no-comments/SKILL.md) | strip comments before review; spawns Comment Sicko, fixes accepted findings, offers encodings for claimed constraints. |
| [`/skill:typescript-best-practices`](./skills/typescript-best-practices/SKILL.md) | you're reading or editing typescript. grounds the type-system-discipline principle in syntax. |
| [`/skill:figure-it-out`](./skills/figure-it-out/SKILL.md) | no bundled playbook fits. designs a rigorous, auditable playbook for the task. |
| [`/skill:show-me-your-work`](./skills/show-me-your-work/SKILL.md) | you want a reviewable decision trail. logs decisions to a tsv you can commit. |
| [`/skill:create-verification-skill`](./skills/create-verification-skill/SKILL.md) | your project has no scripted way to prove app behavior. generates a project-local verify skill with a feature map, for any language or platform. |
| [`/skill:maintain-verification-skill`](./skills/maintain-verification-skill/SKILL.md) | your verify skill's feature map has drifted from the app. source wave + one live pass, at most one PR of proven corrections. |
| [`/skill:unslop`](./skills/unslop/SKILL.md) | you're cleaning up writing. removes AI tells. |
| [`/skill:bro`](./skills/bro/SKILL.md) | you want the last message restated in plain human language, no jargon. |
| [`/skill:technical-writing`](./skills/technical-writing/SKILL.md) | layered doc standard (Diátaxis + Google developer style + STE + Global English) for docs, RFCs, readmes, PR descriptions, commit messages. |

</details>



### examples

mostly poteto types [`/skill:poteto-mode`](./skills/poteto-mode/SKILL.md) at the start of a task and lets it route to a playbook. the other skills fire as the steps need them. a few poteto reaches for directly.


<details>
<summary>all the examples</summary>

```
bug fix:           /skill:poteto-mode this pr has a subtle bug where the scroll drifts every 750ms even
                   when idle. repro first, then fix and verify.
perf:              /skill:poteto-mode a big list takes a second or two to load even though we virtualize.
                   run a cpu trace and tell me why.
feature:           /skill:poteto-mode build a small feature behind a feature flag. verify it really works.
prototype:         /skill:poteto-mode build two prototypes of the markdown renderer so we can compare.
                   spawn an agent for each.
multi-phase:       /skill:poteto-mode open source these skills as a plugin. nothing internal leaks, work
                   in a temp dir, show me the dependency graph first.
overnight run:     /skill:poteto-mode i'm going to bed. land the stack even if ci flakes. i want
                   everything merged by morning.
babysit:           /skill:poteto-mode check on pr 123. anything outstanding?
visual parity:     /skill:poteto-mode the row spacing is too tall when this flag is on. the second image
                   is correct. repro and fix until it matches.
figure it out:     /skill:poteto-mode i'm stepping away. migrate every caller from the synchronous store
                   to the new async one, keeping behavior identical. i want to trust it was done
                   right when i'm back.
how:               /skill:how do we cancel runs? do we have an n+1 when we look up every run to cancel?
why:               /skill:why is this feature flag not on yet?
architect:         design this instrumentation to be high signal with no false positives. /skill:architect
                   this first.
arena:             /skill:arena take my prompt to the arena verbatim. i want to compare their proposals
                   with yours.
swarm:             /skill:swarm check every package under packages/ against its check.sh. one worker per
                   package. one report.
interrogate:       /skill:interrogate review this pr.
tdd:               /skill:tdd implement
unslop:            can we unslop and tighten the new changes?
reflect:           /skill:reflect that took too long. capture what we learned so the next run doesn't
                   repeat it.
show-me-your-work: /skill:show-me-your-work keep a decision trail i can review when i'm back.
automate-me:       /skill:automate-me
```

</details>

## the `poteto-agent` and Comment Sicko subagents

pstack also ships a subagent that runs poteto's style end to end. spawn it from a parent agent with the `task` tool as [`agent: "poteto-agent"`](./agents/poteto-agent.md). it reads `poteto-mode` in full, including its inline principles index, before doing any work. reach for it when a step names no agent. the seven `pstack-*` role agents are model carriers and don't read the skill, so a step that names one carries the scope its delegate needs.

[`/skill:poteto-mode`](./skills/poteto-mode/SKILL.md) and [`agent: "poteto-agent"`](./agents/poteto-agent.md) route through the same wrapper.

pstack also ships [Comment Sicko](./agents/comment-sicko.md), a read-only comment reviewer you spawn with the `task` tool as `agent: "Comment Sicko"`. usually invoke it through [`/skill:no-comments`](./skills/no-comments/SKILL.md), not directly.

## principles

twenty-three short skills, one principle each. `poteto-mode` indexes them inline and reads that index at task start. the standalone files are there so other skills can reference a principle by name, and so the index can point at the full rule for each.

<details>
<summary>all twenty-three principles</summary>

| principle | group | rule |
|---|---|---|
| [laziness-protocol](./skills/principle-laziness-protocol/SKILL.md) | core | Bias toward deletion and the smallest change that solves the problem. |
| [foundational-thinking](./skills/principle-foundational-thinking/SKILL.md) | core | Apply before writing logic: choosing core types and data structures, sequencing scaffold-vs-feature work, asking what concurrent actors share. Get the data structures right so downstream code becomes obvious. |
| [redesign-from-first-principles](./skills/principle-redesign-from-first-principles/SKILL.md) | core | Redesign as if the requirement had been a foundational assumption from day one, instead of bolting it on. |
| [attack-the-premise](./skills/principle-attack-the-premise/SKILL.md) | core | Apply when two or more fixes that share one premise have failed the same gate. Take a census of which actors hold the imbalance before the next fix, then question the premise instead of writing another fix that assumes it. |
| [subtract-before-you-add](./skills/principle-subtract-before-you-add/SKILL.md) | core | Remove dead weight, redundant validators, and stub references first, then build on the simpler base. |
| [minimize-reader-load](./skills/principle-minimize-reader-load/SKILL.md) | core | Count layers between question and answer, and hidden state in the reader's head; collapse one-caller wrappers and shrink mutable scope. |
| [outcome-oriented-execution](./skills/principle-outcome-oriented-execution/SKILL.md) | core | Apply during planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture; don't preserve smooth intermediate states with throwaway compatibility code. |
| [experience-first](./skills/principle-experience-first/SKILL.md) | core | Choose user delight over implementation convenience; ship fewer polished features over more rough ones. |
| [exhaust-the-design-space](./skills/principle-exhaust-the-design-space/SKILL.md) | core | Build 2-3 competing prototypes and compare side by side before committing. |
| [build-the-lever](./skills/principle-build-the-lever/SKILL.md) | core | Apply to any non-trivial work, not just bulk work: edits, migrations, analyses, checks. Build the tool that does it or proves it (codemod, script, generator, or a skill your subagents follow) instead of working by hand. The tool is the artifact a reviewer can rerun. |
| [model-the-domain](./skills/principle-model-the-domain/SKILL.md) | architecture | Encode the domain in a structure instead of scattered conditionals. |
| [boundary-discipline](./skills/principle-boundary-discipline/SKILL.md) | architecture | Concentrate guards at system boundaries (CLI, config, network, external APIs); trust internal types and keep business logic in pure functions. |
| [type-system-discipline](./skills/principle-type-system-discipline/SKILL.md) | architecture | Make illegal states unrepresentable, brand semantic primitives, parse external data at boundaries, refuse to lie to the compiler, exhaust variants, derive from authoritative schemas. |
| [make-operations-idempotent](./skills/principle-make-operations-idempotent/SKILL.md) | architecture | Converge to the same end state regardless of partial prior runs. |
| [migrate-callers-then-delete-legacy-apis](./skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md) | architecture | Migrate callers and delete the old API in the same wave instead of preserving compatibility layers. |
| [separate-before-serializing-shared-state](./skills/principle-separate-before-serializing-shared-state/SKILL.md) | architecture | Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant. |
| [prove-it-works](./skills/principle-prove-it-works/SKILL.md) | verification | Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.'. |
| [fix-root-causes](./skills/principle-fix-root-causes/SKILL.md) | verification | Trace each symptom to its root cause and fix it there; reproduce first, ask why until you reach it, resist nil-check guards that silence crashes. |
| [sequence-verifiable-units](./skills/principle-sequence-verifiable-units/SKILL.md) | verification | Apply to multi-step work (sweeps, migrations, runs of similar edits) and to how you stack commits and PRs. Break work into small units that each end in a verifiable state, check each before the next, and order delivery so the sequence proves itself to a reviewer. |
| [test-behavior-not-implementation](./skills/principle-test-behavior-not-implementation/SKILL.md) | verification | Apply when you write, change, or keep a test. Call the code the way its users do and assert the result they observe against a literal expected value. If the test would still pass when every imported function returns undefined, rewrite the assertion or delete the test. |
| [guard-the-context-window](./skills/principle-guard-the-context-window/SKILL.md) | delegation | Route bulk to subagents; keep summaries in the main thread, not raw payloads. |
| [never-block-on-the-human](./skills/principle-never-block-on-the-human/SKILL.md) | delegation | Proceed, present the result, let the human course-correct after the fact; reserve confirmation for irreversible actions. |
| [encode-lessons-in-structure](./skills/principle-encode-lessons-in-structure/SKILL.md) | meta | Encode the rule as a lint, metadata flag, runtime check, or script instead of more text. |

</details>

## not shipped here

a few things `poteto-mode` references but doesn't bundle:

- `benny`, the automation pack, triages slack issue reports and fixes confirmed bugs with real ui evidence, but it isn't bundled: it hard-depends on a hosted automations runtime and a project layout omp doesn't have.
- `make-bot-ui` isn't bundled either: it targets hosted cloud-agent routines (`update_state`, `SendToUser`, hosted webhook urls).
- there's no `deslop`, `control-cli`, or `control-ui` here. the slop sweep is pstack's own: [no-comments](./skills/no-comments/SKILL.md) over comments plus dead weight deleted per [principle-subtract-before-you-add](./skills/principle-subtract-before-you-add/SKILL.md). browser, Electron, and web work uses omp's `browser` tool, and CLIs and TUIs run as a `hub` pty process.
- authoring a skill is omp's `manage_skill` tool, not a bundled slash command.
- the PR watcher in `skills/poteto-mode/scripts/watch-pr/` detects github-hosted review-automation comments by their github author logins, and the playbooks take an `origin` forge cli when `command -v origin` succeeds, defaulting to `gh`.

## why are there no planning skills?

omp already has a great plan mode which works great with pstack. but personally, poteto doesn't believe in planning. the best spec is code. if you do want to make a plan, [`/skill:poteto-mode`](./skills/poteto-mode/SKILL.md) covers it, but it's not a default. 

## make it yours

`poteto-mode` is poteto's style. you may not want exactly that.

type [`/skill:automate-me`](./skills/automate-me/SKILL.md). it mines your recent transcripts, drafts a `<your-name>-mode` skill from how you've actually worked, and routes through pstack underneath. you keep pstack as the base and end up with your own routing skill alongside `poteto-mode`.

models are configurable too. type [`/skill:setup-pstack`](./skills/setup-pstack/SKILL.md). it probes the models this machine can actually spawn and maps each role (code, judgment, tooling, the review panels) to one, writing the seven `pstack-*` entries into `~/.omp/agent/config.yml` without touching your other keys. a role runs on your session model until you set it, so you override only what you want.

## license

MIT
