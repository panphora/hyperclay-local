// The JSON Lines record grammar and limits of a structured helper's stdout, a
// port of htmlclay/internal/helper/jsonl.go. Every message here is the Go
// message, because the runner reports it to the page as the reason a request
// failed.
//
// Record members stay JSON text, the way Go carries json.RawMessage: an explicit
// null, false, 0, "" and [] all survive to the wire, and a member that is absent
// never reads as null.

const PROTOCOL_VERSION = 1;
const MAX_RECORD = 512 * 1024;
const MAX_TERMINAL_RECORD = 512 * 1024;
const MAX_STATUS_RECORD = 32 * 1024;
const MAX_WIRE_ENVELOPE = 1 << 20;
const STRUCTURED_DEADLINE_MS = 5 * 60 * 1000;
const DESCRIBE_DEADLINE_MS = 5 * 1000;
const DESCRIBE_RESULT_LIMIT = 8 * 1024;
const MAX_STATUS_TEXT = 4 * 1024;
const MAX_ERROR_CODE = 128;
const MAX_PROGRESS_UNIT = 64;

const EMPTY = Buffer.alloc(0);
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

// errRecordTooLarge, jsonl.go:28. The runner turns this one into the record
// limit in details instead of the message.
class RecordTooLargeError extends Error {
  constructor() {
    super('protocol record too large');
    this.name = 'RecordTooLargeError';
  }
}

function invalidJson(err) {
  return new Error(`invalid JSON record: ${err.message}`);
}

function byteLength(text) {
  return Buffer.byteLength(text, 'utf8');
}

// readRecordLine, jsonl.go:104-147: the line that ends at the next LF, without
// its line ending, refused when it is longer than the limit. A buffer past the
// limit means the line is past the limit, whether or not the newline has
// arrived yet, which is what bufio's ErrBufferFull check amounts to.
class ByteReader {
  constructor(source, { chunkSize = 0 } = {}) {
    this.next = chunkSource(source, chunkSize);
    this.buffer = EMPTY;
    this.eof = false;
  }

  async fill() {
    const chunk = await this.next();
    if (chunk === null) {
      this.eof = true;
      return;
    }
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
  }

  async readLine(max = MAX_RECORD) {
    for (;;) {
      const index = this.buffer.indexOf(NEWLINE);
      if (index !== -1) {
        const line = this.buffer.subarray(0, index);
        this.buffer = this.buffer.subarray(index + 1);
        const trimmed = line.length > 0 && line[line.length - 1] === CARRIAGE_RETURN ? line.subarray(0, line.length - 1) : line;
        if (trimmed.length > max) throw new RecordTooLargeError();
        return trimmed;
      }
      if (this.buffer.length > max) throw new RecordTooLargeError();
      if (this.eof) {
        if (this.buffer.length === 0) return null;
        const line = this.buffer;
        this.buffer = EMPTY;
        return line;
      }
      await this.fill();
    }
  }
}

function chunkSource(source, chunkSize) {
  if (typeof source === 'string') source = Buffer.from(source, 'utf8');
  if (Buffer.isBuffer(source)) {
    if (chunkSize > 0) {
      let offset = 0;
      return async () => {
        if (offset >= source.length) return null;
        const chunk = source.subarray(offset, offset + chunkSize);
        offset += chunk.length;
        return chunk;
      };
    }
    let sent = false;
    return async () => {
      if (sent) return null;
      sent = true;
      return source;
    };
  }
  if (Array.isArray(source)) {
    let index = 0;
    return async () => (index < source.length ? Buffer.from(source[index++]) : null);
  }
  if (!source || typeof source[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('a record reader needs a buffer or an async iterable of buffers');
  }
  const iterator = source[Symbol.asyncIterator]();
  return async () => {
    const { value, done } = await iterator.next();
    return done ? null : (Buffer.isBuffer(value) ? value : Buffer.from(value));
  };
}

// json.Valid on the record's bytes. Re-encoding is the test: Node replaces an
// invalid sequence with U+FFFD, which cannot round-trip to the original bytes.
function isUtf8(bytes) {
  return Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
}

class Scanner {
  constructor(text) {
    this.text = text;
    this.index = 0;
  }

  atEnd() {
    return this.index >= this.text.length;
  }

  skipWhitespace() {
    while (this.index < this.text.length && WHITESPACE.has(this.text[this.index])) this.index++;
  }

  readValue() {
    this.skipWhitespace();
    if (this.atEnd()) throw new Error('unexpected end of JSON input');
    const ch = this.text[this.index];
    if (ch === '{') return this.readObject();
    if (ch === '[') return this.readArray();
    if (ch === '"') return this.readString();
    if (this.text.startsWith('true', this.index)) return this.readLiteral('true', true);
    if (this.text.startsWith('false', this.index)) return this.readLiteral('false', false);
    if (this.text.startsWith('null', this.index)) return this.readLiteral('null', null);
    return this.readNumber();
  }

  readLiteral(literal, value) {
    const start = this.index;
    this.index += literal.length;
    return { kind: literal === 'null' ? 'null' : 'boolean', raw: literal, value };
  }

  readNumber() {
    NUMBER.lastIndex = this.index;
    const match = NUMBER.exec(this.text);
    if (!match) throw new Error(`invalid character ${JSON.stringify(this.text[this.index])} looking for beginning of value`);
    this.index = NUMBER.lastIndex;
    return { kind: 'number', raw: match[0], value: Number(match[0]) };
  }

  readString() {
    const start = this.index;
    this.index++;
    let value = '';
    for (;;) {
      if (this.atEnd()) throw new Error('unexpected end of JSON input');
      const ch = this.text[this.index];
      if (ch === '"') {
        this.index++;
        return { kind: 'string', raw: this.text.slice(start, this.index), value };
      }
      if (ch === '\\') {
        this.index++;
        const escape = this.text[this.index];
        if (escape === 'u') {
          const hex = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('invalid unicode escape in string');
          value += String.fromCharCode(parseInt(hex, 16));
          this.index += 5;
        } else if (ESCAPES[escape] !== undefined) {
          value += ESCAPES[escape];
          this.index++;
        } else {
          throw new Error('invalid escape in string');
        }
        continue;
      }
      if (ch < ' ') throw new Error('invalid control character in string');
      value += ch;
      this.index++;
    }
  }

  readObject() {
    const start = this.index;
    this.index++;
    const entries = [];
    this.skipWhitespace();
    if (this.text[this.index] === '}') {
      this.index++;
      return { kind: 'object', raw: this.text.slice(start, this.index), entries };
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') throw new Error('invalid object key');
      const key = this.readString();
      this.skipWhitespace();
      if (this.text[this.index] !== ':') throw new Error('invalid character looking for colon');
      this.index++;
      entries.push([key.value, this.readValue()]);
      this.skipWhitespace();
      const ch = this.text[this.index];
      if (ch === ',') {
        this.index++;
        continue;
      }
      if (ch === '}') {
        this.index++;
        return { kind: 'object', raw: this.text.slice(start, this.index), entries };
      }
      throw new Error('invalid character looking for comma or closing brace');
    }
  }

  readArray() {
    const start = this.index;
    this.index++;
    const items = [];
    this.skipWhitespace();
    if (this.text[this.index] === ']') {
      this.index++;
      return { kind: 'array', raw: this.text.slice(start, this.index), items };
    }
    for (;;) {
      items.push(this.readValue());
      this.skipWhitespace();
      const ch = this.text[this.index];
      if (ch === ',') {
        this.index++;
        continue;
      }
      if (ch === ']') {
        this.index++;
        return { kind: 'array', raw: this.text.slice(start, this.index), items };
      }
      throw new Error('invalid character looking for comma or closing bracket');
    }
  }
}

const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

// recordFields, jsonl.go:149-192: the decoded top-level members, duplicates
// rejected. Members that are objects keep their pairs in order so a duplicate
// inside `progress` is caught too.
function recordFields(raw) {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const scanner = new Scanner(text);
  let node;
  try {
    node = scanner.readValue();
    scanner.skipWhitespace();
  } catch (err) {
    throw invalidJson(err);
  }
  if (!scanner.atEnd()) {
    try {
      scanner.readValue();
    } catch (err) {
      throw invalidJson(err);
    }
    throw new Error('protocol line contains more than one JSON value');
  }
  if (node.kind !== 'object') throw new Error('protocol record must be a JSON object');
  return objectFields(node);
}

function objectFields(node) {
  const fields = new Map();
  for (const [key, value] of node.entries) {
    if (fields.has(key)) throw new Error(`duplicate top-level key ${JSON.stringify(key)}`);
    fields.set(key, value);
  }
  return fields;
}

function requiredRecordString(fields, name) {
  const node = fields.get(name);
  if (node === undefined) throw new Error(`${name} is required`);
  if (node.kind !== 'string') throw new Error(`${name} must be a string`);
  return node.value;
}

function validateProgress(progress) {
  if (progress.kind !== 'object') throw new Error('status.progress must be an object: protocol record must be a JSON object');
  let fields;
  try {
    fields = objectFields(progress);
  } catch (err) {
    throw new Error(`status.progress must be an object: ${err.message}`);
  }
  const completed = fields.get('completed');
  if (completed === undefined) throw new Error('status.progress.completed is required');
  validateNonnegativeNumber(completed, 'status.progress.completed');
  const total = fields.get('total');
  if (total !== undefined && total.kind !== 'null') validateNonnegativeNumber(total, 'status.progress.total');
  const unit = fields.get('unit');
  if (unit !== undefined) {
    if (unit.kind !== 'string') throw new Error('status.progress.unit must be a string');
    if (byteLength(unit.value) > MAX_PROGRESS_UNIT) {
      throw new Error(`status.progress.unit is ${byteLength(unit.value)} bytes, limit is ${MAX_PROGRESS_UNIT}`);
    }
  }
}

// validateNonnegativeNumber, jsonl.go:265-283. Through `any` and asserted, the
// way Go does it: json.Unmarshal into a number accepts a JSON STRING holding
// digits, and the progress object is forwarded to the page unchanged.
function validateNonnegativeNumber(node, name) {
  if (node.kind !== 'number') throw new Error(`${name} must be a number`);
  if (!Number.isFinite(node.value) || node.value < 0) throw new Error(`${name} must be a nonnegative finite number`);
}

// readRecord, jsonl.go:36-102. Returns null at a clean end of input, the way the
// Go reader returns io.EOF, and throws a description of anything else.
// `{ type, text, progress }` for a status, `{ type, value }` for a result, and
// `{ type, code, message, details }` for an error.
async function readRecord(reader, max = MAX_RECORD) {
  const raw = await reader.readLine(max);
  if (raw === null) return null;
  if (!isUtf8(raw)) throw new Error('record is not valid UTF-8');
  if (raw.length === 0) throw new Error('blank protocol record');

  const fields = recordFields(raw);
  const type = requiredRecordString(fields, 'type');

  if (type === 'status') {
    if (raw.length > MAX_STATUS_RECORD) throw new Error(`status record is ${raw.length} bytes, limit is ${MAX_STATUS_RECORD}`);
    const text = requiredRecordString(fields, 'text');
    if (byteLength(text) > MAX_STATUS_TEXT) throw new Error(`status.text is ${byteLength(text)} bytes, limit is ${MAX_STATUS_TEXT}`);
    const progress = fields.get('progress');
    if (progress !== undefined) validateProgress(progress);
    return { type, text, progress: progress ? progress.raw : null };
  }

  if (type === 'result') {
    const value = fields.get('value');
    if (value === undefined) throw new Error('result.value is required');
    if (raw.length > MAX_TERMINAL_RECORD) throw new Error(`result record is ${raw.length} bytes, limit is ${MAX_TERMINAL_RECORD}`);
    return { type, value: value.raw };
  }

  if (type === 'error') {
    if (raw.length > MAX_TERMINAL_RECORD) throw new Error(`error record is ${raw.length} bytes, limit is ${MAX_TERMINAL_RECORD}`);
    const code = requiredRecordString(fields, 'code');
    if (code === '') throw new Error('error.code must not be empty');
    if (byteLength(code) > MAX_ERROR_CODE) throw new Error(`error.code is ${byteLength(code)} bytes, limit is ${MAX_ERROR_CODE}`);
    const message = requiredRecordString(fields, 'message');
    if (message === '') throw new Error('error.message must not be empty');
    if (byteLength(message) > MAX_STATUS_TEXT) throw new Error(`error.message is ${byteLength(message)} bytes, limit is ${MAX_STATUS_TEXT}`);
    const details = fields.get('details');
    return { type, code, message, details: details ? details.raw : null };
  }

  throw new Error(`unknown record type ${JSON.stringify(type)}`);
}

// StampProtocol, jsonl.go:316-333: the accepted envelope, the protocol version,
// and the document mode the host resolved. The mode is written even when the
// page omitted it, so the program branches on the same value the host enforces.
function stampProtocol(envelope, document = 'none') {
  let parsed;
  if (typeof envelope === 'string') parsed = parseEnvelope(envelope);
  else if (Buffer.isBuffer(envelope)) parsed = parseEnvelope(envelope.toString('utf8'));
  else if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) parsed = envelope;
  else throw new Error('request envelope must be an object');
  const stamped = { ...parsed };
  stamped.helperProtocol = PROTOCOL_VERSION;
  stamped.document = document;
  return JSON.stringify(stamped);
}

function parseEnvelope(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('request envelope must be an object');
  return parsed;
}

function failureDetails(field, reason) {
  return JSON.stringify({ field, reason });
}

function limitDetails(field, limit) {
  return JSON.stringify({ field, limit });
}

module.exports = {
  ByteReader,
  RecordTooLargeError,
  readRecord,
  recordFields,
  stampProtocol,
  failureDetails,
  limitDetails,
  PROTOCOL_VERSION,
  MAX_RECORD,
  MAX_TERMINAL_RECORD,
  MAX_STATUS_RECORD,
  MAX_WIRE_ENVELOPE,
  STRUCTURED_DEADLINE_MS,
  DESCRIBE_DEADLINE_MS,
  DESCRIBE_RESULT_LIMIT,
  MAX_STATUS_TEXT,
  MAX_ERROR_CODE,
  MAX_PROGRESS_UNIT,
};
