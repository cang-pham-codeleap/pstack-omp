import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
} from "commander";
import {
  GhGitHubReader,
  WatcherQueryError,
  discoverStack,
  resolveContext,
} from "./github.ts";
import {
  runQueued,
  runResolveThread,
  runSimple,
  statusQueryVerdict,
  verdictFactory,
  type WatchClock,
} from "./policy.ts";
import { renderJson, renderPretty } from "./render.ts";
import type * as T from "./types.ts";
import { nonEmpty, parsePrNumber } from "./types.ts";
export interface CliOptions {
  readonly owner: string | null;
  readonly repo: string | null;
  readonly pr: T.PrNumber | null;
  readonly mode: T.WatchMode;
  readonly stackPrs: readonly T.PrNumber[];
  readonly statusOnly: boolean;
  readonly pretty: boolean;
  readonly approverCommand: string | null;
  readonly polling: T.PollingOptions;
}
function positiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new InvalidArgumentError("must be greater than zero");
  return parsed;
}
function nonNegativeNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new InvalidArgumentError("must be zero or greater");
  return parsed;
}
function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new InvalidArgumentError("must be a positive integer");
  return parsed;
}
function prNumber(value: string): T.PrNumber {
  try {
    return parsePrNumber(Number(value.replace(/^#/, "")));
  } catch {
    throw new InvalidArgumentError("must be a positive integer");
  }
}
function stackPrList(value: string): T.NonEmpty<T.PrNumber> {
  const numbers = value.split(",").map((part) => prNumber(part.trim()));
  if (new Set(numbers).size !== numbers.length)
    throw new InvalidArgumentError("contains a duplicate PR");
  const parsed = nonEmpty(numbers);
  if (parsed === null) throw new InvalidArgumentError("cannot be empty");
  return parsed;
}
function isoTime(value: string): string {
  if (Number.isNaN(Date.parse(value)))
    throw new InvalidArgumentError("must be an ISO 8601 time");
  return value;
}
function commitSha(value: string): string {
  if (!/^[0-9a-f]{7,40}$/i.test(value))
    throw new InvalidArgumentError("must be a 7 to 40 character commit SHA");
  return value;
}
interface RawOptions {
  readonly owner?: string;
  readonly repo?: string;
  readonly pr?: T.PrNumber;
  readonly stack: boolean;
  readonly queuedStack: boolean;
  readonly stackPrs?: T.NonEmpty<T.PrNumber>;
  readonly interval: number;
  readonly sweepInterval: number;
  readonly timeout: number;
  readonly maxQueryErrors: number;
  readonly statusOnly: boolean;
  readonly allowDraft: boolean;
  readonly awaitReview: readonly string[];
  readonly reviewTimeout: number;
  readonly since?: string;
  readonly head?: string;
  readonly approverCommand?: string;
  readonly pretty: boolean;
}
export function parseArgs(
  argv: readonly string[],
  io: Pick<CliRuntime, "stdout" | "stderr">
): CliOptions {
  const program = new Command("watch-pr")
    .description(
      "Watch one pull request, a connected stack, or an immutable queued stack.\nJSON (NDJSON while polling) is the default; --pretty renders human text.\n--status-only also reports ship counts derived from GitHub: Copilot reviews, approver runs, CI-fix pushes per check, and startedAt.\nSubcommands: resolve-thread (reply and resolve a review thread), eta (typical workflow durations and recommended timeouts from Actions history). Run each with --help."
    )
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .exitOverride()
    .option("--owner <owner>", "GitHub repository owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--pr <number>", "pull request number", prNumber)
    .addOption(
      new Option("--stack", "watch the connected open stack")
        .default(false)
        .conflicts("queuedStack")
    )
    .option(
      "--queued-stack",
      "watch the captured stack until all PRs merge",
      false
    )
    .option(
      "--stack-prs <n,...>",
      "frozen bottom-to-top queue (queued mode only)",
      stackPrList
    )
    .option("--interval <seconds>", "poll interval", positiveNumber, 60)
    .option(
      "--sweep-interval <seconds>",
      "whole-stack sweep interval",
      positiveNumber,
      300
    )
    .option(
      "--timeout <seconds>",
      "deadline; 0 disables it",
      nonNegativeNumber,
      0
    )
    .option(
      "--max-query-errors <count>",
      "consecutive query-error budget",
      positiveInteger,
      5
    )
    .option(
      "--await-review <login>",
      "hold READY until this reviewer has reviewed the head commit; any login other than Copilot must APPROVE or REQUEST_CHANGES; repeatable",
      reviewerLogin,
      []
    )
    .option(
      "--review-timeout <seconds>",
      "give up awaiting reviews after this long with exit 9; 0 disables it",
      nonNegativeNumber,
      600
    )
    .option(
      "--since <iso>",
      "count only awaited reviews submitted after this time (the approver trigger); with a non-Copilot --await-review, a pr-review-status failure comment posted after it ends the watch with exit 10",
      isoTime
    )
    .option(
      "--head <sha>",
      "expected head commit; any other head ends with exit 8 (single PR only)",
      commitSha
    )
    .option(
      "--approver-command <text>",
      "with --status-only, count your PR comments that start with this command, minus VERDICT: DEFERRED reviews (a deferral spends no approver run)"
    )
    .option(
      "--status-only",
      "print one status table (with awaited review state and ship counts) and exit 0",
      false
    )
    .option("--allow-draft", "do not treat a draft as a merge gate", false)
    .option("--pretty", "render human text instead of JSON", false);
  program.parse(argv, { from: "user" });
  const raw = program.opts<RawOptions>();
  if (raw.stackPrs !== undefined && !raw.queuedStack)
    program.error("error: --stack-prs requires --queued-stack");
  if (raw.awaitReview.length > 0 && raw.queuedStack)
    program.error("error: --await-review does not support --queued-stack");
  if (raw.head !== undefined && (raw.stack || raw.queuedStack))
    program.error("error: --head requires a single PR");
  return {
    owner: raw.owner ?? null,
    repo: raw.repo ?? null,
    pr: raw.pr ?? null,
    mode: raw.queuedStack ? "queued-stack" : raw.stack ? "stack" : "single",
    stackPrs: raw.stackPrs ?? [],
    statusOnly: raw.statusOnly,
    pretty: raw.pretty,
    approverCommand: raw.approverCommand ?? null,
    polling: {
      interval: raw.interval,
      sweepInterval: raw.sweepInterval,
      timeout: raw.timeout,
      maxQueryErrors: raw.maxQueryErrors,
      allowDraft: raw.allowDraft,
      awaitReview: raw.awaitReview,
      reviewTimeout: raw.reviewTimeout,
      since: raw.since ?? null,
      head: raw.head ?? null,
    },
  };
}
export interface CliRuntime {
  readonly reader: T.GitHubReader;
  readonly clock: WatchClock;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}
function realRuntime(): CliRuntime {
  return {
    reader: new GhGitHubReader(),
    clock: {
      now: () => performance.now() / 1_000,
      observedAt: () => new Date().toISOString(),
      sleep: async (seconds) => {
        await delay(seconds * 1_000);
      },
    },
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
}
function repoSlug(value: string): { owner: string; repo: string } {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(value);
  if (match === null) throw new InvalidArgumentError("must be owner/name");
  return { owner: match[1], repo: match[2] };
}
function reviewerLogin(value: string, previous: readonly string[]): string[] {
  if (value.trim() === "")
    throw new InvalidArgumentError("login cannot be empty");
  return [...previous, value.trim()];
}
async function resolveThreadCommand(
  argv: readonly string[],
  runtime: CliRuntime
): Promise<number> {
  const command = new Command("watch-pr resolve-thread")
    .description(
      "Optionally reply to a review thread, then resolve it. Resolving a resolved thread succeeds quietly.\nThe thread node id is globally unique, so --pr and --repo only document the target."
    )
    .configureOutput({ writeOut: runtime.stdout, writeErr: runtime.stderr })
    .exitOverride()
    .requiredOption("--pr <number>", "pull request number", prNumber)
    .requiredOption("--thread <nodeId>", "review thread GraphQL node id")
    .option("--repo <owner/name>", "repository", repoSlug)
    .addOption(
      new Option("--body <text>", "reply text posted before resolving").conflicts(
        "bodyFile"
      )
    )
    .option("--body-file <path>", "read the reply text from a file")
    .option(
      "--max-query-errors <count>",
      "consecutive query-error budget",
      positiveInteger,
      5
    );
  try {
    command.parse(argv, { from: "user" });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    return error.exitCode === 0 ? 0 : 64;
  }
  const opts = command.opts<{
    readonly thread: string;
    readonly body?: string;
    readonly bodyFile?: string;
    readonly maxQueryErrors: number;
  }>();
  let body: string | null = opts.body ?? null;
  try {
    if (opts.bodyFile !== undefined) body = readFileSync(opts.bodyFile, "utf8");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    runtime.stderr(`error: cannot read --body-file: ${error.message}\n`);
    return 64;
  }
  if (body !== null && body.trim() === "") {
    runtime.stderr("error: reply body cannot be empty\n");
    return 64;
  }
  const result = await runResolveThread({
    dependencies: {
      reader: runtime.reader,
      clock: runtime.clock,
      emit: (verdict) => runtime.stdout(renderJson(verdict)),
    },
    threadId: opts.thread,
    body,
    options: {
      interval: 60,
      sweepInterval: 300,
      timeout: 0,
      maxQueryErrors: opts.maxQueryErrors,
      allowDraft: false,
      awaitReview: [],
      reviewTimeout: 0,
      since: null,
      head: null,
    },
  });
  if (result === "resolved") return 0;
  runtime.stdout(renderJson(result));
  return result.exitCode;
}
// Nearest-rank percentile over ascending seconds.
const percentile = (sorted: readonly number[], p: number): number =>
  sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
const COPILOT_WORKFLOWS = [
  "copilot",
  "copilot code review",
  "running copilot code review",
];
const PR_EVENTS = ["pull_request", "pull_request_target"];
function workflowEta(runs: readonly T.WorkflowRun[], approverWorkflow: string | null) {
  const durations: Record<string, number[]> = {};
  const prWorkflows = new Set<string>();
  for (const run of runs) {
    if (run.status !== "completed" || run.conclusion !== "success") continue;
    // startedAt is the latest attempt's start, so a rerun hours later does
    // not count the gap between attempts.
    const seconds = Math.round(
      (Date.parse(run.updatedAt) - Date.parse(run.startedAt)) / 1_000
    );
    (durations[run.workflowName] ??= []).push(seconds);
    if (PR_EVENTS.includes(run.event)) prWorkflows.add(run.workflowName);
  }
  const workflows = Object.fromEntries(
    Object.entries(durations).map(([name, values]) => {
      const sorted = values.sort((a, b) => a - b);
      return [
        name,
        { n: sorted.length, p50: percentile(sorted, 50), p90: percentile(sorted, 90) },
      ];
    })
  );
  const isCopilot = (name: string) => COPILOT_WORKFLOWS.includes(name.toLowerCase());
  // Twice the slowest p90 among workflows with at least 3 samples.
  const timeout = (match: (name: string) => boolean, fallback: number) => {
    const p90s = Object.entries(workflows)
      .filter(([name, stats]) => stats.n >= 3 && match(name))
      .map(([, stats]) => stats.p90);
    return p90s.length === 0 ? fallback : 2 * Math.max(...p90s);
  };
  const ciTimeout = timeout(
    (name) => prWorkflows.has(name) && !isCopilot(name) && name !== approverWorkflow,
    900
  );
  const copilotReviewTimeout = timeout(isCopilot, 600);
  const approverReviewTimeout = timeout((name) => name === approverWorkflow, 900);
  return {
    workflows,
    recommended: {
      ciTimeout,
      copilotReviewTimeout,
      approverReviewTimeout,
      runBudget: 3 * (ciTimeout + copilotReviewTimeout) + 2 * approverReviewTimeout,
    },
  };
}
async function etaCommand(
  argv: readonly string[],
  runtime: CliRuntime
): Promise<number> {
  const command = new Command("watch-pr eta")
    .description(
      "Print p50/p90 seconds of successful GitHub Actions runs per workflow, timed from the latest attempt's start, and the recommended timeouts:\nciTimeout (2x the slowest pull_request workflow p90, else 900), copilotReviewTimeout (2x Copilot p90, else 600), approverReviewTimeout (2x --approver-workflow p90, else 900), and runBudget = 3 x (ciTimeout + copilotReviewTimeout) + 2 x approverReviewTimeout.\nA workflow needs 3 samples to count."
    )
    .configureOutput({ writeOut: runtime.stdout, writeErr: runtime.stderr })
    .exitOverride()
    .option("--repo <owner/name>", "repository", repoSlug)
    .option("--limit <count>", "runs to sample", positiveInteger, 200)
    .option("--approver-workflow <name>", "workflow name of the approving review");
  try {
    command.parse(argv, { from: "user" });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    return error.exitCode === 0 ? 0 : 64;
  }
  const opts = command.opts<{
    readonly repo?: T.Repository;
    readonly limit: number;
    readonly approverWorkflow?: string;
  }>();
  try {
    const repository = opts.repo ?? (await runtime.reader.originRepo());
    if (repository === null) {
      runtime.stderr("error: no origin remote; pass --repo owner/name\n");
      return 64;
    }
    const runs = await runtime.reader.workflowRuns(repository, opts.limit);
    runtime.stdout(
      `${JSON.stringify({
        repo: `${repository.owner}/${repository.repo}`,
        sampled: runs.length,
        ...workflowEta(runs, opts.approverWorkflow ?? null),
      })}\n`
    );
    return 0;
  } catch (error) {
    if (!(error instanceof WatcherQueryError)) throw error;
    const verdict = statusQueryVerdict(
      verdictFactory(runtime.clock, "single"),
      1,
      error.failure
    );
    runtime.stdout(renderJson(verdict));
    return verdict.exitCode;
  }
}
export async function main(
  argv: readonly string[],
  runtime: CliRuntime = realRuntime()
): Promise<number> {
  if (argv[0] === "resolve-thread")
    return resolveThreadCommand(argv.slice(1), runtime);
  if (argv[0] === "eta") return etaCommand(argv.slice(1), runtime);
  let options: CliOptions;
  try {
    options = parseArgs(argv, runtime);
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    return error.exitCode === 0 ? 0 : 64;
  }
  const render = options.pretty ? renderPretty : renderJson;
  const emit = (verdict: T.ProgressVerdict): void =>
    runtime.stdout(render(verdict));
  let contexts: T.NonEmpty<T.PrContext>;
  try {
    const seed = await resolveContext({
      reader: runtime.reader,
      owner: options.owner,
      repo: options.repo,
      pr: options.pr ?? options.stackPrs[0] ?? null,
    });
    contexts =
      nonEmpty(options.stackPrs.map((number) => ({ ...seed, number }))) ??
      (options.mode === "single"
        ? [seed]
        : await discoverStack(runtime.reader, seed));
  } catch (error) {
    if (!(error instanceof WatcherQueryError)) throw error;
    const verdict = statusQueryVerdict(
      verdictFactory(runtime.clock, options.mode),
      1,
      error.failure
    );
    runtime.stdout(render(verdict));
    return verdict.exitCode;
  }
  const dependencies = { reader: runtime.reader, clock: runtime.clock, emit };
  const verdict =
    options.mode === "queued-stack" && !options.statusOnly
      ? await runQueued({ dependencies, contexts, options: options.polling })
      : await runSimple({
          dependencies,
          contexts,
          mode: options.mode,
          statusOnly: options.statusOnly,
          options: options.polling,
          approverCommand: options.approverCommand,
        });
  runtime.stdout(render(verdict));
  return verdict.exitCode;
}
