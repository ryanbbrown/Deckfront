import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ALWAYS_AVAILABLE_ACTION_IDS, TREASURE_IDS } from '../src/game';

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

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, '.data/strategy-search-30/rust-balance-analysis-v1.json');
const catalogPath = path.join(root, 'src/server/pretrained-opponents.json');
const source = JSON.parse(await readFile(sourcePath, 'utf8')) as SourceReport;
const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as unknown;
const fixedCardIds = new Set([...TREASURE_IDS, ...ALWAYS_AVAILABLE_ACTION_IDS]);
if (source.kingdoms.some((kingdom) => kingdom.strategies.some((strategy) => strategy.startingBuild.length > 0))) {
  throw new Error('The source contains a starting build that the draft-off catalog cannot omit.');
}
const derived = {
  v: 1,
  kingdoms: source.kingdoms.map((kingdom) => ({
    id: kingdom.kingdom.id,
    cards: kingdom.kingdom.offeredCards.map((card) => card.id).filter((id) => !fixedCardIds.has(id)),
    plans: kingdom.strategies.map((strategy) => [
      strategy.strategyId,
      strategy.selectedWeight,
      strategy.selectedLotteryScorePercent / 100,
      strategy.buySteps.flatMap((step) => [step.cardId, step.desiredCount])
    ])
  }))
};

if (JSON.stringify(catalog) !== JSON.stringify(derived)) {
  throw new Error('The pretrained catalog does not exactly match rust-balance-analysis-v1.json.');
}
const planCount = derived.kingdoms.reduce((sum, kingdom) => sum + kingdom.plans.length, 0);
console.log(`Verified ${derived.kingdoms.length} kingdoms and ${planCount} plans (${(await stat(catalogPath)).size} bytes).`);
