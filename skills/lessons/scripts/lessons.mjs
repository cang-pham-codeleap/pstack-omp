#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const KINDS = { 'root-cause': 'rc', 'intake-gap': 'ig', preference: 'pf' };
const MAX_TEXT = 600;
const RANK = { strong: 3, recurring: 2, candidate: 1 };
const EXCLUDES = ['.pstack/config.json', '.pstack/lessons.local.jsonl'];

const SECRETS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /github_pat_\w{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
];
const KEY_VALUE = /((?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*)\S+/gi;

export function redact(text) {
  let out = String(text);
  for (const re of SECRETS) out = out.replace(re, '[REDACTED]');
  return out.replace(KEY_VALUE, '$1[REDACTED]');
}

export function normalizeLesson(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

const wordSet = text => new Set(text.split(' ').filter(Boolean));
const DUP_THRESHOLD = 0.7;

// Jaccard similarity of the normalized word sets; 0 when both are empty.
export function similarity(a, b) {
  const [x, y] = [wordSet(normalizeLesson(a)), wordSet(normalizeLesson(b))];
  const shared = [...x].filter(w => y.has(w)).length;
  return x.size + y.size - shared ? shared / (x.size + y.size - shared) : 0;
}

export function deriveStatus(entry) {
  if (entry.retiredReason || entry.harmful > entry.helpful) return 'retired';
  if (entry.helpful >= 4) return 'strong';
  if (entry.helpful >= 2) return 'recurring';
  return 'candidate';
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (glob.startsWith('**/', i)) { re += '(?:.*/)?'; i += 2; }
    else if (glob.startsWith('**', i)) { re += '.*'; i += 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const fail = message => { throw new Error(message); };
const today = () => new Date().toISOString().slice(0, 10);
const list = value => (value ? String(value).split(',').map(s => s.trim()).filter(Boolean) : []);

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') flags.json = true;
    else if (argv[i].startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`missing value for ${argv[i]}`);
      flags[argv[i].slice(2)] = value;
      i++;
    } else positional.push(argv[i]);
  }
  return { flags, positional };
}

function gitOut(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function context(flags, env) {
  const cwd = resolve(flags.cwd ?? process.cwd());
  const root = gitOut(cwd, ['rev-parse', '--show-toplevel']) || cwd;
  const home = env.PSTACK_HOME || join(homedir(), '.pstack');
  return {
    root,
    paths: {
      projectConfig: join(root, '.pstack', 'config.json'),
      globalConfig: join(home, 'config.json'),
      remote: join(root, '.pstack', 'lessons.jsonl'),
      local: join(root, '.pstack', 'lessons.local.jsonl'),
      global: join(home, 'lessons.jsonl'),
    },
  };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    fail(`cannot read ${file}: ${err.message}`);
  }
}

function loadConfig({ paths }) {
  for (const [source, file] of [['project', paths.projectConfig], ['global', paths.globalConfig]]) {
    const cfg = readJson(file);
    if (cfg) return { enabled: cfg.enabled === true, projectStore: cfg.projectStore === 'remote' ? 'remote' : 'local', source };
  }
  return { enabled: false, projectStore: 'local', source: null };
}

function ensureExcluded(root) {
  const rel = gitOut(root, ['rev-parse', '--git-path', 'info/exclude']);
  if (!rel) return;
  const file = resolve(root, rel);
  const have = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const missing = EXCLUDES.filter(line => !have.split('\n').includes(line));
  if (!missing.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${have && !have.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
}

function readStore(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((line, i) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return fail(`malformed JSONL in ${file} line ${i + 1}`);
    }
  });
}

function writeStore(file, entries) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
  renameSync(tmp, file);
}

function loadStores({ paths }) {
  return [paths.remote, paths.local, paths.global].filter(existsSync).map(file => ({ file, entries: readStore(file) }));
}

function findEntry(stores, id) {
  for (const store of stores) {
    const entry = store.entries.find(e => e.id === id);
    if (entry) return { store, entry };
  }
  return fail(`unknown lesson id: ${id}`);
}

function checkedText(name, value) {
  const text = redact(value).trim();
  if (text.length > MAX_TEXT) fail(`${name} exceeds ${MAX_TEXT} characters after redaction (${text.length})`);
  return text;
}

function touch(entry) {
  entry.updated = today();
  entry.status = deriveStatus(entry);
}

const formatLine = ({ id, status, helpful, harmful, match: m = {}, lesson, prevent }) => {
  const tag = [m.ticketType, m.section].filter(Boolean).join('/');
  const flat = text => text.replace(/\s+/g, ' ');
  return `${id} ${status} +${helpful}/-${harmful}${tag ? ` [${tag}]` : ''} ${flat(lesson)}${prevent ? ` | prevent: ${flat(prevent)}` : ''}`;
};

const commands = {
  configure({ flags, ctx }) {
    if (!['project', 'global'].includes(flags.where)) fail('--where must be project or global');
    if (!['true', 'false'].includes(flags.enabled)) fail('--enabled must be true or false');
    const store = flags['project-store'] ?? 'local';
    if (!['remote', 'local'].includes(store)) fail('--project-store must be remote or local');
    const config = { enabled: flags.enabled === 'true', projectStore: store };
    const path = flags.where === 'project' ? ctx.paths.projectConfig : ctx.paths.globalConfig;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    if (flags.where === 'project') ensureExcluded(ctx.root);
    return { config, path };
  },

  config({ ctx, cfg }) {
    const { remote, local, global } = ctx.paths;
    return { ...cfg, stores: { remote, local, global } };
  },

  add({ flags, ctx, cfg }) {
    if (!cfg.enabled) return { enabled: false, skipped: true };
    const prefix = KINDS[flags.kind] ?? fail(`--kind must be one of ${Object.keys(KINDS).join(', ')}`);
    if (!flags.lesson) fail('--lesson is required');
    if (!flags.evidence) fail('--evidence is required');
    const scope = flags.scope ?? (flags.kind === 'preference' ? 'global' : 'project');
    if (!['project', 'global'].includes(scope)) fail('--scope must be project or global');
    const lesson = checkedText('lesson', flags.lesson);
    const evidence = checkedText('evidence', flags.evidence);
    const prevent = flags.prevent ? checkedText('prevent', flags.prevent) : undefined;

    const stores = loadStores(ctx);
    const key = normalizeLesson(lesson);
    let best = null;
    for (const store of stores) {
      for (const e of store.entries) {
        if (e.kind !== flags.kind || e.status === 'retired') continue;
        const other = normalizeLesson(e.lesson);
        const sim = other === key ? 1 : wordSet(other).size >= 4 && wordSet(key).size >= 4 ? similarity(key, other) : 0;
        if (sim >= DUP_THRESHOLD && (!best || sim > best.sim)) best = { store, hit: e, sim };
      }
    }
    if (best) {
      best.hit.helpful += 1;
      touch(best.hit);
      writeStore(best.store.file, best.store.entries);
      return { id: best.hit.id, deduped: true, status: best.hit.status, similarity: Math.round(best.sim * 100) / 100 };
    }

    const match = {};
    if (flags.paths) match.paths = list(flags.paths);
    if (flags.tags) match.tags = list(flags.tags);
    if (flags['ticket-type']) match.ticketType = flags['ticket-type'];
    if (flags.section) match.section = flags.section;
    const date = today();
    const entry = {
      id: `${prefix}-${randomBytes(4).toString('hex')}`,
      kind: flags.kind, scope, status: 'candidate', match, lesson,
      ...(prevent && { prevent }),
      evidence, helpful: 0, harmful: 0, created: date, updated: date,
    };
    const file = scope === 'global' ? ctx.paths.global : ctx.paths[cfg.projectStore];
    writeStore(file, [...readStore(file), entry]);
    if (file === ctx.paths.local) ensureExcluded(ctx.root);
    return { id: entry.id, status: 'candidate', store: file };
  },

  match({ flags, ctx, cfg }) {
    if (!cfg.enabled) return flags.json ? { enabled: false, lessons: [] } : '';
    const real = p => { try { return realpathSync(p); } catch { return p; } };
    const paths = list(flags.paths).map(p => (isAbsolute(p) ? relative(ctx.root, real(p)) : p));
    const tags = list(flags.tags).map(t => t.toLowerCase());
    const limit = flags.limit === undefined ? 5 : Number(flags.limit);
    if (!Number.isInteger(limit) || limit < 0) fail('--limit must be a non-negative integer');

    const keep = ({ match: m = {}, status, kind }) => {
      if (status === 'retired' || (flags.kind && kind !== flags.kind)) return false;
      if (flags['ticket-type'] && m.ticketType && m.ticketType !== flags['ticket-type']) return false;
      if (flags.section && m.section && m.section !== flags.section) return false;
      if ((paths.length || tags.length) && (m.paths?.length || m.tags?.length)) {
        const pathHit = m.paths?.some(g => paths.some(p => globToRegExp(g).test(p)));
        const tagHit = m.tags?.some(t => tags.includes(t.toLowerCase()));
        return Boolean(pathHit || tagHit);
      }
      return true;
    };
    const lessons = loadStores(ctx).flatMap(s => s.entries).filter(keep).sort((a, b) =>
      RANK[b.status] - RANK[a.status]
      || (b.helpful - b.harmful) - (a.helpful - a.harmful)
      || b.updated.localeCompare(a.updated));
    if (flags.json) return { enabled: true, lessons: lessons.slice(0, limit) };
    const max = flags['max-chars'] === undefined ? 1500 : Number(flags['max-chars']);
    if (!Number.isInteger(max) || max < 1) fail('--max-chars must be a positive integer');
    const out = [];
    let len = 0;
    for (const line of lessons.slice(0, limit).map(formatLine)) {
      const next = len + (out.length ? 1 : 0) + line.length;
      if (out.length && next > max) break;
      out.push(line);
      len = next;
    }
    if (out.length < lessons.length) out.push(`... ${lessons.length - out.length} more (raise --limit or --max-chars)`);
    return out.join('\n');
  },

  vote({ positional, ctx }) {
    if (!positional.length || positional.length % 2) fail('usage: vote <id> up|down [<id> up|down ...]');
    const stores = loadStores(ctx);
    const pairs = [];
    for (let i = 0; i < positional.length; i += 2) {
      const dir = positional[i + 1];
      if (!['up', 'down'].includes(dir)) fail(`vote direction must be up or down, got: ${dir}`);
      pairs.push({ ...findEntry(stores, positional[i]), dir });
    }
    const votes = pairs.map(({ entry, dir }) => {
      entry[dir === 'up' ? 'helpful' : 'harmful'] += 1;
      touch(entry);
      return { id: entry.id, status: entry.status, helpful: entry.helpful, harmful: entry.harmful };
    });
    for (const store of new Set(pairs.map(p => p.store))) writeStore(store.file, store.entries);
    return { votes };
  },

  retire({ positional: [id], flags, ctx }) {
    if (!id) fail('usage: retire <id> --reason TEXT');
    if (!flags.reason) fail('--reason is required');
    const { store, entry } = findEntry(loadStores(ctx), id);
    entry.retiredReason = checkedText('reason', flags.reason);
    touch(entry);
    writeStore(store.file, store.entries);
    return { id, status: entry.status };
  },

  list({ flags, ctx }) {
    const lessons = loadStores(ctx).flatMap(s => s.entries).filter(e =>
      (flags.status ? e.status === flags.status : e.status !== 'retired') && (!flags.kind || e.kind === flags.kind));
    return flags.json ? { lessons } : lessons.map(formatLine).join('\n');
  },

  help() {
    return [
      'lessons.mjs <command> [flags]   (all commands accept --cwd DIR; output is JSON except match/list/help)',
      '  configure --where project|global --enabled true|false [--project-store remote|local]',
      '  config',
      '  add --kind K --lesson TEXT --evidence TEXT [--prevent TEXT] [--scope project|global]',
      '      [--paths a,b] [--tags a,b] [--ticket-type T] [--section S]   (near-duplicates merge and upvote)',
      '  match [--kind K] [--paths a,b] [--tags a,b] [--ticket-type T] [--section S]',
      '        [--limit 5] [--max-chars 1500] [--json]   (text; empty output = nothing to apply)',
      '  list [--status S] [--kind K] [--json]',
      '  vote <id> up|down [<id> up|down ...]   (all pairs validated before any write)',
      '  retire <id> --reason TEXT',
      '  help',
      'Kinds: root-cause (rc), intake-gap (ig), preference (pf).',
      'Text line: <id> <status> +<helpful>/-<harmful> [<ticketType>/<section>] <lesson> | prevent: <prevent>',
      '  [...] and "| prevent" are omitted when unset; match ends with "... N more (raise --limit or --max-chars)" if truncated.',
    ].join('\n');
  },
};

export function run(argv, env = process.env) {
  const [name, ...rest] = argv;
  const command = Object.hasOwn(commands, name ?? '') ? commands[name] : fail(`unknown command: ${name ?? '(none)'}; expected ${Object.keys(commands).join(', ')}`);
  const { flags, positional } = parseArgs(rest);
  const ctx = context(flags, env);
  return command({ flags, positional, ctx, cfg: loadConfig(ctx) });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const out = run(process.argv.slice(2));
    process.stdout.write(typeof out === 'string' ? (out && `${out}\n`) : `${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}
