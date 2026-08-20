import { workerData } from 'node:worker_threads';
import { registerKingdom } from '../game';
import type { Kingdom } from '../game';
import { runPairingWorker } from '../sim/pairingRunner';

const data = workerData as { kingdom?: Kingdom };
if (!data.kingdom) throw new Error('AI pairing worker needs a kingdom.');
registerKingdom(data.kingdom);
runPairingWorker();
