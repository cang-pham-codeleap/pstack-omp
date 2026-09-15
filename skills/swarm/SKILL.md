---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

Fan out N parallel workers. They may cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers, not the concurrency limit — OMP runs at most 8 `task` subagents at once and queues the rest.
4. Every worker runs on `agent: "pstack-code"` unless the shape assigns another role agent (a model race names one per arm). A worker's model comes from its role (omp: `modelRoles.<role>` in `~/.omp/agent/config.yml`, set by `/skill:setup-pstack`; claude code: the `model:` field in that role's `agents/<role>.md`). For a model race, name each arm's agent up front: `pstack-code`, `pstack-judgment`, and `pstack-panel-1` through `pstack-panel-4` are the distinct model carriers.
5. Give each worker its own writable output when it writes.

## Phase B: Fan out

Spawn all N workers in one `task` batch, each item on `agent: "pstack-code"` with `isolated: true` so the worker gets its own git worktree. Drop `isolated` only when the worker needs access to something on the user's computer.

When a worker must start from a non-default pushed branch, create that worker's worktree from `<branch>`.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.
