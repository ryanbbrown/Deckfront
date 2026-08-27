import fs from 'node:fs';
import path from 'node:path';
import {
  startParallelPsro, validateParallelPsroCheckpoint, validateParallelPsroScoreTaskChunk
} from '../src/sim/strategySearchParallelPsro';
import type {
  ParallelPsroScoreTaskChunk, ParallelPsroScoreTaskDescriptor, ParallelPsroTransition
} from '../src/sim/strategySearchParallelPsro';

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
const chunk = read<ParallelPsroScoreTaskChunk>('chunk');
let valid = false;
if (transition.kind === 'score' && validateParallelPsroCheckpoint(transition.checkpoint)) {
  const expected = startParallelPsro(transition.checkpoint, { targetTasks: transition.tasks.length });
  const expectedTask = expected.kind === 'score' ? expected.tasks[task.taskIndex] : undefined;
  const taskKeys = ['candidateEnd', 'candidateStart', 'expectedTaskMs', 'scheduleEnd',
    'scheduleStart', 'taskIndex'];
  const taskValid = expectedTask !== undefined && exact(Object.keys(task).sort(), taskKeys)
    && task.taskIndex === expectedTask.taskIndex && task.candidateStart === expectedTask.candidateStart
    && task.candidateEnd === expectedTask.candidateEnd && task.scheduleStart === expectedTask.scheduleStart
    && task.scheduleEnd === expectedTask.scheduleEnd && task.expectedTaskMs === expectedTask.expectedTaskMs;
  const look = transition.look;
  valid = expected.kind === 'score' && exact(expected.look, look) && taskValid
    && validateParallelPsroScoreTaskChunk(chunk, transition.checkpoint, look, task);
}
writeAtomic(option('out'), { valid });
