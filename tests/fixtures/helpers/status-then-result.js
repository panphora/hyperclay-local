// Structured helper fixture: one progress status, then the terminal result.
setTimeout(() => {
  process.stdout.write(`${JSON.stringify({ type: 'result', value: { matches: ['notes/a.txt:12:needle'] } })}\n`);
}, 50);
process.stdout.write(`${JSON.stringify({ type: 'status', text: 'Scanning', progress: { completed: 1, total: 2, unit: 'files' } })}\n`);
