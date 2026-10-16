import type * as T from "./types.ts";
export const renderJson = (verdict: T.WatcherVerdict): string =>
  `${JSON.stringify(verdict)}\n`;
function ciCell(row: T.PrSnapshot): string {
  if (row.kind !== "open") return "\u2014";
  const was = row.ci.hadPreviousPassingCi ? ", was ✅" : "";
  switch (row.ci.kind) {
    case "ci-clean":
      return "✅";
    case "ci-pending":
      return `⏳ ${row.ci.pending.length} pending${was}`;
    case "ci-failing":
      return `❌ ${row.ci.failed.length} failed${row.ci.pending.length ? `, ${row.ci.pending.length} pending` : ""}${was}`;
    case "ci-github-rejected":
      return `❌ GitHub reports failing checks${was}`;
    default: {
      const exhaustive: never = row.ci;
      return exhaustive;
    }
  }
}
function reviewCell(row: T.PrSnapshot): string {
  if (row.kind !== "open") return "\u2014";
  const open = row.threads.length;
  const base = row.reviewAutomationRunning
    ? open
      ? `🤖 running, ${open} open`
      : "🤖 running"
    : open
      ? `📝 ${open} open`
      : "✅";
  const awaiting = row.awaitedReviews
    .filter((review) => !review.satisfied)
    .map((review) => review.login);
  if (awaiting.length === 0) return base;
  return `${base === "✅" ? "" : `${base}, `}⌛ awaiting ${awaiting.join(", ")}`;
}
function mergeCell(row: T.PrSnapshot): string {
  if (row.kind === "merged") return "✅ merged";
  if (row.kind === "closed") return "❌ closed";
  if (row.facts.isDraft) return "⏸ draft";
  if (row.facts.reviewDecision === "CHANGES_REQUESTED")
    return "⚠️ changes requested";
  return row.facts.mergeable === "CONFLICTING" ||
    row.facts.mergeStateStatus === "DIRTY" ||
    row.facts.mergeStateStatus === "CONFLICTING"
    ? "⚠️ conflict"
    : "✅";
}
export function renderStatusTable(rows: T.NonEmpty<T.PrSnapshot>): string {
  const lines = ["| PR | CI | Review | Merge |", "| --- | --- | --- | --- |"];
  for (const row of rows) {
    const url = `https://github.com/${row.context.owner}/${row.context.repo}/pull/${row.context.number}`;
    lines.push(
      `| [#${row.context.number}](${url}) | ${ciCell(row)} | ${reviewCell(row)} | ${mergeCell(row)} |`
    );
  }
  return `${lines.join("\n")}\n`;
}
const missingLines = (missing: T.NonEmpty<T.MissingReview>): string =>
  missing
    .map(
      (item) =>
        `awaiting=${item.login} pr=${item.pr.number} head=${item.headSha ?? "None"} reviewed=${item.reviewedSha ?? "None"}${item.review === null ? "" : ` state=${item.review.state} submittedAt=${item.review.submittedAt ?? "None"} body=${item.review.body.split(/\r?\n/, 1)[0]?.slice(0, 180) ?? ""}`}`
    )
    .join("\n");
function threadLine(thread: T.ReviewThread): string {
  const comment = thread.firstComment;
  return [
    thread.id,
    comment?.path ?? "None",
    comment?.line ?? "None",
    comment?.authorLogin ?? "None",
    `isBugBot=${thread.isBugbot}`,
    `isOutdated=${thread.isOutdated}`,
    `commentId=${comment?.databaseId ?? "None"}`,
    `bugbotReviewPasses=${thread.bugbotReviewPasses}`,
    (comment?.body ?? "").split(/\r?\n/, 1)[0]?.slice(0, 180) ?? "",
  ].join(" ");
}
type StatusQueryBlocker = {
  readonly kind: "status-query";
  readonly failures: number;
  readonly failure: { readonly detail: string };
};
function renderBlocker(blocker: T.MergeBlocker | StatusQueryBlocker): string {
  const head = blocker.kind === "status-query" ? [] : [`head=${blocker.headSha ?? "None"}`];
  switch (blocker.kind) {
    case "merge-conflicts":
      return [
        "BLOCKER: merge-conflicts",
        `pr=${blocker.pr.number}`,
        ...head,
        `mergeable=${blocker.facts.mergeable}`,
        `mergeStateStatus=${blocker.facts.mergeStateStatus}`,
        "action=resolve merge conflicts before waiting for CI",
      ].join("\n");
    case "review-threads":
      return [
        "BLOCKER: review-threads",
        `pr=${blocker.pr.number}`,
        ...head,
        `unresolved=${blocker.threads.length}`,
        ...blocker.threads.map(threadLine),
      ].join("\n");
    case "failing-checks": {
      const failed = blocker.ci.kind === "ci-failing" ? blocker.ci.failed : [];
      const details = failed.map(
        (check) =>
          `${check.name} ${check.reportedState} ${check.description} ${check.link}`
      );
      if (blocker.ci.kind === "ci-github-rejected")
        details.push(
          `mergeStateStatus=${blocker.ci.github.mergeStateStatus}`,
          `headRollupState=${blocker.ci.github.headRollupState}`
        );
      return [
        "BLOCKER: failing-checks",
        `pr=${blocker.pr.number}`,
        ...head,
        `failed=${failed.length}`,
        ...details,
      ].join("\n");
    }
    case "merge-gate": {
      const action =
        blocker.reason === "closed-without-merge"
          ? "restore or remove the closed PR from the queued stack"
          : blocker.reason === "draft-pr"
            ? "mark the PR ready for review before waiting for the merge queue"
            : "resolve the changes-requested review before waiting for the merge queue";
      return [
        `BLOCKER: ${blocker.reason}`,
        `pr=${blocker.pr.number}`,
        ...head,
        ...blocker.reviews.flatMap((review) =>
          review.review === null
            ? []
            : [`review=${review.login} state=${review.review.state} reviewed=${review.reviewedOid ?? "None"}`]
        ),
        `action=${action}`,
      ].join("\n");
    }
    case "head-changed":
      return [
        "BLOCKER: head-changed",
        `pr=${blocker.pr.number}`,
        `expected=${blocker.expected}`,
        ...head,
        "action=someone else pushed; stop and report, or re-arm with the new head if the push was yours",
      ].join("\n");
    case "status-query":
      return [
        "BLOCKER: status-query",
        `failures=${blocker.failures}`,
        `detail=${blocker.failure.detail}`,
        "action=verify current PR context, GitHub authentication, and API availability, then rearm",
      ].join("\n");
    default: {
      const exhaustive: never = blocker;
      return exhaustive;
    }
  }
}
export function renderPretty(verdict: T.WatcherVerdict): string {
  switch (verdict.kind) {
    case "QUEUE":
      return `QUEUE: captured ${verdict.queue.length} PR${verdict.queue.length === 1 ? "" : "s"} bottom-to-top: ${verdict.queue.map((pr) => `#${pr.number}`).join(",")}\n`;
    case "STATUS":
      return verdict.terminal
        ? `${renderStatusTable(verdict.rows)}${verdict.ship
            .map(
              (counts) =>
                `ship pr=${counts.pr.number} startedAt=${counts.startedAt} copilotReviews=${counts.copilotReviews} approverRuns=${counts.approverRuns ?? "None"} ciFixes=${Object.entries(counts.ciFixes).map(([name, count]) => `${name}:${count}`).join(",") || "None"}\n`
            )
            .join("")}`
        : renderStatusTable(verdict.rows);
    case "WAITING":
      return verdict.reason.kind === "pending-checks"
        ? `WAITING: frontier=#${verdict.frontier.number}; ${verdict.reason.pending.length} check${verdict.reason.pending.length === 1 ? "" : "s"} pending\n`
        : `WAITING: frontier=#${verdict.frontier.number} is blocker-free; waiting for merge queue (${verdict.reason.unmergedCount} PR${verdict.reason.unmergedCount === 1 ? "" : "s"} unmerged)\n`;
    case "ADVANCE":
      return `ADVANCE: merged #${verdict.merged.number}; next=#${verdict.frontier.number}; remaining=${verdict.remaining}\n`;
    case "RETRY":
      return `RETRY: GitHub status query failed; retrying in ${verdict.retryInSeconds}s\ndetail=${verdict.failure.detail}\n`;
    case "BLOCKER":
      return `${renderBlocker(verdict.blocker)}\n`;
    case "READY": {
      const detail =
        verdict.scope.kind === "single" && verdict.scope.pr.kind === "ready-pr"
          ? `\nhead=${verdict.scope.pr.headSha ?? "None"}\nmergeStateStatus=${verdict.scope.pr.proof.ci.github.mergeStateStatus}\nreviewDecision=${verdict.scope.pr.proof.gate.reviewDecision}\nisDraft=${verdict.scope.pr.proof.gate.draft === "draft-allowed"}${verdict.scope.pr.proof.gate.draft === "draft-allowed" ? "\nnote=draft allowed (--allow-draft); leave draft \u2014 do not mark ready" : ""}${verdict.scope.pr.proof.reviews.map((review) => `\nreview=${review.login} state=${review.review?.state ?? "None"} submittedAt=${review.review?.submittedAt ?? "None"}`).join("")}`
          : "";
      return `READY: no merge conflicts, no unresolved review threads, no failing or pending checks${detail}\n`;
    }
    case "COMPLETE":
      return `COMPLETE: queued stack merged (${verdict.queue.length} PR${verdict.queue.length === 1 ? "" : "s"})\n`;
    case "TIMEOUT":
      if (verdict.reason.kind === "pending-checks")
        return "TIMEOUT: checks still pending\n";
      if (verdict.reason.kind === "status-unavailable")
        return "TIMEOUT: GitHub status remained unavailable\n";
      if (verdict.reason.kind === "awaiting-review")
        return `TIMEOUT: still awaiting review\n${missingLines(verdict.reason.missing)}\n`;
      return `TIMEOUT: queued stack still has ${verdict.reason.unmergedCount} PR${verdict.reason.unmergedCount === 1 ? "" : "s"} unmerged; frontier=#${verdict.reason.frontier.number}\n`;
    case "AWAITING_REVIEW":
      return `AWAITING_REVIEW: waiting for review of the head commit\n${missingLines(verdict.missing)}\n`;
    case "REVIEW_TIMEOUT":
      return `REVIEW_TIMEOUT: no review of the head commit after ${Math.round(verdict.waitedSeconds)}s\n${missingLines(verdict.missing)}\n`;
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}
