import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'omp-workers.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-workers-'));
const chat = (provider, id, thinking = ['low', 'medium', 'high']) => ({ provider, kind: 'chat', id, selector: `${provider}/${id}`, thinking });
const models = [
  chat('github-copilot', 'gpt-6.1-terra'),
  chat('github-copilot', 'gpt-6.1-terra-1m'),
  chat('llmgate', 'gpt-6.1-terra'),
  chat('github-copilot', 'claude-opus-5'),
  chat('github-copilot', 'claude-opus-5.5'),
  chat('anthropic', 'claude-opus-5-5'),
  chat('anthropic', 'claude-haiku-4-5-20251001'),
  chat('openrouter', 'anthropic/claude-opus-5.5'),
];
const skillDir = path.join(tmp, 'skills', 'poteto-mode');
fs.mkdirSync(path.join(skillDir, 'playbooks'), { recursive: true });
fs.writeFileSync(path.join(skillDir, 'playbooks', 'feature.md'), '');
const skills = [
  { name: 'poteto-mode', description: 'Workflow playbooks', baseDir: skillDir },
  { name: 'nestjs-patterns', description: 'NestJS modules and DTO validation', baseDir: tmp },
  { name: 'security-audit', description: 'Security review for APIs', baseDir: tmp },
];
fs.writeFileSync(path.join(tmp, 'catalog.json'), JSON.stringify({ models }));
fs.writeFileSync(path.join(tmp, 'skills.json'), JSON.stringify({ skills }));
const fakeOmp = path.join(tmp, 'omp');
fs.writeFileSync(fakeOmp, `#!/bin/sh\n[ "$1" = skill ] && exec cat "${path.join(tmp, 'skills.json')}"\ncat "${path.join(tmp, 'catalog.json')}"\n`, { mode: 0o755 });

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, OMP_BIN: fakeOmp, OMP_WORKERS_HOME: tmp, OMP_WORKERS_LINGER_MS: '0' } });
const startWith = (task) => {
  const file = path.join(tmp, 'tasks.json');
  fs.writeFileSync(file, JSON.stringify([{ id: 'a', ...task }]));
  return run('start', file, '--cwd', tmp);
};
const resolve = (words) => {
  const r = run('models', ...words.split(' '));
  return { code: r.status, ...JSON.parse(r.stdout) };
};

test('provider word picks one model', () => {
  assert.deepEqual([resolve('gpt-6.1 terra copilot').match, resolve('gpt 6.1 terra github copilot').match], ['github-copilot/gpt-6.1-terra', 'github-copilot/gpt-6.1-terra']);
});

test('dotted and dashed versions match each other, and 5.5 never matches 5', () => {
  assert.equal(resolve('opus 5.5 copilot').match, 'github-copilot/claude-opus-5.5');
  assert.equal(resolve('claude opus 5-5 anthropic').match, 'anthropic/claude-opus-5-5');
});

test('a named provider beats a router id that contains the provider name', () => {
  assert.equal(resolve('opus 5.5 anthropic').match, 'anthropic/claude-opus-5-5');
});

test('a dated id keeps its version token', () => {
  assert.equal(resolve('haiku 4.5').match, 'anthropic/claude-haiku-4-5-20251001');
});

test('same id on two providers is ambiguous and exits 1', () => {
  const r = resolve('gpt 6.1 terra');
  assert.deepEqual([r.code, r.match, r.candidates.slice(0, 2).map((c) => c.selector)], [1, null, ['github-copilot/gpt-6.1-terra', 'llmgate/gpt-6.1-terra']]);
});

test('start rejects an inexact model and an unsupported thinking level', () => {
  assert.match(startWith({ prompt: 'skill://nestjs-patterns', model: 'gpt-6.1-terra' }).stderr, /a: unknown model gpt-6.1-terra/);
  assert.match(startWith({ prompt: 'skill://nestjs-patterns', model: 'github-copilot/gpt-6.1-terra', thinking: 'max' }).stderr, /thinking is one of low, medium, high/);
});

test('start rejects a brief that names no skill, an unknown skill, or a missing playbook', () => {
  assert.match(startWith({ prompt: 'fix the bug' }).stderr, /a: the brief names no skill/);
  assert.match(startWith({ prompt: '/skill:poteto-mode read skill://made-up-skill' }).stderr, /a: omp has no skill made-up-skill/);
  assert.match(startWith({ prompt: '/skill:poteto-mode Playbook: skill://poteto-mode/playbooks/nope.md' }).stderr, /skill:\/\/poteto-mode\/playbooks\/nope\.md does not exist/);
});

test('start accepts a brief whose skills and playbook exist', () => {
  const r = startWith({ prompt: '/skill:poteto-mode\nPlaybook: skill://poteto-mode/playbooks/feature.md.\nSkills:\n- skill://nestjs-patterns: DTO shape' });
  assert.deepEqual([r.status, JSON.parse(r.stdout).workers], [0, ['a']]);
});

test('skills lists catalog entries matching the words, best match first', () => {
  assert.deepEqual(run('skills', 'nestjs', 'dto', '--cwd', tmp).stdout.trim().split('\n'), ['nestjs-patterns: NestJS modules and DTO validation']);
  assert.equal(run('skills', '--cwd', tmp).stdout.trim().split('\n').length, 3);
});
