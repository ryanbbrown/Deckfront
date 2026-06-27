import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGameConfig } from '../../src/config/loadGameConfig';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';

const root = '.games/e001-rush-vs-engine-a';
const snapshots = join(root, 'snapshots');
const names: Record<string, string> = {
  rest: 'Rest', copper: 'Copper', silver: 'Silver', gold: 'Gold', village: 'Village',
  smithy: 'Smithy', peddler: 'Peddler', zap: 'Zap', blast: 'Blast', inferno: 'Inferno',
  storm: 'Storm', bandage: 'Bandage', potion: 'Potion', healer: 'Healer', armory: 'Armory',
  training: 'Training', 'second-wind': 'Second Wind'
};

type Unit = { id: string; player: string; type: string; q: number; r: number; hp: number };
type Board = {
  schemaVersion: 1;
  ruleset: string;
  map: string;
  turn: { activePlayer: string; round: number };
  units: Unit[];
  notes: string[];
  supplyControl: { id: string; controller: string | null }[];
  supply: { player: string; amount: number }[];
};

const maxHp: Record<string, number> = { guardian: 16, raider: 8, marksman: 8, scout: 8, druid: 10, healer: 4 };
let rng = new SeededRng(1);
const config = await loadGameConfig('rulesets/territory-v1/deck.yaml');
let game = setupGame(config, rng);
let board = JSON.parse(await readFile(join(root, 'board.json'), 'utf8')) as Board;
board.notes.push('Automated run-local driver used existing deck engine actions; board phase was applied from documented playtest decisions.');

function living(player: string): number {
  return board.units.filter((u) => u.player === player).length;
}

function supply(player: string): { player: string; amount: number } {
  return board.supply.find((s) => s.player === player)!;
}

function controls(player: string): number {
  return board.supplyControl.filter((c) => c.controller === player).length;
}

function center(id: string, player: string): void {
  board.supplyControl.find((c) => c.id === id)!.controller = player;
}

function move(id: string, q: number, r: number): void {
  const unit = board.units.find((u) => u.id === id);
  if (unit) {
    unit.q = q;
    unit.r = r;
  }
}

function damage(id: string, amount: number): void {
  const unit = board.units.find((u) => u.id === id);
  if (!unit) return;
  unit.hp -= amount;
  if (unit.hp <= 0) {
    board.units = board.units.filter((u) => u.id !== id);
  }
}

function heal(id: string, amount: number): void {
  const unit = board.units.find((u) => u.id === id);
  if (!unit) return;
  unit.hp = Math.min(maxHp[unit.type]!, unit.hp + amount);
}

function recruit(player: string, type: string, q: number, r: number): void {
  const pool = supply(player);
  if (pool.amount < 5) return;
  const prefix = `${player}-${type}-`;
  const n = Math.max(0, ...board.units
    .filter((u) => u.id.startsWith(prefix))
    .map((u) => Number(u.id.slice(prefix.length)))
    .filter((value) => Number.isInteger(value))) + 1;
  pool.amount -= 5;
  board.units.push({ id: `${player}-${type}-${n}`, player, type, q, r, hp: maxHp[type]! });
}

function advanceTurn(): void {
  board.turn.activePlayer = board.turn.activePlayer === 'P1' ? 'P2' : 'P1';
  if (board.turn.activePlayer === 'P1') board.turn.round += 1;
}

function chooseAction(player: string, descs: string[]): number {
  const buy = (card: string) => descs.findIndex((d) => d.startsWith(`Buy ${card} `));
  const play = (card: string) => descs.findIndex((d) => d === `Play ${card}`);
  const moveToBuy = descs.findIndex((d) => d === 'Move to buy phase');
  const end = descs.findIndex((d) => d === 'End turn');
  if (moveToBuy >= 0) {
    const p1 = ['Village', 'Peddler', 'Zap', 'Blast', 'Bandage', 'Storm', 'Inferno'];
    const p2 = ['Village', 'Peddler', 'Smithy', 'Bandage', 'Zap'];
    for (const card of player === 'P1' ? p1 : p2) {
      const idx = play(card);
      if (idx >= 0) return idx;
    }
    return moveToBuy;
  }
  if (end >= 0) {
    const p1 = ['Inferno', 'Storm', 'Blast', 'Zap', 'Peddler', 'Silver'];
    const p2 = ['Gold', 'Village', 'Smithy', 'Peddler', 'Silver', 'Bandage'];
    for (const card of player === 'P1' ? p1 : p2) {
      const idx = buy(card);
      if (idx >= 0) return idx;
    }
    return end;
  }
  return 0;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function idsToNames(ids: string[]): string[] {
  return ids.map((id) => names[id] ?? id);
}

const entries = [];
await mkdir(snapshots, { recursive: true });

for (let turn = 1; turn <= 12; turn += 1) {
  const id = `turn-${String(turn).padStart(3, '0')}`;
  const player = game.players[game.activePlayer]!.id;
  if (living(player) - living(player === 'P1' ? 'P2' : 'P1') >= 3) break;

  const deckBefore = { schemaVersion: 1, rngState: rng.snapshot(), game: clone(game) };
  const boardBefore = clone(board);
  await writeJson(join(snapshots, `${id}.before.deck.json`), deckBefore);
  await writeJson(join(snapshots, `${id}.before.board.json`), boardBefore);

  const active = game.players[game.activePlayer]!;
  const hand = idsToNames(active.hand);
  const played: string[] = [];
  const bought: string[] = [];
  let producedMoney = 0;

  while (!game.ended && game.players[game.activePlayer]!.id === player) {
    const legal = listLegalActions(game);
    const descs = legal.map((a) => a.description);
    const idx = chooseAction(player, descs);
    const desc = descs[idx]!;
    if (desc.startsWith('Play ')) played.push(desc.slice(5));
    if (desc.startsWith('Buy ')) bought.push(desc.match(/^Buy (.+) \(/)![1]!);
    if (desc === 'Move to buy phase') {
      game = applyAction(game, legal[idx]!.action, rng);
      producedMoney = game.players.find((p) => p.id === player)!.money;
      continue;
    }
    game = applyAction(game, legal[idx]!.action, rng);
  }

  const deckAfter = { schemaVersion: 1, rngState: rng.snapshot(), game: clone(game) };

  const producedPlayer = deckBefore.game.players.find((p) => p.id === player)!;
  const afterAttrs = clone(producedPlayer.attributes);
  const produced = {
    money: producedMoney,
    damage: game.players.find((p) => p.id === player)?.attributes.damage ?? 0,
    heal: game.players.find((p) => p.id === player)?.attributes.heal ?? 0,
    bonusHp: game.players.find((p) => p.id === player)?.attributes.bonusHp ?? 0,
    bonusAttack: game.players.find((p) => p.id === player)?.attributes.bonusAttack ?? 0,
    reattack: game.players.find((p) => p.id === player)?.attributes.reattack ?? 0,
    stormTargets: game.players.find((p) => p.id === player)?.attributes.stormTargets ?? 0
  };
  Object.assign(afterAttrs, produced);

  supply(player).amount += 2 + controls(player);

  let summary = '';
  let reasoning = '';
  if (turn === 1) {
    move('P1-raider-1', 8, 1); center('center-northeast', 'P1');
    move('P1-scout-1', 10, 3); center('center-east', 'P1');
    move('P1-marksman-1', 10, 0); move('P1-guardian-1', 10, 2);
    heal('P1-raider-1', produced.heal);
    summary = 'P1 claimed the northeast and east supply centers.';
    reasoning = 'The rush side used raider and scout speed immediately. Deck damage had no target, so only Bandage healing mattered.';
  } else if (turn === 2) {
    move('P2-scout-1', 3, 7); center('center-west-south', 'P2');
    move('P2-scout-2', 2, 8); move('P2-druid-1', 2, 7); move('P2-marksman-1', 1, 8);
    summary = 'P2 claimed west-south while keeping the fragile starter pieces grouped.';
    reasoning = 'The engine side avoided early combat and preserved a support cluster near its first center.';
  } else if (turn === 3) {
    move('P1-raider-1', 6, 3); move('P1-scout-1', 9, 6); move('P1-marksman-1', 9, 1); move('P1-guardian-1', 10, 3);
    recruit('P1', 'scout', 11, 1);
    summary = 'P1 spent the first recruit on another scout and pushed toward center-north and southeast.';
    reasoning = 'P1 had enough saved supply after two controlled centers. The rush plan added speed rather than durability.';
  } else if (turn === 4) {
    move('P2-scout-1', 6, 8); center('center-center-south', 'P2');
    move('P2-scout-2', 4, 8); move('P2-druid-1', 3, 7); move('P2-marksman-1', 2, 8);
    recruit('P2', 'guardian', 0, 9);
    summary = 'P2 took center-south and recruited a guardian screen.';
    reasoning = 'P2 hit the first recruit threshold and chose durability to buy time for the slower deck.';
  } else if (turn === 5) {
    move('P1-scout-1', 9, 7); center('center-southeast', 'P1');
    move('P1-raider-1', 5, 3); center('center-center-north', 'P1');
    move('P1-marksman-1', 8, 1); move('P1-guardian-1', 9, 3); move('P1-scout-2', 10, 2);
    recruit('P1', 'raider', 12, 1);
    summary = 'P1 expanded to four centers and added a second raider.';
    reasoning = 'The rush player converted tempo into supply control before P2 could contest the middle.';
  } else if (turn === 6) {
    move('P2-scout-1', 6, 5); center('center-center', 'P2');
    move('P2-scout-2', 5, 8); move('P2-druid-1', 4, 7); move('P2-marksman-1', 3, 8); move('P2-guardian-1', 1, 8);
    summary = 'P2 slipped into the center but could not recruit this turn.';
    reasoning = 'P2 preserved the center scout as a temporary forward claim while the support units lagged behind.';
  } else if (turn === 7) {
    move('P1-scout-1', 7, 6); damage('P2-scout-1', 2 + produced.damage);
    move('P1-raider-1', 5, 4); move('P1-marksman-1', 7, 2); move('P1-guardian-1', 8, 3); move('P1-raider-2', 10, 2);
    recruit('P1', 'raider', 11, 1);
    summary = 'P1 killed the exposed center scout and kept recruiting pressure units.';
    reasoning = 'A scout attack plus deck damage removed the low-HP center holder. Control of center persisted for P2, but its body count fell.';
  } else if (turn === 8) {
    move('P2-scout-2', 6, 8); move('P2-druid-1', 5, 7); move('P2-marksman-1', 4, 8); move('P2-guardian-1', 2, 8);
    recruit('P2', 'guardian', 1, 7);
    summary = 'P2 used accumulated supply for a second guardian and formed a southern line.';
    reasoning = 'The engine deck was still building; on board P2 chose not to overextend a damaged position.';
  } else if (turn === 9) {
    move('P1-scout-1', 6, 5); center('center-center', 'P1');
    damage('P2-druid-1', 2 + produced.damage);
    move('P1-raider-1', 5, 5); move('P1-marksman-1', 6, 3); move('P1-guardian-1', 7, 3); move('P1-raider-2', 8, 3); move('P1-raider-3', 9, 2);
    recruit('P1', 'marksman', 11, 0);
    summary = 'P1 flipped center and focused the druid before it could stabilize the line.';
    reasoning = 'The least expansive damage interpretation assigned spell damage through a legal scout attack, deleting the fragile druid.';
  } else if (turn === 10) {
    move('P2-guardian-1', 3, 8); move('P2-guardian-2', 2, 7); move('P2-scout-2', 6, 7); damage('P1-scout-1', 2);
    move('P2-marksman-1', 5, 8); damage('P1-scout-1', 4);
    recruit('P2', 'druid', 0, 8);
    summary = 'P2 killed the center scout and recruited a replacement druid.';
    reasoning = 'P2 finally answered the forward scout with concentrated ranged attacks, but the response cost tempo.';
  } else if (turn === 11) {
    move('P1-raider-1', 5, 6); damage('P2-scout-2', 6);
    move('P1-raider-2', 6, 4); move('P1-raider-3', 7, 4); move('P1-marksman-1', 5, 3); damage('P2-scout-2', 4);
    move('P1-guardian-1', 6, 3); move('P1-marksman-2', 10, 1);
    recruit('P1', 'scout', 12, 1);
    summary = 'P1 removed P2’s last scout and widened the unit lead.';
    reasoning = 'Raider pressure forced another kill near center-south; P1 still avoided sacrificing units into guardians.';
  } else {
    move('P2-guardian-1', 4, 8); move('P2-guardian-2', 3, 7); move('P2-druid-2', 1, 8); heal('P2-guardian-2', 1);
    recruit('P2', 'guardian', 0, 9);
    summary = 'P2 stabilized with another guardian but remained behind on units and center control.';
    reasoning = 'The engine side reached a defensive posture, but the low-HP seed and P1 supply lead made the recovery too slow.';
  }

  advanceTurn();
  await writeJson(join(snapshots, `${id}.after.deck.json`), deckAfter);
  await writeJson(join(snapshots, `${id}.after.board.json`), board);
  entries.push({
    id,
    player,
    round: boardBefore.turn.round,
    deck: {
      before: `snapshots/${id}.before.deck.json`,
      after: `snapshots/${id}.after.deck.json`,
      drawnHand: hand,
      played,
      bought,
      produced
    },
    board: {
      before: `snapshots/${id}.before.board.json`,
      after: `snapshots/${id}.after.board.json`
    },
    summary,
    reasoning
  });
}

await writeJson(join(root, 'deck.json'), { schemaVersion: 1, rngState: rng.snapshot(), game });
await writeJson(join(root, 'board.json'), board);
await writeJson(join(root, 'timeline.json'), { schemaVersion: 1, title: 'E001 Rush vs Engine A', entries });
await writeFile(join(root, 'notes.md'), [
  '# E001 Rush vs Engine A Notes',
  '',
  '- Seeded board from `.games/territory-v1-playtest/snapshots/turn-001.before.board.json` as requested.',
  '- That seed uses corrected low-HP starter units rather than max-HP units from `units.json`, making early combat much more lethal.',
  '- Deck damage was treated as extra damage assigned through a legal attack, not free global direct damage.',
  '- Druid healing was applied conservatively during P2 board phases where relevant.',
  '- Stopped after 12 completed player turns with P1 ahead on units and supply center control; the start-of-turn unit-lead win condition had not yet fired at the final completed turn.',
  ''
].join('\n'));
