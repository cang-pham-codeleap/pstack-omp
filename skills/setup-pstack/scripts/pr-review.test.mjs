import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detect, NO_CLASSIC_REVIEWS, parseInstalled, render, requiredSecrets, requiresCodeOwnerReview } from './pr-review.mjs';

const repoWithRemote = url => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-review-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (url) execFileSync('git', ['remote', 'add', 'origin', url], { cwd: dir });
  return dir;
};

describe('render', () => {
  it('gives copilot the copilot-requests permission and the deny-tool sandbox, and claude neither', () => {
    const copilot = render({ engine: 'copilot', model: 'gpt-5.6-luna' })['pr-review.md'];
    const claude = render({ engine: 'claude' })['pr-review.md'];
    expect(copilot).toContain('  statuses: read\n  copilot-requests: write\njobs:');
    expect(copilot).toContain('engine:\n  id: copilot\n  model: gpt-5.6-luna\n  args:\n    - --reasoning-effort=high\n    - --deny-tool=write\n');
    expect(claude).toContain('  statuses: read\njobs:');
    expect(claude).toContain('engine:\n  id: claude\nruns-on: ubuntu-24.04');
  });

  it('wires a custom trigger into the slash command, the validation regex, and the retry hint', () => {
    const files = render({ command: 'ai-review' });
    expect(files['pr-review.md']).toContain('slash_command:\n    name: ai-review\n');
    expect(files['pr-review.md']).toContain('!/^\\/ai-review(?:\\s|$)/.test(');
    expect(files['pr-review.md']).not.toContain('__');
    expect(files['pr-review-status.yml']).toContain('Post a new \\`/ai-review\\` comment');
  });

  it('rejects an unsupported engine and a trigger that would break the regex', () => {
    expect(() => render({ engine: 'codex' })).toThrow('engine must be one of copilot, claude');
    expect(() => render({ command: 're(view' })).toThrow('command must match');
  });

  it('reads back what it rendered', () => {
    expect(parseInstalled(render({ engine: 'copilot', model: 'gpt-5.6-luna', command: 'check' })['pr-review.md']))
      .toEqual({ engine: 'copilot', command: 'check', model: 'gpt-5.6-luna' });
    expect(parseInstalled(render({ engine: 'claude' })['pr-review.md'])).toEqual({ engine: 'claude', command: 'review', model: null });
  });
});

describe('requiredSecrets', () => {
  it('returns each validated secret group and ignores optional OAuth tokens', () => {
    const lock = [
      '        run: bash "${RUNNER_TEMP}/gh-aw/actions/validate_multi_secret.sh" ANTHROPIC_API_KEY \'Claude Code\' https://x',
      '          COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}',
    ].join('\n');
    expect(requiredSecrets(lock)).toEqual([['ANTHROPIC_API_KEY']]);
    expect(requiredSecrets('COPILOT_GITHUB_TOKEN: ${{ github.token }}')).toEqual([]);
  });
});

describe('detect', () => {
  it('reports a non-GitHub remote and a repo without a remote as not GitHub', () => {
    expect(detect(repoWithRemote('git@gitlab.com:acme/app.git')).github).toBe(false);
    expect(detect(repoWithRemote()).github).toBe(false);
  });

  it('flags another workflow that already answers the trigger, and reads the installed config', () => {
    const dir = repoWithRemote();
    mkdirSync(join(dir, '.github/workflows'), { recursive: true });
    writeFileSync(join(dir, '.github/workflows/old-review.yml'), "if: startsWith(github.event.comment.body, '/review')\n");
    writeFileSync(join(dir, '.github/workflows/build.yml'), 'run: npm test -- --reviewer\n');
    writeFileSync(join(dir, '.github/workflows/pr-review.md'), render({ engine: 'claude' })['pr-review.md']);
    const state = detect(dir);
    expect(state.conflicts).toEqual(['.github/workflows/old-review.yml']);
    expect(state.installed).toEqual({ engine: 'claude', command: 'review', model: null });
  });
});

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

// Runs the safe-outputs publication gate from the rendered workflow against one agent output.
async function gate(items) {
  const text = render({})['pr-review.md'];
  const block = text.slice(text.indexOf('id: verify_review_target'));
  const script = block.slice(block.indexOf('script: |\n') + 10, block.indexOf('\n---\n')).replace(/^ {10}/gm, '');
  const dir = mkdtempSync(join(tmpdir(), 'pr-review-gate-'));
  const outputPath = join(dir, 'output.json');
  writeFileSync(outputPath, JSON.stringify({ items }));
  const repo = { id: 1 };
  const live = { state: 'open', head: { sha: HEAD, repo }, base: { sha: BASE, repo } };
  const logs = [];
  const run = new (Object.getPrototypeOf(async () => {}).constructor)('github', 'context', 'core', 'require', 'process', script);
  await run(
    { rest: { pulls: { get: async () => ({ data: live }) } } },
    { repo: { owner: 'acme', repo: 'app' }, payload: { repository: repo } },
    { info: m => logs.push(m) },
    (await import('node:module')).createRequire(import.meta.url),
    { env: { GH_AW_AGENT_OUTPUT: outputPath, EXPECTED_PR_NUMBER: '7', EXPECTED_HEAD_SHA: HEAD, EXPECTED_BASE_SHA: BASE } },
  );
  return logs;
}

const review = (event, body) => ({ type: 'submit_pull_request_review', event, body });
const comment = body => ({ type: 'add_comment', body });
const deferred = 'VERDICT: DEFERRED\nSummary: CI run 42 is still in progress; re-run /review when it finishes.';

describe('publication gate', () => {
  it('publishes a deferred verdict as one COMMENT review, which ship-to-green reads as DEFERRED', async () => {
    expect(await gate([review('COMMENT', deferred)])).toEqual(['Verdict deferred; publishing a COMMENT review only.']);
  });

  it('refuses a deferred verdict sent as a comment or with an approving event', async () => {
    await expect(gate([comment(deferred)])).rejects.toThrow('Expected exactly one formal review');
    await expect(gate([review('APPROVE', deferred)])).rejects.toThrow('Expected exactly one formal review');
  });

  it('refuses a COMMENT review that carries a real verdict', async () => {
    const body = `VERDICT: APPROVE\nReviewed commit: ${HEAD}\nReviewed base: ${BASE}\nSummary: fine.`;
    await expect(gate([review('COMMENT', body), comment('VERDICT: APPROVE\nSummary: fine.')])).rejects.toThrow('same valid verdict');
  });

  it('passes a matching approval bound to the captured head and base', async () => {
    const body = `VERDICT: APPROVE\nReviewed commit: ${HEAD}\nReviewed base: ${BASE}\nSummary: fine.`;
    expect(await gate([review('APPROVE', body), comment('VERDICT: APPROVE\nSummary: fine.')])).toEqual([]);
  });
});

// Runs one github-script body from a rendered template, cut between `script: |` and `end`.
async function runScript(text, after, end, github, payload, outputs = {}) {
  const block = text.slice(text.indexOf(after));
  const script = block.slice(block.indexOf('script: |\n') + 10, block.indexOf(end)).replace(/^ {10}/gm, '').replace(/^ {2}/gm, '');
  const run = new (Object.getPrototypeOf(async () => {}).constructor)('github', 'context', 'core', script);
  await run(github, { repo: { owner: 'acme', repo: 'app' }, payload }, { info: () => {}, setOutput: (k, v) => { outputs[k] = v; } });
  return outputs;
}

describe('pre-activation', () => {
  const request = async author => {
    const repo = { id: 1 };
    const pr = { number: 7, state: 'open', user: { login: author }, head: { sha: HEAD, repo }, base: { sha: BASE, repo } };
    const payload = { action: 'created', repository: repo, issue: { number: 7, pull_request: { url: 'x' } },
      comment: { body: '/review', user: { login: 'dev' }, author_association: 'COLLABORATOR' } };
    return runScript(render({})['pr-review.md'], 'id: validate_review_request', '\nrun-name:', { rest: { pulls: { get: async () => ({ data: pr }) } } }, payload);
  };

  it('refuses a PR that GitHub Actions opened, because the bot cannot review its own PR', async () => {
    await expect(request('github-actions[bot]')).rejects.toThrow('GitHub Actions opened this pull request');
  });

  it('accepts a collaborator request on a PR another bot opened', async () => {
    expect(await request('dependabot[bot]')).toMatchObject({ should_review: 'true', pr_number: '7', head_sha: HEAD });
  });
});

describe('stale approval label', () => {
  const push = async removeLabel => runScript(render({})['pr-review-status.yml'], 'clear-stale-approval:', '\n  report:',
    { rest: { issues: { removeLabel } } }, { pull_request: { number: 7 } });

  it('drops ready-for-merge from the PR when a new head is pushed', async () => {
    const calls = [];
    await push(async args => { calls.push(args); });
    expect(calls).toEqual([{ owner: 'acme', repo: 'app', issue_number: 7, name: 'ready-for-merge' }]);
  });

  it('tolerates a PR without the label but surfaces other API failures', async () => {
    await push(async () => { throw Object.assign(new Error('Label does not exist'), { status: 404 }); });
    await expect(push(async () => { throw Object.assign(new Error('boom'), { status: 500 }); })).rejects.toThrow('boom');
  });
});

describe('requiresCodeOwnerReview', () => {
  const ruleset = require => JSON.stringify([{ type: 'pull_request', parameters: { require_code_owner_review: require } }]);

  it('reports a code-owner requirement from a ruleset or classic protection', () => {
    expect(requiresCodeOwnerReview({ rules: ruleset(true), protection: null })).toBe(true);
    expect(requiresCodeOwnerReview({ rules: '[]', protection: '{"require_code_owner_reviews":true}' })).toBe(true);
  });

  it('reports false only when both rulesets and classic protection are known to be clear', () => {
    expect(requiresCodeOwnerReview({ rules: ruleset(false), protection: NO_CLASSIC_REVIEWS })).toBe(false);
    expect(requiresCodeOwnerReview({ rules: '[]', protection: '{"require_code_owner_reviews":false}' })).toBe(false);
  });

  it('reports unknown when classic protection could not be read', () => {
    expect(requiresCodeOwnerReview({ rules: '[]', protection: null })).toBeNull();
    expect(requiresCodeOwnerReview({ rules: null, protection: NO_CLASSIC_REVIEWS })).toBeNull();
  });
});
