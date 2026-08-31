import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface SourceBuyStep { cardId: string; desiredCount: number }
interface SourceStrategy {
  strategyId: string;
  selectedWeight: number;
  selectedLotteryScorePercent: number;
  startingBuild: string[];
  buySteps: SourceBuyStep[];
}
interface SourceKingdom {
  kingdom: { id: string; offeredCards: Array<{ id: string }> };
  strategies: SourceStrategy[];
}
interface SourceReport { kingdoms: SourceKingdom[] }

const FIXED_SOURCE_CARD_IDS = new Set(['copper', 'silver', 'gold', 'step', 'focus', 'scrap']);
const root = path.resolve(import.meta.dirname, '..');
const catalogPath = path.join(root, 'src/server/pretrained-opponents.json');

function parseArguments(args: string[]): { sourcePath: string; write: boolean } {
  const write = args.includes('--write');
  const sourceArgs = args.filter((argument) => argument !== '--write');
  const positional = sourceArgs.length === 1 && !sourceArgs[0]!.startsWith('-') ? sourceArgs[0] : undefined;
  const named = sourceArgs[0] === '--source' && sourceArgs.length === 2 ? sourceArgs[1] : undefined;
  const inline = sourceArgs.length === 1 && sourceArgs[0]!.startsWith('--source=')
    ? sourceArgs[0]!.slice('--source='.length)
    : undefined;
  const sourcePath = positional ?? named ?? inline;
  if (!sourcePath) {
    throw new Error('Usage: tsx scripts/verify_pretrained_catalog.ts [--write] [--source] <analysis-path>');
  }
  return { sourcePath: path.resolve(sourcePath), write };
}

const options = parseArguments(process.argv.slice(2));
const sourcePath = options.sourcePath;
const source = JSON.parse(await readFile(sourcePath, 'utf8')) as SourceReport;
for (const kingdom of source.kingdoms) {
  const variableCards = kingdom.kingdom.offeredCards
    .map((card) => card.id)
    .filter((id) => !FIXED_SOURCE_CARD_IDS.has(id));
  if (variableCards.length !== 10 || new Set(variableCards).size !== 10) {
    throw new Error(`Source kingdom ${kingdom.kingdom.id} does not have ten variable cards.`);
  }
  for (const strategy of kingdom.strategies) {
    if (strategy.startingBuild.length > 0 || strategy.buySteps.length !== 5) {
      throw new Error(`Source strategy ${strategy.strategyId} does not have the draft-off five-step shape.`);
    }
  }
}

const derived = {
  v: 1,
  kingdoms: source.kingdoms.map((kingdom) => ({
    id: kingdom.kingdom.id,
    cards: kingdom.kingdom.offeredCards
      .map((card) => card.id)
      .filter((id) => !FIXED_SOURCE_CARD_IDS.has(id)),
    plans: kingdom.strategies.map((strategy) => [
      strategy.strategyId,
      strategy.selectedWeight,
      strategy.selectedLotteryScorePercent / 100,
      strategy.buySteps.flatMap((step) => [step.cardId, step.desiredCount])
    ])
  }))
};

const expectedBytes = Buffer.from(`${JSON.stringify(derived)}\n`);
if (options.write) await writeFile(catalogPath, expectedBytes);
const catalogBytes = await readFile(catalogPath);
if (!catalogBytes.equals(expectedBytes)) {
  throw new Error(`The pretrained catalog is not byte-equal to data derived from ${sourcePath}.`);
}
const planCount = derived.kingdoms.reduce((sum, kingdom) => sum + kingdom.plans.length, 0);
const positiveWeightCount = derived.kingdoms.reduce((sum, kingdom) =>
  sum + kingdom.plans.filter((plan) => Number(plan[1]) > 0).length, 0);
console.log(`Verified ${derived.kingdoms.length} kingdoms, ${planCount} plans, and ${positiveWeightCount} positive-weight entries (${catalogBytes.length} bytes).`);
