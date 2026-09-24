// Generic-contract fixture agent for the prompt's two context sections: it
// reports which context files reached the prompt and how many bytes of @page
// context it saw, so a test can prove the host read both from disk rather than
// from a copy in the payload.
const PAGE_HEADER = 'The full page, for context (@page):\n\n';

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const refs = [...input.matchAll(/^Context file @(\S+):$/gm)].map((match) => match[1]).join(',');
  const start = input.indexOf(PAGE_HEADER);
  const page = start === -1 ? 0 : Buffer.byteLength(input.slice(start + PAGE_HEADER.length).split('\n\nRequest:')[0], 'utf8');
  process.stdout.write(`<section data-edit-id="hero"><p>prompt:${refs || 'none'}:${page}</p></section>\n`);
});
