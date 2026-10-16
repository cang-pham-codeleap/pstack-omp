import { describe, expect, it } from 'bun:test';
import { checkReady, hashDescription } from './check-ticket-ready.mjs';

const template = `**Instance (must):**

* Registry

**Problem to solve (must):**

* Developers lack a registry-native editor.

**User Story (must):**

* As a developer, I want an html-editor Block.

**To do/actions (must):**

* Rebuild html-editor.

**Acceptance Criteria (must):**

* Published as a Block.

**Test process (must):**

1. Run pnpm build.

**Tester (internal, must):** <custom data-type="mention" data-id="id-0">@Long Luu</custom>

**Stakeholder validation (external, must):**

None

**Description of the breaking changes (must):**

* None
`;

const intake = `
## Agent intake

Type: rebuild

### Source of truth
* Legacy: jtl-platform-ui-react/src/HtmlEditor

### Scope
* In: editor shell. Out: image upload.

### API contract
* Keep value/onChange. Deprecate legacy \`html\` prop.

### Deliverables
* Story, Fumadocs page with live demo, changeset.

### Precedence
* Ticket, then Figma, then legacy.

### Decisions
* D1: Remove or deprecate \`html\`? -> Deprecate it (source: user, 2026-10-16)

### Delivery
* Branch feat/cp-6011-html-editor, base main, minor changeset.
`;

describe('ticket readiness', () => {
  it('accepts a ticket whose template and agent intake sections are filled', () => {
    const result = checkReady(template + intake);

    expect(result).toMatchObject({ ready: true, type: 'rebuild', missing: [], empty: [], open: [] });
  });

  it('names the human-owned field that is blank and refuses to be ready', () => {
    const blankTester = (template + intake).replace(/\*\*Tester.*\n/, '**Tester (internal, must):**\n');

    const result = checkReady(blankTester);

    expect(result.ready).toBe(false);
    expect(result.needsHuman).toEqual(['tester']);
  });

  it('rejects placeholder and open-question content that a heading check would accept', () => {
    const gamed = (template + intake)
      .replace('* Ticket, then Figma, then legacy.', 'N/A')
      .replace('* Keep value/onChange. Deprecate legacy `html` prop.', '* [OPEN] keep value?');

    const result = checkReady(gamed);

    expect(result.ready).toBe(false);
    expect(result.empty).toEqual(['precedence']);
    expect(result.open).toEqual(['* [OPEN] keep value?']);
  });

  it('requires the sections of the ticket type, so a bug needs a repro', () => {
    const result = checkReady(template + intake, { type: 'bug' });

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(['repro', 'expected vs actual']);
  });

  it('flags decisions without a recorded source and date', () => {
    const result = checkReady((template + intake).replace(/\(source: user, 2026-10-16\)/, ''));

    expect(result.ready).toBe(false);
    expect(result.badDecisions).toHaveLength(1);
  });

  it('treats the ticket as stale once its description changes after the recorded hash', () => {
    const { hash } = checkReady(template + intake);

    expect(checkReady(template + intake, { expectHash: hash }).ready).toBe(true);
    expect(checkReady(`${template + intake}\n* new requirement`, { expectHash: hash })).toMatchObject({
      ready: false,
      stale: true,
    });
    expect(hashDescription(`${template + intake}\r\n`)).toBe(hash);
  });
});
