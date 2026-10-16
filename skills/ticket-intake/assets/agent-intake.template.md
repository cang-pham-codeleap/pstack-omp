### Agent intake

Type: <rebuild | component | enhancement | bug | tooling | docs | tokens | refactor | spike>
Form: <Atom | Component | Block | Recipe | n/a>

### Source of truth

- Legacy code: <path in jtl-platform-ui-react> (inferred, confirmed in D<n>)
- Legacy Storybook: <url>
- Figma: <node url>
- Consumers: <repo or package that imports it>

### Scope

- In: <bullet>
- Out: <bullet, with the follow-up ticket key or the reason>

### API contract

- <prop or behavior>: keep | deprecate (replacement, migration note) | remove (approved, D<n>)

### Deliverables

- <story, Fumadocs page with live demo, changeset, registry entry, tests — only what this ticket needs>

### Precedence

- <which source wins on conflict, e.g. ticket, then Figma, then legacy>

### Agent discretion

- <decisions the agent may take alone; each is recorded in the PR description>

### Decisions

- D1: <question> -> <answer> (source: user, YYYY-MM-DD)
- D2: <question> -> <answer> (source: default, YYYY-MM-DD)

### Delivery

- Slug: <kebab-case, no ticket key>
- Branch: feat/cp-<n>-<slug>. Base: main.
- Changeset: <none | patch | minor | major> — <entry text>
- Gates: <commands, copied from AGENTS.md plus CI-only checks>
- Verify: AC1 -> <command or observable check>; AC2 -> <...>
- Stop when: <blocker conditions. The agent comments on the ticket, labels it agent-blocked, and stops.>
