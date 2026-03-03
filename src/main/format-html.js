const beautify = require('js-beautify');

const beautifyOptions = {
  indent_size: 2,
  indent_char: ' ',
  wrap_attributes: 'force-expand-multiline',
  unformatted: ['svg', 'path', 'rect', 'circle', 'script', 'style', 'link', 'meta']
};

function formatHtml(str) {
  const formatDisabledPattern = /<html[^>]*\sformathtml\s*=\s*["']false["'][^>]*>/i;

  if (formatDisabledPattern.test(str)) {
    return str;
  }

  return beautify.html(str, beautifyOptions).replace(/(\r\n|\r|\n){3,}/g, '\n\n');
}

module.exports = formatHtml;
