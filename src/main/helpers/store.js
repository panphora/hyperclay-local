// Helper programs and the answers documents gave about them, held in settings.
// Pure functions over the settings object: callers save after mutating.

const crypto = require('crypto');

// settings.helperPrograms:  [{ id, name, path, anyDocument, addedAt }]
// settings.helperDecisions: [{ document, name, program?, allowed, decidedAt, accountId? }]
const PROGRAM_CAP = 32;
const DECISION_CAP = 512;

function resolveHelper(settings, { document, name, accountId = null }) {
  const programs = settings.helperPrograms || [];
  const decision = (settings.helperDecisions || []).find(d => d.document === document && d.name === name);
  if (decision && (decision.accountId ?? null) === accountId) {
    if (!decision.allowed) return { decided: true, allowed: false, program: null };
    const program = programs.find(p => p.id === decision.program);
    if (program) return { decided: true, allowed: true, program };
  }
  const named = programs.filter(p => p.name === name);
  if (accountId === null) {
    const broad = named.find(p => p.anyDocument);
    if (broad) return { decided: true, allowed: true, program: broad };
  }
  return { decided: false, allowed: false, program: named[0] || null };
}

function addProgram(settings, name, path) {
  const programs = settings.helperPrograms || (settings.helperPrograms = []);
  if (programs.length >= PROGRAM_CAP) return null;
  const program = {
    id: crypto.randomBytes(16).toString('hex'),
    name,
    path,
    anyDocument: false,
    addedAt: Date.now(),
  };
  programs.push(program);
  return program;
}

function decide(settings, decision) {
  const decisions = settings.helperDecisions || (settings.helperDecisions = []);
  const index = decisions.findIndex(d => d.document === decision.document && d.name === decision.name);
  if (index !== -1) {
    decisions[index] = decision;
    return decision;
  }
  if (decisions.length >= DECISION_CAP) return null;
  decisions.push(decision);
  return decision;
}

function setAnyDocument(settings, id, anyDocument) {
  const program = (settings.helperPrograms || []).find(p => p.id === id);
  if (!program) return false;
  program.anyDocument = anyDocument;
  return true;
}

function removeProgram(settings, id) {
  const programs = settings.helperPrograms || [];
  const index = programs.findIndex(p => p.id === id);
  if (index === -1) return null;
  const [program] = programs.splice(index, 1);
  settings.helperDecisions = (settings.helperDecisions || []).filter(d => d.program !== id);
  return program;
}

function forgetDecisions(settings, document) {
  const decisions = settings.helperDecisions || [];
  const kept = decisions.filter(d => d.document !== document);
  settings.helperDecisions = kept;
  return decisions.length - kept.length;
}

module.exports = {
  resolveHelper,
  addProgram,
  decide,
  setAnyDocument,
  removeProgram,
  forgetDecisions,
  PROGRAM_CAP,
  DECISION_CAP,
};
