import { beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveStatus, globToRegExp, run } from './lessons.mjs';

const script = join(import.meta.dir, 'lessons.mjs');
let repo;
let home;
let env;

const lessons = (...args) => run([...args, '--cwd', repo], env);
const enable = (store = 'local') => lessons('configure', '--where', 'project', '--enabled', 'true', '--project-store', store);
const add = (lesson, ...extra) => lessons('add', '--kind', 'root-cause', '--lesson', lesson, '--evidence', 'seen in PR', ...extra);
const exclude = () => readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'lessons-repo-')));
  home = realpathSync(mkdtempSync(join(tmpdir(), 'lessons-home-')));
  env = { PSTACK_HOME: home };
  execFileSync('git', ['init', '-q'], { cwd: repo });
});

describe('add', () => {
  it('skips when no config exists', () => {
    expect(add('x')).toEqual({ enabled: false, skipped: true });
    expect(existsSync(join(repo, '.pstack'))).toBe(false);
  });

  it('writes the local store and excludes config + local store', () => {
    enable('local');
    const res = add('Check the migration order');
    expect(res.status).toBe('candidate');
    expect(res.id).toMatch(/^rc-[0-9a-f]{8}$/);
    expect(res.store).toBe(join(repo, '.pstack', 'lessons.local.jsonl'));
    const entry = JSON.parse(readFileSync(res.store, 'utf8'));
    expect(entry).toMatchObject({ kind: 'root-cause', scope: 'project', status: 'candidate', helpful: 0, harmful: 0, evidence: 'seen in PR' });
    expect(entry.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(exclude()).toContain('.pstack/config.json\n');
    expect(exclude()).toContain('.pstack/lessons.local.jsonl\n');
  });

  it('writes the remote store without excluding it', () => {
    enable('remote');
    const res = add('Prefer explicit ids');
    expect(res.store).toBe(join(repo, '.pstack', 'lessons.jsonl'));
    expect(exclude().split('\n')).not.toContain('.pstack/lessons.jsonl');
  });

  it('sends preferences to the global store by default', () => {
    enable();
    const res = lessons('add', '--kind', 'preference', '--lesson', 'Short PRs', '--evidence', 'user said so');
    expect(res.store).toBe(join(home, 'lessons.jsonl'));
    expect(res.id).toMatch(/^pf-/);
  });

  it('dedups by normalized lesson and upvotes', () => {
    enable();
    const first = add('Check the migration order.');
    const second = add('  check THE migration   order ');
    expect(second).toEqual({ id: first.id, deduped: true, status: 'candidate' });
    expect(add('check the migration order!')).toEqual({ id: first.id, deduped: true, status: 'recurring' });
    expect(lessons('list').lessons[0].helpful).toBe(2);
  });

  it('redacts secrets before storing', () => {
    enable();
    const res = lessons('add', '--kind', 'root-cause', '--lesson', `token leaked ghp_${'a'.repeat(36)} here`, '--evidence', 'config had password=hunter2 inline');
    const entry = JSON.parse(readFileSync(res.store, 'utf8'));
    expect(entry.lesson).toBe('token leaked [REDACTED] here');
    expect(entry.evidence).toBe('config had password=[REDACTED] inline');
  });

  it('rejects text over 600 chars and bad kinds', () => {
    enable();
    expect(() => add('x'.repeat(601))).toThrow('lesson exceeds 600');
    expect(() => lessons('add', '--kind', 'nope', '--lesson', 'a', '--evidence', 'b')).toThrow('--kind must be one of');
    expect(() => lessons('add', '--kind', 'root-cause', '--lesson', 'a')).toThrow('--evidence is required');
  });
});

describe('status', () => {
  it('derives candidate -> recurring -> strong and retires when harmful > helpful', () => {
    const e = { helpful: 0, harmful: 0 };
    expect(deriveStatus(e)).toBe('candidate');
    expect(deriveStatus({ helpful: 2, harmful: 0 })).toBe('recurring');
    expect(deriveStatus({ helpful: 4, harmful: 0 })).toBe('strong');
    expect(deriveStatus({ helpful: 4, harmful: 5 })).toBe('retired');
    expect(deriveStatus({ helpful: 1, harmful: 1 })).toBe('candidate');
  });

  it('transitions through vote', () => {
    enable();
    const { id } = add('Vote me');
    expect(lessons('vote', id, 'up')).toEqual({ id, status: 'candidate', helpful: 1, harmful: 0 });
    expect(lessons('vote', id, 'up').status).toBe('recurring');
    lessons('vote', id, 'up');
    expect(lessons('vote', id, 'up').status).toBe('strong');
    for (let i = 0; i < 4; i++) lessons('vote', id, 'down');
    expect(lessons('vote', id, 'down')).toEqual({ id, status: 'retired', helpful: 4, harmful: 5 });
  });

  it('keeps explicit retire sticky even after upvotes', () => {
    enable();
    const { id } = add('Retire me');
    expect(lessons('retire', id, '--reason', 'obsolete')).toEqual({ id, status: 'retired' });
    expect(lessons('vote', id, 'up')).toEqual({ id, status: 'retired', helpful: 1, harmful: 0 });
    expect(lessons('list').lessons).toEqual([]);
    expect(lessons('list', '--status', 'retired').lessons[0].retiredReason).toBe('obsolete');
  });

  it('errors on unknown id', () => {
    enable();
    expect(() => lessons('vote', 'rc-00000000', 'up')).toThrow('unknown lesson id');
  });
});

describe('match', () => {
  it('returns disabled shape when off', () => {
    expect(lessons('match', '--kind', 'root-cause')).toEqual({ enabled: false, lessons: [] });
  });

  it('filters by path glob, ticket type and passes general entries; sorts by status then score', () => {
    enable();
    const api = add('API lesson', '--paths', 'src/api/**/*.ts');
    const ui = add('UI lesson', '--paths', 'src/ui/*.tsx');
    const bug = add('Bug-only lesson', '--ticket-type', 'bug', '--paths', 'src/api/**');
    const general = add('General lesson');
    const second = add('Second general');
    lessons('vote', second.id, 'up');
    lessons('vote', second.id, 'up');
    lessons('vote', general.id, 'up');

    const ids = res => res.lessons.map(l => l.id);
    const forApi = lessons('match', '--kind', 'root-cause', '--paths', 'src/api/v1/user.ts', '--ticket-type', 'feature');
    // second = recurring(2), general = candidate(1), api = candidate(0); bug excluded by ticketType, ui by path
    expect(ids(forApi)).toEqual([second.id, general.id, api.id]);
    expect(ids(lessons('match', '--kind', 'root-cause', '--paths', 'src/api/v1/user.ts', '--ticket-type', 'bug'))).toEqual([second.id, general.id, api.id, bug.id]);
    expect(ids(lessons('match', '--kind', 'root-cause', '--paths', 'src/ui/Button.tsx'))).toEqual([second.id, general.id, ui.id]);
    expect(ids(lessons('match', '--kind', 'root-cause', '--limit', '1'))).toEqual([second.id]);
    expect(lessons('match', '--kind', 'intake-gap').lessons).toEqual([]);
  });

  it('matches tags case-insensitively and excludes section mismatches', () => {
    enable();
    const tagged = add('Tagged', '--tags', 'React,Hooks');
    add('Other section', '--section', 'Scope');
    const res = lessons('match', '--kind', 'root-cause', '--tags', 'hooks', '--section', 'API contract');
    expect(res.lessons.map(l => l.id)).toEqual([tagged.id]);
  });

  it('matches an absolute path that reaches the repo through a symlink', () => {
    enable();
    const api = add('API lesson', '--paths', 'src/api/**');
    mkdirSync(join(repo, 'src', 'api'), { recursive: true });
    writeFileSync(join(repo, 'src', 'api', 'user.ts'), '');
    symlinkSync(repo, join(home, 'link'));
    const res = lessons('match', '--kind', 'root-cause', '--paths', join(home, 'link', 'src', 'api', 'user.ts'));
    expect(res.lessons.map(l => l.id)).toEqual([api.id]);
  });
});

describe('config', () => {
  it('project config overrides global entirely', () => {
    lessons('configure', '--where', 'global', '--enabled', 'true');
    expect(lessons('config')).toMatchObject({ enabled: true, projectStore: 'local', source: 'global' });
    lessons('configure', '--where', 'project', '--enabled', 'false', '--project-store', 'remote');
    expect(lessons('config')).toEqual({
      enabled: false, projectStore: 'remote', source: 'project',
      stores: { remote: join(repo, '.pstack', 'lessons.jsonl'), local: join(repo, '.pstack', 'lessons.local.jsonl'), global: join(home, 'lessons.jsonl') },
    });
    expect(add('x')).toEqual({ enabled: false, skipped: true });
  });
});

describe('stores and CLI', () => {
  it('names file and line of a malformed store', () => {
    enable('remote');
    mkdirSync(join(repo, '.pstack'), { recursive: true });
    writeFileSync(join(repo, '.pstack', 'lessons.jsonl'), '{"id":"a"}\nnot json\n');
    expect(() => lessons('list')).toThrow(`malformed JSONL in ${join(repo, '.pstack', 'lessons.jsonl')} line 2`);
  });

  it('prints JSON errors to stderr with exit 1', () => {
    const res = spawnSync('node', [script, 'vote', 'rc-1', 'up', '--cwd', repo], { env: { ...process.env, PSTACK_HOME: home }, encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stderr)).toEqual({ error: 'unknown lesson id: rc-1' });
  });
});

describe('globToRegExp', () => {
  it('handles **, * and ?', () => {
    expect(globToRegExp('src/**/*.ts').test('src/a/b/c.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/c.ts')).toBe(false);
    expect(globToRegExp('a?.ts').test('ab.ts')).toBe(true);
    expect(globToRegExp('a?.ts').test('a/.ts')).toBe(false);
    expect(globToRegExp('a.ts').test('axts')).toBe(false);
  });
});
