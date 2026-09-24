// Structured helper fixture: one result whose value is as large as the test asks
// for. Past 512 KiB the record itself is invalid; under it, the value is what a
// request with a smaller result cap refuses.
const size = Number(process.env.HTMLCLAY_TEST_RESULT_BYTES || 512 * 1024 + 1);
process.stdout.write(`${JSON.stringify({ type: 'result', value: 'x'.repeat(size) })}\n`);
