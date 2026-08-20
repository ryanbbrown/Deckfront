import { describe, expect, it } from 'vitest';
import { cardDefinition } from '../../src/game';
import {
  buildAttackProfile, printedAttackDamage, profilePositionValue, publicPositionAdvantage, removeProfileCard
} from '../../src/sim/positionValue';

function profile(...ids: string[]): ReturnType<typeof buildAttackProfile> {
  return buildAttackProfile(ids.map((id) => {
    const card = cardDefinition(id);
    return { definitionId: card.id, mechanic: card.mechanic, values: card.values ?? {} };
  }));
}

describe('public position value', () => {
  it('discounts a Close attack by each step needed to reach Close', () => {
    const melee = profile('heavyBlow');
    expect(profilePositionValue(melee, 3, 3)).toBe(20);
    expect(profilePositionValue(melee, 2, 3)).toBe(-1);
    expect(profilePositionValue(melee, 1, 3)).toBe(-2);
  });

  it('includes Drive wall damage only while Close at either wall', () => {
    const drive = profile('drive');
    expect(profilePositionValue(drive, 1, 1)).toBe(20);
    expect(profilePositionValue(drive, 5, 5)).toBe(20);
    expect(profilePositionValue(drive, 3, 3)).toBe(10);
    expect(profilePositionValue(drive, 1, 3)).toBe(-2);
  });

  it('values Steady Shot equally at Near and Far', () => {
    const ranged = profile('steadyShot');
    expect(profilePositionValue(ranged, 3, 3)).toBe(-1);
    expect(profilePositionValue(ranged, 2, 3)).toBe(10);
    expect(profilePositionValue(ranged, 1, 3)).toBe(10);
  });

  it('values Repelling Shot as a ranged attack', () => {
    const ranged = profile('repellingShot');
    expect(profilePositionValue(ranged, 3, 3)).toBe(-1);
    expect(profilePositionValue(ranged, 2, 3)).toBe(5);
    expect(profilePositionValue(ranged, 1, 3)).toBe(5);
  });

  it('uses current Aim only for the current hand and best printed Volley for public value', () => {
    const volley = cardDefinition('volley');
    const card = { mechanic: volley.mechanic, values: volley.values ?? {} };
    expect(printedAttackDamage(card, 2, 3, { aimed: false, tacticalPlayed: 0, publicFuture: false })).toBe(1);
    expect(printedAttackDamage(card, 2, 3, { aimed: true, tacticalPlayed: 0, publicFuture: false })).toBe(4);
    expect(printedAttackDamage(card, 1, 3, { aimed: false, tacticalPlayed: 0, publicFuture: false })).toBe(4);
    expect(printedAttackDamage(card, 1, 3, { aimed: true, tacticalPlayed: 0, publicFuture: false })).toBe(5);
    expect(profilePositionValue(profile('volley'), 2, 3)).toBe(19);
    expect(profilePositionValue(profile('volley'), 1, 3)).toBe(25);
  });

  it('keeps Mage damage position-neutral', () => {
    const mage = profile('arcBolt');
    expect(profilePositionValue(mage, 3, 3)).toBe(20);
    expect(profilePositionValue(mage, 2, 3)).toBe(20);
    expect(profilePositionValue(mage, 1, 3)).toBe(20);
  });

  it('normalizes unequal live deck sizes with exact integer arithmetic', () => {
    const smallMage = profile('arcBolt');
    const largeMage = profile('arcBolt', 'copper');
    expect(publicPositionAdvantage(smallMage, largeMage, 1, 3)).toBe(20);
    expect(publicPositionAdvantage(largeMage, smallMage, 1, 3)).toBe(-20);
  });

  it('updates normalization when Cull removes a live non-attack card', () => {
    const card = cardDefinition('copper');
    const mageWithCopper = profile('arcBolt', 'copper');
    const mage = profile('arcBolt');
    expect(publicPositionAdvantage(mageWithCopper, mage, 1, 3)).toBe(-20);
    removeProfileCard(mageWithCopper, {
      definitionId: card.id, mechanic: card.mechanic, values: card.values ?? {}
    });
    expect(publicPositionAdvantage(mageWithCopper, mage, 1, 3)).toBe(0);
  });
});
