# Set up pstack

In this page you install the plugin, pick which models pstack uses, and run your first task. Setup is one command plus a short conversation.

## Install the plugin

In a terminal, run:

```text
omp plugin marketplace add cang-pham-codeleap/pstack-omp
omp plugin install --scope user pstack@pstack-omp
```

omp confirms the plugin is installed.

## Pick your models

Run:

```text
/skill:setup-pstack
```

[`/skill:setup-pstack`](../../skills/setup-pstack/SKILL.md) detects the models you have access to, asks for a reasoning budget, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions. It writes the seven `pstack-*` entries into `~/.omp/agent/config.yml`: a `modelRoles` key holding each role's model, and a `task.agentModelOverrides` entry pointing the role agent at it. Both are what every pstack skill reads.

You only override what you care about. A role with no key in the config inherits your parent chat model. To change a role later, edit its key, or just run `/skill:setup-pstack` again.

You might be wondering what happens when you'd rather not pin a model. Leave a role's key unset and the agent inherits your parent chat model. An unset key is not a model slug. For a panel role, one `pstack-panel-<n>` agent runs per entry you configure, so the number of entries sets the panel size. Setup also configures the code role, the default for every `/skill:swarm` worker.

## Accept the verification offer, or don't

At the end of setup, `/skill:setup-pstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/skill:create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.omp/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/skill:create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers when it earns its place.

After setup, start a new chat. The model roles apply to new sessions.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/skill:poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/skill:poteto-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. `/skill:poteto-mode` is sticky. It stays on for the conversation until you opt out by saying so.

Next: [Route work through `/skill:poteto-mode`](./02-poteto-mode.md).
