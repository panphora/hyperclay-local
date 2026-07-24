const beautify = require('js-beautify');

const beautifyOptions = {
  indent_size: 2,
  indent_char: ' ',
  wrap_attributes: 'force-expand-multiline',
  unformatted: ['svg', 'path', 'rect', 'circle', 'script', 'style', 'link', 'meta']
};

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

function formatHtml(str) {
  if (!formatOptIn(str)) {
    return str;
  }
  return beautify.html(str, beautifyOptions).replace(/(\r\n|\r|\n){3,}/g, '\n\n');
}

module.exports = formatHtml;
