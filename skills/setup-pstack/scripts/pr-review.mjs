#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const WORKFLOWS = '.github/workflows';
export const FILES = { workflow: 'pr-review.md', lock: 'pr-review.lock.yml', status: 'pr-review-status.yml' };

const COPILOT_ARGS = ['--reasoning-effort=high', '--deny-tool=write', ...['cat', 'date', 'echo', 'grep', 'head', 'ls', 'printf', 'pwd', 'sort', 'tail', 'uniq', 'wc', 'yq'].map(t => `--deny-tool=shell(${t})`)];
// Copilot bills through the workflow's own token, so it needs a permission instead of an API-key secret.
// Codex is absent: gh-aw ignores the bash allowlist for it, which would drop the read-only sandbox.
export const ENGINES = {
  copilot: { permissions: '  copilot-requests: write\n', args: COPILOT_ARGS },
  claude: { permissions: '', args: [] },
};

export function render({ engine = 'copilot', model, command = 'review' }) {
  if (!ENGINES[engine]) throw new Error(`engine must be one of ${Object.keys(ENGINES).join(', ')}`);
  if (!/^[a-z][a-z0-9-]*$/.test(command)) throw new Error('command must match [a-z][a-z0-9-]*');
  if (model !== undefined && !/^[\w.:/-]+$/.test(model)) throw new Error(`invalid model: ${model}`);
  const { permissions, args } = ENGINES[engine];
  const engineBlock = ['engine:', `  id: ${engine}`, ...(model ? [`  model: ${model}`] : []),
    ...(args.length ? ['  args:', ...args.map(a => `    - ${a}`)] : [])].join('\n') + '\n';
  const fill = text => text.replaceAll('__COMMAND__', command).replace('__ENGINE_PERMISSIONS__', permissions).replace('__ENGINE__', engineBlock);
  return {
    [FILES.workflow]: fill(readFileSync(join(TEMPLATES, FILES.workflow), 'utf8')),
    [FILES.status]: fill(readFileSync(join(TEMPLATES, FILES.status), 'utf8')),
  };
}

export function parseInstalled(text) {
  const command = text.match(/slash_command:\n\s+name: (\S+)/)?.[1];
  const engine = text.match(/^engine:\n\s+id: (\S+)/m)?.[1];
  if (!command || !engine) return null;
  return { engine, command, model: text.match(/^engine:\n\s+id: \S+\n\s+model: (\S+)/m)?.[1] ?? null };
}

// Each group is a set of alternatives the compiled lock validates before the agent runs; one present secret satisfies it.
export function requiredSecrets(lockText) {
  return [...lockText.matchAll(/validate_multi_secret\.sh"?((?: [A-Z][A-Z0-9_]+)+)/g)].map(m => m[1].trim().split(' '));
}

const sh = (cmd, args, cwd) => {
  try { return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return null; }
};

export function detect(cwd, command) {
  const remote = sh('git', ['remote', 'get-url', 'origin'], cwd) ?? sh('git', ['remote'], cwd)?.split('\n').filter(Boolean).map(r => sh('git', ['remote', 'get-url', r], cwd)).find(Boolean) ?? null;
  const repo = remote ? sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], cwd) : null;
  const github = Boolean(repo) || /github\.com[:/]/.test(remote ?? '');
  const dir = join(cwd, WORKFLOWS);
  const installedPath = join(dir, FILES.workflow);
  const installed = existsSync(installedPath) ? parseInstalled(readFileSync(installedPath, 'utf8')) : null;
  const trigger = new RegExp(`/${command ?? installed?.command ?? 'review'}\\b`);
  const conflicts = existsSync(dir) ? readdirSync(dir)
    .filter(f => !Object.values(FILES).includes(f) && /\.(ya?ml|md)$/.test(f) && trigger.test(readFileSync(join(dir, f), 'utf8')))
    .map(f => `${WORKFLOWS}/${f}`) : [];
  const canApprove = repo ? sh('gh', ['api', `repos/${repo}/actions/permissions/workflow`, '--jq', '.can_approve_pull_request_reviews'], cwd) : null;
  return {
    // gh aw prints its version on stderr.
    github, remote, repo, ghAw: spawnSync('gh', ['aw', 'version'], { cwd, encoding: 'utf8' }).stderr?.match(/version (v\S+)/)?.[1] ?? null,
    installed, conflicts, canApprove: canApprove === null ? null : canApprove === 'true',
  };
}

export function install(cwd, opts) {
  const files = render(opts);
  const state = detect(cwd, opts.command);
  if (!state.github) throw new Error('origin is not a GitHub remote; nothing to install');
  if (!state.repo) throw new Error('gh cannot see this repository; run `gh auth login` and retry');
  if (!state.ghAw) execFileSync('gh', ['extension', 'install', 'github/gh-aw'], { cwd, stdio: ['ignore', 2, 2] });
  const dir = join(cwd, WORKFLOWS);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  try {
    execFileSync('gh', ['aw', 'compile', FILES.workflow.replace(/\.md$/, '')], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    throw new Error(`gh aw compile failed:\n${err.stdout ?? ''}${err.stderr ?? ''}`);
  }
  const needed = requiredSecrets(readFileSync(join(dir, FILES.lock), 'utf8'));
  const present = new Set((sh('gh', ['secret', 'list', '--json', 'name', '--jq', '.[].name'], cwd) ?? '').split('\n'));
  let canApprove = state.canApprove;
  let canApproveError = null;
  if (!canApprove) {
    const current = sh('gh', ['api', `repos/${state.repo}/actions/permissions/workflow`, '--jq', '.default_workflow_permissions'], cwd) ?? 'read';
    try {
      execFileSync('gh', ['api', '-X', 'PUT', `repos/${state.repo}/actions/permissions/workflow`, '-f', `default_workflow_permissions=${current}`, '-F', 'can_approve_pull_request_reviews=true'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      canApprove = true;
    } catch (err) {
      canApproveError = String(err.stderr ?? err.message).trim();
    }
  }
  return {
    repo: state.repo,
    files: [...[FILES.workflow, FILES.lock, FILES.status].map(f => `${WORKFLOWS}/${f}`), '.github/aw/actions-lock.json', '.gitattributes'].filter(f => existsSync(join(cwd, f))),
    missingSecrets: needed.filter(group => !group.some(s => present.has(s))),
    canApprove, canApproveError, conflicts: state.conflicts,
    ...approvalBlockers(readReviewRules(cwd, state.repo)),
  };
}

export const NO_CLASSIC_REVIEWS = 'none';

// The default branch's review rules: its rulesets (any reader can see them) and classic protection (admins only).
function readReviewRules(cwd, repo) {
  const branch = sh('gh', ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'], cwd);
  if (!branch) return { branch: null, rules: null, classic: null };
  const rules = JSON.parse(sh('gh', ['api', `repos/${repo}/rules/branches/${branch}`], cwd) ?? 'null');
  const res = spawnSync('gh', ['api', `repos/${repo}/branches/${branch}/protection/required_pull_request_reviews`], { cwd, encoding: 'utf8' });
  const classic = res.status === 0 ? JSON.parse(res.stdout) : /Branch not protected|not enabled/.test(res.stderr ?? '') ? NO_CLASSIC_REVIEWS : null;
  return { branch, rules, classic };
}

// Why the bot's single approval would not make a PR mergeable under one source's review settings.
function reviewReasons(count, codeOwners, requiredReviewers) {
  return [
    ...(count > 1 ? [`requires ${count} approvals; the bot gives one`] : []),
    ...(codeOwners ? ['requires a code-owner review, which the bot never satisfies'] : []),
    ...(requiredReviewers?.length ? ['requires specific reviewers for some paths'] : []),
  ];
}

// approvalKnown is false when classic protection was unreadable, so an empty list is not proof.
export function approvalBlockers({ rules, classic }) {
  const blockers = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (rule.type !== 'pull_request') continue;
    const p = rule.parameters ?? {};
    const reasons = reviewReasons(p.required_approving_review_count ?? 0, p.require_code_owner_review, p.required_reviewers);
    if (reasons.length) blockers.push({ source: 'ruleset', rulesetId: rule.ruleset_id, editable: rule.ruleset_source_type === 'Repository', reasons });
  }
  if (classic && classic !== NO_CLASSIC_REVIEWS) {
    const reasons = reviewReasons(classic.required_approving_review_count ?? 0, classic.require_code_owner_reviews, []);
    if (reasons.length) blockers.push({ source: 'classic', editable: true, reasons });
  }
  return { approvalBlockers: blockers, approvalKnown: Array.isArray(rules) && classic !== null };
}

// Review settings under which the bot's one approval is enough; everything else in the rule is kept.
export function relaxReviewParams(params) {
  return {
    ...params,
    required_approving_review_count: Math.min(params.required_approving_review_count ?? 0, 1),
    require_code_owner_review: false,
    ...('required_reviewers' in params ? { required_reviewers: [] } : {}),
  };
}

const ghJson = (args, cwd, body) => execFileSync('gh', ['api', ...args, ...(body ? ['--input', '-'] : [])], { cwd, encoding: 'utf8', input: body ? JSON.stringify(body) : undefined, stdio: ['pipe', 'pipe', 'pipe'] });

// Relaxes only the blocking review settings, in repo rulesets and classic protection. Organization rulesets are left alone.
export function allowBotApproval(cwd) {
  const { repo } = detect(cwd);
  if (!repo) throw new Error('gh cannot see this repository; run `gh auth login` and retry');
  const read = readReviewRules(cwd, repo);
  const { approvalBlockers: blockers } = approvalBlockers(read);
  const changed = [];
  const skipped = [];
  for (const blocker of blockers) {
    if (!blocker.editable) { skipped.push({ ...blocker, why: 'organization ruleset; an org owner must change it' }); continue; }
    try {
      if (blocker.source === 'ruleset') {
        const set = JSON.parse(ghJson([`repos/${repo}/rulesets/${blocker.rulesetId}`], cwd));
        const rules = set.rules.map(r => (r.type === 'pull_request' ? { ...r, parameters: relaxReviewParams(r.parameters ?? {}) } : r));
        ghJson(['-X', 'PUT', `repos/${repo}/rulesets/${blocker.rulesetId}`], cwd, { name: set.name, target: set.target, enforcement: set.enforcement, conditions: set.conditions, bypass_actors: set.bypass_actors, rules });
      } else {
        ghJson(['-X', 'PATCH', `repos/${repo}/branches/${read.branch}/protection/required_pull_request_reviews`], cwd,
          { required_approving_review_count: Math.min(read.classic.required_approving_review_count, 1), require_code_owner_reviews: false });
      }
      changed.push(blocker);
    } catch (err) {
      skipped.push({ ...blocker, why: String(err.stderr ?? err.message).trim() });
    }
  }
  return { repo, changed, skipped, ...approvalBlockers(readReviewRules(cwd, repo)) };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (!['engine', 'model', 'command', 'cwd'].includes(key) || argv[i + 1] === undefined) throw new Error(`unknown or incomplete flag: ${argv[i]}`);
    opts[key] = argv[i + 1];
  }
  return opts;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const [cmd, ...rest] = process.argv.slice(2);
    const { cwd = process.cwd(), ...opts } = parseArgs(rest);
    const out = cmd === 'detect' ? detect(cwd, opts.command) : cmd === 'install' ? install(cwd, opts) : cmd === 'allow-bot-approval' ? allowBotApproval(cwd) : null;
    if (!out) throw new Error('usage: pr-review.mjs detect|install|allow-bot-approval [--engine copilot|claude] [--model M] [--command review] [--cwd DIR]');
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
