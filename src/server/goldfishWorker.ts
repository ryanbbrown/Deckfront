import { parentPort, workerData } from 'node:worker_threads';
import { registerKingdom } from '../game';
import type { Kingdom } from '../game';
import { scoreGoldfishStrategy } from '../sim/goldfish';
import type { GoldfishConfig } from '../sim/goldfish';
import type { Strategy } from '../sim/strategy';

interface Request { id: number; strategies: Strategy[]; config: GoldfishConfig }

const data = workerData as { kingdom?: Kingdom };
if (!data.kingdom || !parentPort) throw new Error('Goldfish worker needs a kingdom and parent port.');
registerKingdom(data.kingdom);
parentPort.on('message', (request: Request) => {
  try {
    parentPort!.postMessage({ id: request.id,
      scores: request.strategies.map((strategy) => scoreGoldfishStrategy(strategy, request.config)) });
  } catch (error) {
    const value = error instanceof Error ? error : new Error(String(error));
    parentPort!.postMessage({ id: request.id, error: value.message, stack: value.stack });
  }
});
