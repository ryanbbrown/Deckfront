import { MARKET_CARD_IDS, cardDefinition } from './config';
import { SeededRandom, shuffle } from './random';
import { cloneGame, createCard, opponent } from './state';
import type {
  ActionAvailability, CardInstance, DisabledReasonCode, GameCommand, GameEventType,
  GameState, LegalAction, MovementChoice, PlayerId, RangeBand
} from './types';

const REASONS: Record<DisabledReasonCode, string> = {
  NOT_YOUR_TURN: 'It is not your turn.', WRONG_PHASE: 'This card cannot be played in this phase.',
  TREASURE_AUTOPLAYS: 'Treasure cards play when you end the Action phase.', NEEDS_CLOSE: 'Requires Close range.',
  NEEDS_NEAR_OR_FAR: 'Requires Near or Far range.', CULL_NEEDS_TWO: 'Cull needs exactly two eligible cards.'
};
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
function key(command: GameCommand): string { return JSON.stringify(stable(command)); }
function legal(label: string, command: GameCommand): LegalAction { return { id: '', label, command }; }
function ids(state: GameState, actions: LegalAction[]): LegalAction[] { return actions.map((action, index) => ({ ...action, id: `v${state.version}-action-${index + 1}` })); }
export function rangeBand(state: GameState): RangeBand {
  const difference = Math.abs(state.fighters.ochre.position - state.fighters.indigo.position);
  return difference === 0 ? 'Close' : difference === 1 ? 'Near' : 'Far';
}
function record(state: GameState, type: GameEventType, detail: Record<string, unknown>, playerId = state.activePlayerId): void {
  state.events.push({ sequence: state.events.length, type, playerId, detail });
}
function movements(state: GameState, playerId: PlayerId): MovementChoice[] {
  const position = state.fighters[playerId].position;
  const result: MovementChoice[] = [];
  if (position > 1) result.push('left');
  if (position < 5) result.push('right');
  return result;
}
function cardAvailability(state: GameState, playerId: PlayerId, card: CardInstance): ActionAvailability {
  const definition = cardDefinition(card.definitionId);
  let reasonCode: DisabledReasonCode | null = null;
  let selection: ActionAvailability['selection'] = 'none';
  let eligibleCardInstanceIds: string[] = [];
  let availableMovements: MovementChoice[] = [];
  if (state.activePlayerId !== playerId) reasonCode = 'NOT_YOUR_TURN';
  else if (state.phase !== 'action') reasonCode = 'WRONG_PHASE';
  else if (definition.type === 'treasure') reasonCode = 'TREASURE_AUTOPLAYS';
  else if (definition.mechanic === 'footwork') {
    selection = 'movement'; availableMovements = movements(state, playerId);
  } else if (definition.mechanic === 'cull') {
    selection = 'trashTwo';
    eligibleCardInstanceIds = [card.id, ...state.players[playerId].deck.hand.filter((candidate) => candidate.id !== card.id).map((candidate) => candidate.id)];
    if (eligibleCardInstanceIds.length < 2) reasonCode = 'CULL_NEEDS_TWO';
  } else if (['feint', 'drive'].includes(definition.mechanic) && rangeBand(state) !== 'Close') reasonCode = 'NEEDS_CLOSE';
  else if (definition.mechanic === 'drive') { selection = 'movement'; availableMovements = ['left', 'right']; }
  else if (['aim', 'volley'].includes(definition.mechanic) && rangeBand(state) === 'Close') reasonCode = 'NEEDS_NEAR_OR_FAR';
  return { cardInstanceId: card.id, enabled: reasonCode === null, reasonCode, reason: reasonCode ? REASONS[reasonCode] : null, selection, eligibleCardInstanceIds, movements: availableMovements };
}
export function listActionAvailability(state: GameState, playerId: PlayerId): ActionAvailability[] {
  return state.players[playerId].deck.hand.map((card) => cardAvailability(state, playerId, card));
}
function cardActions(state: GameState): LegalAction[] {
  const playerId = state.activePlayerId;
  const hand = state.players[playerId].deck.hand;
  return hand.flatMap((card) => {
    const available = cardAvailability(state, playerId, card);
    if (!available.enabled) return [];
    const definition = cardDefinition(card.definitionId);
    switch (definition.mechanic) {
      case 'money': return [];
      case 'footwork': return available.movements.map((movement) => legal(`Play Footwork: ${movement === 'left' ? 'Left' : 'Right'}`, { type: 'playFootwork', cardInstanceId: card.id, movement }));
      case 'cull': {
        const other = hand.filter((candidate) => candidate.id !== card.id);
        const actions: LegalAction[] = other.map((candidate) => legal(`Play Cull: trash Cull and ${cardDefinition(candidate.definitionId).name}`, { type: 'playCull', cardInstanceId: card.id, trashInstanceIds: [card.id, candidate.id] }));
        for (let left = 0; left < other.length; left += 1) for (let right = left + 1; right < other.length; right += 1) {
          actions.push(legal(`Play Cull: trash ${cardDefinition(other[left]!.definitionId).name} and ${cardDefinition(other[right]!.definitionId).name}`, { type: 'playCull', cardInstanceId: card.id, trashInstanceIds: [other[left]!.id, other[right]!.id] }));
        }
        return actions;
      }
      case 'muster': return [legal('Play Muster', { type: 'playMuster', cardInstanceId: card.id })];
      case 'feint': return [legal('Play Feint', { type: 'playFeint', cardInstanceId: card.id })];
      case 'drive': return available.movements.map((direction) => legal(`Play Drive: Push ${direction === 'left' ? 'Left' : 'Right'}`, { type: 'playDrive', cardInstanceId: card.id, direction }));
      case 'flurry': return [legal('Play Flurry', { type: 'playFlurry', cardInstanceId: card.id })];
      case 'aim': return [legal('Play Aim', { type: 'playAim', cardInstanceId: card.id })];
      case 'volley': return [legal('Play Volley', { type: 'playVolley', cardInstanceId: card.id })];
    }
  });
}
function buyActions(state: GameState): LegalAction[] {
  const money = state.players[state.activePlayerId].money;
  const actions = MARKET_CARD_IDS.flatMap((definitionId) => {
    const definition = cardDefinition(definitionId);
    const available = definition.type === 'treasure' || (state.supply[definitionId] ?? 0) > 0;
    return available && definition.cost <= money ? [legal(`Buy ${definition.name}`, { type: 'buyCard' as const, definitionId })] : [];
  });
  return [...actions, legal('End Buy phase', { type: 'endBuyPhase' })];
}
export function listLegalActions(state: GameState): LegalAction[] {
  if (state.phase === 'startingBuild' || state.phase === 'ended') return [];
  if (state.phase === 'buy') return ids(state, buyActions(state));
  return ids(state, [...cardActions(state), legal('End Action phase', { type: 'endActionPhase' })]);
}
function takeCard(state: GameState, cardInstanceId: string): CardInstance {
  const deck = state.players[state.activePlayerId].deck;
  const index = deck.hand.findIndex((card) => card.id === cardInstanceId);
  if (index < 0) throw new Error(`Card is not in hand: ${cardInstanceId}`);
  const [card] = deck.hand.splice(index, 1);
  if (!card) throw new Error(`Card is not in hand: ${cardInstanceId}`);
  deck.play.push(card);
  return card;
}
function draw(state: GameState, playerId: PlayerId, count: number): void {
  const deck = state.players[playerId].deck;
  const random = new SeededRandom(state.rngState);
  let drawn = 0;
  while (drawn < count) {
    if (!deck.draw.length) {
      if (!deck.discard.length) break;
      deck.draw = shuffle(deck.discard, random); deck.discard = [];
    }
    const card = deck.draw.shift(); if (!card) break;
    deck.hand.push(card); drawn += 1;
  }
  state.rngState = random.snapshot();
  if (drawn) record(state, 'draw', { count: drawn }, playerId);
}
function dealDamage(state: GameState, targetId: PlayerId, base: number, closeDamage: boolean): void {
  const target = state.fighters[targetId];
  let amount = base;
  if (closeDamage && target.exposed) { amount += 2; target.exposed = false; record(state, 'condition', { condition: 'Exposed', change: 'consumed', targetId }); }
  target.health = Math.max(0, target.health - amount);
  record(state, 'damage', { targetId, amount, health: target.health });
  if (target.health === 0) { state.winner = opponent(targetId); state.phase = 'ended'; record(state, 'victory', { winner: state.winner }); }
}
function playCard(state: GameState, command: Extract<GameCommand, { cardInstanceId: string }>): void {
  const actorId = state.activePlayerId;
  const targetId = opponent(actorId);
  const previousActions = state.actionsThisTurn.length;
  const card = takeCard(state, command.cardInstanceId);
  state.actionsThisTurn.push(card.id);
  record(state, 'cardPlayed', { cardInstanceId: card.id, definitionId: card.definitionId });
  switch (command.type) {
    case 'playFootwork': {
      const actor = state.fighters[actorId]; const from = actor.position;
      actor.position += command.movement === 'left' ? -1 : 1;
      record(state, 'move', { movement: command.movement, from, to: actor.position }); draw(state, actorId, 1); break;
    }
    case 'playCull': {
      const deck = state.players[actorId].deck;
      for (const id of command.trashInstanceIds) {
        let index = deck.hand.findIndex((candidate) => candidate.id === id); let zone = deck.hand;
        if (index < 0 && id === card.id) { zone = deck.play; index = zone.findIndex((candidate) => candidate.id === id); }
        if (index < 0) throw new Error('Cull target is no longer eligible.');
        const [trashed] = zone.splice(index, 1); if (!trashed) throw new Error('Cull target is no longer eligible.');
        state.trash.push(trashed); record(state, 'trash', { cardInstanceId: trashed.id, definitionId: trashed.definitionId });
      }
      break;
    }
    case 'playMuster': draw(state, actorId, 2); break;
    case 'playFeint': state.fighters[targetId].exposed = true; record(state, 'condition', { condition: 'Exposed', change: 'set', targetId }); break;
    case 'playDrive': {
      dealDamage(state, targetId, 2, true); if (state.winner) break;
      const target = state.fighters[targetId]; const destination = target.position + (command.direction === 'left' ? -1 : 1);
      if (destination < 1 || destination > 5) { record(state, 'wallCollision', { targetId, direction: command.direction }); dealDamage(state, targetId, 2, false); }
      else { target.position = destination; record(state, 'push', { targetId, direction: command.direction, to: destination }); }
      break;
    }
    case 'playFlurry': dealDamage(state, targetId, Math.min(5, previousActions), rangeBand(state) === 'Close'); break;
    case 'playAim': state.fighters[actorId].aimed = true; record(state, 'condition', { condition: 'Aimed', change: 'set', targetId: actorId }); draw(state, actorId, 1); break;
    case 'playVolley': {
      const aimed = state.fighters[actorId].aimed; const band = rangeBand(state);
      const amount = aimed ? (band === 'Near' ? 5 : 7) : (band === 'Near' ? 2 : 5);
      if (aimed) { state.fighters[actorId].aimed = false; record(state, 'condition', { condition: 'Aimed', change: 'consumed', targetId: actorId }); }
      dealDamage(state, targetId, amount, false); break;
    }
  }
}
function finishSetup(state: GameState): void {
  const random = new SeededRandom(state.rngState);
  for (const playerId of ['ochre', 'indigo'] as const) {
    const selected = state.players[playerId].startingBuild!;
    const definitions = [...Array<string>(7).fill('copper'), ...selected];
    state.players[playerId].deck.draw = definitions.map((definitionId) => createCard(state, definitionId));
    state.players[playerId].firstBuyMoney = 12 - selected.reduce((total, id) => total + cardDefinition(id).cost, 0);
  }
  state.players.ochre.deck.draw = shuffle(state.players.ochre.deck.draw, random);
  state.players.indigo.deck.draw = shuffle(state.players.indigo.deck.draw, random);
  state.rngState = random.snapshot();
  draw(state, 'ochre', 5); draw(state, 'indigo', 5);
  state.phase = 'action'; state.activePlayerId = state.selectedFirstPlayerId; state.turn = 1;
  record(state, 'turn', { turn: 1, activePlayerId: state.activePlayerId });
}
function submitBuild(state: GameState, command: Extract<GameCommand, { type: 'submitStartingBuild' }>): void {
  if (state.phase !== 'startingBuild' || state.activePlayerId !== command.playerId) throw new Error('This starting build cannot be submitted now.');
  if (state.players[command.playerId].startingBuild) throw new Error('The starting build is already complete.');
  let cost = 0;
  for (const id of command.definitionIds) { cardDefinition(id); cost += cardDefinition(id).cost; }
  if (cost > 12) throw new Error('Starting build costs more than 12 money.');
  state.players[command.playerId].startingBuild = [...command.definitionIds];
  record(state, 'buildComplete', { playerId: command.playerId, count: command.definitionIds.length, cost }, command.playerId);
  if (command.playerId === 'ochre') state.activePlayerId = 'indigo'; else finishSetup(state);
}
function execute(state: GameState, command: GameCommand): void {
  if (command.type === 'submitStartingBuild') { submitBuild(state, command); return; }
  if ('cardInstanceId' in command) { playCard(state, command); return; }
  const player = state.players[state.activePlayerId];
  switch (command.type) {
    case 'endActionPhase': {
      const treasures = player.deck.hand.filter((card) => cardDefinition(card.definitionId).type === 'treasure');
      player.deck.hand = player.deck.hand.filter((card) => cardDefinition(card.definitionId).type !== 'treasure');
      player.deck.play.push(...treasures);
      player.money = treasures.reduce((total, card) => total + (cardDefinition(card.definitionId).money ?? 0), 0) + (player.firstBuyPending ? player.firstBuyMoney : 0);
      state.phase = 'buy'; record(state, 'phase', { phase: 'buy', money: player.money }); break;
    }
    case 'buyCard': {
      const definition = cardDefinition(command.definitionId);
      player.money -= definition.cost;
      if (definition.type === 'action') state.supply[command.definitionId]!--;
      const card = createCard(state, command.definitionId); player.deck.discard.push(card); player.purchases.push(command.definitionId);
      record(state, 'purchase', { definitionId: command.definitionId, cost: definition.cost }); break;
    }
    case 'endBuyPhase': {
      player.deck.discard.push(...player.deck.hand, ...player.deck.play); player.deck.hand = []; player.deck.play = [];
      player.money = 0; player.firstBuyPending = false; player.firstBuyMoney = 0;
      state.fighters[state.activePlayerId].aimed = false; state.fighters[opponent(state.activePlayerId)].exposed = false;
      draw(state, state.activePlayerId, 5); state.actionsThisTurn = [];
      state.activePlayerId = opponent(state.activePlayerId); state.phase = 'action'; state.turn += 1;
      record(state, 'turn', { turn: state.turn, activePlayerId: state.activePlayerId }); break;
    }
  }
}
export function applyAction(state: GameState, id: string): GameState {
  const selected = listLegalActions(state).find((action) => action.id === id);
  if (!selected) throw new Error(`Unknown or stale legal action: ${id}`);
  const next = cloneGame(state); execute(next, selected.command); next.version += 1; return next;
}
export function applyCommand(state: GameState, command: GameCommand): GameState {
  const next = cloneGame(state);
  if (command.type === 'submitStartingBuild') { execute(next, command); next.version += 1; return next; }
  const action = listLegalActions(state).find((candidate) => key(candidate.command) === key(command));
  if (!action) throw new Error(`Illegal command: ${key(command)}`);
  return applyAction(state, action.id);
}
export function submitStartingBuild(state: GameState, playerId: PlayerId, definitionIds: string[]): GameState {
  return applyCommand(state, { type: 'submitStartingBuild', playerId, definitionIds });
}
export function replayCommands(initialState: GameState, commands: readonly GameCommand[]): GameState {
  return commands.reduce((state, command) => applyCommand(state, command), cloneGame(initialState));
}
export function marketCost(definitionIds: readonly string[]): number { return definitionIds.reduce((sum, id) => sum + cardDefinition(id).cost, 0); }
