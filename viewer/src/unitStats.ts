import type { BoardState, UnitRules } from '../../src/board/schema';

type Unit = BoardState['units'][number];
type UpgradeableStat = 'attack' | 'movement' | 'range';

export type BuffedUnitStats = Record<UpgradeableStat, boolean>;

export function buffedUnitStats(unit: Unit, rules: UnitRules): BuffedUnitStats {
  const base = rules[unit.type];
  return {
    attack: base ? unit.attack > base.attack : false,
    movement: base ? unit.movement > base.movement : false,
    range: base ? unit.range > base.range : false
  };
}
