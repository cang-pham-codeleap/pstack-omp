#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.OMP_WORKERS_HOME ?? path.join(os.homedir(), '.pstack', 'omp-workers');
const RUNS = path.join(ROOT, 'runs');
const OMP = process.env.OMP_BIN ?? 'omp';
const LINGER_MS = Number(process.env.OMP_WORKERS_LINGER_MS ?? 90000);
const SELF = fileURLToPath(import.meta.url);
const MODES = ['review', 'write'];
const TERMINAL = (s) => s === 'done' || s === 'failed' || String(s).startsWith('exited');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const die = (m) => { console.error(m); process.exit(2); };

const catalog = () => JSON.parse(execFileSync(OMP, ['models', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 })).models.filter((m) => m.kind === 'chat');
const SKILL_REF = /(?:\/skill:|skill:\/\/)([\w-]+)((?:\/[\w.-]+)*)/g;
const skillCatalogs = new Map();
const skillCatalog = (cwd) => {
  if (!skillCatalogs.has(cwd)) {
    const { skills } = JSON.parse(execFileSync(OMP, ['skill', 'list', '--json'], { cwd, encoding: 'utf8', maxBuffer: 64 << 20 }));
    skillCatalogs.set(cwd, new Map(skills.map((s) => [s.name, s])));
  }
  return skillCatalogs.get(cwd);
};
const tokens = (s) => s.toLowerCase().replace(/(\d)[-.](?=\d{1,2}(?![a-z0-9]))/g, '$1.').split(/[^a-z0-9.]+/).filter(Boolean);

function resolveModel(words, models) {
  const query = new Set(tokens(words.join(' ')));
  const ranked = models
    .map((m) => {
      const id = tokens(m.id);
      const provider = tokens(m.provider);
      const known = new Set([...id, ...provider]);
      return [...query].every((q) => known.has(q)) && {
        selector: m.selector,
        thinking: m.thinking,
        extra: id.filter((t) => !query.has(t)).length,
        providerHits: provider.filter((t) => query.has(t)).length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.extra - b.extra || b.providerHits - a.providerHits || a.selector.localeCompare(b.selector));
  const best = ranked.filter((c) => c.extra === ranked[0].extra && c.providerHits === ranked[0].providerHits);
  return { match: best.length === 1 ? best[0].selector : null, candidates: ranked.slice(0, 8) };
}

function runDir(name) {
  fs.mkdirSync(RUNS, { recursive: true });
  const runs = fs.readdirSync(RUNS).filter((d) => fs.statSync(path.join(RUNS, d)).isDirectory()).sort();
  const id = !name || name === 'latest' ? runs.at(-1) : name;
  if (!id) die('no runs yet');
  const dir = path.join(RUNS, id);
  if (!fs.existsSync(dir)) die(`unknown run ${id}`);
  return dir;
}

function start(file, opts) {
  if (!file) die('usage: omp-workers start <tasks.json> [--run name] [--cwd dir]');
  const tasks = readJson(file);
  const ids = tasks.map((t) => t.id);
  if (new Set(ids).size !== ids.length || tasks.some((t) => !t.id || !t.prompt)) die('every task needs a unique id and a prompt');
  const bad = tasks.find((t) => t.mode && !MODES.includes(t.mode));
  if (bad) die(`${bad.id}: mode must be one of ${MODES.join(', ')}`);
  if (tasks.some((t) => t.model || t.thinking)) {
    const models = new Map(catalog().map((m) => [m.selector, m]));
    for (const t of tasks) {
      if (t.thinking && !t.model) die(`${t.id}: thinking needs an exact model`);
      if (!t.model) continue;
      const m = models.get(t.model) ?? die(`${t.id}: unknown model ${t.model}. Run: omp-workers models <words>`);
      if (t.thinking && !m.thinking?.includes(t.thinking)) die(`${t.id}: ${t.model} thinking is one of ${m.thinking?.join(', ') || 'none'}`);
    }
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const dir = path.join(RUNS, opts.run ? `${stamp}-${opts.run}` : stamp);
  fs.mkdirSync(path.join(dir, 'ctl'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  const base = path.resolve(opts.cwd ?? process.cwd());
  for (const t of tasks) {
    const refs = [...t.prompt.matchAll(SKILL_REF)];
    if (!refs.length) die(`${t.id}: the brief names no skill. Name each skill the worker needs as skill://<name>. Find them with: omp-workers skills <words>`);
    const catalog = skillCatalog(path.resolve(base, t.cwd ?? '.'));
    for (const [ref, name, sub] of refs) {
      const skill = catalog.get(name) ?? die(`${t.id}: omp has no skill ${name}. Find one with: omp-workers skills <words>`);
      const file = sub.replace(/\.+$/, '');
      if (file && !fs.existsSync(path.join(skill.baseDir, file))) die(`${t.id}: ${ref} does not exist in ${skill.baseDir}`);
    }
  }
  const normalized = tasks.map((t) => {
    const report = path.join(dir, 'reports', `${t.id}.md`);
    return { mode: 'review', ...t, cwd: path.resolve(base, t.cwd ?? '.'), prompt: t.prompt.replaceAll('{{REPORT}}', report) };
  });
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(normalized, null, 1));
  const log = fs.openSync(path.join(dir, 'daemon.log'), 'a');
  spawn(process.execPath, [SELF, 'daemon', dir], { detached: true, stdio: ['ignore', log, log] }).unref();
  console.log(JSON.stringify({ run: path.basename(dir), dir, workers: ids }));
}

function daemon(dir) {
  const tasks = readJson(path.join(dir, 'tasks.json'));
  const eventsFile = path.join(dir, 'events.jsonl');
  const statusFile = path.join(dir, 'status.json');
  const status = {};
  const emit = (worker, type, data = {}) => fs.appendFileSync(eventsFile, JSON.stringify({ t: new Date().toISOString(), worker, type, ...data }) + '\n');
  const save = () => fs.writeFileSync(statusFile, JSON.stringify(status, null, 1));
  const clip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'string' && x.length > 300 ? `${x.slice(0, 300)}…` : x)));

  class Worker {
    constructor(task) {
      this.task = task;
      this.id = task.id;
      this.n = 0;
      this.report = path.join(dir, 'reports', `${task.id}.md`);
      status[this.id] = { model: task.model ?? 'default', state: 'starting', tools: 0 };
      const args = ['--mode', 'rpc', '--approval-mode', 'always-ask', ...(task.model ? ['--model', task.model] : []), ...(task.thinking ? ['--thinking', task.thinking] : [])];
      this.proc = spawn(OMP, args, { cwd: task.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      status[this.id].pid = this.proc.pid;
      this.proc.on('error', (e) => { this.setState('failed'); status[this.id].lastError = String(e.message); emit(this.id, 'error', { text: e.message }); save(); });
      let buf = '';
      this.proc.stdout.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line.trim()) this.onLine(line);
        }
      });
      this.proc.stderr.on('data', (c) => emit(this.id, 'stderr', { text: String(c).slice(0, 500) }));
      this.proc.on('exit', (code, sig) => { if (!TERMINAL(status[this.id].state)) this.setState(`exited:${code ?? sig}`); emit(this.id, 'exit', { code, sig }); save(); });
    }
    setState(s) {
      if (status[this.id].state === s) return;
      status[this.id].state = s;
      emit(this.id, 'state', { state: s });
      save();
    }
    tool(name) {
      const s = status[this.id];
      s.lastTool = name;
      s.tools += 1;
      if (s.tools % 20 === 0) emit(this.id, 'progress', { tools: s.tools, lastTool: name });
    }
    onLine(line) {
      let f;
      try { f = JSON.parse(line); } catch { return emit(this.id, 'badframe', { line: line.slice(0, 200) }); }
      this.onFrame(f);
    }
    start() { this.prompt(this.task.prompt); }
    rpc(cmd) { cmd.id = `${this.id}-${++this.n}`; emit(this.id, 'cmd', { cmd: clip(cmd) }); this.proc.stdin.write(`${JSON.stringify(cmd)}\n`); }
    prompt(message) { this.rpc({ type: 'prompt', message, ...(status[this.id].state === 'running' ? { streamingBehavior: 'followUp' } : {}) }); }
    steer(message) { this.rpc({ type: 'steer', message }); }
    followup(message) { this.rpc({ type: 'follow_up', message }); }
    abort() { this.rpc({ type: 'abort' }); }
    getState() { this.rpc({ type: 'get_state' }); }
    onFrame(f) {
      const s = status[this.id];
      if (f.type === 'ready') this.setState('ready');
      else if (f.type === 'agent_start') this.setState('running');
      else if (f.type === 'agent_end' && f.isTerminal !== false) {
        const last = [...(f.messages ?? [])].reverse().find((m) => m.role === 'assistant');
        const text = Array.isArray(last?.content) ? last.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : String(last?.content ?? '');
        fs.writeFileSync(path.join(dir, 'reports', `${this.id}.final.txt`), text);
        this.setState('done');
      } else if (f.type === 'response' && f.success === false) { s.lastError = f.error; emit(this.id, 'error', { text: String(f.error), command: f.command }); }
      else if (f.type === 'extension_ui_request') return this.approval(f);
      else if (f.type === 'tool_execution_start') this.tool(f.toolName ?? f.name);
      else if (f.type === 'response') emit(this.id, 'response', { f: clip(f) });
      save();
    }
    approval(f) {
      if (!['confirm', 'select', 'input'].includes(f.method)) return;
      const title = String(f.title ?? '');
      const m = title.match(/^Allow tool: (\w+)(?:\n(?:Command|Path): ([\s\S]*))?/);
      const tool = m?.[1];
      const command = m?.[2] ?? '';
      const arg = command.split('\n')[0].trim();
      const write = this.task.mode === 'write';
      const denyBash = write
        ? /\b(rm -rf|sudo|curl|wget|gh)\b|git (push|reset --hard|clean)/
        : /[>]|\b(rm|mv|cp|chmod|curl|wget|npm|pnpm|yarn|tee|dd|gh)\b|sed -i|git (add|commit|push|checkout|reset|clean|stash|apply)/;
      const inCwd = arg && path.resolve(this.task.cwd, arg).startsWith(this.task.cwd + path.sep);
      const reportWrite = tool === 'write' && arg === this.report;
      const ok = reportWrite
        || ['read', 'grep', 'find', 'ls', 'search', 'glob', 'task'].includes(tool)
        || (tool === 'bash' && !denyBash.test(command))
        || (write && ['write', 'edit'].includes(tool) && inCwd);
      const opts = (f.options ?? []).map((o) => (typeof o === 'string' ? { label: o } : o));
      const pick = opts.find((o) => /^approve$/i.test(String(o.label ?? o.value).trim()));
      const allow = ok && !!pick;
      emit(this.id, 'approval', { tool, title: title.slice(0, 160), decision: allow ? 'allow' : 'deny' });
      const reply = f.method === 'confirm' ? { confirmed: allow } : allow && f.method === 'select' ? { value: pick.value ?? pick.label } : { cancelled: true };
      this.proc.stdin.write(`${JSON.stringify({ type: 'extension_ui_response', id: f.id, ...reply })}\n`);
    }
  }

  const workers = Object.fromEntries(tasks.map((t) => [t.id, new Worker(t)]));
  for (const w of Object.values(workers)) w.start();
  let allDoneSince = null;
  setInterval(() => {
    for (const f of fs.readdirSync(path.join(dir, 'ctl')).sort()) {
      const file = path.join(dir, 'ctl', f);
      let c;
      try { c = readJson(file); } catch { continue; }
      fs.unlinkSync(file);
      if (c.op === 'stop') { for (const x of Object.values(workers)) x.proc.kill('SIGTERM'); return setTimeout(() => process.exit(0), 500); }
      const w = workers[c.worker];
      if (!w) { emit('supervisor', 'error', { text: `unknown worker ${c.worker}` }); continue; }
      const op = { steer: 'steer', followup: 'followup', prompt: 'prompt', abort: 'abort', state: 'getState' }[c.op];
      if (!op) { emit('supervisor', 'error', { text: `unknown op ${c.op}` }); continue; }
      w[op](c.message ?? '');
      allDoneSince = null;
    }
    if (Object.values(status).every((s) => TERMINAL(s.state))) {
      allDoneSince ??= Date.now();
      if (Date.now() - allDoneSince > LINGER_MS) { for (const x of Object.values(workers)) x.proc.kill('SIGTERM'); emit('supervisor', 'exit'); setTimeout(() => process.exit(0), 500); }
    } else allDoneSince = null;
  }, 500);
}

function watch(dir) {
  const eventsFile = path.join(dir, 'events.jsonl');
  const statusFile = path.join(dir, 'status.json');
  let off = 0;
  const tick = () => {
    if (fs.existsSync(eventsFile)) {
      const buf = fs.readFileSync(eventsFile);
      const chunk = buf.subarray(off).toString('utf8');
      const end = chunk.lastIndexOf('\n') + 1;
      off += Buffer.byteLength(chunk.slice(0, end));
      for (const line of chunk.slice(0, end).split('\n').filter(Boolean)) {
        const e = JSON.parse(line);
        if (e.type === 'state') console.log(`${e.worker} ${e.state}`);
        else if (e.type === 'progress') console.log(`${e.worker} progress tools=${e.tools} last=${e.lastTool}`);
        else if (e.type === 'approval' && e.decision === 'deny') console.log(`${e.worker} DENIED ${e.tool}: ${String(e.title).replace(/\n/g, ' ').slice(0, 110)}`);
        else if (['stderr', 'error', 'badframe'].includes(e.type)) console.log(`${e.worker} ${e.type.toUpperCase()} ${String(e.text ?? e.line ?? '').replace(/\n/g, ' ').slice(0, 160)}`);
      }
    }
    if (fs.existsSync(statusFile)) {
      const s = readJson(statusFile);
      if (Object.values(s).length && Object.values(s).every((x) => TERMINAL(x.state))) { console.log('ALL TERMINAL'); process.exit(0); }
    }
  };
  setInterval(tick, 1000);
  tick();
}

function verify(dir) {
  const tasks = readJson(path.join(dir, 'tasks.json'));
  const fails = [];
  const status = readJson(path.join(dir, 'status.json'));
  for (const [id, s] of Object.entries(status)) if (s.state !== 'done') fails.push(`${id} state=${s.state}`);
  const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  for (const e of events) if (['stderr', 'error', 'badframe'].includes(e.type)) fails.push(`${e.worker} ${e.type}: ${String(e.text ?? e.line).slice(0, 120)}`);
  const out = {};
  for (const t of tasks) {
    const rp = path.join(dir, 'reports', `${t.id}.md`);
    const fp = path.join(dir, 'reports', `${t.id}.final.txt`);
    const file = [rp, fp].find((p) => fs.existsSync(p) && fs.statSync(p).size > 200);
    if (!file) { fails.push(`${t.id} has no report of useful size`); continue; }
    const index = new Map();
    let seen = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (['node_modules', '.git', 'dist', 'build'].includes(e.name) || seen > 40000) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else { seen++; index.set(e.name, [...(index.get(e.name) ?? []), p]); }
      }
    };
    walk(t.cwd);
    const refs = [...fs.readFileSync(file, 'utf8').matchAll(/`([\w@./()[\]-]+\.\w+):(\d+)(?:-(\d+))?`/g)];
    const bad = [];
    for (const [, f, a, b] of refs) {
      const cands = [path.resolve(t.cwd, f), ...(index.get(path.basename(f)) ?? []).filter((p) => p.endsWith(f))].filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!cands.some((p) => Number(b ?? a) <= fs.readFileSync(p, 'utf8').split('\n').length)) bad.push(`${f}:${a}`);
    }
    out[t.id] = { report: path.basename(file), refs: refs.length, unresolved: bad.slice(0, 10) };
    if (!refs.length) fails.push(`${t.id} cites no file:line evidence`);
    else if (bad.length / refs.length > 0.1) fails.push(`${t.id} ${bad.length}/${refs.length} citations do not resolve`);
  }
  console.log(JSON.stringify({ out, fails }, null, 1));
  process.exit(fails.length ? 1 : 0);
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i]; else pos.push(rest[i]); }

if (cmd === 'models') {
  if (!pos.length) die('usage: omp-workers models <model and provider words>');
  const r = resolveModel(pos, catalog());
  console.log(JSON.stringify(r, null, 1));
  process.exit(r.match ? 0 : 1);
} else if (cmd === 'skills') {
  const words = pos.map((w) => w.toLowerCase());
  const hits = (s) => words.filter((w) => `${s.name} ${s.description}`.toLowerCase().includes(w)).length;
  [...skillCatalog(path.resolve(flags.cwd ?? process.cwd())).values()]
    .map((s) => [hits(s), s])
    .filter(([n]) => !words.length || n)
    .sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name))
    .forEach(([, s]) => console.log(`${s.name}: ${s.description.replace(/\s+/g, ' ').slice(0, 140)}`));
} else if (cmd === 'start') start(pos[0], flags);
else if (cmd === 'daemon') daemon(pos[0]);
else if (cmd === 'watch') watch(runDir(pos[0]));
else if (cmd === 'verify') verify(runDir(pos[0]));
else if (cmd === 'status') console.log(fs.readFileSync(path.join(runDir(pos[0]), 'status.json'), 'utf8'));
else if (cmd === 'report') {
  const dir = runDir(pos[0]);
  const id = pos[1] ?? die('usage: omp-workers report <run> <worker>');
  const f = ['md', 'final.txt'].map((x) => path.join(dir, 'reports', `${id}.${x}`)).find((p) => fs.existsSync(p) && fs.statSync(p).size > 0);
  console.log(f ? fs.readFileSync(f, 'utf8') : die(`no report for ${id}`));
} else if (cmd === 'events') {
  const dir = runDir(pos[0]);
  const lines = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n');
  const since = Number(flags.since ?? 0);
  lines.slice(since).forEach((l, i) => { if (!flags.worker || l.includes(`"worker":"${flags.worker}"`)) console.log(`${since + i} ${l.slice(0, 400)}`); });
} else if (['steer', 'followup', 'prompt', 'abort', 'state', 'stop'].includes(cmd)) {
  const dir = runDir(pos[0]);
  if (cmd !== 'stop' && !pos[1]) die(`usage: omp-workers ${cmd} <run> <worker>${['abort', 'state'].includes(cmd) ? '' : ' "<message>"'}`);
  fs.writeFileSync(path.join(dir, 'ctl', `${Date.now()}-${process.pid}.json`), JSON.stringify({ op: cmd, worker: pos[1], message: pos.slice(2).join(' ') }));
  console.log(`queued ${cmd}`);
} else {
  die('usage: omp-workers <models|skills|start|watch|status|events|report|verify|steer|followup|prompt|abort|state|stop> ...');
}
