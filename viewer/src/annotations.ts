import { coordKey, type BoardState } from '../../src/board/schema';
import type { ReplayBoardAction } from '../../src/replay/schema';

type BoardUnit = BoardState['units'][number];
type AnnotationKind = 'movement' | 'attack';

export interface BoardAnnotation {
  id: string;
  kind: AnnotationKind;
  player: string;
  from: BoardUnit | null;
  to: BoardUnit;
  label: string;
  showImpact?: boolean;
}

export function buildBoardAnnotations(previousState: BoardState | null, state: BoardState, activePlayer: string | null, action?: ReplayBoardAction): BoardAnnotation[] {
  if (!previousState || !activePlayer) return [];

  const currentUnitsById = new Map(state.units.map((unit) => [unit.id, unit]));
  const previousUnitsById = new Map(previousState.units.map((unit) => [unit.id, unit]));
  if (action?.type === 'activation') return buildActionAnnotations(action.activation, currentUnitsById, previousUnitsById, activePlayer);
  if (action?.type === 'setup') return [];

  const activeUnits = state.units.filter((unit) => unit.player === activePlayer);
  const annotations: BoardAnnotation[] = [];
  for (const current of state.units) {
    const previous = previousUnitsById.get(current.id);
    if (previous && coordKey(previous) !== coordKey(current)) {
      annotations.push({ id: `movement-${current.id}`, kind: 'movement', player: current.player, from: previous, to: current, label: '' });
    }
  }

  for (const previous of previousState.units) {
    if (previous.player === activePlayer) continue;
    const current = currentUnitsById.get(previous.id);
    const damage = current ? previous.hp - current.hp : previous.hp;
    if (damage > 0) {
      annotations.push({
        id: `attack-${previous.id}`,
        kind: 'attack',
        player: activePlayer,
        from: nearestUnit(activeUnits, current ?? previous),
        to: current ?? previous,
        label: current ? `-${damage}` : 'KO'
      });
    }
  }
  return annotations;
}

function buildActionAnnotations(
  actionActivation: Extract<ReplayBoardAction, { type: 'activation' }>['activation'],
  currentUnitsById: Map<string, BoardUnit>,
  previousUnitsById: Map<string, BoardUnit>,
  activePlayer: string
): BoardAnnotation[] {
  const annotations: BoardAnnotation[] = [];
  for (const [index, activation] of [actionActivation].entries()) {
    const unit = currentUnitsById.get(activation.unit) ?? previousUnitsById.get(activation.unit);
    if (!unit) continue;
    const from = { ...unit, ...activation.from };
    const via = { ...unit, ...(activation.via ?? activation.from) };
    const to = { ...unit, ...activation.to };

    if (coordKey(from) !== coordKey(via)) {
      annotations.push({ id: `movement-${activation.unit}-${index}-via`, kind: 'movement', player: activePlayer, from, to: via, label: '' });
    }
    if (activation.attack) {
      const target = currentUnitsById.get(activation.attack.target) ?? previousUnitsById.get(activation.attack.target);
      if (target) {
        annotations.push({
          id: `attack-${activation.unit}-${index}`,
          kind: 'attack',
          player: activePlayer,
          from: via,
          to: target,
          label: activation.attack.targetRemoved ? 'KO' : `-${activation.attack.damage}`,
          showImpact: true
        });
      }
    }
    if (coordKey(via) !== coordKey(to)) {
      annotations.push({ id: `movement-${activation.unit}-${index}-to`, kind: 'movement', player: activePlayer, from: via, to, label: '' });
    }
  }
  return annotations;
}

function nearestUnit(units: BoardUnit[], target: BoardUnit): BoardUnit | null {
  let nearest: BoardUnit | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const unit of units) {
    const colDistance = unit.col - target.col;
    const rowDistance = unit.row - target.row;
    const distance = colDistance * colDistance + rowDistance * rowDistance;
    if (distance < nearestDistance) {
      nearest = unit;
      nearestDistance = distance;
    }
  }
  return nearest;
}
