// e.g. "Hello there" → "hello-there"
// Preserves .html/.htmlclay extensions
function slugify (text) {
  if (text == null) return '';
  const extMatch = text.toString().match(/\.(html|htmlclay)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  const base = extMatch ? text.toString().slice(0, -ext.length) : text.toString();

  return base.toLowerCase()
    .normalize('NFD') // separate accents from letters
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/\s+/g, '-') // replace spaces with -
    .replace(/[^\w\-]+/g, '') // remove all non-word chars
    .replace(/\-\-+/g, '-') // replace multiple - with single -
    .replace(/^-+/, '') // trim - from start of text
    .replace(/-+$/, '') // trim - from end of text
    + ext;
}

export default slugify;
