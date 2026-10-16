import type {
  Check,
  ChecksFastPath,
  CommitRollup,
  GitHubReader,
  OpenPullRequest,
  PrContext,
  PrReview,
  PullRequestFacts,
  Repository,
  ReviewThread,
  RollupPage,
  WorkflowRun,
} from "./types.ts";
import { parsePrNumber } from "./types.ts";

export interface FakeReaderOptions {
  readonly facts?: Partial<Omit<PullRequestFacts, "context">>;
  readonly fastPath?: ChecksFastPath;
  readonly rollupPages?: readonly RollupPage[];
  readonly threads?: readonly ReviewThread[];
  readonly commitRollups?: readonly CommitRollup[];
  readonly reviews?: readonly PrReview[];
  readonly openPullRequests?: readonly OpenPullRequest[];
  readonly origin?: Repository | null;
  readonly current?: PrContext;
  readonly workflowRuns?: readonly WorkflowRun[];
}

export function passingCheck(name = "ci"): Check {
  return {
    kind: "passed",
    name,
    reportedState: "SUCCESS",
    description: "",
    link: "",
    workflow: "",
  };
}

export function pendingCheck(name = "ci"): Check {
  return {
    kind: "pending",
    name,
    reportedState: "PENDING",
    description: "",
    link: "",
    workflow: "",
  };
}

export function failedCheck(name = "ci"): Check {
  return {
    kind: "failed",
    name,
    reportedState: "FAILURE",
    description: "",
    link: "",
    workflow: "",
  };
}

export function fakeReader(
  options: FakeReaderOptions = {}
): GitHubReader & { readonly calls: readonly string[] } {
  const calls: string[] = [];
  const context = options.current ?? {
    owner: "owner",
    repo: "repo",
    number: parsePrNumber(1),
  };
  const defaults: PullRequestFacts = {
    context,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    headRefOid: "head",
    headRefName: "feature",
    baseRefName: "main",
    state: "OPEN",
    mergedAt: null,
    isDraft: false,
  };
  let page = 0;
  return {
    calls,
    async originRepo() {
      calls.push("originRepo");
      return options.origin === undefined
        ? { owner: "owner", repo: "repo" }
        : options.origin;
    },
    async currentPr(pr) {
      calls.push("currentPr");
      return { ...context, number: pr ?? context.number };
    },
    async pullRequest(requested) {
      calls.push("pullRequest");
      return { ...defaults, ...options.facts, context: requested };
    },
    async openPullRequests() {
      calls.push("openPullRequests");
      return options.openPullRequests ?? [];
    },
    async checksFastPath() {
      calls.push("checksFastPath");
      return options.fastPath ?? { kind: "checks", checks: [passingCheck()] };
    },
    async checkRollupPage(_requested, after) {
      calls.push(`checkRollupPage:${after ?? "null"}`);
      return options.rollupPages?.[page++] ?? { checks: [], endCursor: null };
    },
    async reviewThreads() {
      calls.push("reviewThreads");
      return options.threads ?? [];
    },
    async commitRollups() {
      calls.push("commitRollups");
      return options.commitRollups ?? [{ oid: "head", state: "SUCCESS" }];
    },
    async reviews() {
      calls.push("reviews");
      return options.reviews ?? [];
    },
    async replyToThread(threadId, body) {
      calls.push(`reply:${threadId}:${body}`);
    },
    async resolveThread(threadId) {
      calls.push(`resolve:${threadId}`);
    },
    async workflowRuns(repository, limit) {
      calls.push(`workflowRuns:${repository.owner}/${repository.repo}:${limit}`);
      return options.workflowRuns ?? [];
    },
  };
}
