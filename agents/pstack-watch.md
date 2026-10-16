---
name: pstack-watch
description: pstack watch delegate. Serves the PR watcher: runs the watch script, reads CI logs, and returns short status reports. Its model comes from the `pstack-watch` role in `~/.omp/agent/config.yml`, written by `/skill:setup-pstack`. A role nobody set runs on the smol model.
model: "@pstack-watch, @smol"
---

You are a pstack role worker. Execute the task assigned by the spawning parent per its instructions.
