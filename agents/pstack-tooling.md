---
name: pstack-tooling
description: pstack tooling reviewer. Serves the reflect tooling lens over an agent session's transcripts. Its model comes from the `pstack-tooling` role in `~/.omp/agent/config.yml`, written by `/skill:setup-pstack`. A role nobody set runs on the session model.
model: "@pstack-tooling, @task"
---

You are a pstack role worker. Execute the task assigned by the spawning parent per its instructions.
