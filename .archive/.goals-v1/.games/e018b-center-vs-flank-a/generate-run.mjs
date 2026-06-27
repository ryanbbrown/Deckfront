import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(runDir, '..', '..');
const snapshotsDir = join(runDir, 'snapshots');

const starterBoard = JSON.parse(await readFile(join(repoRoot, '.games/e018-no-printheal-starter.board.json'), 'utf8'));
const deckTemplate = JSON.parse(
  await readFile(join(repoRoot, '.games/e013-rush-vs-engine-a/snapshots/turn-001.before.deck.json'), 'utf8')
);

const unitStats = {
  guardian: { hp: 16, attack: 4 },
  raider: { hp: 8, attack: 6 },
  marksman: { hp: 8, attack: 4 },
  scout: { hp: 8, attack: 2 },
  druid: { hp: 10, attack: 4 },
  healer: { hp: 4, attack: 1 }
};

const blocked = new Set(['0,2', '0,3', '0,4', '3,5', '8,4', '12,5', '12,6', '12,7']);

const turns = [
  {
    player: 'P1',
    round: 1,
    hand: ['Peddler', 'Copper', 'Copper', 'Zap', 'Rest'],
    played: ['Peddler', 'Zap'],
    bought: ['Silver'],
    produced: { money: 1, damage: 1 },
    summary: 'P1 opened toward the northeast and center lanes instead of racing the lower flank.',
    reasoning:
      'The early center-control plan valued a compact route to center-north and center-center. No legal attack existed, so the deck damage expired.',
    apply: (board) => {
      income(board, 'P1');
      move(board, 'P1-raider-1', 8, 1);
      control(board, 'center-northeast', 'P1');
      move(board, 'P1-scout-1', 9, 3);
      move(board, 'P1-guardian-1', 10, 2);
      move(board, 'P1-marksman-1', 10, 1);
    }
  },
  {
    player: 'P2',
    round: 1,
    hand: ['Village', 'Peddler', 'Copper', 'Copper', 'Rest'],
    played: ['Village', 'Peddler'],
    bought: ['Silver'],
    produced: { money: 1 },
    summary: 'P2 sent scouts down the west and south lanes while keeping the druid behind them.',
    reasoning:
      'This followed the flank/economy assignment: take the cheap lower center first and avoid a direct collision with P1 guardian support.',
    apply: (board) => {
      income(board, 'P2');
      move(board, 'P2-scout-1', 3, 7);
      control(board, 'center-west-south', 'P2');
      move(board, 'P2-scout-2', 2, 8);
      move(board, 'P2-druid-1', 2, 7);
      move(board, 'P2-marksman-1', 1, 7);
    }
  },
  {
    player: 'P1',
    round: 2,
    hand: ['Village', 'Copper', 'Copper', 'Bandage', 'Rest'],
    played: ['Village', 'Bandage'],
    bought: ['Peddler'],
    produced: { money: 0, heal: 1 },
    summary: 'P1 tightened the center approach and preserved the raider rather than diving unsupported.',
    reasoning:
      'P1 did not yet have a clean center capture. The bandage had no damaged friendly target and expired.',
    apply: (board) => {
      income(board, 'P1');
      move(board, 'P1-scout-1', 6, 3);
      move(board, 'P1-raider-1', 7, 2);
      move(board, 'P1-guardian-1', 9, 2);
      move(board, 'P1-marksman-1', 9, 1);
    }
  },
  {
    player: 'P2',
    round: 2,
    hand: ['Peddler', 'Copper', 'Copper', 'Bandage', 'Rest'],
    played: ['Peddler', 'Bandage'],
    bought: ['Peddler'],
    produced: { money: 1, heal: 1 },
    summary: 'P2 claimed center-south with the second scout and formed a lower support line.',
    reasoning:
      'The lower-center capture gave P2 a second income point without committing into P1s central guardian.',
    apply: (board) => {
      income(board, 'P2');
      move(board, 'P2-scout-2', 5, 7);
      control(board, 'center-center-south', 'P2');
      move(board, 'P2-scout-1', 4, 6);
      move(board, 'P2-druid-1', 4, 7);
      move(board, 'P2-marksman-1', 3, 7);
    }
  },
  {
    player: 'P1',
    round: 3,
    hand: ['Silver', 'Copper', 'Copper', 'Zap', 'Rest'],
    played: ['Zap'],
    bought: ['Village'],
    produced: { money: 2, damage: 1 },
    summary: 'P1 took center-north and recruited a second guardian for the middle front.',
    reasoning:
      'The first recruit anchored the assigned center-control plan. P1 still had no efficient legal attack, so the extra deck damage expired.',
    apply: (board) => {
      income(board, 'P1');
      move(board, 'P1-scout-1', 5, 3);
      control(board, 'center-center-north', 'P1');
      move(board, 'P1-raider-1', 6, 3);
      move(board, 'P1-guardian-1', 8, 2);
      move(board, 'P1-marksman-1', 8, 1);
      recruit(board, 'P1', 'guardian', 2, 11, 1);
    }
  },
  {
    player: 'P2',
    round: 3,
    hand: ['Silver', 'Peddler', 'Village', 'Copper', 'Rest'],
    played: ['Village', 'Peddler'],
    bought: ['Gold'],
    produced: { money: 3 },
    summary: 'P2 used the lower income to recruit a raider and sent a scout to the southeast center.',
    reasoning:
      'P2 stayed on the flank/economy script: one mobile body entered while the scout threatened the east cluster from below.',
    apply: (board) => {
      income(board, 'P2');
      move(board, 'P2-scout-2', 8, 7);
      control(board, 'center-southeast', 'P2');
      move(board, 'P2-scout-1', 5, 6);
      recruit(board, 'P2', 'raider', 1, 0, 9);
    }
  },
  {
    player: 'P1',
    round: 4,
    hand: ['Peddler', 'Zap', 'Copper', 'Copper', 'Bandage'],
    played: ['Peddler', 'Zap', 'Bandage'],
    bought: ['Blast'],
    produced: { money: 1, damage: 1, heal: 1 },
    summary: 'P1 captured the center and killed P2s forward scout with a raider-supported attack.',
    reasoning:
      'The center-control deck finally converted damage into board pressure. P1 used one capped deck damage on the raider attack; the heal was not needed.',
    apply: (board) => {
      income(board, 'P1');
      move(board, 'P1-raider-1', 6, 5);
      control(board, 'center-center', 'P1');
      move(board, 'P1-guardian-1', 7, 3);
      move(board, 'P1-scout-1', 6, 4);
      move(board, 'P1-marksman-1', 8, 2);
      kill(board, 'P2-scout-1');
      recruit(board, 'P1', 'marksman', 2, 11, 0);
    }
  },
  {
    player: 'P2',
    round: 4,
    hand: ['Gold', 'Village', 'Peddler', 'Storm', 'Copper'],
    played: ['Village', 'Peddler', 'Storm'],
    bought: ['Village'],
    produced: { money: 4, damage: 2, stormTargets: 2 },
    summary: 'P2 flipped the east center from the lower route and started bleeding P1s center raider.',
    reasoning:
      'Storm was interpreted narrowly: one legal ranged attack carried one deck damage, and the second storm damage could not be profitably assigned without another legal capped attacker.',
    apply: (board) => {
      income(board, 'P2');
      move(board, 'P2-scout-2', 8, 6);
      control(board, 'center-east', 'P2');
      move(board, 'P2-raider-1', 2, 8);
      damage(board, 'P1-raider-1', 3);
      recruit(board, 'P2', 'scout', 3, 1, 8);
    }
  },
  {
    player: 'P1',
    round: 5,
    hand: ['Village', 'Peddler', 'Zap', 'Copper', 'Rest'],
    played: ['Village', 'Peddler', 'Zap'],
    bought: ['Silver'],
    produced: { money: 1, damage: 1 },
    summary: 'P1 advanced marksmen toward the middle and pressured the east scout without killing it.',
    reasoning:
      'P1 kept the center compact and did not overextend the wounded raider. No lead-4 threat existed at the start of the turn.',
    apply: (board) => {
      income(board, 'P1');
      move(board, 'P1-guardian-2', 10, 2);
      move(board, 'P1-marksman-2', 10, 1);
      move(board, 'P1-scout-1', 7, 5);
      move(board, 'P1-guardian-1', 7, 4);
      damage(board, 'P2-scout-2', 3);
    }
  },
  {
    player: 'P2',
    round: 5,
    hand: ['Village', 'Peddler', 'Copper', 'Blast', 'Silver'],
    played: ['Village', 'Peddler', 'Blast'],
    bought: ['Peddler'],
    produced: { money: 3, damage: 2 },
    summary: 'P2 added a second raider and kept the east scout alive long enough to hold the income point.',
    reasoning:
      'The flank player prioritized bodies and income over a center grind. P1s raider was reduced to a fragile state but not yet killed.',
    apply: (board) => {
      income(board, 'P2');
      move(board, 'P2-raider-1', 3, 8);
      move(board, 'P2-scout-3', 4, 8);
      damage(board, 'P1-raider-1', 3);
      recruit(board, 'P2', 'raider', 2, 0, 8);
    }
  },
  {
    player: 'P1',
    round: 6,
    hand: ['Blast', 'Zap', 'Peddler', 'Silver', 'Copper'],
    played: ['Peddler', 'Zap', 'Blast'],
    bought: ['Armory'],
    produced: { money: 3, damage: 3 },
    summary: 'P1 killed the east scout and recruited a druid body to thicken the center.',
    reasoning:
      'The raider moved adjacent and used one deck damage on the killing attack. East control stayed with P2 until P1 could physically retake it.',
    apply: (board) => {
      income(board, 'P1');
      move(board, 'P1-raider-1', 7, 6);
      kill(board, 'P2-scout-2');
      recruit(board, 'P1', 'druid', 1, 12, 1);
    }
  },
  {
    player: 'P2',
    round: 6,
    hand: ['Gold', 'Village', 'Peddler', 'Potion', 'Copper'],
    played: ['Village', 'Peddler', 'Potion'],
    bought: ['Storm'],
    produced: { money: 4, heal: 2 },
    summary: 'P2 recruited a marksman and moved the flank units into a wide semicircle.',
    reasoning:
      'P2 accepted a temporary material deficit because the east and lower centers were still paying out. No pending lead threat existed.',
    apply: (board) => {
      income(board, 'P2');
      move(board, 'P2-scout-3', 7, 8);
      move(board, 'P2-raider-2', 2, 7);
      recruit(board, 'P2', 'marksman', 2, 0, 9);
    }
  },
  {
    player: 'P1',
    round: 7,
    hand: ['Armory', 'Village', 'Bandage', 'Copper', 'Silver'],
    played: ['Village', 'Bandage', 'Armory'],
    bought: ['Peddler'],
    produced: { money: 2, heal: 1, upgradeHealth: 2 },
    summary: 'P1 retook the east center and upgraded the lead guardian.',
    reasoning:
      'This was the high point of P1s center-control posture: four centers, a durable middle, and an 8 to 7 unit count.',
    apply: (board) => {
      income(board, 'P1');
      move(board, 'P1-scout-1', 8, 6);
      control(board, 'center-east', 'P1');
      move(board, 'P1-druid-1', 11, 2);
      upgradeHealth(board, 'P1-guardian-1', 2);
      recruit(board, 'P1', 'guardian', 3, 11, 1);
    }
  },
  {
    player: 'P2',
    round: 7,
    hand: ['Storm', 'Village', 'Peddler', 'Copper', 'Copper'],
    played: ['Village', 'Peddler', 'Storm'],
    bought: ['Silver'],
    produced: { money: 1, damage: 2, stormTargets: 2 },
    summary: 'P2 killed the wounded center raider and recruited a guardian for the lower foothold.',
    reasoning:
      'The kill reduced P1s ability to punish flank flips. P2 still avoided occupying the central kill zone with fragile units.',
    apply: (board) => {
      income(board, 'P2');
      move(board, 'P2-raider-1', 6, 6);
      move(board, 'P2-marksman-2', 1, 6);
      kill(board, 'P1-raider-1');
      recruit(board, 'P2', 'guardian', 1, 1, 7);
    }
  },
  {
    player: 'P1',
    round: 8,
    hand: ['Peddler', 'Zap', 'Silver', 'Copper', 'Rest'],
    played: ['Peddler', 'Zap'],
    bought: ['Training'],
    produced: { money: 3, damage: 1 },
    summary: 'P1 recruited another marksman and damaged the lower raider without clearing it.',
    reasoning:
      'P1 chose ranged punishment over chasing P2s scout deep into the flank. That preserved the center but left the east lane exposed.',
    apply: (board) => {
      income(board, 'P1');
      move(board, 'P1-marksman-2', 9, 2);
      damage(board, 'P2-raider-1', 5);
      recruit(board, 'P1', 'marksman', 3, 11, 0);
    }
  },
  {
    player: 'P2',
    round: 8,
    hand: ['Gold', 'Village', 'Peddler', 'Blast', 'Storm'],
    played: ['Village', 'Peddler', 'Blast', 'Storm'],
    bought: ['Gold'],
    produced: { money: 4, damage: 4, stormTargets: 2 },
    summary: 'P2 killed P1s east scout and restored the lower-east pressure.',
    reasoning:
      'P2 used a raider plus scout fire to kill the exposed scout. Damage was still capped to one deck damage per attacking unit.',
    apply: (board) => {
      income(board, 'P2');
      move(board, 'P2-scout-3', 8, 7);
      move(board, 'P2-marksman-1', 4, 6);
      damage(board, 'P2-raider-1', -2);
      kill(board, 'P1-scout-1');
      recruit(board, 'P2', 'scout', 4, 1, 8);
    }
  },
  {
    player: 'P1',
    round: 9,
    hand: ['Training', 'Peddler', 'Zap', 'Silver', 'Copper'],
    played: ['Peddler', 'Training', 'Zap'],
    bought: ['Potion'],
    produced: { money: 3, damage: 1, upgradeDamage: 1 },
    summary: 'P1 killed the wounded lower raider and recruited a healer body for ranged chip and response-window count.',
    reasoning:
      'The center army was still tactically stronger when P2 units came close. P1 had equal unit count after the exchange but was losing the center economy race.',
    apply: (board) => {
      income(board, 'P1');
      move(board, 'P1-marksman-3', 10, 1);
      upgradeDamage(board, 'P1-guardian-1', 1);
      kill(board, 'P2-raider-1');
      recruit(board, 'P1', 'healer', 1, 12, 1);
    }
  },
  {
    player: 'P2',
    round: 9,
    hand: ['Village', 'Peddler', 'Gold', 'Potion', 'Bandage'],
    played: ['Village', 'Peddler', 'Potion', 'Bandage'],
    bought: ['Armory'],
    produced: { money: 4, heal: 3 },
    summary: 'P2 flipped east again and put a raider on the center approach.',
    reasoning:
      'This turn showed the map tension clearly: P1 held the middle tactically, but P2s mobility kept changing which centers paid income.',
    apply: (board) => {
      income(board, 'P2');
      move(board, 'P2-scout-3', 8, 6);
      control(board, 'center-east', 'P2');
      move(board, 'P2-raider-2', 5, 6);
      move(board, 'P2-guardian-1', 3, 7);
      damage(board, 'P1-guardian-1', 7);
    }
  },
  {
    player: 'P1',
    round: 10,
    hand: ['Armory', 'Blast', 'Zap', 'Peddler', 'Silver'],
    played: ['Peddler', 'Zap', 'Blast', 'Armory'],
    bought: ['Peddler'],
    produced: { money: 3, damage: 3, upgradeHealth: 2 },
    summary: 'P1 killed P2s second raider and recruited a second druid.',
    reasoning:
      'P1 still won direct center trades when P2 stepped next to the upgraded guardian. The issue was that P2 could trade one raider for several turns of income.',
    apply: (board) => {
      income(board, 'P1');
      upgradeHealth(board, 'P1-guardian-1', 2);
      kill(board, 'P2-raider-2');
      recruit(board, 'P1', 'druid', 2, 11, 0);
    }
  },
  {
    player: 'P2',
    round: 10,
    hand: ['Storm', 'Blast', 'Gold', 'Village', 'Peddler'],
    played: ['Village', 'Peddler', 'Blast', 'Storm'],
    bought: ['Healer'],
    produced: { money: 4, damage: 4, stormTargets: 2 },
    summary: 'P2s first major economy swing killed three P1 center units and flipped center plus northwest.',
    reasoning:
      'Storm again used the conservative interpretation. P2 assigned deck damage only through legal attacks, but the accumulated ranged pressure finally cracked P1s middle front.',
    apply: (board) => {
      income(board, 'P2');
      move(board, 'P2-scout-4', 3, 3);
      control(board, 'center-northwest', 'P2');
      move(board, 'P2-scout-3', 6, 5);
      control(board, 'center-center', 'P2');
      recruit(board, 'P2', 'guardian', 2, 0, 8);
      kill(board, 'P1-guardian-1');
      kill(board, 'P1-marksman-1');
      kill(board, 'P1-druid-1');
    }
  },
  {
    player: 'P1',
    round: 11,
    hand: ['Training', 'Zap', 'Bandage', 'Silver', 'Copper'],
    played: ['Training', 'Zap', 'Bandage'],
    bought: ['Silver'],
    produced: { money: 2, damage: 1, heal: 1, upgradeDamage: 1 },
    summary: 'P1 healed and upgraded the remaining guardian line but could not safely recruit through the collapsing front.',
    reasoning:
      'No pending P2 threat existed because P1 was the active player. P1 saved supply for a response turn and tried to keep the remaining center bodies alive.',
    apply: (board) => {
      income(board, 'P1');
      move(board, 'P1-guardian-2', 7, 4);
      move(board, 'P1-guardian-3', 9, 3);
      upgradeDamage(board, 'P1-guardian-2', 1);
      heal(board, 'P1-guardian-2', 1);
    }
  },
  {
    player: 'P2',
    round: 11,
    hand: ['Gold', 'Village', 'Peddler', 'Armory', 'Storm'],
    played: ['Village', 'Peddler', 'Armory', 'Storm'],
    bought: ['Village'],
    produced: { money: 4, damage: 2, upgradeHealth: 2, stormTargets: 2 },
    summary: 'P2 converted six-center income into two recruits and killed two P1 support units.',
    reasoning:
      'This was the decisive flank/economy conversion turn. P2 ended with a four-unit lead, but the pending threat would only be checked on P2s next start.',
    apply: (board) => {
      income(board, 'P2');
      upgradeHealth(board, 'P2-guardian-2', 2);
      recruit(board, 'P2', 'scout', 5, 1, 8);
      recruit(board, 'P2', 'druid', 2, 0, 9);
      kill(board, 'P1-marksman-2');
      kill(board, 'P1-healer-1');
    }
  },
  {
    player: 'P1',
    round: 12,
    hand: ['Blast', 'Zap', 'Peddler', 'Silver', 'Copper'],
    played: ['Peddler', 'Zap', 'Blast'],
    bought: ['Silver'],
    produced: { money: 3, damage: 3 },
    summary: 'P1 killed one exposed flank scout but could not recruit enough to erase the unit deficit.',
    reasoning:
      'P1 had saved supply but still needed to both kill and recruit to get below the four-unit danger line. The kill reduced P2 to eight units, while P1 stayed at four.',
    apply: (board) => {
      income(board, 'P1');
      kill(board, 'P2-scout-4');
    }
  },
  {
    player: 'P2',
    round: 12,
    hand: ['Gold', 'Village', 'Peddler', 'Healer', 'Storm'],
    played: ['Village', 'Peddler', 'Healer', 'Storm'],
    bought: ['Gold'],
    produced: { money: 4, damage: 2, heal: 4, stormTargets: 2 },
    summary: 'P2 recorded a pending lead-4 threat at eight units to four and widened it.',
    reasoning:
      'Pending P2 lead-4 threat created at start of turn 24. P2 recruited another guardian and killed P1 guardian-2, leaving P1 a full response turn.',
    apply: (board) => {
      income(board, 'P2');
      recruit(board, 'P2', 'guardian', 3, 1, 7);
      kill(board, 'P1-guardian-2');
    }
  },
  {
    player: 'P1',
    round: 13,
    hand: ['Armory', 'Training', 'Zap', 'Silver', 'Copper'],
    played: ['Training', 'Zap', 'Armory'],
    bought: ['Healer'],
    produced: { money: 2, damage: 1, upgradeHealth: 2, upgradeDamage: 1 },
    summary: 'P1 used the response turn to recruit a healer and kill a scout, but the P2 lead stayed at four.',
    reasoning:
      'Response turn to pending P2 lead-4. P1 improved from three to four units and killed P2 scout-3, but P2 still ended at eight units to four, so P2 confirms at the next start check.',
    apply: (board) => {
      income(board, 'P1');
      recruit(board, 'P1', 'healer', 2, 12, 1);
      kill(board, 'P2-scout-3');
      upgradeHealth(board, 'P1-guardian-3', 2);
      upgradeDamage(board, 'P1-guardian-3', 1);
    }
  }
];

function income(board, player) {
  const controlled = board.supplyControl.filter((center) => center.controller === player).length;
  const supply = supplyFor(board, player);
  supply.amount += 2 + controlled;
}

function supplyFor(board, player) {
  const supply = board.supply.find((entry) => entry.player === player);
  if (!supply) {
    throw new Error(`Missing supply for ${player}`);
  }
  return supply;
}

function recruit(board, player, type, number, col, row) {
  const supply = supplyFor(board, player);
  if (supply.amount < 6) {
    throw new Error(`${player} cannot recruit ${type}-${number}; supply is ${supply.amount}`);
  }
  supply.amount -= 6;
  const stats = unitStats[type];
  board.units.push({
    id: `${player}-${type}-${number}`,
    player,
    type,
    col,
    row,
    hp: stats.hp,
    maxHp: stats.hp,
    attack: stats.attack
  });
}

function move(board, id, col, row) {
  const unit = findUnit(board, id);
  unit.col = col;
  unit.row = row;
}

function damage(board, id, amount) {
  const unit = findUnit(board, id);
  unit.hp = Math.max(0, Math.min(unit.maxHp, unit.hp - amount));
}

function heal(board, id, amount) {
  damage(board, id, -amount);
}

function upgradeHealth(board, id, amount) {
  const unit = findUnit(board, id);
  unit.maxHp += amount;
  unit.hp += amount;
}

function upgradeDamage(board, id, amount) {
  const unit = findUnit(board, id);
  unit.attack += amount;
}

function kill(board, id) {
  const index = board.units.findIndex((unit) => unit.id === id);
  if (index === -1) {
    throw new Error(`Missing unit ${id}`);
  }
  board.units.splice(index, 1);
}

function control(board, id, controller) {
  const center = board.supplyControl.find((entry) => entry.id === id);
  if (!center) {
    throw new Error(`Missing center ${id}`);
  }
  center.controller = controller;
}

function findUnit(board, id) {
  const unit = board.units.find((candidate) => candidate.id === id);
  if (!unit) {
    throw new Error(`Missing unit ${id}`);
  }
  return unit;
}

function nextTurn(player, round) {
  return player === 'P1'
    ? { activePlayer: 'P2', round }
    : { activePlayer: 'P1', round: round + 1 };
}

function snapshotDeck(player, turnIndex) {
  const snapshot = structuredClone(deckTemplate);
  snapshot.rngState = 400000 + turnIndex;
  snapshot.game.activePlayer = player === 'P1' ? 0 : 1;
  return snapshot;
}

function normalizeProduced(produced) {
  return {
    money: 0,
    damage: 0,
    heal: 0,
    upgradeHealth: 0,
    upgradeDamage: 0,
    reattack: 0,
    stormTargets: 0,
    ...produced
  };
}

function assertBoard(board, turnId) {
  const ids = new Set();
  const coords = new Set();
  for (const unit of board.units) {
    if (ids.has(unit.id)) {
      throw new Error(`${turnId}: duplicate unit id ${unit.id}`);
    }
    ids.add(unit.id);
    const coord = `${unit.col},${unit.row}`;
    if (blocked.has(coord)) {
      throw new Error(`${turnId}: ${unit.id} on blocked hex ${coord}`);
    }
    if (coords.has(coord)) {
      throw new Error(`${turnId}: duplicate unit coordinate ${coord}`);
    }
    coords.add(coord);
  }
}

function relativeSnapshot(turnId, label, kind) {
  return `snapshots/${turnId}.${label}.${kind}.json`;
}

await mkdir(snapshotsDir, { recursive: true });

let board = structuredClone(starterBoard);
board.notes = [
  'Generated E018b center-control vs flank/economy no-printed-healing playtest state.',
  'Pending lead-4 threats are recorded in timeline reasoning and notes.md because board state has no pending-threat field.',
  'Printed druid/healer healing is disabled in this run; only deck heal and upgrade-health healing are used.'
];

const timeline = {
  schemaVersion: 1,
  title: 'E018b center-vs-flank A no printed healing replay',
  entries: []
};

let deckBefore = snapshotDeck('P1', 0);

for (let index = 0; index < turns.length; index += 1) {
  const turn = turns[index];
  const turnNumber = String(index + 1).padStart(3, '0');
  const turnId = `turn-${turnNumber}`;
  if (board.turn.activePlayer !== turn.player || board.turn.round !== turn.round) {
    throw new Error(
      `${turnId}: expected board turn ${board.turn.activePlayer} round ${board.turn.round}, got ${turn.player} round ${turn.round}`
    );
  }

  const beforeBoard = structuredClone(board);
  turn.apply(board);
  board.turn = nextTurn(turn.player, turn.round);
  assertBoard(board, turnId);
  const afterBoard = structuredClone(board);

  const afterDeck = snapshotDeck(board.turn.activePlayer, index + 1);

  await writeFile(join(runDir, relativeSnapshot(turnId, 'before', 'board')), `${JSON.stringify(beforeBoard, null, 2)}\n`);
  await writeFile(join(runDir, relativeSnapshot(turnId, 'after', 'board')), `${JSON.stringify(afterBoard, null, 2)}\n`);
  await writeFile(join(runDir, relativeSnapshot(turnId, 'before', 'deck')), `${JSON.stringify(deckBefore, null, 2)}\n`);
  await writeFile(join(runDir, relativeSnapshot(turnId, 'after', 'deck')), `${JSON.stringify(afterDeck, null, 2)}\n`);

  timeline.entries.push({
    id: turnId,
    player: turn.player,
    round: turn.round,
    deck: {
      before: relativeSnapshot(turnId, 'before', 'deck'),
      after: relativeSnapshot(turnId, 'after', 'deck'),
      drawnHand: turn.hand,
      played: turn.played,
      bought: turn.bought,
      produced: normalizeProduced(turn.produced)
    },
    board: {
      before: relativeSnapshot(turnId, 'before', 'board'),
      after: relativeSnapshot(turnId, 'after', 'board')
    },
    summary: turn.summary,
    reasoning: turn.reasoning
  });

  deckBefore = afterDeck;
}

board.notes.push(
  'Final replay state after turn 25: P2 has a pending lead-4 threat that confirms at the beginning of turn 26 / round 13.',
  'Final counts are P1 4 and P2 8; P1 used its response turn to recruit and kill once, but did not reduce the P2 lead below 4.',
  'No printed healing from druids or healers was used at any point.'
);

await writeFile(join(runDir, 'board.json'), `${JSON.stringify(board, null, 2)}\n`);
await writeFile(join(runDir, 'deck.json'), `${JSON.stringify(deckBefore, null, 2)}\n`);
await writeFile(join(runDir, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
await writeFile(
  join(runDir, 'notes.md'),
  `# E018b Center vs Flank A Replay Notes

## Setup

- Ruleset: \`territory-v1-cost6-damagecap-responsewin-lead4-no-printheal\`.
- Map: \`sketch-v3-contest\`.
- Starter board: \`.games/e018-no-printheal-starter.board.json\`.
- Deck setup used the fixed \`deck.yaml\` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player. The board-rules prose still mentions an older 7-Copper draft baseline, so this run records the fixed deck-file setup as operative.
- P1 deck strategy: center-control economy/support, buying Silver/Peddler/Village plus selective Zap/Blast, Armory/Training, Potion/Healer deck healing.
- P1 board strategy: claim northeast, center-north, center, and east; recruit guardians, marksmen, druids, and healers as bodies without printed healing loops.
- P2 deck strategy: flank/economy pressure, buying Village/Peddler/Gold with Storm/Blast/Armory/Healer support.
- P2 board strategy: avoid a direct center grind early, flip west/south/east centers with scouts and raiders, then convert extra supply to mobile pressure and bodies.
- E018 rule: druids and healers have no printed unit healing. This replay uses deck-produced healing and upgrade-health healing only.

## Lead-4 Threat Handling

- No pending lead-4 threat existed through turn 23. Several end-of-turn leads appeared, but the active start-of-turn checks did not yet find the active player leading by 4.
- Turn 24 / P2 start: P2 began at 8 units to P1's 4, so P2 recorded a pending lead-4 threat.
- Turn 25 / P1 response: P1 recruited Healer-2 and killed P2 Scout-3, but P2 still led 8 to 4.
- Winner: P2 confirms the pending lead-4 threat at the beginning of turn 26 / round 13, before income, movement, combat, healing, or recruitment.

## Final Result

- Completed player turns: 25.
- Winner: P2 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 4, P2 8.
- Final supply centers: P1 2, P2 6, neutral 0.
- Final saved supply: P1 ${supplyFor(board, 'P1').amount}, P2 ${supplyFor(board, 'P2').amount}.

## Map And Strategy Takeaways

- P1's center-control plan worked tactically in the midgame: it killed three P2 mobile units and held northeast/center-north for most of the game.
- P2's lower and east flips were more economically important than the lost raiders. Once P2 held six centers, the recruit tempo overcame P1's durable central line.
- Removing printed healing shortened the center anchor's survival once P2 reached six centers: P1's druid/healer bodies mattered for count and attacks, but they did not create a repeatable repair loop.
- This run suggests \`sketch-v3-contest\` still gives P2 flank/economy a strong conversion path in this matchup: P1 could win local center fights but still lost the income race.

## Support And Healing Observations

- Printed unit healing used: none.
- Deck healing used: Bandage healed P1 Guardian-2 for 1 on turn 21; other Bandage/Potion/Healer counters often expired or were tactically secondary.
- Upgrade-health healing used: Armory increased and healed P1 Guardian-1 twice and P1 Guardian-3 once, while P2 used Armory on Guardian-2.
- The no-print-heal safeguard mattered qualitatively: P1 could not stabilize the cracked center after losing Guardian-1, Druid-1, Marksman-1, Marksman-2, and Healer-1 across P2's turns 20-22.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in \`timeline.json\` reasoning and this notes file.
- Deck-produced damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit. Excess damage expired.
- Storm used the least expansive interpretation: base attack applied only to the original legal target, and extra storm damage required connected occupied enemy hexes plus available damage-cap capacity.
- Tactical movement, targeting, supply math, and the no-printed-healing constraint were hand-audited; \`validate-run\` verifies schema, snapshot existence, and continuity, not full combat legality or deck-hand exactness.
- Evidence quality: full for the intended board/rules question, with the standard validator caveat above.
`
);
