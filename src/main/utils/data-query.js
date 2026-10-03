function readDataQuery(url) {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const values = [];
  let invalid = false;
  const decode = (value) => decodeURIComponent(value.replace(/\+/g, ' '));
  for (const part of query.split('&')) {
    const separator = part.indexOf('=');
    const key = separator < 0 ? part : part.slice(0, separator);
    const value = separator < 0 ? '' : part.slice(separator + 1);
    try {
      const isData = decode(key) === 'data';
      if (isData) {
        values.push(undefined);
      }
      const decoded = decode(value);
      if (isData) values[values.length - 1] = decoded;
      if (part.includes(';')) invalid = true;
    } catch {
      invalid = true;
    }
  }
  if (!values.length) return { present: false };
  if (invalid || values.length !== 1) {
    return { present: true, error: {
      error: 'Invalid extraction rules',
      message: invalid ? 'Failed to parse extraction rules. Check your JSON syntax.' : 'Provide exactly one data parameter.'
    } };
  }
  if (values[0] === '') {
    return { present: true, error: {
      error: 'Missing data parameter',
      message: 'Please provide extraction rules via ?data= parameter',
      example: '?data={title:"h1",items:".item"}'
    } };
  }
  return { present: true, text: values[0] };
}

module.exports = { readDataQuery };
