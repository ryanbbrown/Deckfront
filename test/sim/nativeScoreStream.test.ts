import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NATIVE_SCORE_STREAM_MAX_LINE_BYTES, readNativeScoreStream
} from '../../src/sim/nativeScoreStream';

async function collect(file: string): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of readNativeScoreStream(file)) values.push(value);
  return values;
}

describe('streaming native score response', () => {
  it('reads a valid response larger than the V8 string limit with bounded lines', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-native-score-stream-'));
    const file = path.join(root, 'response.ndjson'), descriptor = fs.openSync(file, 'w');
    const padding = Buffer.alloc(NATIVE_SCORE_STREAM_MAX_LINE_BYTES, 0x20);
    padding[padding.length - 1] = 0x0a;
    try {
      fs.writeSync(descriptor, '{"schemaVersion":1,"type":"score-batch-start","scoreCount":1}\n');
      for (let index = 0; index < 64; index += 1) fs.writeSync(descriptor, padding);
      fs.writeSync(descriptor, '{"strategyId":"saved","collisionTieKey":"canonical","profiles":[]}\n');
      fs.writeSync(descriptor, '{"schemaVersion":1,"type":"score-batch-end","scoreCount":1}\n');
    } finally { fs.closeSync(descriptor); }
    try {
      expect(fs.statSync(file).size).toBeGreaterThan(0x1fffffe8);
      await expect(collect(file)).resolves.toEqual([
        { strategyId: 'saved', collisionTieKey: 'canonical', profiles: [] }
      ]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 120_000);

  it('rejects count, footer, trailing-content, and oversized-line corruption', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-native-score-corrupt-'));
    const write = (name: string, lines: string[]): string => {
      const file = path.join(root, name); fs.writeFileSync(file, `${lines.join('\n')}\n`); return file;
    };
    try {
      await expect(collect(write('short', [
        '{"schemaVersion":1,"type":"score-batch-start","scoreCount":1}',
        '{"schemaVersion":1,"type":"score-batch-end","scoreCount":1}'
      ]))).rejects.toThrow();
      await expect(collect(write('footer', [
        '{"schemaVersion":1,"type":"score-batch-start","scoreCount":0}',
        '{"schemaVersion":1,"type":"score-batch-end","scoreCount":1}'
      ]))).rejects.toThrow('footer differs');
      await expect(collect(write('trailing', [
        '{"schemaVersion":1,"type":"score-batch-start","scoreCount":0}',
        '{"schemaVersion":1,"type":"score-batch-end","scoreCount":0}', '{}'
      ]))).rejects.toThrow('trailing content');
      const oversized = path.join(root, 'oversized');
      const descriptor = fs.openSync(oversized, 'w');
      try {
        fs.writeSync(descriptor, Buffer.alloc(NATIVE_SCORE_STREAM_MAX_LINE_BYTES + 1, 0x20));
      } finally { fs.closeSync(descriptor); }
      await expect(collect(oversized)).rejects.toThrow('bounded size');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
