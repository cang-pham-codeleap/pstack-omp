---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

The parent finds its own transcript file before fanning out. OMP keeps them in `~/.omp/agent/sessions/<encoded-cwd>/`, where `<encoded-cwd>` is the workspace path with the home prefix dropped and every `/` replaced by `-`, prefixed with `-` (`~/Documents/proj` → `-Documents-proj`). Session files are named `<ISO timestamp>_<sessionId>.jsonl`, and subagent transcripts sit in a sibling directory `<ISO timestamp>_<sessionId>/<AgentName>.jsonl`. Derive the path from `PWD`:

```bash
d="$HOME/.omp/agent/sessions/-$(printf %s "${PWD#"$HOME"/}" | tr / -)"
ls -t "$d"/*.jsonl "$d"/*/*.jsonl 2>/dev/null | head -10
```

Do not glob across other session directories. That crosses workspace boundaries and reads private chats from unrelated projects.

Every entry is one JSON line. The opening user prompt is the first line with `"type":"message"`; read `message.content[0].text` on it. Take that matching path. If no path resolves, write a tight digest of the session and pass that instead.

### 2. Spawn three reviewers in parallel

One `task` batch, three items: judgment and divergent on `agent: "pstack-judgment"`, tooling on `agent: "pstack-tooling"`. The `task` tool spawns an agent with full tool access, so nothing is stripped. Reviewers need that access for context lookups (tickets, chat threads, observability traces referenced in the transcript). Their models come from the `pstack-judgment` and `pstack-tooling` roles (omp: `modelRoles.pstack-judgment` and `modelRoles.pstack-tooling` in `~/.omp/agent/config.yml`, set by `/skill:setup-pstack`; claude code: the `model:` fields in `agents/pstack-judgment.md` and `agents/pstack-tooling.md`).

| Lens | Agent | Prompt template |
|---|---|---|
| Judgment | `pstack-judgment` | `references/judgment-reviewer.md` |
| Tooling | `pstack-tooling` | `references/tooling-reviewer.md` |
| Divergent | `pstack-judgment` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `task` agent's result.

### 3. Synthesize

One `task` item on `agent: "pstack-judgment"`. The synthesizer's quality check includes spot-verifying citations, which can require MCP access; the `task` tool spawns an agent with full tool access, so nothing is stripped. Its model comes from the `pstack-judgment` role (omp: `modelRoles.pstack-judgment` in `~/.omp/agent/config.yml`, set by `/skill:setup-pstack`; claude code: the `model:` field in `agents/pstack-judgment.md`). Use `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. The synthesizer returns a structured Accepted / Rejected / Backlog list.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. See the **encode-lessons-in-structure** principle skill.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

Backlog items file to whatever devex / backlog tracker your team uses automatically. Only the Accepted list waits for approval.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): parent does directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the `manage_skill` tool and run its draft / test / iterate loop. (claude code: see `skills/poteto-mode/references/harness-surface.md` for the equivalent)
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `manage_skill` and run its description-optimization loop.
- `new skill via manage_skill: <kebab-name>`: hand creation to `manage_skill`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
