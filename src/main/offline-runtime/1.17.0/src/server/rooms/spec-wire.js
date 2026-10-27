import crypto from 'crypto';

export function documentEtag (storedHtml) {
  return crypto.createHash('sha256').update(storedHtml || '').digest('hex').substring(0, 16);
}

export function ifMatchSatisfied (fieldValue, storedBytes) {
  const stored = storedBytes || '';
  const field = String(fieldValue ?? '').trim();
  if (field === '*') return stored.length > 0;

  const current = documentEtag(stored);
  return field.split(',').some(entry => {
    const tag = entry.trim().replace(/^W\//i, '').replace(/^"(.*)"$/, '$1');
    return tag !== '' && tag === current;
  });
}
