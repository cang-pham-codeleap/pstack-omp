import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CliRuntime, main, parseArgs } from "./cli.ts";
import { fakeReader, failedCheck } from "./fakes.test-helper.ts";
import { WatcherQueryError, parseReviewThreads } from "./github.ts";
import {
  canonicalReviewer,
  readSnapshot,
  runSimple,
  type WatchClock,
} from "./policy.ts";
import type {
  GitHubReader,
  PollingOptions,
  PrReview,
  ProgressVerdict,
  ReviewThread,
} from "./types.ts";
import { parsePrNumber } from "./types.ts";

const context = { owner: "owner", repo: "repo", number: parsePrNumber(1) };
const BOT = "copilot-pull-request-reviewer[bot]";
const review = (
  authorLogin: string,
  commitOid: string | null,
  state = "COMMENTED",
  submittedAt: string | null = "2026-07-26T00:00:00Z",
  body = ""
): PrReview => ({ authorLogin, state, commitOid, submittedAt, body });
const polling = (overrides: Partial<PollingOptions> = {}): PollingOptions => ({
  interval: 10,
  sweepInterval: 300,
  timeout: 0,
  maxQueryErrors: 5,
  allowDraft: false,
  awaitReview: [BOT],
  reviewTimeout: 600,
  since: null,
  head: null,
  ...overrides,
});

function steppedClock(onSleep: (count: number) => void = () => {}) {
  let now = 0;
  let sleeps = 0;
  const clock: WatchClock = {
    now: () => now,
    observedAt: () => "2026-07-26T00:00:00.000Z",
    async sleep(seconds) {
      now += seconds;
      sleeps += 1;
      onSleep(sleeps);
    },
  };
  return { clock, elapsed: () => now };
}

async function watch(
  reader: GitHubReader,
  clock: WatchClock,
  options: PollingOptions
) {
  const events: ProgressVerdict[] = [];
  const verdict = await runSimple({
    dependencies: { reader, clock, emit: (event) => events.push(event) },
    contexts: [context],
    mode: "single",
    statusOnly: false,
    options,
    approverCommand: null,
  });
  return { events, verdict };
}

describe("await review bots", () => {
  it("matches logins case-insensitively and treats the Copilot names as one bot", () => {
    expect(canonicalReviewer("Copilot")).toBe("copilot");
    expect(canonicalReviewer("copilot-pull-request-reviewer[bot]")).toBe(
      "copilot"
    );
    expect(canonicalReviewer("Copilot[bot]")).toBe("copilot");
    expect(canonicalReviewer("github-actions[bot]")).toBe("github-actions");
    expect(canonicalReviewer("github-actions")).not.toBe(
      canonicalReviewer("copilot")
    );
  });

  it("reports AWAITING_REVIEW then READY once the bot reviews the head SHA", async () => {
    let reviews: PrReview[] = [];
    const base = fakeReader();
    const reader: GitHubReader = { ...base, reviews: async () => reviews };
    const { clock } = steppedClock(() => {
      reviews = [review("Copilot", "head")];
    });
    const { events, verdict } = await watch(reader, clock, polling());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "AWAITING_REVIEW",
      terminal: false,
      missing: [{ login: BOT, headSha: "head", reviewedSha: null }],
    });
    expect(verdict).toMatchObject({ kind: "READY", exitCode: 0 });
  });

  it("does not count a review of an older SHA as satisfaction", async () => {
    const reader = fakeReader({ reviews: [review("Copilot", "older")] });
    const { clock, elapsed } = steppedClock();
    const { verdict } = await watch(
      reader,
      clock,
      polling({ reviewTimeout: 30 })
    );
    expect(verdict).toMatchObject({
      kind: "REVIEW_TIMEOUT",
      terminal: true,
      exitCode: 9,
      waitedSeconds: 30,
      missing: [{ login: BOT, headSha: "head", reviewedSha: "older" }],
    });
    expect(elapsed()).toBe(30);
  });

  it("ignores DISMISSED reviews when picking the latest review", async () => {
    const satisfied = await readSnapshot({
      reader: fakeReader({
        reviews: [
          review("copilot", "head"),
          review("copilot", "newer", "DISMISSED"),
        ],
      }),
      context,
      pendingHistory: "include",
      allowDraft: false,
      awaitReview: ["Copilot"],
    });
    const dismissedOnly = await readSnapshot({
      reader: fakeReader({ reviews: [review("copilot", "head", "DISMISSED")] }),
      context,
      pendingHistory: "include",
      allowDraft: false,
      awaitReview: ["Copilot"],
    });
    expect(satisfied).toMatchObject({
      awaitedReviews: [{ login: "Copilot", reviewedOid: "head", satisfied: true }],
    });
    expect(dismissedOnly).toMatchObject({
      awaitedReviews: [
        { login: "Copilot", reviewedOid: null, satisfied: false },
      ],
    });
  });

  it("keeps github-actions separate from the Copilot alias set", async () => {
    const snapshot = await readSnapshot({
      reader: fakeReader({ reviews: [review("copilot", "head")] }),
      context,
      pendingHistory: "include",
      allowDraft: false,
      awaitReview: ["github-actions"],
    });
    expect(snapshot).toMatchObject({
      awaitedReviews: [{ login: "github-actions", satisfied: false }],
    });
  });

  it("resets the review timer when the head SHA changes", async () => {
    let head = "A";
    const base = fakeReader({ reviews: [review("Copilot", "stale")] });
    const reader: GitHubReader = {
      ...base,
      async pullRequest(requested) {
        return { ...(await base.pullRequest(requested)), headRefOid: head };
      },
    };
    const { clock, elapsed } = steppedClock((count) => {
      if (count === 3) head = "B";
    });
    const { verdict } = await watch(
      reader,
      clock,
      polling({ reviewTimeout: 30 })
    );
    expect(verdict).toMatchObject({
      kind: "REVIEW_TIMEOUT",
      exitCode: 9,
      waitedSeconds: 30,
      missing: [{ headSha: "B" }],
    });
    expect(elapsed()).toBe(60);
  });

  it("never times out when the review timeout is 0", async () => {
    let polls = 0;
    const base = fakeReader();
    const reader: GitHubReader = {
      ...base,
      reviews: async () => (polls++ < 50 ? [] : [review("Copilot", "head")]),
    };
    const { clock } = steppedClock();
    const { verdict } = await watch(
      reader,
      clock,
      polling({ reviewTimeout: 0 })
    );
    expect(verdict).toMatchObject({ kind: "READY", exitCode: 0 });
  });

  it("lets terminal blockers win over AWAITING_REVIEW", async () => {
    const thread: ReviewThread = {
      id: "T1",
      isOutdated: false,
      firstComment: null,
      isBugbot: false,
      bugbotReviewPasses: 0,
    };
    const threaded = await watch(
      fakeReader({ threads: [thread] }),
      steppedClock().clock,
      polling()
    );
    expect(threaded.verdict).toMatchObject({ kind: "BLOCKER", exitCode: 3 });
    const failing = await watch(
      fakeReader({
        fastPath: { kind: "checks", checks: [failedCheck()] },
      }),
      steppedClock().clock,
      polling()
    );
    expect(failing.verdict).toMatchObject({ kind: "BLOCKER", exitCode: 4 });
    const conflicting = await watch(
      fakeReader({ facts: { mergeable: "CONFLICTING" } }),
      steppedClock().clock,
      polling()
    );
    expect(conflicting.verdict).toMatchObject({ kind: "BLOCKER", exitCode: 2 });
    const draft = await watch(
      fakeReader({ facts: { isDraft: true } }),
      steppedClock().clock,
      polling()
    );
    expect(draft.verdict).toMatchObject({ kind: "BLOCKER", exitCode: 6 });
  });

  it("does not query reviews without --await-review", async () => {
    const reader = fakeReader();
    const { verdict } = await watch(
      reader,
      steppedClock().clock,
      polling({ awaitReview: [] })
    );
    expect(verdict).toMatchObject({ kind: "READY" });
    expect(reader.calls).not.toContain("reviews");
  });

  it("parses repeatable --await-review and --review-timeout", () => {
    const silent = { stdout: () => {}, stderr: () => {} };
    expect(parseArgs([], silent).polling).toMatchObject({
      awaitReview: [],
      reviewTimeout: 600,
    });
    expect(
      parseArgs(
        ["--await-review", "Copilot", "--await-review", "github-actions", "--review-timeout", "0"],
        silent
      ).polling
    ).toMatchObject({
      awaitReview: ["Copilot", "github-actions"],
      reviewTimeout: 0,
    });
  });

  it("shows the awaited bot in the status-only table and JSON", async () => {
    const harness = testHarness(fakeReader());
    const code = await main(
      [
        "--owner", "owner", "--repo", "repo", "--pr", "1",
        "--await-review", "Copilot", "--status-only", "--pretty",
      ],
      harness.runtime
    );
    expect(code).toBe(0);
    expect(harness.stdout.join("")).toContain("⌛ awaiting Copilot");
  });

  it("exits 9 from main and 64 for the unsupported queued-stack combination", async () => {
    const timedOut = testHarness(fakeReader());
    expect(
      await main(
        ["--owner", "owner", "--repo", "repo", "--pr", "1",
          "--await-review", "Copilot", "--review-timeout", "20"],
        timedOut.runtime
      )
    ).toBe(9);
    expect(JSON.parse(timedOut.stdout.at(-1) ?? "")).toMatchObject({
      kind: "REVIEW_TIMEOUT",
      exitCode: 9,
    });
    const queued = testHarness(fakeReader());
    expect(
      await main(
        ["--queued-stack", "--stack-prs", "1", "--await-review", "Copilot"],
        queued.runtime
      )
    ).toBe(64);
  });

  it("holds an approver until it APPROVES the head after --since, and reports the review", async () => {
    const since = "2026-07-26T01:00:00Z";
    const options = polling({ awaitReview: ["review-bot[bot]"], since, reviewTimeout: 20 });
    const before = review("review-bot[bot]", "head", "APPROVED", "2026-07-26T00:59:00Z");
    const deferred = review("review-bot[bot]", "head", "COMMENTED", "2026-07-26T01:05:00Z", "VERDICT: DEFERRED");
    const approved = review("review-bot[bot]", "head", "APPROVED", "2026-07-26T01:06:00Z", "LGTM");

    const stale = await watch(fakeReader({ reviews: [before] }), steppedClock().clock, options);
    expect(stale.verdict).toMatchObject({ kind: "REVIEW_TIMEOUT", missing: [{ review: null }] });

    const commented = await watch(fakeReader({ reviews: [before, deferred] }), steppedClock().clock, options);
    expect(commented.events[0]).toMatchObject({
      kind: "AWAITING_REVIEW",
      missing: [{ review: { state: "COMMENTED", body: "VERDICT: DEFERRED" } }],
    });
    expect(commented.verdict).toMatchObject({ kind: "REVIEW_TIMEOUT", exitCode: 9 });

    const ready = await watch(fakeReader({ reviews: [deferred, approved] }), steppedClock().clock, options);
    expect(ready.verdict).toMatchObject({
      kind: "READY",
      scope: {
        pr: {
          headSha: "head",
          proof: { reviews: [{ satisfied: true, review: { state: "APPROVED", submittedAt: "2026-07-26T01:06:00Z" } }] },
        },
      },
    });
  });

  describe("approver run failure comment", () => {
    const since = "2026-07-26T01:00:00Z";
    const options = polling({ awaitReview: ["github-actions[bot]"], since, reviewTimeout: 600 });
    const failureBody = (runId: number) =>
      `<!-- pr-review-status: ${runId}:1 -->\n⚠️ PR Review failure.\nJob \`agent\` ended with \`failure\`. Post a new \`/review\` comment after resolving the workflow problem.`;
    const activity = (createdAt: string, authorLogin = "github-actions") => ({
      createdAt: "2026-07-25T10:00:00Z",
      viewerLogin: "agent",
      comments: [{ authorLogin, body: failureBody(42), createdAt }],
      commits: [{ oid: "head", failedChecks: [] }],
    });

    it("ends the watch with exit 10 and the status excerpt when the comment is after --since", async () => {
      const { clock, elapsed } = steppedClock();
      const { verdict, events } = await watch(
        fakeReader({ shipActivity: activity("2026-07-26T01:03:00Z") }),
        clock,
        options
      );
      expect(events).toEqual([]);
      expect(elapsed()).toBe(0);
      expect(verdict).toMatchObject({
        kind: "REVIEW_FAILED",
        terminal: true,
        exitCode: 10,
        failure: { postedAt: "2026-07-26T01:03:00Z" },
        missing: [{ login: "github-actions[bot]" }],
      });
      if (verdict.kind !== "REVIEW_FAILED") throw new Error("unreachable");
      expect(verdict.failure.excerpt).toContain("⚠️ PR Review failure.");
      expect(verdict.failure.excerpt).toContain("ended with `failure`");
      expect(verdict.failure.excerpt).not.toContain("<!--");
    });

    it("ignores a failure comment from before --since", async () => {
      const { verdict } = await watch(
        fakeReader({ shipActivity: activity("2026-07-26T00:59:00Z") }),
        steppedClock().clock,
        polling({ ...options, reviewTimeout: 20 })
      );
      expect(verdict).toMatchObject({ kind: "REVIEW_TIMEOUT", exitCode: 9 });
    });

    it("ignores the marker when someone other than the approver posts it", async () => {
      const { verdict } = await watch(
        fakeReader({ shipActivity: activity("2026-07-26T01:03:00Z", "mallory") }),
        steppedClock().clock,
        polling({ ...options, reviewTimeout: 20 })
      );
      expect(verdict).toMatchObject({ kind: "REVIEW_TIMEOUT", exitCode: 9 });
    });

    it("lets an APPROVED review of the head win over a failure comment", async () => {
      const approved = review("github-actions[bot]", "head", "APPROVED", "2026-07-26T01:06:00Z", "LGTM");
      const { verdict } = await watch(
        fakeReader({ reviews: [approved], shipActivity: activity("2026-07-26T01:03:00Z") }),
        steppedClock().clock,
        options
      );
      expect(verdict).toMatchObject({ kind: "READY", exitCode: 0 });
    });

    it("does not read comments when only Copilot is awaited", async () => {
      const reader = fakeReader({ shipActivity: activity("2026-07-26T01:03:00Z") });
      const { verdict } = await watch(
        reader,
        steppedClock().clock,
        polling({ since, reviewTimeout: 20 })
      );
      expect(verdict).toMatchObject({ kind: "REVIEW_TIMEOUT" });
      expect(reader.calls).not.toContain("shipActivity");
    });
  });

  it("waits for re-review when only the awaited bot's CHANGES_REQUESTED is on an old head", async () => {
    const options = polling({ awaitReview: ["review-bot[bot]"], reviewTimeout: 20 });
    const facts = { reviewDecision: "CHANGES_REQUESTED" } as const;
    const botOld = review("review-bot[bot]", "old", "CHANGES_REQUESTED");

    const stale = await watch(fakeReader({ facts, reviews: [botOld] }), steppedClock().clock, options);
    expect(stale.events[0]).toMatchObject({ kind: "AWAITING_REVIEW" });
    expect(stale.verdict).toMatchObject({ kind: "REVIEW_TIMEOUT", exitCode: 9 });

    const onHead = await watch(
      fakeReader({ facts, reviews: [review("review-bot[bot]", "head", "CHANGES_REQUESTED")] }),
      steppedClock().clock,
      options
    );
    expect(onHead.verdict).toMatchObject({ kind: "BLOCKER", exitCode: 6 });

    const human = await watch(
      fakeReader({ facts, reviews: [botOld, review("alice", "old", "CHANGES_REQUESTED")] }),
      steppedClock().clock,
      options
    );
    expect(human.verdict).toMatchObject({ kind: "BLOCKER", exitCode: 6 });
  });

  it("ends with exit 8 when the head is not the pinned SHA", async () => {
    const { verdict } = await watch(
      fakeReader(),
      steppedClock().clock,
      polling({ awaitReview: [], head: "abcdef1" })
    );
    expect(verdict).toMatchObject({
      kind: "BLOCKER",
      exitCode: 8,
      blocker: { kind: "head-changed", expected: "abcdef1", headSha: "head" },
    });
  });

  it("retries instead of mixing reads when the head moves mid-snapshot", async () => {
    const heads = ["abcdef1", "abcdef2", "abcdef2", "abcdef2"];
    const base = fakeReader();
    const reader: GitHubReader = {
      ...base,
      async pullRequest(requested) {
        return { ...(await base.pullRequest(requested)), headRefOid: heads.shift() ?? "abcdef2" };
      },
    };
    const { events, verdict } = await watch(
      reader,
      steppedClock().clock,
      polling({ awaitReview: [], head: "abcdef1" })
    );
    expect(events[0]).toMatchObject({ kind: "RETRY", failure: { kind: "head-moved" } });
    expect(verdict).toMatchObject({ kind: "BLOCKER", exitCode: 8, blocker: { headSha: "abcdef2" } });
  });

  it("does not count a VERDICT: DEFERRED reply as an approver run", async () => {
    const harness = testHarness(
      fakeReader({
        reviews: [
          review("review-bot[bot]", "head", "COMMENTED", "2026-07-26T01:05:00Z", "VERDICT: DEFERRED\nCI pending"),
          review("review-bot[bot]", "head", "COMMENTED", "2026-07-26T01:06:00Z", "plain comment"),
        ],
        shipActivity: {
          createdAt: "2026-07-25T10:00:00Z",
          viewerLogin: "agent",
          comments: [
            { authorLogin: "agent", body: "/review", createdAt: "2026-07-26T01:00:00Z" },
            { authorLogin: "agent", body: "/review", createdAt: "2026-07-26T01:10:00Z" },
          ],
          commits: [{ oid: "head", failedChecks: [] }],
        },
      })
    );
    await main(
      ["--owner", "owner", "--repo", "repo", "--pr", "1", "--status-only", "--approver-command", "/review"],
      harness.runtime
    );
    expect(JSON.parse(harness.stdout[0]).ship[0].approverRuns).toBe(1);

    const extra = testHarness(
      fakeReader({
        reviews: [
          review("review-bot[bot]", "head", "COMMENTED", "2026-07-26T01:05:00Z", "VERDICT: DEFERRED"),
          review("review-bot[bot]", "head", "COMMENTED", "2026-07-26T01:06:00Z", "VERDICT: DEFERRED"),
        ],
        shipActivity: {
          createdAt: "2026-07-25T10:00:00Z",
          viewerLogin: "agent",
          comments: [{ authorLogin: "agent", body: "/review", createdAt: "2026-07-26T01:00:00Z" }],
          commits: [{ oid: "head", failedChecks: [] }],
        },
      })
    );
    await main(
      ["--owner", "owner", "--repo", "repo", "--pr", "1", "--status-only", "--approver-command", "/review"],
      extra.runtime
    );
    expect(JSON.parse(extra.stdout[0]).ship[0].approverRuns).toBe(0);
  });

  it("derives ship counts from GitHub in --status-only", async () => {
    const harness = testHarness(
      fakeReader({
        reviews: [review(BOT, "a"), review("Copilot", "b"), review("someone", "b")],
        shipActivity: {
          createdAt: "2026-07-25T10:00:00Z",
          viewerLogin: "agent",
          comments: [
            { authorLogin: "agent", body: "/review", createdAt: "2026-07-25T10:01:00Z" },
            { authorLogin: "agent", body: " /review\nplease", createdAt: "2026-07-25T10:02:00Z" },
            { authorLogin: "agent", body: "/reviewer x", createdAt: "2026-07-25T10:03:00Z" },
            { authorLogin: "human", body: "/review", createdAt: "2026-07-25T10:04:00Z" },
          ],
          commits: [
            { oid: "a", failedChecks: ["lint"] },
            { oid: "b", failedChecks: ["lint", "unit", "lint"] },
            { oid: "head", failedChecks: ["lint"] },
          ],
        },
      })
    );
    expect(
      await main(
        ["--owner", "owner", "--repo", "repo", "--pr", "1", "--status-only", "--approver-command", "/review"],
        harness.runtime
      )
    ).toBe(0);
    expect(JSON.parse(harness.stdout[0]).ship).toEqual([
      {
        pr: context,
        startedAt: "2026-07-25T10:00:00Z",
        copilotReviews: 2,
        approverRuns: 2,
        ciFixes: { lint: 2, unit: 1 },
      },
    ]);
  });
});

describe("review thread triage fields", () => {
  const node = (id: string, body: string) => ({
    id,
    isResolved: false,
    isOutdated: true,
    comments: {
      nodes: [
        {
          databaseId: 777,
          body,
          createdAt: "now",
          path: "src/a.ts",
          line: 12,
          author: { login: "reviewer" },
        },
      ],
    },
  });
  const response = (...nodes: unknown[]) => ({
    data: { repository: { pullRequest: { reviewThreads: { nodes } } } },
  });

  it("returns outdated flag, comment id, author, location and a 400 char body", () => {
    const [thread] = parseReviewThreads(response(node("T", "x".repeat(500))));
    expect(thread).toMatchObject({
      id: "T",
      isOutdated: true,
      firstComment: {
        databaseId: 777,
        authorLogin: "reviewer",
        path: "src/a.ts",
        line: 12,
      },
    });
    expect(thread.firstComment?.body).toHaveLength(400);
  });

  it("still detects Bugbot passes whose run id sits beyond the truncated body", () => {
    const bugbot = {
      ...node("B", `${"y".repeat(450)} RUN_ID: late-run`),
    };
    bugbot.comments.nodes[0].author.login = "bugbot";
    const [thread] = parseReviewThreads(response(bugbot));
    expect(thread.isBugbot).toBe(true);
    expect(thread.bugbotReviewPasses).toBe(1);
    expect(thread.firstComment?.body).toHaveLength(400);
  });

  it("defaults the new fields when GitHub omits them", () => {
    const bare = {
      id: "T",
      isResolved: false,
      comments: {
        nodes: [
          { body: "hi", createdAt: "now", path: null, line: null, author: null },
        ],
      },
    };
    const [thread] = parseReviewThreads(response(bare));
    expect(thread.isOutdated).toBe(false);
    expect(thread.firstComment?.databaseId).toBeNull();
  });

  it("surfaces the fields in pretty and JSON output", async () => {
    const thread: ReviewThread = {
      id: "T9",
      isOutdated: true,
      firstComment: {
        databaseId: 4242,
        authorLogin: "reviewer",
        body: "please fix",
        path: "src/a.ts",
        line: 3,
        createdAt: "now",
      },
      isBugbot: false,
      bugbotReviewPasses: 0,
    };
    const args = ["--owner", "owner", "--repo", "repo", "--pr", "1"];
    const pretty = testHarness(fakeReader({ threads: [thread] }));
    expect(await main([...args, "--pretty"], pretty.runtime)).toBe(3);
    expect(pretty.stdout.join("")).toContain("isOutdated=true commentId=4242");
    const json = testHarness(fakeReader({ threads: [thread] }));
    await main(args, json.runtime);
    expect(JSON.parse(json.stdout[0])).toMatchObject({
      blocker: {
        threads: [
          { id: "T9", isOutdated: true, firstComment: { databaseId: 4242 } },
        ],
      },
    });
  });
});

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "watch-pr-"));
  tempDirs.push(dir);
  return dir;
};

interface TestHarness {
  readonly runtime: CliRuntime;
  readonly stdout: string[];
  readonly stderr: string[];
}

function testHarness(reader: GitHubReader): TestHarness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let now = 0;
  const runtime: CliRuntime = {
    reader,
    clock: {
      now: () => now,
      observedAt: () => "2026-07-26T00:00:00.000Z",
      async sleep(seconds) {
        now += seconds;
      },
    },
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  };
  return { runtime, stdout, stderr };
}

describe("resolve-thread", () => {
  it("replies first, then resolves", async () => {
    const reader = fakeReader();
    const harness = testHarness(reader);
    const code = await main(
      ["resolve-thread", "--pr", "1", "--thread", "T1", "--body", "Fixed in abc"],
      harness.runtime
    );
    expect(code).toBe(0);
    expect(reader.calls).toEqual(["reply:T1:Fixed in abc", "resolve:T1"]);
    expect(harness.stdout).toEqual([]);
  });

  it("reads the reply from --body-file and resolves quietly without a body", async () => {
    const file = join(tempDir(), "reply.md");
    writeFileSync(file, "From file\n");
    const withFile = fakeReader();
    await main(
      ["resolve-thread", "--pr", "1", "--thread", "T2", "--body-file", file],
      testHarness(withFile).runtime
    );
    expect(withFile.calls).toEqual(["reply:T2:From file\n", "resolve:T2"]);
    const bare = fakeReader();
    expect(
      await main(
        ["resolve-thread", "--pr", "1", "--thread", "T3", "--repo", "o/r"],
        testHarness(bare).runtime
      )
    ).toBe(0);
    expect(bare.calls).toEqual(["resolve:T3"]);
  });

  it("is idempotent when the thread is already resolved", async () => {
    const reader = fakeReader();
    const argv = ["resolve-thread", "--pr", "1", "--thread", "T4"];
    expect(await main(argv, testHarness(reader).runtime)).toBe(0);
    expect(await main(argv, testHarness(reader).runtime)).toBe(0);
    expect(reader.calls).toEqual(["resolve:T4", "resolve:T4"]);
  });

  it("retries a failed resolve without posting the reply twice", async () => {
    let failures = 1;
    const base = fakeReader();
    const reader: GitHubReader = {
      ...base,
      async resolveThread(threadId) {
        await base.resolveThread(threadId);
        if (failures-- > 0)
          throw new WatcherQueryError({
            kind: "command-exit",
            retryable: true,
            code: 1,
            detail: "boom",
          });
      },
    };
    const harness = testHarness(reader);
    const code = await main(
      ["resolve-thread", "--pr", "1", "--thread", "T5", "--body", "hi"],
      harness.runtime
    );
    expect(code).toBe(0);
    expect(base.calls).toEqual(["reply:T5:hi", "resolve:T5", "resolve:T5"]);
    expect(harness.stdout).toHaveLength(1);
    expect(JSON.parse(harness.stdout[0])).toMatchObject({ kind: "RETRY" });
  });

  it("exits 7 when the query keeps failing", async () => {
    const reader: GitHubReader = {
      ...fakeReader(),
      async resolveThread() {
        throw new WatcherQueryError({
          kind: "command-exit",
          retryable: true,
          code: 1,
          detail: "boom",
        });
      },
    };
    const harness = testHarness(reader);
    const code = await main(
      ["resolve-thread", "--pr", "1", "--thread", "T6", "--max-query-errors", "2"],
      harness.runtime
    );
    expect(code).toBe(7);
    expect(JSON.parse(harness.stdout.at(-1) ?? "")).toMatchObject({
      kind: "BLOCKER",
      exitCode: 7,
      blocker: { kind: "status-query" },
    });
  });

  it("rejects missing, conflicting and blank input as usage", async () => {
    for (const argv of [
      ["resolve-thread", "--pr", "1"],
      ["resolve-thread", "--thread", "T"],
      ["resolve-thread", "--pr", "1", "--thread", "T", "--body", "a", "--body-file", "b"],
      ["resolve-thread", "--pr", "1", "--thread", "T", "--body", "  "],
      ["resolve-thread", "--pr", "1", "--thread", "T", "--body-file", "/nonexistent/file"],
      ["resolve-thread", "--pr", "1", "--thread", "T", "--repo", "bad"],
    ]) {
      const reader = fakeReader();
      expect(await main(argv, testHarness(reader).runtime)).toBe(64);
      expect(reader.calls).toEqual([]);
    }
  });
});
