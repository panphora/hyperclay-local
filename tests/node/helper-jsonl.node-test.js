// Every case of htmlclay/internal/helper/jsonl_test.go, one for one, against the
// port in src/main/helpers/jsonl.js. The Go test name leads each title; the
// buffer sizes the Go cases use are mirrored with ByteReader's chunkSize, so the
// incremental line reader is exercised the same way bufio.NewReaderSize is.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ByteReader, RecordTooLargeError, readRecord, recordFields, stampProtocol, MAX_RECORD, MAX_STATUS_RECORD, MAX_STATUS_TEXT, MAX_ERROR_CODE, MAX_PROGRESS_UNIT, PROTOCOL_VERSION } = require('../../src/main/helpers/jsonl');

function reader(input, chunkSize = 0) {
  return new ByteReader(Buffer.from(input), { chunkSize });
}

async function read(input, { chunkSize = 0, max = MAX_RECORD } = {}) {
  return readRecord(reader(input, chunkSize), max);
}

function assertRejectsMessage(promise, fragment) {
  return promise.then(
    record => assert.fail(`expected an error containing ${JSON.stringify(fragment)}, got ${JSON.stringify(record)}`),
    err => assert.ok(err.message.includes(fragment), `error ${JSON.stringify(err.message)} does not contain ${JSON.stringify(fragment)}`),
  );
}

// TestReadRecordGrammar, jsonl_test.go:14.
const grammarCases = [
  { name: 'duplicate key', input: '{"type":"result","type":"status","value":null}\n', wantError: 'duplicate top-level key' },
  { name: 'invalid UTF-8', input: Buffer.concat([Buffer.from('{"type":"status","text":"'), Buffer.from([0xff]), Buffer.from('"}\n')]), wantError: 'valid UTF-8' },
  { name: 'missing result value', input: '{"type":"result"}\n', wantError: 'result.value is required' },
  { name: 'explicit null result', input: '{"type":"result","value":null}\n', wantType: 'result', wantValue: 'null' },
  { name: 'CRLF', input: '{"type":"result","value":false}\r\n', wantType: 'result', wantValue: 'false' },
  { name: 'final record without newline', input: '{"type":"result","value":0}', wantType: 'result', wantValue: '0' },
  { name: 'blank line', input: '\n', wantError: 'blank protocol record' },
  { name: 'pretty printed record', input: '{\n  "type": "result",\n  "value": null\n}\n', wantError: 'invalid JSON record' },
  { name: 'non-object', input: '[]\n', wantError: 'must be a JSON object' },
  { name: 'unknown type', input: '{"type":"partial"}\n', wantError: 'unknown record type' },
  { name: 'unknown field', input: '{"type":"result","value":[],"future":true}\n', wantType: 'result', wantValue: '[]' },
];

for (const c of grammarCases) {
  test(`TestReadRecordGrammar: ${c.name}`, async () => {
    const input = Buffer.isBuffer(c.input) ? c.input : Buffer.from(c.input);
    const promise = readRecord(new ByteReader(input, { chunkSize: 8 }), MAX_RECORD);
    if (c.wantError) return assertRejectsMessage(promise, c.wantError);
    const record = await promise;
    assert.equal(record.type, c.wantType);
    assert.equal(record.value, c.wantValue);
  });
}

// TestReadRecordRefusesAnOversizeRecordInsteadOfTruncating, jsonl_test.go:58: a
// truncated record that still parses is the failure this replaces.
test('TestReadRecordRefusesAnOversizeRecordInsteadOfTruncating: a record past the limit is refused, not truncated', async () => {
  const big = `{"type":"result","value":"${'a'.repeat(4096)}"}\n`;
  await assert.rejects(read(big, { max: 512 }), err => err instanceof RecordTooLargeError);
});

// TestReadRecordValidatesRecordFields, jsonl_test.go:68.
const fieldCases = [
  { name: 'null type', input: '{"type":null}', wantError: 'type must be a string' },
  { name: 'status text required', input: '{"type":"status"}', wantError: 'text is required' },
  { name: 'status text string', input: '{"type":"status","text":null}', wantError: 'text must be a string' },
  { name: 'progress object', input: '{"type":"status","text":"x","progress":null}', wantError: 'must be an object' },
  { name: 'progress completed required', input: '{"type":"status","text":"x","progress":{}}', wantError: 'completed is required' },
  { name: 'progress completed nonnegative', input: '{"type":"status","text":"x","progress":{"completed":-1}}', wantError: 'nonnegative finite' },
  { name: 'progress total finite', input: '{"type":"status","text":"x","progress":{"completed":1,"total":1e999}}', wantError: 'nonnegative finite' },
  { name: 'progress unit string', input: '{"type":"status","text":"x","progress":{"completed":1,"unit":null}}', wantError: 'unit must be a string' },
  { name: 'error code required', input: '{"type":"error","message":"x"}', wantError: 'code is required' },
  { name: 'error code nonempty', input: '{"type":"error","code":"","message":"x"}', wantError: 'code must not be empty' },
  { name: 'error message required', input: '{"type":"error","code":"bad"}', wantError: 'message is required' },
  { name: 'error message nonempty', input: '{"type":"error","code":"bad","message":""}', wantError: 'message must not be empty' },
];

for (const c of fieldCases) {
  test(`TestReadRecordValidatesRecordFields: ${c.name}`, async () => {
    await assertRejectsMessage(read(c.input), c.wantError);
  });
}

test('TestReadRecordValidatesRecordFields: a validated progress status is accepted', async () => {
  const record = await read('{"type":"status","text":"Scanning","progress":{"completed":40,"total":null,"unit":"files"}}');
  assert.equal(record.type, 'status');
  assert.equal(record.text, 'Scanning');
  assert.deepEqual(JSON.parse(record.progress), { completed: 40, total: null, unit: 'files' });
});

// TestReadRecordLimits, jsonl_test.go:106.
const statusPrefix = '{"type":"status","text":"ok","padding":"';
const statusSuffix = '"}';
const limitCases = [
  { name: 'status record', input: statusPrefix + 'x'.repeat(MAX_STATUS_RECORD + 1 - statusPrefix.length - statusSuffix.length) + statusSuffix, wantError: 'status record' },
  { name: 'status text', input: `{"type":"status","text":"${'x'.repeat(MAX_STATUS_TEXT + 1)}"}`, wantError: 'status.text' },
  { name: 'error message', input: `{"type":"error","code":"bad","message":"${'x'.repeat(MAX_STATUS_TEXT + 1)}"}`, wantError: 'error.message' },
  { name: 'error code', input: `{"type":"error","code":"${'x'.repeat(MAX_ERROR_CODE + 1)}","message":"bad"}`, wantError: 'error.code' },
  { name: 'progress unit', input: `{"type":"status","text":"x","progress":{"completed":1,"unit":"${'x'.repeat(MAX_PROGRESS_UNIT + 1)}"}}`, wantError: 'progress.unit' },
];

for (const c of limitCases) {
  test(`TestReadRecordLimits: ${c.name}`, async () => {
    await assertRejectsMessage(read(c.input), c.wantError);
  });
}

test('TestReadRecordLimits: a record at exactly the terminal limit is accepted', async () => {
  const prefix = '{"type":"result","value":"';
  const suffix = '"}';
  const exact = prefix + 'x'.repeat(512 * 1024 - prefix.length - suffix.length) + suffix;
  const record = await read(exact, { chunkSize: 4 << 10 });
  assert.equal(record.type, 'result');
});

// TestReadRecordRefusesQuotedProgressNumbers, jsonl_test.go:145.
const quotedCases = [
  { name: 'quoted completed', input: '{"type":"status","text":"tick","progress":{"completed":"4"}}' },
  { name: 'quoted total', input: '{"type":"status","text":"tick","progress":{"completed":4,"total":"8"}}' },
];

for (const c of quotedCases) {
  test(`TestReadRecordRefusesQuotedProgressNumbers: ${c.name} is refused`, async () => {
    await assertRejectsMessage(read(`${c.input}\n`), 'must be a number');
  });
}

test('TestReadRecordRefusesQuotedProgressNumbers: a genuinely numeric progress is accepted', async () => {
  const record = await read('{"type":"status","text":"tick","progress":{"completed":4,"total":8}}\n');
  assert.deepEqual(JSON.parse(record.progress), { completed: 4, total: 8 });
});

// jsonl.go:316, StampProtocol: the mode is written even when the page omitted it.
test('stampProtocol adds helperProtocol and the resolved document mode', () => {
  const stamped = JSON.parse(stampProtocol({ v: 1, type: 'wire/request', id: 'a', helper: 'echo' }, 'edit'));
  assert.equal(stamped.helperProtocol, PROTOCOL_VERSION);
  assert.equal(stamped.document, 'edit');
  assert.equal(stamped.helper, 'echo');
  assert.equal(JSON.parse(stampProtocol('{"id":"b"}')).document, 'none');
  assert.throws(() => stampProtocol('[]'), /request envelope must be an object/);
});

// Docs/wire.md:249: duplicate keys inside `progress` are rejected too, which is
// the second recordFields pass validateProgress runs (jsonl.go:235).
test('a duplicate key inside progress is refused', async () => {
  assert.equal(recordFields('{"type":"status","progress":{"completed":1}}').get('type').value, 'status');
  await assertRejectsMessage(read('{"type":"status","text":"x","progress":{"completed":1,"completed":2}}\n'), 'duplicate top-level key');
});
