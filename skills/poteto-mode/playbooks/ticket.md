### Ticket

**Nobody writes code until the ticket is understood and the human confirms it.** This playbook runs before the playbook that builds the ticket (usually Feature or Bug fix). **principle-never-block-on-the-human** does not apply here, because intake decides what to build and that is the human's call. The human skips the grill by saying "skip grill".

1. **Read.** Read the ticket in full. For Jira, fetch it through the Atlassian MCP. For a markdown file, read every line.
2. **Research.** Check every claim the ticket makes against primary sources: the code, official docs, specs, first-party APIs. Do the referenced files, endpoints, components, flags, and conventions exist and behave as the ticket says? Trace each claim back to the source that owns it. Delegate the reading to a background `task` agent and keep working while it reads. Write the findings to one Markdown file, citing each claim's source. Keep it outside the repo unless the repo already keeps such notes.
3. **Readiness.** List each acceptance criterion, each assumption that failed, and each gap (copy, states, errors, permissions, empty and loading, API shape, scope).
4. **Grill.** Map the open decisions as a design tree. Every decision branches into the decisions that depend on it. The frontier is every decision whose prerequisites are settled. Ask the whole frontier in one round, numbered, with your recommended answer for each. Word each question so "yes" accepts the recommendation. Use this format:

   ```
   ❓ **Q1** - **<question title>**: <question body, with choices if any>

   ➡️ <your recommended answer>
   ```

   A question that depends on another open question in the same round goes in a later round. Finding facts is your job, never the human's. Dispatch a subagent for anything you can look up, and ask only the questions that do not wait on it. Decisions belong to the human.
5. **End the turn and wait.** No code in the turn the ticket arrives. Each answer reshapes the tree. Recompute the frontier and ask the next round.
6. **Confirm.** Done when the frontier is empty and the human confirms a shared understanding. Then route to the build playbook with the findings and the decisions.

**Reply:** findings with sources, failed assumptions, the current question round. After confirmation, the decisions list.

Steps 2 and 4 adapt the `research` and `grilling` skills from [mattpocock/skills](https://github.com/mattpocock/skills), Copyright (c) 2026 Matt Pocock, MIT License.
