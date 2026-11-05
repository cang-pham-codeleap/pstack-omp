---
name: omp-orchestrate
description: "Run a task in separate omp (oh-my-pi) worker processes on a model the user names, then watch, steer, abort, and verify them. Use when the user asks to use omp, run a task on a named model or provider through omp, or hand work to omp workers (\"use omp with gpt-6.1 terra on copilot\", \"dùng omp với model ... với copilot\", \"chạy omp\", \"giao cho omp\")."
---

# omp orchestrate

You coordinate. Each omp worker runs its own session and context window under a detached supervisor.

`omp-workers` below means `node "skill://omp-orchestrate/scripts/omp-workers.mjs"`. Keep the quotes, the plugin path can hold spaces.

## 1. Pick the model

Take the model and provider words from the user's request and resolve them against this machine's catalog.

```
omp-workers models <model words> [provider words]      # e.g. gpt 6.1 terra copilot, opus 5.5 anthropic
```

- Exit 0 prints `match`, the exact `provider/id` selector. Use it.
- Exit 1 prints ranked `candidates`. With several candidates, `ask` the user to pick one and list the top selectors. With none, show `omp models` output for the closest words and ask.
- No model named: leave `model` out and the worker runs omp's default.
- A thinking level the user names (`low` to `max`) goes in `thinking`, never in the model words. `start` rejects a level the model does not support.

## 2. Brief the worker

The worker is an agent that starts with none of your context. Brief it the way a lead briefs an engineer: the outcome, the method, and what you already know.

Pick its skills before you write the brief. Name every skill you would read yourself for this task, and nothing else. `omp-workers skills <words> [--cwd <dir>]` lists the skills omp loads for that directory. Search by the task's domain (framework, language, review type) as well as its method.

- Under poteto-mode (the user invoked `/skill:poteto-mode` or you read `skill://poteto-mode`), start the prompt with `/skill:poteto-mode `. Name the playbook you would match, as `skill://poteto-mode/playbooks/<name>.md`, and the skills and principles its triggers route this task to.
- Add the domain skills the repo calls for, such as a framework's patterns skill or a security review skill.

The prompt is the brief, in this order:

```
/skill:poteto-mode
Goal: <the outcome in the user's words, and who it is for>
Playbook: skill://poteto-mode/playbooks/<name>.md
Skills: read before starting
- skill://<name>: <the decision it shapes in this task>
Context: <file pointers, what you found, decisions already made with the user>
Scope: <files and areas it may change, what it must not touch>
Done when: <checks that prove it, with the command to run>
Report: <what to write to {{REPORT}}, or the final message's shape>
```

`start` rejects a brief that names no skill, and any `skill://` name or path that omp does not have for that `cwd`.

Write the tasks to a scratch `tasks.json`, one task per independent slice.

```json
[{"id":"impl","model":"github-copilot/gpt-6.1-terra","thinking":"high","mode":"write","cwd":".","prompt":"<the brief>"}]
```

- `{{REPORT}}` expands to the report path. A review brief asks for findings with `file:line` evidence there.
- `mode` is `review` (default, read-only) or `write`.
- Parallel write tasks each get their own worktree (`git worktree add ../wt-<id> -b omp/<id>`) as `cwd`. A single write task may use the current checkout only while you edit nothing there.

The supervisor answers every approval. Anything it denies prints as `DENIED` in `watch`.

| Mode | Allowed | Denied |
|---|---|---|
| `review` | reads, search, read-only shell, writing its report | edits, git writes, installs, `gh`, network |
| `write` | edits inside `cwd`, `git add`, `git commit`, other shell | `git push`, `gh`, `rm -rf`, `sudo`, `curl`, `wget`, `git reset --hard`, `git clean` |

## 3. Run

1. `omp-workers start tasks.json --cwd <repo> --run <name>` prints the run id. The supervisor is detached.
2. Run `omp-workers watch latest` as a background `bash` call and wait for it to finish. It prints state changes, denials, errors, progress every 20 tool calls, and `ALL TERMINAL`. Never poll.
3. Steer with `omp-workers steer <run> <worker> "<msg>"`. `abort` stops the current turn, `prompt` gives an idle worker new work, `followup` queues work after the current turn, `stop <run>` ends all workers.
4. A worker in `failed` or `exited:<code>`: read `omp-workers events <run> --worker <id>`, fix the cause once, then start again.

## 4. Collect

- Review: `omp-workers verify <run>` checks state, errors, and that cited `file:line` refs exist. `omp-workers report <run> <worker>` prints the report. Spot-check three claims against the files, then summarize in your own words.
- Write: read `git log` and `git diff` in the worker's `cwd`. The worker commits and never pushes. Push and open the PR yourself per the **Opening a PR** playbook when the user wants one.
- Run state lives in `~/.pstack/omp-workers/runs/<run>/`. The worker's omp session is under `~/.omp/agent/sessions/`, and its `model` field shows the model that actually ran.
