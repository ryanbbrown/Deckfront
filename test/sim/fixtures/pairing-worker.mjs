import { parentPort } from 'node:worker_threads';
import { setTimeout } from 'node:timers';

const record = () => ({ played: 0, wins: 0, draws: 0, losses: 0, aborted: 0 });
const telemetry = () => ({
  acquisitionsByStrategy: {}, damageByCard: {}, playsByCard: {},
  deadDraws: { range: 0, mana: 0, setup: 0, total: 0 },
  turnsToWin: { total: 0, count: 0 },
  byOrientation: {
    firstOchre: { normal: record(), swapped: record() },
    firstIndigo: { normal: record(), swapped: record() }
  }
});

parentPort.on('message', (request) => {
  if (request.items.some((item) => item.job.candidate.id === 'fail')) {
    parentPort.postMessage({
      kind: 'pairing-error', name: 'Error', message: 'worker exploded'
    });
    return;
  }
  const delay = Math.max(0, 20 - request.items[0].id * 5);
  setTimeout(() => parentPort.postMessage({
    kind: 'pairing-results', outcomes: request.items.map(({ id }) => ({ id, outcome: {
      record: record(), candidateScore: 0, opponentScore: 0, telemetry: telemetry(),
      matches: id, seedBlocks: 0, stopReason: 'maximum',
      candidateMean: null, opponentMean: null
    } }))
  }), delay);
});
