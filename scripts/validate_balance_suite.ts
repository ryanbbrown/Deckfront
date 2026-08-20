import { balanceSuite } from '../src/sim/balanceSuite';

const result = balanceSuite.validateRuns(process.cwd());
process.stdout.write(`${result.complete}/100 complete; ${result.matches} games; ${result.aborted} aborted; ${(result.elapsedMs / 1000).toFixed(1)} experiment-seconds.\n`);
if (!result.valid) {
  for (const failure of result.failures) process.stderr.write(`${failure.kingdomId}: ${failure.reason}\n`);
  process.exitCode = 1;
}
