const {
  resolveHelper,
  addProgram,
  decide,
  setAnyDocument,
  removeProgram,
  forgetDecisions,
  PROGRAM_CAP,
  DECISION_CAP,
} = require('../../src/main/helpers/store');

const DOC = '/Users/alex/Sites/app.html';
const OTHER = '/Users/alex/Sites/other.html';
const TEAM_ACCOUNT = 42;
const OTHER_ACCOUNT = 51;

const program = (overrides = {}) => ({
  id: overrides.id || `id-${Math.random().toString(16).slice(2)}`,
  name: 'search',
  path: '/usr/local/bin/search',
  anyDocument: false,
  addedAt: 1,
  ...overrides,
});

const decision = (overrides = {}) => ({
  document: DOC,
  name: 'search',
  program: 'p1',
  allowed: true,
  decidedAt: 1,
  ...overrides,
});

const settings = (helperPrograms = [], helperDecisions = []) => ({ helperPrograms, helperDecisions });

describe('resolveHelper', () => {
  test('allows the document when a personal decision approved the name', () => {
    const p1 = program({ id: 'p1' });
    const s = settings([p1], [decision({ program: 'p1', accountId: null })]);

    expect(resolveHelper(s, { document: DOC, name: 'search', accountId: null }))
      .toEqual({ decided: true, allowed: true, program: p1 });
  });

  test('denies the document when a personal decision refused the name', () => {
    const s = settings([program({ id: 'p1' })], [decision({ allowed: false, program: undefined, accountId: null })]);

    expect(resolveHelper(s, { document: DOC, name: 'search', accountId: null }))
      .toEqual({ decided: true, allowed: false, program: null });
  });

  test('leaves the document undecided when the decision names a program that is not registered', () => {
    const p1 = program({ id: 'p1' });
    const s = settings([p1], [decision({ program: 'gone', accountId: null })]);

    expect(resolveHelper(s, { document: DOC, name: 'search', accountId: null }))
      .toEqual({ decided: false, allowed: false, program: p1 });
  });

  test('leaves the document undecided when there is no program with that name', () => {
    const p1 = program({ id: 'p1', name: 'other-helper' });
    const s = settings([p1], []);

    expect(resolveHelper(s, { document: DOC, name: 'search', accountId: null }))
      .toEqual({ decided: false, allowed: false, program: null });
  });

  test('ignores a decision recorded for another document or another name', () => {
    const p1 = program({ id: 'p1' });
    const s = settings([p1], [
      decision({ document: OTHER, accountId: null }),
      decision({ name: 'ai-edit', accountId: null }),
    ]);

    expect(resolveHelper(s, { document: DOC, name: 'search', accountId: null }))
      .toEqual({ decided: false, allowed: false, program: p1 });
  });

  test('proposes the earliest registration of the name', () => {
    const first = program({ id: 'first' });
    const second = program({ id: 'second' });
    const s = settings([first, second], []);

    expect(resolveHelper(s, { document: DOC, name: 'search', accountId: null }).program).toEqual(first);
  });

  test('allows any document for a personal document when the program is marked anyDocument', () => {
    const broad = program({ id: 'p1', anyDocument: true });
    const s = settings([broad], []);

    expect(resolveHelper(s, { document: DOC, name: 'search', accountId: null }))
      .toEqual({ decided: true, allowed: true, program: broad });
  });

  test('never lets a team document inherit an anyDocument program', () => {
    const broad = program({ id: 'p1', anyDocument: true });
    const s = settings([broad], []);

    expect(resolveHelper(s, { document: DOC, name: 'search', accountId: TEAM_ACCOUNT }))
      .toEqual({ decided: false, allowed: false, program: broad });
  });

  test('still allows a team document when its own decision approved the name', () => {
    const p1 = program({ id: 'p1' });
    const s = settings([p1], [decision({ accountId: TEAM_ACCOUNT })]);

    expect(resolveHelper(s, { document: DOC, name: 'search', accountId: TEAM_ACCOUNT }))
      .toEqual({ decided: true, allowed: true, program: p1 });
  });

  test('reads a decision recorded under another account as undecided', () => {
    const p1 = program({ id: 'p1' });
    const s = settings([p1], [decision({ accountId: TEAM_ACCOUNT })]);

    expect(resolveHelper(s, { document: DOC, name: 'search', accountId: OTHER_ACCOUNT }))
      .toEqual({ decided: false, allowed: false, program: p1 });
  });

  test('a denial recorded under another account does not stick', () => {
    const p1 = program({ id: 'p1' });
    const s = settings([p1], [decision({ allowed: false, program: undefined, accountId: TEAM_ACCOUNT })]);

    expect(resolveHelper(s, { document: DOC, name: 'search', accountId: OTHER_ACCOUNT }))
      .toEqual({ decided: false, allowed: false, program: p1 });
  });

  test('defaults to a personal document when no account is given', () => {
    const broad = program({ id: 'p1', anyDocument: true });
    const s = settings([broad], []);

    expect(resolveHelper(s, { document: DOC, name: 'search' }))
      .toEqual({ decided: true, allowed: true, program: broad });
  });
});

describe('addProgram', () => {
  test('registers a program with a 16-byte hex id, this document only', () => {
    const s = settings();

    const added = addProgram(s, 'search', '/usr/local/bin/search');

    expect(added.id).toMatch(/^[0-9a-f]{32}$/);
    expect(added.name).toBe('search');
    expect(added.path).toBe('/usr/local/bin/search');
    expect(added.anyDocument).toBe(false);
    expect(typeof added.addedAt).toBe('number');
    expect(s.helperPrograms).toEqual([added]);
  });

  test('registers a second program under a different id', () => {
    const s = settings();

    const first = addProgram(s, 'search', '/usr/local/bin/search');
    const second = addProgram(s, 'search', '/opt/bin/search');

    expect(second.id).not.toBe(first.id);
    expect(s.helperPrograms).toEqual([first, second]);
  });

  test('refuses past the program cap', () => {
    const s = settings();
    for (let i = 0; i < PROGRAM_CAP; i++) expect(addProgram(s, `helper-${i}`, `/bin/${i}`)).not.toBeNull();
    expect(s.helperPrograms).toHaveLength(PROGRAM_CAP);

    expect(addProgram(s, 'one-too-many', '/bin/extra')).toBeNull();
    expect(s.helperPrograms).toHaveLength(PROGRAM_CAP);
  });
});

describe('decide', () => {
  test('records a decision and replaces the row for the same document and name', () => {
    const s = settings();

    decide(s, decision({ allowed: false, program: undefined, decidedAt: 1 }));
    decide(s, decision({ program: 'p1', decidedAt: 2 }));

    expect(s.helperDecisions).toHaveLength(1);
    expect(s.helperDecisions[0]).toEqual(decision({ program: 'p1', decidedAt: 2 }));
  });

  test('keeps the decisions of other documents and names', () => {
    const s = settings();

    decide(s, decision({ document: OTHER }));
    decide(s, decision({ name: 'ai-edit' }));
    decide(s, decision({ program: 'p2' }));

    expect(s.helperDecisions).toHaveLength(3);
    expect(s.helperDecisions.filter((d) => d.document === DOC && d.name === 'search'))
      .toEqual([decision({ program: 'p2' })]);
  });

  test('refuses a new row past the decision cap', () => {
    const s = settings();
    for (let i = 0; i < DECISION_CAP; i++) {
      expect(decide(s, decision({ document: `/Users/alex/Sites/${i}.html` }))).not.toBeNull();
    }
    expect(s.helperDecisions).toHaveLength(DECISION_CAP);

    expect(decide(s, decision({ document: '/Users/alex/Sites/one-too-many.html' }))).toBeNull();
    expect(s.helperDecisions).toHaveLength(DECISION_CAP);
  });

  test('replaces an existing row even when the decision cap is reached', () => {
    const s = settings();
    decide(s, decision({ decidedAt: 1 }));
    for (let i = 0; i < DECISION_CAP - 1; i++) decide(s, decision({ document: `/Users/alex/Sites/${i}.html` }));
    expect(s.helperDecisions).toHaveLength(DECISION_CAP);

    const replacement = decision({ program: 'p9', decidedAt: 2 });
    expect(decide(s, replacement)).toEqual(replacement);
    expect(s.helperDecisions).toHaveLength(DECISION_CAP);
    expect(s.helperDecisions.find((d) => d.document === DOC && d.name === 'search')).toEqual(replacement);
  });
});

describe('setAnyDocument', () => {
  test('flips the flag on a registered program', () => {
    const p1 = program({ id: 'p1' });
    const s = settings([p1]);

    expect(setAnyDocument(s, 'p1', true)).toBe(true);
    expect(p1.anyDocument).toBe(true);
    expect(setAnyDocument(s, 'p1', false)).toBe(true);
    expect(p1.anyDocument).toBe(false);
  });

  test('reports an unregistered id', () => {
    const s = settings([program({ id: 'p1' })]);

    expect(setAnyDocument(s, 'missing', true)).toBe(false);
  });
});

describe('removeProgram', () => {
  test('drops the program and the decisions that point at it', () => {
    const p1 = program({ id: 'p1' });
    const p2 = program({ id: 'p2', name: 'ai-edit' });
    const kept = decision({ document: OTHER, name: 'ai-edit', program: 'p2' });
    const s = settings([p1, p2], [decision({ program: 'p1' }), kept]);

    expect(removeProgram(s, 'p1')).toEqual(p1);
    expect(s.helperPrograms).toEqual([p2]);
    expect(s.helperDecisions).toEqual([kept]);
    expect(resolveHelper(s, { document: DOC, name: 'search', accountId: null }))
      .toEqual({ decided: false, allowed: false, program: null });
  });

  test('reports an unregistered id and changes nothing', () => {
    const s = settings([program({ id: 'p1' })], [decision({ program: 'p1' })]);

    expect(removeProgram(s, 'missing')).toBeNull();
    expect(s.helperPrograms).toHaveLength(1);
    expect(s.helperDecisions).toHaveLength(1);
  });
});

describe('forgetDecisions', () => {
  test('drops every decision of one document and reports how many', () => {
    const other = decision({ document: OTHER });
    const s = settings([], [
      decision({ name: 'search' }),
      decision({ name: 'ai-edit' }),
      other,
    ]);

    expect(forgetDecisions(s, DOC)).toBe(2);
    expect(s.helperDecisions).toEqual([other]);
  });

  test('reports zero for a document with no decisions', () => {
    const other = decision({ document: OTHER });
    const s = settings([], [other]);

    expect(forgetDecisions(s, DOC)).toBe(0);
    expect(s.helperDecisions).toEqual([other]);
  });
});
