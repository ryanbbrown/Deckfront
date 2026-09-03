import { describe, expect, it } from 'vitest';
import {
  findPretrainedKingdom, pretrainedBattlefields, publicBattlefieldNumber, publicBattlefieldNumbers
} from '../src/server/pretrainedCatalog';

describe('pretrained battlefield catalog', () => {
  it('maps the stable kingdom id boundaries to public battlefield numbers', () => {
    expect(publicBattlefieldNumber('balance-tuning-001')).toBe(1);
    expect(publicBattlefieldNumber('balance-tuning-128')).toBe(128);
    expect(publicBattlefieldNumber('balance-validation-001')).toBe(129);
    expect(publicBattlefieldNumber('balance-validation-032')).toBe(160);
  });

  it.each([
    'balance-tuning-1',
    'balance-training-001',
    'balance-validation-001-extra',
    'invented-001'
  ])('rejects the unrecognized kingdom id %s', (kingdomId) => {
    expect(() => publicBattlefieldNumber(kingdomId)).toThrow('unrecognized public id');
  });

  it.each([
    'balance-tuning-000',
    'balance-tuning-129',
    'balance-validation-000',
    'balance-validation-033'
  ])('rejects the out-of-range kingdom id %s', (kingdomId) => {
    expect(() => publicBattlefieldNumber(kingdomId)).toThrow('out-of-range public number');
  });

  it('rejects duplicate public numbers', () => {
    expect(() => publicBattlefieldNumbers(['balance-tuning-001', 'balance-tuning-001']))
      .toThrow('Public battlefield number 1 is duplicated.');
  });

  it('publishes the exact ordered sequence and round-trips every card set', () => {
    const battlefields = pretrainedBattlefields();
    expect(battlefields.map((battlefield) => battlefield.number))
      .toEqual(Array.from({ length: battlefields.length }, (_, index) => index + 1));
    expect(battlefields).toHaveLength(160);
    for (const battlefield of battlefields) {
      const kingdom = findPretrainedKingdom([...battlefield.variableCardIds].reverse());
      expect(kingdom?.battlefieldNumber).toBe(battlefield.number);
    }
  });
});
