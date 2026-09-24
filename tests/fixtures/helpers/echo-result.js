// Structured helper fixture: reads the request envelope from stdin and answers
// with one result that echoes the envelope, the working directory and the two
// variables the host sets, so a test can see all of them.
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let envelope = null;
  try { envelope = JSON.parse(input); } catch { envelope = null; }
  const value = {
    envelope,
    cwd: process.cwd(),
    wireFile: process.env.HTMLCLAY_WIRE_FILE || null,
    wireId: process.env.HTMLCLAY_WIRE_ID || null,
    path: process.env.PATH || null,
    argv: process.argv.slice(2),
  };
  process.stdout.write(`${JSON.stringify({ type: 'result', value })}\n`);
});
