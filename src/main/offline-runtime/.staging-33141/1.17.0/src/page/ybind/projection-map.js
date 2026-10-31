const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const fail = (message) => { throw new RangeError(message); };
const sideOf = (affinity) => {
  if (affinity !== "before" && affinity !== "after") fail(`Unknown affinity: ${affinity}`);
  return affinity;
};
const firstAbove = (list, pick, value) => {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pick(list[mid]) <= value) lo = mid + 1; else hi = mid; }
  return lo;
};

export function createProjectionMap(w, physicalLength) {
  if (!w || typeof w !== "object" || !isCount(w.tokens)) fail("A projection map needs a walk result with a token count");
  if (!isCount(physicalLength)) fail("A projection map needs a nonnegative physical length");
  const holes = w.holes === undefined ? [] : w.holes;
  if (!Array.isArray(holes)) fail("A projection map needs the walk holes");
  const segments = [];
  const spans = [];
  const prefix = [0];
  let logical = 0, physical = 0, previousAt = -1;
  const show = (length) => {
    segments.push({ logicalStart: logical, logicalLength: length, physicalStart: physical, physicalLength: length, kind: "visible" });
    logical += length;
    physical += length;
  };
  const hide = (length) => {
    const last = spans[spans.length - 1];
    if (last && last.at === logical) {
      last.length += length;
      last.end += length;
      segments[segments.length - 1].physicalLength += length;
      prefix[prefix.length - 1] += length;
    } else {
      spans.push({ at: logical, start: physical, end: physical + length, length });
      segments.push({ logicalStart: logical, logicalLength: 0, physicalStart: physical, physicalLength: length, kind: "hidden" });
      prefix.push(prefix[prefix.length - 1] + length);
    }
    physical += length;
  };
  for (const hole of holes) {
    if (!hole || typeof hole !== "object" || !isCount(hole.at) || !isCount(hole.len)) fail("Malformed walk hole");
    if (hole.at < previousAt) fail("Walk holes are out of order");
    if (hole.at > w.tokens) fail("A walk hole sits past the logical length");
    previousAt = hole.at;
    if (hole.at > logical) show(hole.at - logical);
    if (hole.len) hide(hole.len);
  }
  if (logical < w.tokens) show(w.tokens - logical);
  if (physical !== physicalLength) fail("Walk holes do not account for the physical length");
  const spansAt = (value) => firstAbove(spans, (span) => span.at, value);
  const spansEnded = (value) => firstAbove(spans, (span) => span.end, value);
  const physicalAt = (value) => value + prefix[spansAt(value)];
  const spanAt = (value) => {
    const span = spans[spansAt(value) - 1];
    return span && span.at === value ? span : null;
  };
  const spanInside = (value) => {
    const span = spans[spansEnded(value)];
    return span && span.start <= value ? span : null;
  };
  const toPhysical = (value, affinity) => {
    const side = sideOf(affinity);
    if (!isCount(value) || value > w.tokens) fail(`Logical position ${value} is outside the map`);
    const span = spanAt(value);
    if (span) return side === "before" ? span.start : span.end;
    return physicalAt(value);
  };
  const toLogical = (value, affinity) => {
    sideOf(affinity);
    if (!isCount(value) || value > physicalLength) fail(`Physical position ${value} is outside the flow`);
    const span = spanInside(value);
    if (span) return span.at;
    return value - prefix[spansEnded(value)];
  };
  const physicalRanges = (from, to) => {
    if (!isCount(from) || !isCount(to) || from > w.tokens || to > w.tokens) fail(`Logical range ${from}..${to} is outside the map`);
    const ranges = [];
    if (to <= from) return ranges;
    let start = physicalAt(from);
    for (const span of spans) {
      if (span.at <= from) continue;
      if (span.at > to) break;
      if (span.start > start) ranges.push([start, span.start]);
      start = span.end;
    }
    const end = physicalAt(to);
    if (end > start) ranges.push([start, end]);
    return ranges;
  };
  return { segments, logicalLength: w.tokens, physicalLength, toPhysical, toLogical, physicalRanges };
}
