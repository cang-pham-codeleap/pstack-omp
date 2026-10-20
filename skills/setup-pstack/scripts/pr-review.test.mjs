import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detect, parseInstalled, render, requiredSecrets } from './pr-review.mjs';

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
