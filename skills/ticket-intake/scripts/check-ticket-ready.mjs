import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const COMMON = [
  'instance',
  'problem to solve',
  'user story',
  'to do',
  'acceptance criteria',
  'test process',
  'tester',
  'stakeholder validation',
  'breaking changes',
];

const HUMAN_ONLY = new Set(['instance', 'tester', 'stakeholder validation']);
const NONE_ALLOWED = new Set(['breaking changes', 'stakeholder validation']);

export const TYPES = {
  rebuild: ['source of truth', 'scope', 'api contract', 'deliverables', 'precedence', 'decisions', 'delivery'],
  component: ['source of truth', 'scope', 'api contract', 'deliverables', 'decisions', 'delivery'],
  enhancement: ['scope', 'api contract', 'deliverables', 'decisions', 'delivery'],
  bug: ['repro', 'expected vs actual', 'scope', 'decisions', 'delivery'],
  tooling: ['scope', 'decisions', 'delivery'],
  docs: ['scope', 'deliverables', 'decisions', 'delivery'],
  tokens: ['source of truth', 'scope', 'decisions', 'delivery'],
  refactor: ['scope', 'behavior preserved', 'decisions', 'delivery'],
  spike: ['question', 'deliverables', 'decisions'],
};

const ALIASES = {
  'to do/actions': 'to do',
  'description of the breaking changes': 'breaking changes',
  'technical notes/developer hints': 'technical notes',
};

const KNOWN = new Set([...COMMON, ...Object.values(TYPES).flat(), ...Object.values(ALIASES), 'designs', 'agent intake', 'agent discretion']);

const PLACEHOLDER = /^(n\/?a|none|tbd|-)$/i;
const OPEN_MARKER = /\[OPEN\]|\bTBD\b|\?\?\?/i;
const DECISION_LINE = /^[-*\s]*D\d+:\s*(?!->)\S.*?->\s*(?!\(source:)\S.*\(source:\s*(user|default|ticket),\s*\d{4}-\d{2}-\d{2}\)\s*$/;

export function normalizeDescription(markdown) {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function hashDescription(markdown) {
  return createHash('sha256').update(normalizeDescription(markdown)).digest('hex');
}

function normalizeLabel(raw) {
  const label = raw
    .replace(/\*\*/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/:$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return ALIASES[label] ?? label;
}

function parseSections(markdown) {
  const sections = new Map();
  let current = null;

  for (const line of normalizeDescription(markdown).split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    const bold = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
    const [label, rest] = heading ? [heading[1], ''] : bold ? [bold[1], bold[2]] : [null, ''];
    const name = label === null ? null : normalizeLabel(label);

    if (name !== null && KNOWN.has(name)) {
      current = name;
      sections.set(name, [...(sections.get(name) ?? []), rest].filter(Boolean));
    } else if (current !== null) {
      sections.get(current).push(line);
    }
  }

  return new Map([...sections].map(([name, lines]) => [name, lines.join('\n').trim()]));
}

function isEmpty(name, body) {
  const text = body.replace(/<[^>]+>/g, '').trim();
  if (text.replace(/[\s\-*•_`>|]+/g, '') === '') return true;
  return PLACEHOLDER.test(text) && !NONE_ALLOWED.has(name);
}

export function checkReady(markdown, { type, expectHash } = {}) {
  const sections = parseSections(markdown);
  const hash = hashDescription(markdown);
  const intake = sections.get('agent intake') ?? '';
  const resolvedType = type ?? intake.match(/^\s*type:\s*\**([a-z-]+)/im)?.[1]?.toLowerCase();

  const problems = { badType: null, missing: [], empty: [], needsHuman: [], open: [], badDecisions: [], stale: false };
  const required = resolvedType in TYPES ? [...COMMON, ...TYPES[resolvedType]] : COMMON;

  if (!(resolvedType in TYPES)) problems.badType = resolvedType ?? 'absent';

  for (const name of required) {
    const body = sections.get(name);
    const lacking = body === undefined || isEmpty(name, body);
    if (!lacking) continue;
    (body === undefined ? problems.missing : problems.empty).push(name);
    if (HUMAN_ONLY.has(name)) problems.needsHuman.push(name);
  }

  problems.open = normalizeDescription(markdown)
    .split('\n')
    .filter(line => OPEN_MARKER.test(line));

  const decisions = sections.get('decisions');
  if (decisions !== undefined && decisions.trim().toLowerCase() !== 'none') {
    problems.badDecisions = decisions.split('\n').filter(line => line.trim() && !DECISION_LINE.test(line));
  }

  problems.stale = expectHash !== undefined && expectHash !== hash;

  const ready = problems.badType === null && !problems.stale && ['missing', 'empty', 'open', 'badDecisions'].every(key => problems[key].length === 0);

  return { ready, type: resolvedType ?? null, hash, ...problems };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const flag = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
  const result = checkReady(readFileSync(0, 'utf8'), { type: flag('type'), expectHash: flag('expect') });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ready ? 0 : 1);
}
