# Set up pstack

In this page you install the plugin, pick which models pstack uses, and run your first task. Setup is one command plus a short conversation.

## Install the plugin

In a terminal, run:

```text
omp plugin marketplace add cang-pham-codeleap/pstack-omp
omp plugin install --scope user pstack@pstack-omp
```

omp confirms the plugin is installed.

In Claude Code, run `/plugin marketplace add cang-pham-codeleap/pstack-omp`, then `/plugin install pstack@pstack-omp`. Claude Code namespaces plugin commands, so each `/skill:<name>` command in this guide is `/pstack:<name>` there. [omp and Claude Code](./11-omp-and-claude-code.md) covers the other differences, including how role models are set.

## Pick your models

Run:

```text
/skill:setup-pstack
```

[`/skill:setup-pstack`](../../skills/setup-pstack/SKILL.md) detects the models you have access to, asks for a reasoning budget, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions. It writes the eight `pstack-*` entries into `~/.omp/agent/config.yml`: a `modelRoles` key holding each role's model, and a `task.agentModelOverrides` entry pointing the role agent at it. Both are what every pstack skill reads.

The defaults run at `xhigh` reasoning, the same as the `large` budget. `unlimited` lifts each model to its highest tier, up to `max`. Opus goes to `max`. Grok tops out at `xhigh`, so it stays there. `medium` and `small` lower the reasoning and spend fewer tokens.

You only override what you care about. A role with no key in the config inherits your parent chat model. To change a role later, edit its key, or just run `/skill:setup-pstack` again.

You might be wondering what happens when you'd rather not pin a model. Leave a role's key unset and the agent inherits your parent chat model. An unset key is not a model slug. For a panel role, one `pstack-panel-<n>` agent runs per entry you configure, so the number of entries sets the panel size. Setup also configures the code role, the default for every `/skill:swarm` worker.

## Accept the verification offers, or don't

At the end of setup, `/skill:setup-pstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/skill:create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.omp/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/skill:create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers it in depth.

If you're new to pstack, say yes. An agent that can check its own work keeps going until the check passes. An agent that can't hands every result back to you to check by hand. Of everything in this guide, the verification skill pays off the most.

Then setup offers once to generate a formal verification skill with [`/skill:create-formal-verification-skill`](../../skills/create-formal-verification-skill/SKILL.md), unless the project already has one. Tests check the cases someone thought to write. A formal verification skill checks one key property of your code, such as "a job never runs twice at once", in every case within a stated scope. Say yes when your code has concurrency, retries, a state machine, or a parser, where a bug is costly and tests rarely reach the case that breaks. Otherwise say no, and run it later if that changes. [Verify and ship](./06-verify-and-ship.md#prove-a-property-with-a-formal-verification-skill) covers it.

## Turn on `/review`, or don't

When the repo lives on GitHub, setup's first question batch also asks whether to install an automated PR review. Pick the Copilot engine (no secret) or the Claude engine (an `ANTHROPIC_API_KEY` repo secret), or say no. On yes it writes a [GitHub Agentic Workflow](https://github.github.com/gh-aw/introduction/overview/) to `.github/workflows/pr-review.md`, compiles it, lets GitHub Actions approve pull requests, and opens a PR with the files. Once that merges, comment `/review` on any PR. The agent reads the diff and CI results, approves or requests changes, and labels the PR. Put repo-specific review rules in `.github/review-rules.md`. The bot's approval counts toward required reviews, so weigh that before you turn it on. Repos hosted elsewhere never see the question.

After setup, start a new chat. The model roles apply to new sessions.

## Keep the cost in check

pstack spends extra tokens on subagents and review panels. That's the price of the rigor. To spend fewer:

- Rerun `/skill:setup-pstack` and pick a smaller reasoning budget or cheaper models. A strong model in the main chat with cheaper, faster models in the code roles is a good split.
- Leave a role's key unset so it runs on the chat's own model.
- Shorten a panel list. Each entry runs one subagent.
- Save `/skill:poteto-mode` for work that needs rigor. A small, obvious edit doesn't.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/skill:poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/skill:poteto-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups.

Next: [Route work through `/skill:poteto-mode`](./02-poteto-mode.md).
