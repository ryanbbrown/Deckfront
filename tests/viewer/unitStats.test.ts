import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { unitRulesSchema } from '../../src/board/schema';
import { buffedUnitStats } from '../../viewer/src/unitStats';
import { skirmishUnit } from '../helpers/skirmish';

describe('viewer unit stat highlighting', () => {
  it('highlights only stats above the canonical value for the unit type', async () => {
    const rules = unitRulesSchema.parse(JSON.parse(await readFile('game/units.json', 'utf8')) as unknown);
    const soldier = { ...skirmishUnit('soldier', 'P1', 'soldier', 0, 0), attack: 2, movement: 5 };
    const archer = { ...skirmishUnit('archer', 'P2', 'archer', 0, 1), range: 3 };

    expect(buffedUnitStats(soldier, rules)).toEqual({ attack: true, movement: true, range: false });
    expect(buffedUnitStats(archer, rules)).toEqual({ attack: false, movement: false, range: true });
  });

  it('does not claim a buff when an unknown unit type has no canonical comparison', async () => {
    const rules = unitRulesSchema.parse(JSON.parse(await readFile('game/units.json', 'utf8')) as unknown);
    const unknown = { ...skirmishUnit('unknown', 'P1', 'soldier', 0, 0), type: 'unknown', attack: 99, movement: 99, range: 99 };

    expect(buffedUnitStats(unknown, rules)).toEqual({ attack: false, movement: false, range: false });
  });
});
