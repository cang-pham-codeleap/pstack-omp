---
name: ticket-intake
description: "Make a Jira ticket complete before any agent works on it. Use when starting a ticket, or when the user says intake, clarify the ticket, or the ticket is missing information. Brainstorms the target once, writes the answers back into the ticket so the ticket is the spec, and stamps it ready. The only step where the agent and the user discuss what to build."
---

# Ticket intake

This is the only step where the agent and the user talk about what to build. After it, nobody asks again. The ticket description **is** the spec: no `spec.md`, no parallel design doc. Everything the user decided lives in the ticket. Chat in the user's language. Write ticket text in English.

The skill ends when `node skill://ticket-intake/scripts/check-ticket-ready.mjs` reports `ready: true` and the ticket carries the ready stamp. It writes no code, creates no branch, and creates no spec file.

## Steps

1. **Read.** Resolve the cloudId with `getAccessibleAtlassianResources`, then `getJiraIssue` with `fields: ["*all"]` and `responseContentFormat: "markdown"`. If the MCP is unavailable, ask the user to paste the ticket.
2. **Check.** Pipe the markdown into the checker. Read the JSON.
3. **Scout.** Dispatch one read-only exploration with `task` and `agent: "scout"`. Ask it to find the legacy implementation the ticket replaces, its stories or docs, consumers, registry or package dependencies, and similar tickets. Mark everything it fills as `(inferred, confirmed in D<n>)` until the user confirms it.
4. **Brainstorm the target.** Confirm the goal, the user, success criteria, and non-goals. If the Problem or User Story reads two ways, propose 2 or 3 approaches with a recommendation and let the user pick. Skip this when the ticket is already unambiguous.
5. **Ask once.** Send one message of numbered questions covering every remaining gap: template sections and the type-specific sections from the table. Each question has a recommended default. The user answers `ok` or `1A 2B`.
   - Allow a second round only for questions caused directly by round-one answers that block scope or API. Everything else takes its default and is recorded as `source: default`.
   - Never default the human-owned fields **Instance**, **Tester (internal)**, and **Stakeholder validation**. If one is blank, name its owner, leave the ticket not ready, and stop.
6. **Write back.** See [Writing back to Jira](#writing-back-to-jira).
7. **Verify and stamp.** Fetch the description again as markdown and run the checker. Fix until `ready: true`. Then add the label `agent-ready` and one comment: `Intake complete. type=<type> sha256=<hash> updated=<iso>`. The hash comes from the checker. Stop.

A ticket that is already ready still goes through steps 1 to 3. If the scout finds nothing new, stamp it and exit without asking.

## Ticket types

The checker requires the common template sections (`Instance`, `Problem to solve`, `User Story`, `To do`, `Acceptance Criteria`, `Test process`, `Tester`, `Stakeholder validation`, `Description of the breaking changes`) plus the intake sections of the type. Both lists live at the top of `scripts/check-ticket-ready.mjs` (`COMMON`, `TYPES`). They match the JTL CP ticket template. Edit them for another template.

| Type          | Use for                                         |
| ------------- | ----------------------------------------------- |
| `rebuild`     | port of a legacy component, behavior must match |
| `component`   | new component with no legacy                    |
| `enhancement` | change to an existing item                      |
| `bug`         | defect (needs repro and expected vs actual)     |
| `tooling`     | CI, scripts, build, repo process                |
| `docs`        | documentation only                              |
| `tokens`      | theme, tokens, styles                           |
| `refactor`    | structure change, behavior preserved            |
| `spike`       | question to answer, output is a finding         |

`Form` (Atom, Component, Block, Recipe) is a separate field, not a type.

## Writing back to Jira

Markdown round trips lose mentions, tables, and panels. Write ADF, not markdown.

1. `getJiraIssue` with `responseContentFormat: "adf"`. Keep the ADF JSON as the backup. Post it in one comment headed `Description before intake (ADF)`.
2. Never edit text a human already wrote. Fill only **empty** template sections by inserting nodes after their label paragraph. Put everything else in one appended block, built from `assets/agent-intake.template.md` (heading `Agent intake`).
3. Re-read `updated` right before writing. If it changed since step 1, stop and start over.
4. `editJiraIssue` with `fields: { description: <adf> }` and `contentFormat: "adf"`. Keep every existing node unchanged, including `localId` attrs and `mention` nodes. Verified on a live ticket: a no-op ADF write kept nodes, ids, and the mention identical. The markdown write path is untested; do not use it.

## Delivery block

The agent derives it from the repo and does not ask the user: slug, branch, base, changeset need and bump, the gate list, which command verifies each acceptance criterion, and the stop conditions. Take the gates from the repo's agent rules (`AGENTS.md`) and add what CI also runs (`.github/workflows`). If an acceptance criterion has no command or observable check, ask for one in the question round.

## What the checker enforces

- Every required section is present and has real content. `N/A`, `TBD`, `-`, and an empty body do not count, except `None` in Breaking changes and Stakeholder validation.
- No `[OPEN]`, `TBD`, or `???` anywhere in the description. Use `[OPEN]` for a question still unanswered.
- Each Decisions line reads `D<n>: question -> answer (source: user|default|ticket, YYYY-MM-DD)`.
- Readiness is tied to the description hash. Any later edit makes the ticket not ready. The `agent-ready` label alone proves nothing; recompute with `--expect=<hash>`.

The checker tests structure, not meaning. A wrong default that is well formed passes, so every default stays visible as `source: default`.

## Blocked

If intake cannot finish (a human-owned field is blank, the MCP write is denied, the user is unreachable), comment on the ticket with the exact gap, add `agent-blocked`, and stop.

## Handoff

The next step reads the ticket only. A PR reviewer that cannot read Jira gets the ticket link and hash quoted in the PR description by whoever opens the PR.
