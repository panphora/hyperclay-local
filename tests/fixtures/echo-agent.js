// Generic-contract fixture agent: prompt on stdin, HTML on stdout, exit 0.
// Emits in two chunks so the adapter's streaming path is exercised, and
// reports whether the prompt actually arrived on stdin.
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  const marker = input.includes('The element to edit') ? 'saw-prompt' : 'no-prompt';
  process.stdout.write('<section data-edit-id="hero"><p>echo ');
  await new Promise(resolve => setTimeout(resolve, 60));
  process.stdout.write(`${marker}</p></section>\n`);
});
