import { balanceSuite } from '../src/sim/balanceSuite';

const result = await balanceSuite.runBatch({ root: process.cwd(), concurrency: 2, workersPerExperiment: 4,
  onProgress: ({ kingdomId, status, finished, total }) => {
    process.stdout.write(`[${finished}/${total}] ${kingdomId}: ${status}\n`);
  } });
if (result.failed.length) {
  for (const failure of result.failed) process.stderr.write(`${failure.kingdomId}: ${failure.error}\n`);
  process.exitCode = 1;
}
