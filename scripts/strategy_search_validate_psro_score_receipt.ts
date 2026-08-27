import fs from 'node:fs';
import path from 'node:path';
import { startParallelPsro, validateParallelPsroCheckpoint } from '../src/sim/strategySearchParallelPsro';
import type {
  ParallelPsroScoreTaskDescriptor, ParallelPsroTransition
} from '../src/sim/strategySearchParallelPsro';
import { thresholdRacingProtocolHash, validateRawPsroScoreChunk } from '../src/sim/thresholdRacingPsro';
import type { RawPsroScoreChunk } from '../src/sim/thresholdRacingPsro';

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`), value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return path.resolve(value);
}
function read<T>(name: string): T {
  return JSON.parse(fs.readFileSync(option(name), 'utf8')) as T;
}
function exact(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  fs.renameSync(temporary, file);
}

const transition = read<ParallelPsroTransition>('transition');
const task = read<ParallelPsroScoreTaskDescriptor>('task');
const chunk = read<RawPsroScoreChunk>('chunk');
let valid = false;
if (transition.kind === 'score' && validateParallelPsroCheckpoint(transition.checkpoint)) {
  const expected = startParallelPsro(transition.checkpoint);
  const expectedTask = expected.kind === 'score' ? expected.tasks[task.taskIndex] : undefined;
  const look = transition.look;
  valid = expected.kind === 'score' && exact(expected.look, look) && exact(expectedTask, task)
    && validateRawPsroScoreChunk(chunk, transition.checkpoint.protocol)
    && chunk.protocolHash === thresholdRacingProtocolHash(transition.checkpoint.protocol)
    && chunk.sourceHash === transition.checkpoint.protocol.sourceIdentityHash
    && chunk.raceKind === look.raceKind && chunk.lookId === look.lookId && chunk.lookDepth === look.lookDepth
    && chunk.familySize === look.familySize && chunk.alpha === look.alpha && chunk.threshold === look.threshold
    && chunk.candidateStart === task.candidateStart && chunk.candidateEnd === task.candidateEnd
    && exact(chunk.candidateIds, look.candidateIds.slice(task.candidateStart, task.candidateEnd))
    && exact(chunk.candidateCanonicals, look.candidateCanonicals.slice(task.candidateStart, task.candidateEnd))
    && exact(chunk.fullSchedule, look.fullSchedule) && exact(chunk.suffixSchedule, look.suffixSchedule)
    && chunk.scheduleStart === look.scheduleStart && chunk.scheduleEnd === look.scheduleEnd;
}
writeAtomic(option('out'), { valid });
