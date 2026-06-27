import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = '.games/e018b-rush-vs-engine-b';
const id = 'turn-031';
const snapshots = join(root, 'snapshots');

const deck = JSON.parse(await readFile(join(root, 'deck.json'), 'utf8'));
const board = JSON.parse(await readFile(join(root, 'board.json'), 'utf8'));
const timeline = JSON.parse(await readFile(join(root, 'timeline.json'), 'utf8'));

await mkdir(snapshots, { recursive: true });
await writeJson(join(snapshots, `${id}.before.deck.json`), deck);
await writeJson(join(snapshots, `${id}.after.deck.json`), deck);
await writeJson(join(snapshots, `${id}.before.board.json`), board);
await writeJson(join(snapshots, `${id}.after.board.json`), board);

const active = deck.game.players[deck.game.activePlayer];
timeline.entries.push({
  id,
  player: 'P1',
  round: 16,
  deck: {
    before: `snapshots/${id}.before.deck.json`,
    after: `snapshots/${id}.after.deck.json`,
    drawnHand: active.hand.map((card: string) => deck.game.cards[card]?.name ?? card),
    played: [],
    bought: [],
    produced: {
      money: 0,
      damage: 0,
      heal: 0,
      upgradeHealth: 0,
      upgradeDamage: 0,
      reattack: 0,
      stormTargets: 0
    }
  },
  board: {
    before: `snapshots/${id}.before.board.json`,
    after: `snapshots/${id}.after.board.json`
  },
  summary: 'P1 confirmed the pending lead-4 unit-count win at the start of round 16.',
  reasoning:
    'P1 had recorded a pending lead-4 threat at the start of turn 29. P2 response turn 30 reduced the count only to P1 11 / P2 7, still a four-unit lead, so P1 wins immediately before deck, income, movement, combat, healing, or recruitment.'
});

await writeJson(join(root, 'timeline.json'), timeline);

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
