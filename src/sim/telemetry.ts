import { EFFECTS, PLAYER_IDS, resolveCard } from '../game';
import type { ActionAvailability, GameEvent, GameState, PlayerId } from '../game';
import type { DeadDrawCounts, MatchTelemetry } from './types';

/** The Action-phase state and its availability list, read before `endActionPhase` applies. */
export interface DeadDrawSnapshot {
  playerId: PlayerId;
  state: GameState;
  availability: readonly ActionAvailability[];
}

/** Everything one applied action contributes to telemetry. */
export interface TelemetrySlice {
  events: readonly GameEvent[];
  completedTurns: number;
  deadDraws?: DeadDrawSnapshot | undefined;
  unspentMoney?: { playerId: PlayerId; amount: number } | undefined;
}

export interface TelemetryAccumulator {
  readonly telemetry: MatchTelemetry;
  // The damage events of a slice belong to the most recent card that player played.
  readonly lastPlayedCard: Readonly<Record<PlayerId, string | null>>;
}

function byPlayer<T>(make: () => T): Record<PlayerId, T> {
  return { ochre: make(), indigo: make() };
}
function number(detail: Record<string, unknown>, key: string): number {
  const value = detail[key];
  return typeof value === 'number' ? value : 0;
}
function text(detail: Record<string, unknown>, key: string): string | null {
  const value = detail[key];
  return typeof value === 'string' ? value : null;
}
function bump(counts: Record<string, number>, key: string, amount: number): Record<string, number> {
  return { ...counts, [key]: (counts[key] ?? 0) + amount };
}

export function createAccumulator(startingBuild: Record<PlayerId, readonly string[]>): TelemetryAccumulator {
  return {
    telemetry: {
      turnsToWin: null,
      eventCount: 0,
      damageByCard: byPlayer<Record<string, number>>(() => ({})),
      playsByCard: byPlayer<Record<string, number>>(() => ({})),
      purchasesByCard: byPlayer<Record<string, number>>(() => ({})),
      startingBuild: { ochre: [...startingBuild.ochre], indigo: [...startingBuild.indigo] },
      deadDraws: byPlayer<DeadDrawCounts>(() => ({ range: 0, mana: 0, setup: 0, total: 0 })),
      moneySpent: byPlayer(() => 0),
      unspentMoney: byPlayer(() => 0),
      finalHealth: byPlayer(() => 0)
    },
    lastPlayedCard: { ochre: null, indigo: null }
  };
}

export function deadDrawCounts(snapshot: DeadDrawSnapshot): DeadDrawCounts {
  const { state, playerId, availability } = snapshot;
  const hand = new Map(state.players[playerId].deck.hand.map((card) => [card.id, card.definitionId]));
  const tacticalPlayed = state.actionsThisTurn.filter((id) => EFFECTS[resolveCard(state, id).mechanic].tactical).length;
  const counts: DeadDrawCounts = { range: 0, mana: 0, setup: 0, total: 0 };
  for (const entry of availability) {
    const definitionId = hand.get(entry.cardInstanceId);
    if (!definitionId) continue;
    const definition = resolveCard(state, definitionId);
    if (definition.type !== 'action') continue;
    if (!entry.enabled) {
      counts.total += 1;
      if (entry.reasonCode === 'NEEDS_CLOSE' || entry.reasonCode === 'NEEDS_NEAR_OR_FAR') counts.range += 1;
      else if (entry.reasonCode === 'NEEDS_MANA') counts.mana += 1;
      continue;
    }
    // A legal card whose setup is missing. No reason code can report this, because the play is legal.
    if (definition.mechanic === 'volley' && !state.fighters[playerId].aimed) counts.setup += 1;
    else if (definition.mechanic === 'flurry' && tacticalPlayed === 0) counts.setup += 1;
  }
  return counts;
}

export function accumulate(accumulator: TelemetryAccumulator, slice: TelemetrySlice): TelemetryAccumulator {
  const telemetry: MatchTelemetry = {
    ...accumulator.telemetry,
    damageByCard: { ...accumulator.telemetry.damageByCard },
    playsByCard: { ...accumulator.telemetry.playsByCard },
    purchasesByCard: { ...accumulator.telemetry.purchasesByCard },
    deadDraws: { ...accumulator.telemetry.deadDraws },
    moneySpent: { ...accumulator.telemetry.moneySpent },
    unspentMoney: { ...accumulator.telemetry.unspentMoney },
    eventCount: accumulator.telemetry.eventCount + slice.events.length
  };
  const lastPlayedCard = { ...accumulator.lastPlayedCard };

  for (const event of slice.events) {
    const actorId = event.playerId;
    switch (event.type) {
      case 'cardPlayed': {
        const definitionId = text(event.detail, 'definitionId');
        if (!definitionId) break;
        lastPlayedCard[actorId] = definitionId;
        telemetry.playsByCard[actorId] = bump(telemetry.playsByCard[actorId], definitionId, 1);
        break;
      }
      case 'damage': {
        const source = lastPlayedCard[actorId];
        if (!source) break;
        telemetry.damageByCard[actorId] = bump(telemetry.damageByCard[actorId], source, number(event.detail, 'amount'));
        break;
      }
      case 'purchase': {
        const definitionId = text(event.detail, 'definitionId');
        if (!definitionId) break;
        telemetry.purchasesByCard[actorId] = bump(telemetry.purchasesByCard[actorId], definitionId, 1);
        telemetry.moneySpent[actorId] += number(event.detail, 'cost');
        break;
      }
      case 'victory':
        telemetry.turnsToWin = slice.completedTurns;
        break;
      default:
        break;
    }
  }

  if (slice.unspentMoney) {
    telemetry.unspentMoney[slice.unspentMoney.playerId] += slice.unspentMoney.amount;
  }
  if (slice.deadDraws) {
    const counts = deadDrawCounts(slice.deadDraws);
    const running = telemetry.deadDraws[slice.deadDraws.playerId];
    telemetry.deadDraws[slice.deadDraws.playerId] = {
      range: running.range + counts.range, mana: running.mana + counts.mana,
      setup: running.setup + counts.setup, total: running.total + counts.total
    };
  }
  return { telemetry, lastPlayedCard };
}

export function finishTelemetry(accumulator: TelemetryAccumulator, state: GameState): MatchTelemetry {
  const finalHealth = byPlayer(() => 0);
  for (const playerId of PLAYER_IDS) finalHealth[playerId] = state.fighters[playerId].health;
  return { ...accumulator.telemetry, finalHealth };
}
