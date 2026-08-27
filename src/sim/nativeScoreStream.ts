import fs from 'node:fs';

export const NATIVE_SCORE_STREAM_SCHEMA_VERSION = 1 as const;
export const NATIVE_SCORE_STREAM_MAX_LINE_BYTES = 8 * 1024 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: object, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
async function* boundedLines(file: string): AsyncGenerator<string> {
  const stream = fs.createReadStream(file);
  let pending: Buffer[] = [], pendingBytes = 0;
  for await (const raw of stream) {
    const chunk = raw as Buffer;
    let start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      const suffix = chunk.subarray(start, index), lineBytes = pendingBytes + suffix.length;
      if (lineBytes > NATIVE_SCORE_STREAM_MAX_LINE_BYTES) {
        throw new Error('Native score stream line exceeds its bounded size.');
      }
      const line = pending.length ? Buffer.concat([...pending, suffix], lineBytes).toString('utf8')
        : suffix.toString('utf8');
      pending = []; pendingBytes = 0; start = index + 1; yield line;
    }
    const suffix = chunk.subarray(start);
    if (pendingBytes + suffix.length > NATIVE_SCORE_STREAM_MAX_LINE_BYTES) {
      throw new Error('Native score stream line exceeds its bounded size.');
    }
    if (suffix.length) { pending.push(suffix); pendingBytes += suffix.length; }
  }
  if (pendingBytes) yield Buffer.concat(pending, pendingBytes).toString('utf8');
}
function parse(line: string, label: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(line) as unknown; } catch { throw new Error(`Native score stream ${label} is not JSON.`); }
  if (!object(value)) throw new Error(`Native score stream ${label} is invalid.`);
  return value;
}

export async function* readNativeScoreStream(file: string): AsyncGenerator<unknown> {
  const lines = boundedLines(file)[Symbol.asyncIterator]();
  const nextContent = async (): Promise<string | undefined> => {
    for (;;) {
      const next = await lines.next();
      if (next.done) return undefined;
      if (next.value.trim()) return next.value;
    }
  };
  const headerLine = await nextContent();
  if (headerLine === undefined) throw new Error('Native score stream is empty.');
  const header = parse(headerLine, 'header');
  if (!exactKeys(header, ['schemaVersion', 'type', 'scoreCount'])
    || header.schemaVersion !== NATIVE_SCORE_STREAM_SCHEMA_VERSION || header.type !== 'score-batch-start'
    || !Number.isSafeInteger(header.scoreCount) || Number(header.scoreCount) < 0) {
    throw new Error('Native score stream header differs.');
  }
  const scoreCount = Number(header.scoreCount);
  for (let index = 0; index < scoreCount; index += 1) {
    const line = await nextContent();
    if (line === undefined) throw new Error('Native score stream ended before every score.');
    yield parse(line, `score ${index}`);
  }
  const footerLine = await nextContent();
  if (footerLine === undefined) throw new Error('Native score stream footer is missing.');
  const footer = parse(footerLine, 'footer');
  if (!exactKeys(footer, ['schemaVersion', 'type', 'scoreCount'])
    || footer.schemaVersion !== NATIVE_SCORE_STREAM_SCHEMA_VERSION || footer.type !== 'score-batch-end'
    || footer.scoreCount !== scoreCount) throw new Error('Native score stream footer differs.');
  if (await nextContent() !== undefined) throw new Error('Native score stream has trailing content.');
}
