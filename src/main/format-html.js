const beautify = require('js-beautify');

const beautifyOptions = {
  indent_size: 2,
  indent_char: ' ',
  wrap_attributes: 'force-expand-multiline',
  unformatted: ['svg', 'path', 'rect', 'circle', 'script', 'style', 'link', 'meta']
};

// Formatting is opt-in per document (spec §4): reformat only when the ROOT <html>
// element carries formathtml="true", read by value. Any other value, no attribute,
// or the same attribute on a non-root element leaves the bytes exactly as sent.
function formatOptIn(str) {
  const rootTag = str.match(/<html(?=[\s/>])(?:"[^"]*"|'[^']*'|[^>])*>/i);
  if (!rootTag) return false;
  const attr = rootTag[0].match(/\sformathtml\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  if (!attr) return false;
  return (attr[1] ?? attr[2] ?? attr[3]) === 'true';
}

function formatHtml(str) {
  if (!formatOptIn(str)) {
    return str;
  }
  return beautify.html(str, beautifyOptions).replace(/(\r\n|\r|\n){3,}/g, '\n\n');
}

module.exports = formatHtml;
