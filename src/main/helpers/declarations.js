const { Parser } = require('htmlparser2');

const SCAN_LIMIT = 512 * 1024;
const MAX_NAMES = 8;
const HEAD_ELEMENTS = new Set(['html', 'head', 'base', 'basefont', 'bgsound', 'link', 'meta', 'noscript', 'script', 'title', 'noframes', 'style']);
const RAW_HEAD_ELEMENTS = new Set(['noscript', 'script', 'title', 'noframes', 'style']);
const STOP_END_TAGS = new Set(['head', 'body', 'html', 'br']);

function validHelperName(s) {
  return typeof s === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(s);
}

function readHelperNames(bytes) {
  const text = Buffer.from(bytes).subarray(0, SCAN_LIMIT).toString('utf8');
  const names = [];
  let done = false;
  let templateDepth = 0;
  let rawElement = '';
  const parser = new Parser({
    onopentag(name, attribs) {
      if (done) return;
      if (rawElement) return;
      if (templateDepth > 0) { if (name === 'template') templateDepth++; return; }
      if (name === 'template') { templateDepth = 1; return; }
      if (!HEAD_ELEMENTS.has(name)) { done = true; return; }
      if (RAW_HEAD_ELEMENTS.has(name)) { rawElement = name; return; }
      if (name !== 'meta' || attribs.name !== 'htmlclay-helper') return;
      const content = attribs.content;
      if (!validHelperName(content) || names.includes(content)) return;
      names.push(content);
      if (names.length === MAX_NAMES) done = true;
    },
    onclosetag(name) {
      if (done) return;
      if (rawElement) { if (name === rawElement) rawElement = ''; return; }
      if (templateDepth > 0) { if (name === 'template') templateDepth--; return; }
      if (STOP_END_TAGS.has(name)) done = true;
    },
    ontext(data) {
      if (done || rawElement || templateDepth > 0) return;
      if (data.replace(/[ \t\n\r\f]/g, '') !== '') done = true;
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(text);
  parser.end();
  return names;
}

module.exports = { readHelperNames, validHelperName, SCAN_LIMIT, MAX_NAMES };
