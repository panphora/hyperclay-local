const beautify = require('js-beautify');

const beautifyOptions = {
  indent_size: 2,
  indent_char: ' ',
  wrap_attributes: 'force-expand-multiline',
  unformatted: ['svg', 'path', 'rect', 'circle', 'script', 'style', 'link', 'meta']
};

// Beautify is superlinear in nesting depth and amplifies output through indentation
// (force-expand-multiline puts each attribute on its own line), so its cost is bounded in
// three places, each failing safe to storing the bytes as sent: deepest nesting and
// projected output size are checked BEFORE formatting (the CPU and the allocation are both
// spent during beautify and cannot be measured afterwards), actual growth is checked after,
// and beautify itself is wrapped so even a throw stores the input unchanged. A heuristic
// miss only ever means "not reformatted", never a wrong document.
const MAX_FORMAT_DEPTH = 256;
const MAX_PROJECTED_BYTES = 32 * 1024 * 1024;
const MAX_GROWTH_RATIO = 3;

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

// Formatting is opt-in per document (spec §4): reformat only when the ROOT <html> element
// carries formathtml="true", read by value. This is a small linear scan of the document
// prefix and the root start-tag (never a whole-document regex) so it stays anchored to the
// real root, matches how a browser parses the tag (quotes only delimit in value position,
// only ASCII whitespace separates attributes, comments end at --> or --!>), and cannot
// backtrack on hostile input. Anything but the exact literal value "true" — any other value,
// no attribute, the attribute on a non-root element, an entity-encoded value, or a root tag
// that never closes — stores the bytes exactly as sent.
function isWs(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

function commentEnd(str, from) {
  if (str[from] === '>') return from + 1;                          // <!-->
  if (str[from] === '-' && str[from + 1] === '>') return from + 2; // <!--->
  const len = str.length;
  for (let k = from; k < len; k++) {
    if (str[k] === '-' && str[k + 1] === '-') {
      let e = k + 2;
      if (str[e] === '!') e++;                                     // comment-end-bang: --!>
      if (str[e] === '>') return e + 1;
    }
  }
  return -1;
}

function formatOptIn(str) {
  const len = str.length;
  let i = str.charCodeAt(0) === 0xFEFF ? 1 : 0;

  // Skip whitespace, comments, doctype, and processing instructions before the root.
  while (i < len) {
    const c = str[i];
    if (isWs(c)) { i++; continue; }
    if (c !== '<') return false;
    if (str[i + 1] === '!' && str[i + 2] === '-' && str[i + 3] === '-') {
      const end = commentEnd(str, i + 4);
      if (end === -1) return false;
      i = end;
      continue;
    }
    if (str[i + 1] === '!' || str[i + 1] === '?') {
      const end = str.indexOf('>', i);
      if (end === -1) return false;
      i = end + 1;
      continue;
    }
    break;
  }

  // Require the root <html> start-tag.
  if (str.substr(i, 5).toLowerCase() !== '<html') return false;
  const boundary = str[i + 5];
  if (boundary === undefined || !(isWs(boundary) || boundary === '>' || boundary === '/')) return false;
  i += 5;

  // Parse attributes, but only trust the result once the tag actually closes with '>'.
  // An unterminated tag (EOF, or a quoted value with no closing quote) is dropped whole by
  // an HTML parser, so it carries no root attribute: fail safe to "not opt-in".
  let optIn = false;
  let seen = false;
  while (i < len) {
    let c = str[i];
    if (c === '>') return optIn;
    if (isWs(c) || c === '/') { i++; continue; }

    const nameStart = i;
    while (i < len) {
      c = str[i];
      if (isWs(c) || c === '=' || c === '>' || c === '/') break;
      i++;
    }
    if (i === nameStart) {                 // sitting on '=' with no name: it begins the name
      i++;
      while (i < len) {
        c = str[i];
        if (isWs(c) || c === '=' || c === '>' || c === '/') break;
        i++;
      }
    }
    const name = str.slice(nameStart, i).toLowerCase();

    while (i < len && isWs(str[i])) i++;
    let value = '';
    if (str[i] === '=') {
      i++;
      while (i < len && isWs(str[i])) i++;
      c = str[i];
      if (c === '"' || c === "'") {
        const close = str.indexOf(c, i + 1);
        if (close === -1) return false;
        value = str.slice(i + 1, close);
        i = close + 1;
      } else {
        const valueStart = i;
        while (i < len) {
          c = str[i];
          if (isWs(c) || c === '>') break;
          i++;
        }
        value = str.slice(valueStart, i);
      }
    }

    if (name === 'formathtml' && !seen) {  // duplicate attributes: first occurrence wins
      seen = true;
      optIn = value === 'true';
    }
  }
  return false;
}

// Find the '>' that ends a start tag, skipping quoted attribute values, and count the
// attributes on the way. force-expand-multiline puts each attribute on its own indented
// line once a tag carries two or more, so attribute count drives the formatted size as much
// as nesting depth does: a shallow document packed with many-attribute tags can still make
// beautify allocate hundreds of MB. Returns { end, attrs }; end is -1 for an unterminated tag.
function scanStartTag(str, from) {
  const len = str.length;
  let attrs = 0;
  let j = from;
  while (j < len) {
    while (j < len && (isWs(str[j]) || str[j] === '/')) j++;
    if (j >= len) return { end: -1, attrs };
    if (str[j] === '>') return { end: j, attrs };
    attrs++;
    while (j < len && !isWs(str[j]) && str[j] !== '=' && str[j] !== '>' && str[j] !== '/') j++;
    while (j < len && isWs(str[j])) j++;
    if (str[j] === '=') {
      j++;
      while (j < len && isWs(str[j])) j++;
      const c = str[j];
      if (c === '"' || c === "'") {
        const close = str.indexOf(c, j + 1);
        if (close === -1) return { end: -1, attrs };
        j = close + 1;
      } else {
        while (j < len && !isWs(str[j]) && str[j] !== '>') j++;
      }
    }
  }
  return { end: -1, attrs };
}

function rawTextEnd(str, from, name) {
  const len = str.length;
  for (let k = from; k < len; k++) {
    if (str[k] !== '<' || str[k + 1] !== '/') continue;
    let m = 0;
    while (m < name.length && str[k + 2 + m] !== undefined &&
           str[k + 2 + m].toLowerCase() === name[m]) m++;
    if (m === name.length) return k;
  }
  return -1;
}

// One linear pass returning how expensive beautifying this document would be: the deepest
// element nesting, and an over-estimate of the formatted output size (input plus the
// indentation and newlines beautify inserts: one line per tag, plus one indented line per
// attribute once a tag carries two or more). Bails out early the moment the projected size
// alone is already decisive, so a size bomb is refused in a few ms without finishing the scan.
function measureFormatCost(str) {
  const len = str.length;
  const indent = beautifyOptions.indent_size;
  let depth = 0;
  let maxDepth = 0;
  let added = 0;
  let i = 0;
  while (i < len) {
    if (str[i] !== '<') {
      // beautify re-indents each line of a formatted text node by depth*indent spaces, so a
      // newline that costs 1 input byte costs depth*indent output bytes. Charge it, or a deeply
      // nested newline-heavy text node slips the size gate and makes beautify allocate/crash.
      if (str[i] === '\n' || (str[i] === '\r' && str[i + 1] !== '\n')) {
        added += depth * indent;
        if (len + added > MAX_PROJECTED_BYTES) return { maxDepth, projectedBytes: len + added };
      }
      i++;
      continue;
    }
    if (str[i + 1] === '!' && str[i + 2] === '-' && str[i + 3] === '-') {
      const end = commentEnd(str, i + 4);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (str[i + 1] === '!' || str[i + 1] === '?') {
      const end = str.indexOf('>', i);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    const closing = str[i + 1] === '/';
    let j = i + (closing ? 2 : 1);
    const nameStart = j;
    while (j < len && !isWs(str[j]) && str[j] !== '>' && str[j] !== '/') j++;
    const name = str.slice(nameStart, j).toLowerCase();
    if (name === '') { i++; continue; }

    if (closing) {
      if (depth > 0) depth--;
      added += depth * indent + 1;
      i = str.indexOf('>', j);
      if (i === -1) break;
      i++;
      continue;
    }

    const tag = scanStartTag(str, j);
    if (tag.end === -1) break;
    const end = tag.end;

    // the tag's own line, plus force-expand's one indented line per attribute once >= 2
    added += depth * indent + 1;
    if (tag.attrs >= 2) {
      added += tag.attrs * ((depth + 1) * indent + 6) + (depth * indent + 1);
    }
    if (len + added > MAX_PROJECTED_BYTES) {
      return { maxDepth: Math.max(maxDepth, depth), projectedBytes: len + added };
    }

    const selfClosed = str[end - 1] === '/';
    if (!VOID_ELEMENTS.has(name) && !selfClosed) {
      depth++;
      if (depth > maxDepth) {
        maxDepth = depth;
        if (maxDepth > MAX_FORMAT_DEPTH) return { maxDepth, projectedBytes: len + added };
      }
    }
    if (RAW_TEXT_ELEMENTS.has(name) && !selfClosed) {
      const raw = rawTextEnd(str, end + 1, name);
      if (raw === -1) break;
      i = raw;
      continue;
    }
    i = end + 1;
  }
  return { maxDepth, projectedBytes: len + added };
}

// Returns { output, declined }. declined is null when the document was reformatted or was
// never opted in; otherwise it names why a formatted result was refused and the input bytes
// were stored unchanged: 'depth' / 'size' / 'error' are pathological (would exhaust CPU or
// memory, or crash the formatter), 'growth' merely grew past the ratio cap. The gates run
// only after formatOptIn, so a non-null declined always means "opted in but refused".
function formatHtmlDetailed(str) {
  if (!formatOptIn(str)) return { output: str, declined: null };
  const cost = measureFormatCost(str);
  if (cost.maxDepth > MAX_FORMAT_DEPTH) return { output: str, declined: 'depth' };
  if (cost.projectedBytes > MAX_PROJECTED_BYTES) return { output: str, declined: 'size' };
  let formatted;
  try {
    formatted = beautify.html(str, beautifyOptions).replace(/(\r\n|\r|\n){3,}/g, '\n\n');
  } catch {
    return { output: str, declined: 'error' };
  }
  if (formatted.length > str.length * MAX_GROWTH_RATIO) return { output: str, declined: 'growth' };
  return { output: formatted, declined: null };
}

function formatHtml(str) {
  return formatHtmlDetailed(str).output;
}

module.exports = formatHtml;
module.exports.formatHtmlDetailed = formatHtmlDetailed;
