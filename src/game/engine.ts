import { ARENA_MAX, ARENA_MIN, EFFECTS } from './effects';
import { kingdomMarket, resolveCard } from './kingdom';
import type { Choice, EffectContext } from './effects';
import { SeededRandom, shuffle } from './random';
import { cloneGame, createCard, opponent } from './state';
import type {
  ActionAvailability, CardDefinition, CardInstance, CardValues, DisabledReasonCode, GameCommand, GameEventType,
  GameState, LegalAction, MovementChoice, PendingChoice, PendingChoiceType, PlayCardCommand, PlayerId
} from './types';

const REASONS: Record<DisabledReasonCode, string> = {
  NOT_YOUR_TURN: 'It is not your turn.', WRONG_PHASE: 'This card cannot be played in this phase.',
  TREASURE_AUTOPLAYS: 'Treasure cards play when you end the Action phase.', NEEDS_CLOSE: 'Requires Close range.',
  NEEDS_NEAR_OR_FAR: 'Requires Near or Far range.', NEEDS_MANA: 'Requires more mana.',
  RESOLVE_CHOICE_FIRST: 'Resolve the pending choice first.'
};
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
function key(command: GameCommand): string { return JSON.stringify(stable(command)); }
function legal(label: string, command: GameCommand): LegalAction { return { id: '', label, command }; }
function ids(state: GameState, actions: LegalAction[]): LegalAction[] { return actions.map((action, index) => ({ ...action, id: `v${state.version}-action-${index + 1}` })); }
function cardValues(definition: CardDefinition): CardValues { return definition.values ?? {}; }
function movementText(movement: MovementChoice): string { return movement === 'left' ? 'Left' : movement === 'right' ? 'Right' : 'Stay'; }
function record(state: GameState, type: GameEventType, detail: Record<string, unknown>, playerId = state.activePlayerId): void {
  // Frozen so `cloneGame` can share it: an event is a record of the past and is never edited.
  state.events.push(Object.freeze({ sequence: state.events.length, type, playerId, detail: Object.freeze(detail) }));
}
function choiceTargets(state: GameState, pending: PendingChoice): CardInstance[] {
  const deck = state.players[pending.playerId].deck;
  return pending.type === 'discard' ? deck.hand : deck.discard;
}
function cardAvailability(state: GameState, playerId: PlayerId, card: CardInstance): ActionAvailability {
  const definition = resolveCard(state, card.definitionId);
  const effect = EFFECTS[definition.mechanic];
  const pending = state.pendingChoice;
  let reasonCode: DisabledReasonCode | null = null;
  let selection: ActionAvailability['selection'] = 'none';
  let eligibleCardInstanceIds: string[] = [];
  let availableMovements: MovementChoice[] = [];
  if (state.activePlayerId !== playerId) reasonCode = 'NOT_YOUR_TURN';
  else if (state.phase !== 'action') reasonCode = 'WRONG_PHASE';
  else if (definition.type === 'treasure') reasonCode = 'TREASURE_AUTOPLAYS';
  else if (pending) {
    reasonCode = 'RESOLVE_CHOICE_FIRST'; selection = pending.type;
    eligibleCardInstanceIds = choiceTargets(state, pending).map((target) => target.id);
  } else {
    reasonCode = effect.gate(state, playerId, cardValues(definition));
    if (!reasonCode) {
      selection = effect.choice; availableMovements = effect.movements(state, playerId);
      if (effect.choice === 'trashOneOrTwo') eligibleCardInstanceIds = [card.id, ...state.players[playerId].deck.hand.filter((candidate) => candidate.id !== card.id).map((candidate) => candidate.id)];
    }
  }
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
    const definition = resolveCard(state, card.definitionId);
    const effect = EFFECTS[definition.mechanic];
    const moveLabel = (movement: MovementChoice): string => `Play ${definition.name}: ${effect.movePrefix}${movementText(movement)}`;
    switch (effect.choice) {
      case 'none': return [legal(`Play ${definition.name}`, effect.command(card.id, {}))];
      case 'movement': return available.movements.map((movement) => legal(moveLabel(movement), effect.command(card.id, { movement })));
      case 'direction': return available.movements.flatMap((movement) => movement === 'stay' ? [] : [legal(moveLabel(movement), effect.command(card.id, { direction: movement }))]);
      case 'trashOneOrTwo': {
        const eligible = [card, ...hand.filter((candidate) => candidate.id !== card.id)];
        const actions: LegalAction[] = eligible.map((candidate) => legal(`Play ${definition.name}: trash ${resolveCard(state, candidate.definitionId).name}`, effect.command(card.id, { trashInstanceIds: [candidate.id] })));
        for (let left = 0; left < eligible.length; left += 1) for (let right = left + 1; right < eligible.length; right += 1) {
          actions.push(legal(`Play ${definition.name}: trash ${resolveCard(state, eligible[left]!.definitionId).name} and ${resolveCard(state, eligible[right]!.definitionId).name}`, effect.command(card.id, { trashInstanceIds: [eligible[left]!.id, eligible[right]!.id] })));
        }
        return actions;
      }
    }
  });
}
function resolveActions(state: GameState, pending: PendingChoice): LegalAction[] {
  const targets = choiceTargets(state, pending);
  if (pending.type === 'discard') return targets.map((card) => legal(`Discard ${resolveCard(state, card.definitionId).name}`, { type: 'resolveDiscard', discardInstanceId: card.id }));
  return [
    ...targets.map((card) => legal(`Recover ${resolveCard(state, card.definitionId).name}`, { type: 'resolveRecover', recoverInstanceId: card.id })),
    legal('Recover nothing', { type: 'resolveRecover', recoverInstanceId: null })
  ];
}
function buyActions(state: GameState): LegalAction[] {
  const money = state.players[state.activePlayerId].money;
  const actions = kingdomMarket(state.kingdomId).flatMap((definition) => {
    const available = definition.type === 'treasure' || (state.supply[definition.id] ?? 0) > 0;
    return available && definition.cost <= money ? [legal(`Buy ${definition.name}`, { type: 'buyCard' as const, definitionId: definition.id })] : [];
  });
  return [...actions, legal('End Buy phase', { type: 'endBuyPhase' })];
}
export function listLegalActions(state: GameState): LegalAction[] {
  if (state.phase === 'startingBuild' || state.phase === 'ended') return [];
  if (state.phase === 'buy') return ids(state, buyActions(state));
  if (state.pendingChoice) return ids(state, resolveActions(state, state.pendingChoice));
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
  if (closeDamage && target.exposed) {
    amount += cardValues(resolveCard(state, 'feint')).bonus ?? 0; target.exposed = false;
    record(state, 'condition', { condition: 'Exposed', change: 'consumed', targetId });
  }
  target.health = Math.max(0, target.health - amount);
  record(state, 'damage', { targetId, amount, health: target.health });
  if (target.health === 0) { state.winner = opponent(targetId); state.phase = 'ended'; record(state, 'victory', { winner: state.winner }); }
}
function moveFighter(state: GameState, playerId: PlayerId, position: number): void {
  const fighter = state.fighters[playerId];
  if (position < ARENA_MIN || position > ARENA_MAX) throw new Error('A fighter cannot leave the arena.');
  if (fighter.position === position) return;
  fighter.position = position;
  if (playerId === state.activePlayerId) state.players[playerId].positionChanged = true;
}
function gainMana(state: GameState, playerId: PlayerId, amount: number): void {
  if (!amount) return;
  const player = state.players[playerId];
  if (player.mana + amount < 0) throw new Error('There is not enough mana.');
  player.mana += amount;
  record(state, 'mana', { amount, mana: player.mana }, playerId);
}
function trashCard(state: GameState, playedCard: CardInstance, cardInstanceId: string): void {
  const deck = state.players[state.activePlayerId].deck;
  let zone = deck.hand;
  let index = zone.findIndex((candidate) => candidate.id === cardInstanceId);
  if (index < 0 && cardInstanceId === playedCard.id) { zone = deck.play; index = zone.findIndex((candidate) => candidate.id === cardInstanceId); }
  if (index < 0) throw new Error('Cull target is no longer eligible.');
  const [trashed] = zone.splice(index, 1); if (!trashed) throw new Error('Cull target is no longer eligible.');
  state.trash.push(trashed); record(state, 'trash', { cardInstanceId: trashed.id, definitionId: trashed.definitionId });
}
function requestChoice(state: GameState, type: PendingChoiceType, playerId: PlayerId, remaining: number): void {
  if (remaining <= 0) return;
  const pending: PendingChoice = { type, playerId, remaining };
  if (!choiceTargets(state, pending).length) return;
  state.pendingChoice = pending;
}
function advanceChoice(state: GameState, pending: PendingChoice): void {
  state.pendingChoice = null;
  requestChoice(state, pending.type, pending.playerId, pending.remaining - 1);
}
function takePendingChoice(state: GameState, type: PendingChoiceType): PendingChoice {
  const pending = state.pendingChoice;
  if (!pending || pending.type !== type) throw new Error(`There is no ${type} choice to resolve.`);
  return pending;
}
function choiceOf(command: PlayCardCommand): Choice {
  return {
    movement: 'movement' in command ? command.movement : undefined,
    direction: 'direction' in command ? command.direction : undefined,
    trashInstanceIds: 'trashInstanceIds' in command ? command.trashInstanceIds : undefined
  };
}
function playCard(state: GameState, command: PlayCardCommand): void {
  const actorId = state.activePlayerId;
  const previousActions = [...state.actionsThisTurn];
  const card = takeCard(state, command.cardInstanceId);
  state.actionsThisTurn.push(card.definitionId);
  record(state, 'cardPlayed', { cardInstanceId: card.id, definitionId: card.definitionId });
  const definition = resolveCard(state, card.definitionId);
  const context: EffectContext = {
    state, actorId, targetId: opponent(actorId), card, previousActions,
    draw: (playerId, count) => draw(state, playerId, count),
    damage: (targetId, amount, closeDamage) => dealDamage(state, targetId, amount, closeDamage),
    move: (playerId, position) => moveFighter(state, playerId, position),
    trash: (cardInstanceId) => trashCard(state, card, cardInstanceId),
    gainMana: (amount) => gainMana(state, actorId, amount),
    requestChoice: (type, remaining) => requestChoice(state, type, actorId, remaining),
    record: (type, detail) => record(state, type, detail)
  };
  EFFECTS[definition.mechanic].resolve(context, cardValues(definition), choiceOf(command));
}
function resolveDiscard(state: GameState, command: Extract<GameCommand, { type: 'resolveDiscard' }>): void {
  const pending = takePendingChoice(state, 'discard');
  const deck = state.players[pending.playerId].deck;
  const index = deck.hand.findIndex((card) => card.id === command.discardInstanceId);
  if (index < 0) throw new Error(`Card is not in hand: ${command.discardInstanceId}`);
  const [card] = deck.hand.splice(index, 1); if (!card) throw new Error(`Card is not in hand: ${command.discardInstanceId}`);
  deck.discard.push(card); record(state, 'discard', { cardInstanceId: card.id, definitionId: card.definitionId }, pending.playerId);
  advanceChoice(state, pending);
}
function resolveRecover(state: GameState, command: Extract<GameCommand, { type: 'resolveRecover' }>): void {
  const pending = takePendingChoice(state, 'recover');
  if (command.recoverInstanceId !== null) {
    const deck = state.players[pending.playerId].deck;
    const index = deck.discard.findIndex((card) => card.id === command.recoverInstanceId);
    if (index < 0) throw new Error(`Card is not in the discard pile: ${command.recoverInstanceId}`);
    const [card] = deck.discard.splice(index, 1); if (!card) throw new Error(`Card is not in the discard pile: ${command.recoverInstanceId}`);
    deck.draw.unshift(card); record(state, 'recover', { cardInstanceId: card.id, definitionId: card.definitionId }, pending.playerId);
  }
  advanceChoice(state, pending);
}
function finishSetup(state: GameState): void {
  const random = new SeededRandom(state.rngState);
  for (const playerId of ['ochre', 'indigo'] as const) {
    const selected = state.players[playerId].startingBuild!;
    const definitions = [...Array<string>(7).fill('copper'), ...selected];
    state.players[playerId].deck.draw = definitions.map((definitionId) => createCard(state, definitionId));
    state.players[playerId].firstBuyMoney = 12 - marketCost(state, selected);
    state.players[playerId].positionChanged = false;
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
  const offered = new Set(kingdomMarket(state.kingdomId).map((definition) => definition.id));
  for (const id of command.definitionIds) if (!offered.has(resolveCard(state, id).id)) throw new Error(`This kingdom does not sell ${id}.`);
  const cost = marketCost(state, command.definitionIds);
  if (cost > 12) throw new Error('Starting build costs more than 12 money.');
  state.players[command.playerId].startingBuild = [...command.definitionIds];
  record(state, 'buildComplete', { playerId: command.playerId, count: command.definitionIds.length, cost }, command.playerId);
  if (command.playerId === 'ochre') state.activePlayerId = 'indigo'; else finishSetup(state);
}
function execute(state: GameState, command: GameCommand): void {
  switch (command.type) {
    case 'submitStartingBuild': submitBuild(state, command); return;
    case 'playFootwork': case 'playCull': case 'playMuster': case 'playFeint': case 'playDrive':
    case 'playFlurry': case 'playAim': case 'playVolley': case 'playAction': case 'playMoveAction':
      playCard(state, command); return;
    case 'resolveDiscard': resolveDiscard(state, command); return;
    case 'resolveRecover': resolveRecover(state, command); return;
    case 'endActionPhase': {
      const player = state.players[state.activePlayerId];
      const treasures = player.deck.hand.filter((card) => resolveCard(state, card.definitionId).type === 'treasure');
      player.deck.hand = player.deck.hand.filter((card) => resolveCard(state, card.definitionId).type !== 'treasure');
      player.deck.play.push(...treasures);
      player.money += treasures.reduce((total, card) => total + (resolveCard(state, card.definitionId).money ?? 0), 0) + (player.firstBuyPending ? player.firstBuyMoney : 0);
      player.mana = 0;
      state.phase = 'buy'; record(state, 'phase', { phase: 'buy', money: player.money }); return;
    }
    case 'buyCard': {
      const player = state.players[state.activePlayerId];
      const definition = resolveCard(state, command.definitionId);
      player.money -= definition.cost;
      if (definition.type === 'action') state.supply[command.definitionId]!--;
      const card = createCard(state, command.definitionId); player.deck.discard.push(card); player.purchases.push(command.definitionId);
      record(state, 'purchase', { definitionId: command.definitionId, cost: definition.cost }); return;
    }
    case 'endBuyPhase': {
      const player = state.players[state.activePlayerId];
      player.deck.discard.push(...player.deck.hand, ...player.deck.play); player.deck.hand = []; player.deck.play = [];
      player.money = 0; player.mana = 0; player.firstBuyPending = false; player.firstBuyMoney = 0;
      state.fighters[state.activePlayerId].aimed = false; state.fighters[opponent(state.activePlayerId)].exposed = false;
      draw(state, state.activePlayerId, 5); state.actionsThisTurn = [];
      state.activePlayerId = opponent(state.activePlayerId); state.phase = 'action'; state.turn += 1;
      state.players[state.activePlayerId].positionChanged = false;
      record(state, 'turn', { turn: state.turn, activePlayerId: state.activePlayerId }); return;
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
export function marketCost(state: GameState, definitionIds: readonly string[]): number {
  return definitionIds.reduce((sum, id) => sum + resolveCard(state, id).cost, 0);
}
