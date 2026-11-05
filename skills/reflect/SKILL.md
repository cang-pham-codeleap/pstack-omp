---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, the parent finds its own transcript file. OMP keeps them in `~/.omp/agent/sessions/<encoded-cwd>/`, where `<encoded-cwd>` is the workspace path with the home prefix dropped and every `/` replaced by `-`, prefixed with `-` (`~/Documents/proj` becomes `-Documents-proj`). Session files are named `<ISO timestamp>_<sessionId>.jsonl`, and subagent transcripts sit in a sibling directory `<ISO timestamp>_<sessionId>/<AgentName>.jsonl`. Derive the path from `PWD`:

```bash
d="$HOME/.omp/agent/sessions/-$(printf %s "${PWD#"$HOME"/}" | tr / -)"
ls -t "$d"/*.jsonl "$d"/*/*.jsonl 2>/dev/null | head -10
```

Do not glob across other session directories. That crosses workspace boundaries and reads private chats from unrelated projects.

Every entry is one JSON line. For each candidate, read the first line with `"type":"message"`. Take the file whose `message.content[0].text` contains the conversation's opening user prompt. If none matches, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

One `task` batch, three items: judgment and divergent on `agent: "pstack-judgment"`, tooling on `agent: "pstack-tooling"`. The `task` tool spawns an agent with full tool access, so nothing is stripped. Reviewers need that access for context lookups (tickets, chat threads, observability traces referenced in the transcript). Their models come from `modelRoles.pstack-judgment` and `modelRoles.pstack-tooling` in `~/.omp/agent/config.yml`, configured by the **setup-pstack** skill (`/skill:setup-pstack`).

| Lens | Agent | Prompt template |
|---|---|---|
| Judgment | `pstack-judgment` | `references/judgment-reviewer.md` |
| Tooling | `pstack-tooling` | `references/tooling-reviewer.md` |
| Divergent | `pstack-judgment` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `task` agent's result.

## 3. Synthesize

One `task` item on `agent: "pstack-judgment"`. It spot-verifies citations, which can require MCP access; the `task` tool spawns an agent with full tool access, so nothing is stripped. Its model comes from `modelRoles.pstack-judgment` in `~/.omp/agent/config.yml`, configured by the **setup-pstack** skill (`/skill:setup-pstack`). Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

Then run `node skill://lessons/scripts/lessons.mjs list --status strong`. Each `strong` lesson has held up across several sessions, so add it to the Accepted list routed to its structural form per the **lessons** skill's Promote section. Once that edit lands, retire the lesson with the commit as the reason.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a skill inside an installed plugin copy. Before approval, show its destination, `.omp/skills/<skill>/` or `~/.omp/agent/skills/<skill>/`. After approval, copy the skill folder there and edit the copy. Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the `manage_skill` tool and run its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `manage_skill` and run its description-optimization loop.
- `new skill via manage_skill: <kebab-name>`: hand creation to `manage_skill`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
