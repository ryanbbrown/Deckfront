import { describe, expect, it } from 'vitest';
import { cardDefinition } from '../../src/game';
import {
  buildAttackProfile, printedAttackDamage, profilePositionValue, publicPositionAdvantage, removeProfileCard
} from '../../src/sim/positionValue';

function attack(id: string) {
  const card = cardDefinition(id);
  return { mechanic: card.mechanic, values: card.values ?? {} };
}
function profile(...ids: string[]): ReturnType<typeof buildAttackProfile> {
  return buildAttackProfile(ids.map((id) => ({ definitionId: id, ...attack(id) })), 2);
}

describe('public position value', () => {
  it('discounts a Close attack by each step needed to reach Close', () => {
    const melee = profile('heavyBlow');
    expect(profilePositionValue(melee, 3, 3)).toBe(36);
    expect(profilePositionValue(melee, 2, 3)).toBe(-1);
    expect(profilePositionValue(melee, 1, 3)).toBe(-2);
  });

  it('includes Drive wall damage only while Close at either wall', () => {
    const drive = profile('drive');
    expect(profilePositionValue(drive, 1, 1)).toBe(30);
    expect(profilePositionValue(drive, 6, 6)).toBe(30);
    expect(profilePositionValue(drive, 3, 3)).toBe(18);
    expect(profilePositionValue(drive, 1, 3)).toBe(-2);
  });

  it('values Steady Shot equally at Near and Far with public Aim potential', () => {
    const ranged = profile('steadyShot');
    expect(profilePositionValue(ranged, 3, 3)).toBe(-1);
    expect(profilePositionValue(ranged, 2, 3)).toBe(24);
    expect(profilePositionValue(ranged, 1, 3)).toBe(24);
  });

  it('values Repelling Shot with separate Near and Far damage', () => {
    const ranged = profile('repellingShot');
    expect(profilePositionValue(ranged, 3, 3)).toBe(-2);
    expect(profilePositionValue(ranged, 2, 3)).toBe(17);
    expect(profilePositionValue(ranged, 1, 3)).toBe(24);
  });

  it('uses current Aim only for the current hand and best printed Volley for public value', () => {
    const volley = cardDefinition('volley');
    const card = { mechanic: volley.mechanic, values: volley.values ?? {} };
    expect(printedAttackDamage(card, 2, 3, { aimed: false, aimBonus: 2, tacticalPlayed: 0, publicFuture: false })).toBe(2);
    expect(printedAttackDamage(card, 2, 3, { aimed: true, aimBonus: 2, tacticalPlayed: 0, publicFuture: false })).toBe(4);
    expect(printedAttackDamage(card, 1, 3, { aimed: false, aimBonus: 2, tacticalPlayed: 0, publicFuture: false })).toBe(4);
    expect(printedAttackDamage(card, 1, 3, { aimed: true, aimBonus: 2, tacticalPlayed: 0, publicFuture: false })).toBe(6);
    expect(profilePositionValue(profile('volley'), 2, 3)).toBe(23);
    expect(profilePositionValue(profile('volley'), 1, 3)).toBe(36);
  });

  it('scores mana and family damage from current tactical counters', () => {
    const discharge = attack('discharge');
    const overload = attack('overload');
    const improvise = attack('improvise');
    expect(printedAttackDamage(discharge, 2, 3,
      { aimed: false, aimBonus: 2, tacticalPlayed: 0, publicFuture: false, mana: 3 })).toBe(6);
    expect(printedAttackDamage(overload, 2, 3,
      { aimed: false, aimBonus: 2, tacticalPlayed: 0, publicFuture: false, manaSpent: 2 })).toBe(6);
    expect(printedAttackDamage(improvise, 2, 3,
      { aimed: false, aimBonus: 2, tacticalPlayed: 0, publicFuture: false, familiesPlayed: ['mana', 'melee'] })).toBe(4);
  });

  it('scores Opening Strike from prior attacks rather than prior setup cards', () => {
    const openingStrike = attack('openingStrike');
    const base = { aimed: false, aimBonus: 0, tacticalPlayed: 0, publicFuture: false };
    expect(printedAttackDamage(openingStrike, 2, 2, { ...base, attacksPlayed: 0 })).toBe(4);
    expect(printedAttackDamage(openingStrike, 2, 2, { ...base, attacksPlayed: 1 })).toBe(1);
  });

  it('scores targeted, copy-sensitive, and spell-chain attacks from current tactical context', () => {
    const salvage = attack('salvageShot');
    const precision = attack('precisionShot');
    const cascade = attack('cascade');
    const base = { aimed: false, aimBonus: 2, tacticalPlayed: 0, publicFuture: false };
    expect(printedAttackDamage(salvage, 2, 4, { ...base, salvageCost: 5 })).toBe(5);
    expect(printedAttackDamage(precision, 2, 4,
      { ...base, definitionId: 'precisionShot', copiesPlayed: {} })).toBe(4);
    expect(printedAttackDamage(precision, 2, 4,
      { ...base, definitionId: 'precisionShot', copiesPlayed: { precisionShot: 1 } })).toBe(2);
    expect(printedAttackDamage(cascade, 2, 4, { ...base, spellsPlayed: 2 })).toBe(8);
  });

  it('gives public-future Flurry one nominal prior Tactical Action at Close range', () => {
    const flurry = profile('flurry');
    expect(profilePositionValue(flurry, 3, 3)).toBe(6);
    expect(profilePositionValue(flurry, 2, 3)).toBe(-1);
  });

  it('keeps Longshot at one damage for Near and absolute-distance damage for Far', () => {
    const longshot = attack('longshot');
    const state = { aimed: false, aimBonus: 2, tacticalPlayed: 0, publicFuture: false };
    expect(printedAttackDamage(longshot, 2, 3, state)).toBe(1);
    expect(printedAttackDamage(longshot, 1, 6, state)).toBe(5);
  });

  it('values only the first Scrap copy as current or public damage', () => {
    const scrap = attack('scrap');
    const base = { aimed: false, aimBonus: 0, tacticalPlayed: 0, publicFuture: false,
      definitionId: 'scrap' };
    expect(printedAttackDamage(scrap, 3, 4, { ...base, copiesPlayed: {} })).toBe(1);
    expect(printedAttackDamage(scrap, 3, 4, { ...base, copiesPlayed: { scrap: 1 } })).toBe(0);
    expect(profilePositionValue(profile('scrap', 'scrap', 'scrap'), 3, 4))
      .toBe(profilePositionValue(profile('scrap'), 3, 4));
  });

  it('keeps Mage damage position-neutral', () => {
    const mage = profile('arcBolt');
    const values = [[3, 3], [2, 3], [1, 3]]
      .map(([attacker, defender]) => profilePositionValue(mage, attacker!, defender!));
    expect(new Set(values).size).toBe(1);
  });

  it('normalizes unequal live deck sizes with exact integer arithmetic', () => {
    const smallMage = profile('arcBolt');
    const largeMage = profile('arcBolt', 'copper');
    const advantage = publicPositionAdvantage(smallMage, largeMage, 1, 3);
    expect(Number.isInteger(advantage)).toBe(true);
    expect(advantage).toBeGreaterThan(0);
    expect(publicPositionAdvantage(largeMage, smallMage, 1, 3)).toBe(-advantage);
  });

  it('updates normalization when Cull removes a live non-attack card', () => {
    const card = cardDefinition('copper');
    const mageWithCopper = profile('arcBolt', 'copper');
    const mage = profile('arcBolt');
    expect(publicPositionAdvantage(mageWithCopper, mage, 1, 3)).toBeLessThan(0);
    removeProfileCard(mageWithCopper, {
      definitionId: card.id, mechanic: card.mechanic, values: card.values ?? {}
    });
    expect(publicPositionAdvantage(mageWithCopper, mage, 1, 3)).toBe(0);
  });
});
