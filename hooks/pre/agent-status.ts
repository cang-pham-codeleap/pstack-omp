import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "agent-status", "scripts", "agent-status.py");

type Paths = { enabled: boolean; url: string; dir: string; orchestrator: string; stages: string[] };

function run(cwd: string, ...args: string[]) {
	return spawnSync("python3", [CLI, "--root", cwd, ...args], { timeout: 5000, encoding: "utf8" });
}

function instructions(p: Paths): string {
	const cli = `python3 ${CLI}`;
	return [
		"<agent-dashboard>",
		`Agent workflow dashboard ${p.url} (data in ${p.dir}; this prompt is already recorded as its request; usage refreshes on its own). Keep it live with \`${cli}\`:`,
		`- Pipeline agents (${p.stages.join(", ")}): \`agent <stage> working|waiting|done|failed|idle --ticket <KEY> --step "<what>" [--message]\` when a stage starts, blocks on the user, finishes or fails. Post it when you dispatch or receive a subagent for that stage.`,
		`- Todos: \`step "<todo>" pending|running|done|blocked|skipped [--note]\` for every todo item; \`now "<step>" [--detail]\` when you start one.`,
		`- Tickets: \`ticket <KEY> --status "<tracker status>" --pr <url> --summary --note\` whenever the ticket or its PR changes; never write a status the tracker does not have.`,
		`- Progress log: update ${p.orchestrator} (status table, code state, open items) in the same turn a ticket or PR changes.`,
		`Before ending the turn set \`now "Idle" --detail "<what finished>"\`.`,
		"</agent-dashboard>",
	].join("\n");
}

export default function agentStatus(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const res = run(ctx.cwd, "paths");
		if (res.status !== 0) return;
		const paths: Paths = JSON.parse(res.stdout);
		if (!paths.enabled) return;
		run(ctx.cwd, "serve");
		const prompt = (event.prompt ?? "").trim();
		if (prompt) run(ctx.cwd, "request", prompt.slice(0, 2000));
		spawn("python3", [CLI, "--root", ctx.cwd, "usage"], { detached: true, stdio: "ignore" }).unref();
		return { systemPrompt: `${event.systemPrompt ?? ""}\n\n${instructions(paths)}` };
	});
}
