const states = new WeakMap();
const released = new WeakSet();
const pending = new Set();
let generation = 0;
let sequence = 0;

const TEXT_BLOCKS = new Set('P H1 H2 H3 H4 H5 H6 DIV LI DD DT BLOCKQUOTE FIGCAPTION SUMMARY ADDRESS'.split(' '));
const isElement = (node) => node?.nodeType === 1;
const onPage = (node) => {
  try {
    return !!node && node.ownerDocument === document && document.documentElement.contains(node);
  } catch {
    return false;
  }
};
const rawOf = (record) => record.rawReports?.length ? record.rawReports : [record];
const rawSet = (records) => new Set(records.flatMap(rawOf).filter((raw) => !released.has(raw)));

function childrenOf(node) {
  return [...node.childNodes, ...(node.nodeType === 1 && node.localName === 'template' && node.content ? [node.content] : [])];
}

function attributesOf(node) {
  return isElement(node) ? [...node.attributes].map((a) => [a.namespaceURI, a.name, a.value]) : [];
}

function fieldsOf(node) {
  const names = {
    input: ['HTMLInputElement', 'value', 'checked'],
    textarea: ['HTMLTextAreaElement', 'value'],
    select: ['HTMLSelectElement', 'selectedIndex'],
    option: ['HTMLOptionElement', 'selected'],
  }[node.localName];
  const prototype = names && document.defaultView[names[0]]?.prototype;
  if (!prototype?.isPrototypeOf(node)) return [];
  return names.slice(1).map((name) => Object.getOwnPropertyDescriptor(prototype, name).get.call(node));
}

function witness(node) {
  const parents = [];
  for (let p = node.parentNode; p; p = p.parentNode) parents.push(p);
  const rows = [];
  const visit = (n) => {
    const children = childrenOf(n);
    rows.push({ node: n, value: n.nodeValue, attributes: attributesOf(n), fields: fieldsOf(n), children });
    for (const child of children) visit(child);
  };
  visit(node);
  return { node, parents, rows };
}

function valid(w, topologyOnly = false) {
  if (!onPage(w.node)) return false;
  let p = w.node.parentNode;
  for (const parent of w.parents) {
    if (p !== parent) return false;
    p = p.parentNode;
  }
  if (p) return false;
  for (const row of w.rows) {
    const children = childrenOf(row.node);
    if (children.length !== row.children.length || children.some((n, i) => n !== row.children[i])) return false;
    if (topologyOnly) continue;
    if (row.node.nodeValue !== row.value) return false;
    const attrs = attributesOf(row.node);
    if (attrs.length !== row.attributes.length || attrs.some((a, i) => a.some((v, j) => v !== row.attributes[i][j]))) return false;
    if (fieldsOf(row.node).some((value, i) => value !== row.fields[i])) return false;
  }
  return true;
}

export const captureFootprintWitnesses = (nodes) => [...new Set(nodes)].map(witness);
export const footprintWitnessesValid = (witnesses) => witnesses.every((w) => valid(w));
export const protectionGeneration = () => generation;

function put(raw, nodes, mode, status = 'proved') {
  if (released.has(raw)) return null;
  const unique = [...new Set(nodes)];
  const state = {
    nodes: unique,
    mode,
    status,
    generation: ++generation,
    witnesses: mode === 'document' ? [] : unique.map(witness),
  };
  states.set(raw, state);
  return state;
}

const broad = (raw) => put(raw, [document.documentElement], 'document', 'unknown');

function spanNode(span) {
  if (!onPage(span?.startContainer) || !onPage(span?.endContainer)) return null;
  const above = new Set();
  for (let n = span.startContainer; n; n = n.parentNode) above.add(n);
  let node = span.endContainer;
  while (node && !above.has(node)) node = node.parentNode;
  if (!isElement(node)) node = node?.parentElement;
  for (let n = node; n; n = n.parentElement) if (TEXT_BLOCKS.has(n.tagName)) return n;
  return node;
}

function seed(raw) {
  const recovery = raw.recovery;
  for (const span of [recovery?.text?.liveSpan, recovery?.text?.liveScope]) {
    const node = spanNode(span);
    if (node && node !== document.documentElement) return put(raw, [node], 'source');
  }
  const live = recovery?.subject?.live || [];
  const nodes = live.map((n) => isElement(n) ? n : n?.parentElement);
  if (nodes.length && nodes.every((n) => onPage(n) && n !== document.documentElement)) return put(raw, nodes, 'source');
  return broad(raw);
}

function current(raw, create = false) {
  let state = states.get(raw);
  if (!state) return create ? seed(raw) : null;
  if (state.mode === 'document') return state.nodes[0] === document.documentElement ? state : broad(raw);
  if (state.witnesses.every((w) => valid(w))) return state;
  // Original live identity still locates a loss after ordinary value edits.
  // A transferred or broadened region has no such independent recovery anchor.
  if (state.mode === 'source' && state.witnesses.every((w) => valid(w, true))) {
    return put(raw, state.nodes, 'source');
  }
  return broad(raw);
}

export function protectionOf(record) {
  if (released.has(record)) return null;
  const raws = [...rawSet([record])];
  const values = raws.map((raw) => current(raw));
  if (!values.some(Boolean)) return null;
  if (values.some((state) => !state)) {
    for (const raw of raws) if (!states.has(raw)) broad(raw);
    return protectionOf(record);
  }
  const union = [...new Set(values.flatMap((state) => state.nodes))];
  if (values.every((state) => state.mode === 'source') && union.length === 1) return null;
  const nodes = values.some((state) => state.mode === 'document')
    ? [document.documentElement]
    : union;
  return { nodes, status: values.some((state) => state.status === 'unknown') ? 'unknown' : 'proved', generation };
}

export function releaseProtection(record) {
  for (const raw of rawOf(record)) {
    released.add(raw);
    states.delete(raw);
  }
  released.add(record);
  states.delete(record);
  generation++;
}

function allRaw(records) {
  const raws = rawSet(records);
  for (const frame of pending) {
    for (const raw of [...frame.tracked, ...frame.raws]) if (!released.has(raw)) raws.add(raw);
  }
  return raws;
}

function positive(entry) {
  if (entry?.complete !== true || !Array.isArray(entry.to) || entry.to.length !== 1) return null;
  const target = entry.to[0];
  if (!isElement(target) || !onPage(target)) return null;
  if (entry.kind === 'retained' && target === entry.from) return target;
  if (entry.kind === 'replaced' && target !== entry.from && !onPage(entry.from)) return target;
  return null;
}

export function beginLineageCapture(records) {
  const frame = {
    serial: ++sequence,
    tracked: allRaw(records),
    raws: new Set(),
    before: new Map(),
    delivered: false,
    invalid: false,
    report: null,
    finished: false,
  };
  generation++;
  const elements = new Set();
  for (const raw of frame.tracked) {
    const state = current(raw, true);
    const chains = state.mode === 'document' ? [] : state.nodes.map((node) => {
      const chain = [];
      for (let n = node; n && n !== document.documentElement; n = n.parentElement) {
        if (onPage(n)) { chain.push(n); elements.add(n); }
      }
      return chain;
    });
    frame.before.set(raw, { state, chains });
  }
  pending.add(frame);

  const invalidate = (openRecords = []) => {
    frame.invalid = true;
    generation++;
    for (const raw of allRaw(openRecords)) broad(raw);
  };

  const lineage = {
    elements: [...elements],
    onResult(result, report) {
      if (frame.finished || frame.delivered) {
        invalidate();
        return;
      }
      frame.delivered = true;
      frame.report = report;
      frame.raws = rawSet(report?.conflicts || []);
      const complete = !frame.invalid && frame.serial === sequence && result?.version === 1 &&
        result.root === document.documentElement && result.status === 'complete' &&
        Array.isArray(result.entries) && report?.lineage === result;
      if (!complete) { invalidate(); return; }
      const entries = new Map();
      for (const entry of result.entries) {
        if (!entry || typeof entry !== 'object' || !isElement(entry.from)) continue;
        if (entries.has(entry.from)) entries.set(entry.from, null);
        else entries.set(entry.from, entry);
      }
      for (const [raw, { state, chains }] of frame.before) {
        if (released.has(raw)) continue;
        if (state.mode === 'document') { broad(raw); continue; }
        const nodes = [];
        let fallback = false;
        for (const chain of chains) {
          let found = null;
          for (let i = 0; i < chain.length; i++) {
            found = positive(entries.get(chain[i]));
            if (found) { fallback ||= i > 0; break; }
          }
          if (!found) { nodes.push(document.documentElement); break; }
          nodes.push(found);
        }
        if (!nodes.length || nodes.includes(document.documentElement)) broad(raw);
        else {
          const same = !fallback && state.mode === 'source' && nodes.every((n, i) => n === state.nodes[i]);
          put(raw, nodes, same ? 'source' : 'lineage', fallback ? 'unknown' : state.status);
        }
      }
      for (const raw of frame.raws) if (!states.has(raw)) seed(raw);
      frame.before.clear();
    },
  };

  return {
    lineage,
    returned() {
      if (!frame.delivered) invalidate();
    },
    invalidate,
    prepareComplete(report, openRecords) {
      if (report !== frame.report || !frame.delivered || frame.invalid) {
        for (const raw of rawSet(report?.conflicts || [])) frame.raws.add(raw);
        invalidate(openRecords);
      } else {
        for (const raw of rawSet(report?.conflicts || [])) {
          if (!frame.raws.has(raw)) { frame.raws.add(raw); broad(raw); }
        }
      }
    },
    finish(openRecords) {
      if (frame.finished) return;
      const keep = rawSet(openRecords);
      for (const raw of frame.raws) if (!keep.has(raw)) states.delete(raw);
      frame.finished = true;
      pending.delete(frame);
      frame.tracked.clear();
      frame.raws.clear();
      frame.before.clear();
      frame.report = null;
      lineage.elements = [];
    },
  };
}
