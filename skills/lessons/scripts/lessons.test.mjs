import { beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveStatus, globToRegExp, run, similarity } from './lessons.mjs';

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
    expect(second).toEqual({ id: first.id, deduped: true, status: 'candidate', similarity: 1 });
    expect(add('check the migration order!')).toEqual({ id: first.id, deduped: true, status: 'recurring', similarity: 1 });
    expect(lessons('list', '--json').lessons[0].helpful).toBe(2);
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
    const vote = dir => lessons('vote', id, dir).votes[0];
    expect(vote('up')).toEqual({ id, status: 'candidate', helpful: 1, harmful: 0 });
    expect(vote('up').status).toBe('recurring');
    vote('up');
    expect(vote('up').status).toBe('strong');
    for (let i = 0; i < 4; i++) vote('down');
    expect(vote('down')).toEqual({ id, status: 'retired', helpful: 4, harmful: 5 });
  });

  it('keeps explicit retire sticky even after upvotes', () => {
    enable();
    const { id } = add('Retire me');
    expect(lessons('retire', id, '--reason', 'obsolete')).toEqual({ id, status: 'retired' });
    expect(lessons('vote', id, 'up')).toEqual({ votes: [{ id, status: 'retired', helpful: 1, harmful: 0 }] });
    expect(lessons('list', '--json').lessons).toEqual([]);
    expect(lessons('list', '--json', '--status', 'retired').lessons[0].retiredReason).toBe('obsolete');
  });

  it('errors on unknown id', () => {
    enable();
    expect(() => lessons('vote', 'rc-00000000', 'up')).toThrow('unknown lesson id');
  });
});

describe('match', () => {
  it('returns disabled shape when off', () => {
    expect(lessons('match', '--json', '--kind', 'root-cause')).toEqual({ enabled: false, lessons: [] });
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
    const m = (...args) => lessons('match', '--json', '--kind', 'root-cause', ...args);
    const forApi = m('--paths', 'src/api/v1/user.ts', '--ticket-type', 'feature');
    // second = recurring(2), general = candidate(1), api = candidate(0); bug excluded by ticketType, ui by path
    expect(ids(forApi)).toEqual([second.id, general.id, api.id]);
    expect(ids(m('--paths', 'src/api/v1/user.ts', '--ticket-type', 'bug'))).toEqual([second.id, general.id, api.id, bug.id]);
    expect(ids(m('--paths', 'src/ui/Button.tsx'))).toEqual([second.id, general.id, ui.id]);
    expect(ids(m('--limit', '1'))).toEqual([second.id]);
    expect(lessons('match', '--json', '--kind', 'intake-gap').lessons).toEqual([]);
  });

  it('matches tags case-insensitively and excludes section mismatches', () => {
    enable();
    const tagged = add('Tagged', '--tags', 'React,Hooks');
    add('Other section', '--section', 'Scope');
    const res = lessons('match', '--json', '--kind', 'root-cause', '--tags', 'hooks', '--section', 'API contract');
    expect(res.lessons.map(l => l.id)).toEqual([tagged.id]);
  });

  it('matches an absolute path that reaches the repo through a symlink', () => {
    enable();
    const api = add('API lesson', '--paths', 'src/api/**');
    mkdirSync(join(repo, 'src', 'api'), { recursive: true });
    writeFileSync(join(repo, 'src', 'api', 'user.ts'), '');
    symlinkSync(repo, join(home, 'link'));
    const res = lessons('match', '--json', '--kind', 'root-cause', '--paths', join(home, 'link', 'src', 'api', 'user.ts'));
    expect(res.lessons.map(l => l.id)).toEqual([api.id]);
  });
});

describe('text output', () => {
  const spawn = (...args) => spawnSync('node', [script, ...args, '--cwd', repo], { env: { ...process.env, PSTACK_HOME: home }, encoding: 'utf8' });
  const A = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];
  const B = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet', 'black', 'white', 'grey'];
  // Ten similar-but-distinct lessons (pairwise Jaccard well under 0.7) so none are merged.
  const addTen = () => A.map((a, i) => add(`Verify ${a} handler retries before enabling ${B[i]} flag`).id);

  it('prints one compact line per lesson and omits unset parts', () => {
    enable();
    const full = add('Check order', '--ticket-type', 'bug', '--section', 'Scope', '--prevent', 'Run in order').id;
    const typeOnly = add('Second lesson here', '--ticket-type', 'bug').id;
    const bare = add('Third lesson here').id;
    expect(lessons('list')).toBe([
      `${full} candidate +0/-0 [bug/Scope] Check order | prevent: Run in order`,
      `${typeOnly} candidate +0/-0 [bug] Second lesson here`,
      `${bare} candidate +0/-0 Third lesson here`,
    ].join('\n'));
    expect(lessons('match')).toBe(lessons('list'));
    expect(lessons('list', '--json').lessons).toHaveLength(3);
    expect(lessons('match', '--json')).toMatchObject({ enabled: true });
  });

  it('prints nothing for no hits or when disabled', () => {
    let res = spawn('match');
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('');
    enable();
    res = spawn('match');
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('');
    expect(spawn('list').stdout).toBe('');
    add('Something');
    expect(spawn('match').stdout.endsWith('\n')).toBe(true);
  });

  it('caps at --limit (default 5) and reports the remainder', () => {
    enable();
    const ids = addTen();
    const lines = lessons('match').split('\n');
    expect(lines).toHaveLength(6);
    expect(lines.slice(0, 5).map(l => l.split(' ')[0])).toEqual(ids.slice(0, 5));
    expect(lines[5]).toBe('... 5 more (raise --limit or --max-chars)');
    expect(lessons('match', '--limit', '10').split('\n')).toHaveLength(10);
    expect(lessons('match', '--limit', '2').split('\n').at(-1)).toBe('... 8 more (raise --limit or --max-chars)');
    expect(lessons('match', '--json', '--max-chars', '1').lessons).toHaveLength(5);
  });

  it('keeps lines within --max-chars but always prints the first', () => {
    enable();
    addTen();
    const all = lessons('match', '--limit', '10').split('\n');
    const two = all[0].length + 1 + all[1].length;
    expect(lessons('match', '--limit', '10', '--max-chars', String(two))).toBe(`${all[0]}\n${all[1]}\n... 8 more (raise --limit or --max-chars)`);
    expect(lessons('match', '--limit', '10', '--max-chars', String(two - 1))).toBe(`${all[0]}\n... 9 more (raise --limit or --max-chars)`);
    expect(lessons('match', '--max-chars', '1')).toBe(`${all[0]}\n... 9 more (raise --limit or --max-chars)`);
  });

  it('prints help under 25 lines', () => {
    const help = lessons('help');
    expect(help.split('\n').length).toBeLessThanOrEqual(25);
    for (const word of ['configure', 'match', 'vote', 'retire', 'root-cause', '--max-chars']) expect(help).toContain(word);
  });
});

describe('near-duplicate merge', () => {
  it('merges at Jaccard >= 0.7 and reports similarity', () => {
    enable();
    const first = add('Always run the migration before seeding data');
    expect(similarity('Always run the migration before seeding data', 'Always run the migration before seeding test data')).toBe(0.875);
    expect(add('Always run the migration before seeding test data')).toEqual({ id: first.id, deduped: true, status: 'candidate', similarity: 0.88 });
    expect(lessons('list', '--json').lessons).toHaveLength(1);
  });

  it('does not merge dissimilar lessons or lessons under 4 words', () => {
    enable();
    const a = add('Always run the migration before seeding data');
    expect(add('Always run the linter before opening pull requests').deduped).toBeUndefined();
    const short = add('Run migrations first');
    expect(add('Run migrations first now').deduped).toBeUndefined();
    expect(add('Run migrations first').id).toBe(short.id); // exact match still dedups
    expect(lessons('list', '--json').lessons.map(l => l.id)).toContain(a.id);
    expect(lessons('list', '--json').lessons).toHaveLength(4);
  });
});

describe('batch vote', () => {
  it('votes several lessons in one call', () => {
    enable();
    const a = add('First lesson to vote on').id;
    const b = add('Entirely different words appear here').id;
    expect(lessons('vote', a, 'up', b, 'down', a, 'up')).toEqual({
      votes: [
        { id: a, status: 'candidate', helpful: 1, harmful: 0 },
        { id: b, status: 'retired', helpful: 0, harmful: 1 },
        { id: a, status: 'recurring', helpful: 2, harmful: 0 },
      ],
    });
  });

  it('writes nothing when any pair is invalid', () => {
    enable();
    const a = add('First lesson to vote on').id;
    expect(() => lessons('vote', a, 'up', 'rc-00000000', 'up')).toThrow('unknown lesson id: rc-00000000');
    expect(() => lessons('vote', a, 'up', a, 'sideways')).toThrow('vote direction must be up or down');
    expect(() => lessons('vote', a, 'up', a)).toThrow('usage: vote');
    expect(lessons('list', '--json').lessons[0]).toMatchObject({ helpful: 0, harmful: 0 });
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
