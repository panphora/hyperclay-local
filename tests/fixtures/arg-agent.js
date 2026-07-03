// Generic-contract fixture agent for the {prompt} argv placeholder: the
// prompt arrives as an argument, the reply goes to stdout.
const prompt = process.argv[2] || '';
const ok = prompt.includes('Request:') ? 'ok' : 'missing';
process.stdout.write(`<section data-edit-id="hero"><p>arg:${ok}</p></section>`);
