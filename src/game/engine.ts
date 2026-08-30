import { ARENA_MAX, ARENA_MIN, EFFECTS } from './effects';
import { MAX_CARRIED_MANA, STARTING_BUDGET, STARTING_DECK_COPPER_COUNT, firstBuyCarry } from './config';
import { kingdomMarket, resolveCard } from './kingdom';
import type { Choice, EffectContext, TargetMetadata } from './effects';
import { SeededRandom, shuffle } from './random';
import { cloneGame, createCard, emptyTurnState, opponent } from './state';
import type {
  ActionAvailability, CardDefinition, CardInstance, CardValues, DisabledReasonCode, GameCommand, GameEventType,
  GameState, LegalAction, MovementChoice, PendingChoice, PlayCardCommand, PlayerId
} from './types';

const SPELL_IDS = new Set(['arcBolt', 'fireball', 'starfire', 'discharge', 'cascade', 'overload']);
const REASONS: Record<DisabledReasonCode, string> = {
  NOT_YOUR_TURN: 'It is not your turn.', WRONG_PHASE: 'This card cannot be played in this phase.',
  TREASURE_AUTOPLAYS: 'Treasure cards play when you end the Action phase.', NEEDS_CLOSE: 'Requires Close range.',
  NEEDS_NEAR_OR_FAR: 'Requires Near or Far range.', NEEDS_MANA: 'Requires more mana.',
  NEEDS_TARGET: 'Requires an eligible card target.', RESOLVE_CHOICE_FIRST: 'Resolve the pending choice first.'
};
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
function key(command: GameCommand): string { return JSON.stringify(stable(command)); }
function legal(label: () => string, command: GameCommand): LegalAction {
  const action = { id: '', command } as LegalAction;
  Object.defineProperty(action, 'label', { enumerable: true, get: label }); return action;
}
function ids(state: GameState, actions: LegalAction[]): LegalAction[] { actions.forEach((action, index) => { action.id = `v${state.version}-action-${index + 1}`; }); return actions; }
function values(definition: CardDefinition): CardValues { return definition.values ?? {}; }
function movementText(movement: MovementChoice): string { return movement === 'left' ? 'Left' : movement === 'right' ? 'Right' : 'Stay'; }
function record(state: GameState, type: GameEventType, detail: Record<string, unknown>, playerId = state.activePlayerId): void {
  state.events.push({ sequence: state.events.length, type, playerId, detail });
}
function combinations<T>(items: readonly T[], minimum: number, maximum: number): T[][] {
  const result: T[][] = [];
  function visit(start: number, selected: T[]): void {
    if (selected.length >= minimum) result.push([...selected]);
    if (selected.length === maximum) return;
    for (let index = start; index < items.length; index += 1) { selected.push(items[index]!); visit(index + 1, selected); selected.pop(); }
  }
  visit(0, []); return result;
}
function targetCandidates(state: GameState, actorId: PlayerId, playedCard: CardInstance, target: TargetMetadata): CardInstance[] {
  const hand = state.players[actorId].deck.hand.filter((card) => card.id !== playedCard.id);
  const candidates = target.zone === 'handOrSelf' ? [playedCard, ...hand] : hand;
  return target.family ? candidates.filter((card) => resolveCard(state, card.definitionId).family === target.family) : candidates;
}
function pendingTargets(state: GameState, pending: PendingChoice): CardInstance[] {
  const deck = state.players[pending.playerId].deck;
  if (pending.type === 'discard') return deck.hand;
  if (pending.type === 'recover') return deck.discard;
  if (pending.type === 'optionalTrash') return [...deck.hand, ...deck.play.filter((card) => card.id === pending.sourceCardInstanceId)];
  return [];
}
function cardAvailability(state: GameState, playerId: PlayerId, card: CardInstance): ActionAvailability {
  const definition = resolveCard(state, card.definitionId); const effect = EFFECTS[definition.mechanic];
  let reasonCode: DisabledReasonCode | null = null;
  let selection: ActionAvailability['selection'] = 'none'; let eligible: string[] = []; let moves: MovementChoice[] = [];
  let minimumTargets = 0; let maximumTargets = 0;
  if (state.activePlayerId !== playerId) reasonCode = 'NOT_YOUR_TURN';
  else if (state.phase !== 'action') reasonCode = 'WRONG_PHASE';
  else if (definition.type === 'treasure') reasonCode = 'TREASURE_AUTOPLAYS';
  else if (state.pendingChoice) { reasonCode = 'RESOLVE_CHOICE_FIRST'; selection = state.pendingChoice.type; eligible = pendingTargets(state, state.pendingChoice).map((target) => target.id); }
  else {
    reasonCode = effect.gate(state, playerId, values(definition)); selection = effect.choice; moves = effect.movements(state, playerId);
    if (effect.target) {
      minimumTargets = effect.target.minimum; maximumTargets = effect.target.maximum;
      eligible = targetCandidates(state, playerId, card, effect.target).map((target) => target.id);
      if (!reasonCode && eligible.length < minimumTargets) reasonCode = 'NEEDS_TARGET';
    }
  }
  return { cardInstanceId: card.id, enabled: reasonCode === null, reasonCode, reason: reasonCode ? REASONS[reasonCode] : null,
    selection, eligibleCardInstanceIds: eligible, movements: moves, minimumTargets, maximumTargets };
}
export function listActionAvailability(state: GameState, playerId: PlayerId): ActionAvailability[] { return state.players[playerId].deck.hand.map((card) => cardAvailability(state, playerId, card)); }
function cardActions(state: GameState): LegalAction[] {
  const playerId = state.activePlayerId; const hand = state.players[playerId].deck.hand;
  return hand.flatMap((card) => {
    const available = cardAvailability(state, playerId, card); if (!available.enabled) return [];
    const definition = resolveCard(state, card.definitionId); const effect = EFFECTS[definition.mechanic];
    const moveLabel = (movement: MovementChoice): string => `Play ${definition.name}: ${effect.movePrefix}${movementText(movement)}`;
    if (effect.choice === 'none') return [legal(() => `Play ${definition.name}`, effect.command(card.id, {}))];
    if (effect.choice === 'movement') return available.movements.map((movement) => legal(() => moveLabel(movement), effect.command(card.id, { movement })));
    if (effect.choice === 'direction') return available.movements.flatMap((movement) => movement === 'stay' ? [] : [legal(() => moveLabel(movement), effect.command(card.id, { direction: movement }))]);
    const candidates = targetCandidates(state, playerId, card, effect.target!);
    return combinations(candidates, effect.target!.minimum, effect.target!.maximum).map((targets) => legal(
      () => targets.length ? `Play ${definition.name}: target ${targets.map((target) => resolveCard(state, target.definitionId).name).join(' and ')}` : `Play ${definition.name}: no targets`,
      effect.command(card.id, { targetCardInstanceIds: targets.map((target) => target.id) })
    ));
  });
}
function resolveActions(state: GameState, pending: PendingChoice): LegalAction[] {
  if (pending.type === 'discard') return pendingTargets(state, pending).map((card) => legal(() => `Discard ${resolveCard(state, card.definitionId).name}`, { type: 'resolveDiscard', discardInstanceId: card.id }));
  if (pending.type === 'recover') return pendingTargets(state, pending).map((card) => legal(() => `Recover ${resolveCard(state, card.definitionId).name}`, { type: 'resolveRecover', recoverInstanceId: card.id }));
  if (pending.type === 'optionalTrash') return [
    ...pendingTargets(state, pending).map((card) => legal(() => `Trash ${resolveCard(state, card.definitionId).name}`, { type: 'resolveOptionalTrash', trashInstanceId: card.id })),
    legal(() => 'Trash nothing', { type: 'resolveOptionalTrash', trashInstanceId: null })
  ];
  const maxCost = pending.maxCost;
  return kingdomMarket(state.kingdomId).filter((definition) => definition.id !== 'scrap' && definition.cost <= maxCost
    && (definition.type === 'treasure' || (state.supply[definition.id] ?? 0) > 0))
    .map((definition) => legal(() => `Gain ${definition.name}`, { type: 'resolveGain', definitionId: definition.id }));
}
function buyActions(state: GameState): LegalAction[] {
  const money = state.players[state.activePlayerId].money;
  const actions = kingdomMarket(state.kingdomId).flatMap((definition) => (definition.type === 'treasure' || (state.supply[definition.id] ?? 0) > 0) && definition.cost <= money
    ? [legal(() => `Buy ${definition.name}`, { type: 'buyCard' as const, definitionId: definition.id })] : []);
  return [...actions, legal(() => 'End Buy phase', { type: 'endBuyPhase' })];
}
export function listLegalActions(state: GameState): LegalAction[] {
  if (state.phase === 'startingBuild' || state.phase === 'ended') return [];
  if (state.phase === 'buy') return ids(state, buyActions(state));
  if (state.pendingChoice) return ids(state, resolveActions(state, state.pendingChoice));
  return ids(state, [...cardActions(state), legal(() => 'End Action phase', { type: 'endActionPhase' })]);
}
function takeCard(state: GameState, id: string): CardInstance {
  const deck = state.players[state.activePlayerId].deck; const index = deck.hand.findIndex((card) => card.id === id);
  if (index < 0) throw new Error(`Card is not in hand: ${id}`); const [card] = deck.hand.splice(index, 1); deck.play.push(card!); return card!;
}
function draw(state: GameState, playerId: PlayerId, count: number): void {
  const deck = state.players[playerId].deck; const random = new SeededRandom(state.rngState); let drawn = 0;
  while (drawn < count) { if (!deck.draw.length) { if (!deck.discard.length) break; deck.draw = shuffle(deck.discard, random); deck.discard = []; } const card = deck.draw.shift(); if (!card) break; deck.hand.push(card); drawn += 1; }
  state.rngState = random.snapshot(); if (drawn) record(state, 'draw', { count: drawn }, playerId);
}
function dealDamage(state: GameState, targetId: PlayerId, base: number, close: boolean): void {
  const target = state.fighters[targetId]; const amount = base + (close && target.exposed ? (values(resolveCard(state, 'feint')).bonus ?? 0) : 0);
  target.health = Math.max(0, target.health - amount); record(state, 'damage', { targetId, amount, health: target.health });
  if (target.health === 0) { state.winner = opponent(targetId); state.phase = 'ended'; record(state, 'victory', { winner: state.winner }); }
}
function rangedDamage(state: GameState, actorId: PlayerId, targetId: PlayerId, base: number): void {
  const fighter = state.fighters[actorId]; const amount = base + (fighter.aimed ? (values(resolveCard(state, 'aim')).bonus ?? 0) : 0);
  if (fighter.aimed) { fighter.aimed = false; record(state, 'condition', { condition: 'Aimed', change: 'consumed', targetId: actorId }); }
  dealDamage(state, targetId, amount, false);
}
function moveFighter(state: GameState, playerId: PlayerId, position: number): void {
  const fighter = state.fighters[playerId]; if (position < ARENA_MIN || position > ARENA_MAX) throw new Error('A fighter cannot leave the arena.');
  if (fighter.position === position) return; const distance = Math.abs(position - fighter.position); fighter.position = position;
  if (playerId === state.activePlayerId) { state.players[playerId].positionChanged = true; state.turnState.spacesMoved += distance; }
}
function changeMana(state: GameState, playerId: PlayerId, amount: number, spent: boolean): void {
  const player = state.players[playerId]; if (player.mana + amount < 0) throw new Error('There is not enough mana.');
  if (spent) state.turnState.manaSpent += -amount; player.mana += amount; if (amount) record(state, 'mana', { amount, mana: player.mana }, playerId);
}
function findTargetZone(state: GameState, source: CardInstance, id: string): { zone: CardInstance[]; index: number } {
  const deck = state.players[state.activePlayerId].deck; let zone = deck.hand; let index = zone.findIndex((card) => card.id === id);
  if (index < 0 && id === source.id) { zone = deck.play; index = zone.findIndex((card) => card.id === id); }
  if (index < 0) throw new Error('Card target is no longer eligible.'); return { zone, index };
}
function trashCard(state: GameState, source: CardInstance, id: string): CardInstance {
  const target = findTargetZone(state, source, id); const [card] = target.zone.splice(target.index, 1); state.trash.push(card!);
  record(state, 'trash', { cardInstanceId: card!.id, definitionId: card!.definitionId }); return card!;
}
function discardCard(state: GameState, source: CardInstance, id: string): CardInstance {
  const deck = state.players[state.activePlayerId].deck; const index = deck.hand.findIndex((card) => card.id === id);
  if (index < 0 || id === source.id) throw new Error('Discard target is no longer eligible.'); const [card] = deck.hand.splice(index, 1); deck.discard.push(card!);
  record(state, 'discard', { cardInstanceId: card!.id, definitionId: card!.definitionId }); return card!;
}
function takePending<T extends PendingChoice['type']>(state: GameState, type: T): Extract<PendingChoice, { type: T }> {
  const pending = state.pendingChoice; if (!pending || pending.type !== type) throw new Error(`There is no ${type} choice to resolve.`); return pending as Extract<PendingChoice, { type: T }>;
}
function choiceOf(command: PlayCardCommand): Choice {
  return { movement: 'movement' in command ? command.movement : undefined, direction: 'direction' in command ? command.direction : undefined,
    targetCardInstanceIds: 'targetCardInstanceIds' in command ? command.targetCardInstanceIds : undefined };
}
function playCard(state: GameState, command: PlayCardCommand): void {
  const actorId = state.activePlayerId; const card = takeCard(state, command.cardInstanceId); const definition = resolveCard(state, card.definitionId);
  const effect = EFFECTS[definition.mechanic]; const choice = choiceOf(command);
  const targetCards = effect.target ? targetCandidates(state, actorId, card, effect.target).filter((target) => choice.targetCardInstanceIds?.includes(target.id)) : [];
  state.turnState.cardsPlayed.push(card.definitionId); state.turnState.copiesPlayed[card.definitionId] = (state.turnState.copiesPlayed[card.definitionId] ?? 0) + 1;
  if (SPELL_IDS.has(card.definitionId)) state.turnState.spellsPlayed += 1;
  if (!state.turnState.familiesPlayed.includes(definition.family)) state.turnState.familiesPlayed.push(definition.family);
  record(state, 'cardPlayed', { cardInstanceId: card.id, definitionId: card.definitionId });
  const context: EffectContext = {
    state, actorId, targetId: opponent(actorId), card, targetCards,
    draw: (playerId, count) => draw(state, playerId, count), damage: (targetId, amount, close) => dealDamage(state, targetId, amount, close),
    rangedDamage: (targetId, amount) => rangedDamage(state, actorId, targetId, amount), move: (playerId, position) => moveFighter(state, playerId, position),
    trash: (id) => trashCard(state, card, id), discard: (id) => discardCard(state, card, id),
    gainMana: (amount) => changeMana(state, actorId, amount, false), spendMana: (amount) => changeMana(state, actorId, -amount, true),
    requestDiscard: (remaining) => { if (remaining > 0 && state.players[actorId].deck.hand.length) state.pendingChoice = { type: 'discard', playerId: actorId, remaining }; },
    requestRecover: () => { state.pendingChoice = { type: 'recover', playerId: actorId, remaining: 1 }; },
    requestOptionalTrash: () => { state.pendingChoice = { type: 'optionalTrash', playerId: actorId, sourceCardInstanceId: card.id }; },
    requestGain: (maxCost) => { state.pendingChoice = { type: 'gain', playerId: actorId, maxCost }; }, record: (type, detail) => record(state, type, detail)
  };
  effect.resolve(context, values(definition), choice);
}
function resolveDiscard(state: GameState, command: Extract<GameCommand, { type: 'resolveDiscard' }>): void {
  const pending = takePending(state, 'discard'); const deck = state.players[pending.playerId].deck; const index = deck.hand.findIndex((card) => card.id === command.discardInstanceId);
  if (index < 0) throw new Error(`Card is not in hand: ${command.discardInstanceId}`); const [card] = deck.hand.splice(index, 1); deck.discard.push(card!); record(state, 'discard', { cardInstanceId: card!.id, definitionId: card!.definitionId }, pending.playerId);
  state.pendingChoice = pending.remaining > 1 && deck.hand.length ? { ...pending, remaining: pending.remaining - 1 } : null;
}
function resolveRecover(state: GameState, command: Extract<GameCommand, { type: 'resolveRecover' }>): void {
  const pending = takePending(state, 'recover'); const deck = state.players[pending.playerId].deck; const index = deck.discard.findIndex((card) => card.id === command.recoverInstanceId);
  if (index < 0) throw new Error(`Card is not in the discard pile: ${command.recoverInstanceId}`); const [card] = deck.discard.splice(index, 1); deck.hand.push(card!); state.pendingChoice = null;
  record(state, 'recover', { cardInstanceId: card!.id, definitionId: card!.definitionId, destination: 'hand' }, pending.playerId);
}
function resolveOptionalTrash(state: GameState, command: Extract<GameCommand, { type: 'resolveOptionalTrash' }>): void {
  const pending = takePending(state, 'optionalTrash'); const source = state.players[pending.playerId].deck.play.find((card) => card.id === pending.sourceCardInstanceId);
  if (!source) throw new Error('Optional trash source is no longer in play.'); if (command.trashInstanceId) trashCard(state, source, command.trashInstanceId); state.pendingChoice = null;
}
function resolveGain(state: GameState, command: Extract<GameCommand, { type: 'resolveGain' }>): void {
  const pending = takePending(state, 'gain'); const definition = resolveCard(state, command.definitionId);
  if (definition.id === 'scrap' || definition.cost > pending.maxCost || !kingdomMarket(state.kingdomId).some((card) => card.id === definition.id)
    || (definition.type === 'action' && (state.supply[definition.id] ?? 0) <= 0)) throw new Error('This card cannot be gained.');
  if (definition.type === 'action') state.supply[definition.id]!--; const card = createCard(state, definition.id); state.players[pending.playerId].deck.discard.push(card); state.pendingChoice = null;
  record(state, 'gain', { definitionId: definition.id }, pending.playerId);
}
function finishSetup(state: GameState): void {
  const random = new SeededRandom(state.rngState);
  for (const playerId of ['ochre', 'indigo'] as const) { const selected = state.players[playerId].startingBuild!; const definitions = [...Array<string>(STARTING_DECK_COPPER_COUNT).fill('copper'), ...selected]; state.players[playerId].deck.draw = definitions.map((id) => createCard(state, id)); state.players[playerId].firstBuyMoney = firstBuyCarry(marketCost(state, selected)); state.players[playerId].positionChanged = false; }
  state.players.ochre.deck.draw = shuffle(state.players.ochre.deck.draw, random); state.players.indigo.deck.draw = shuffle(state.players.indigo.deck.draw, random); state.rngState = random.snapshot();
  draw(state, 'ochre', 5); draw(state, 'indigo', 5); state.phase = 'action'; state.activePlayerId = state.selectedFirstPlayerId; state.turn = 1; record(state, 'turn', { turn: 1, activePlayerId: state.activePlayerId });
}
function submitBuild(state: GameState, command: Extract<GameCommand, { type: 'submitStartingBuild' }>): void {
  if (!state.startingDraftEnabled || state.phase !== 'startingBuild' || state.activePlayerId !== command.playerId) throw new Error('This starting build cannot be submitted now.');
  if (state.players[command.playerId].startingBuild) throw new Error('The starting build is already complete.'); const offered = new Set(kingdomMarket(state.kingdomId).map((definition) => definition.id));
  for (const id of command.definitionIds) if (!offered.has(resolveCard(state, id).id)) throw new Error(`This kingdom does not sell ${id}.`);
  const cost = marketCost(state, command.definitionIds); if (cost > STARTING_BUDGET) throw new Error(`Starting build costs more than ${STARTING_BUDGET} money.`);
  state.players[command.playerId].startingBuild = [...command.definitionIds]; record(state, 'buildComplete', { playerId: command.playerId, count: command.definitionIds.length, cost }, command.playerId);
  if (command.playerId === 'ochre') state.activePlayerId = 'indigo'; else finishSetup(state);
}
function execute(state: GameState, command: GameCommand): void {
  switch (command.type) {
    case 'submitStartingBuild': submitBuild(state, command); return;
    case 'playFootwork': case 'playMuster': case 'playFeint': case 'playDrive': case 'playFlurry': case 'playAim': case 'playVolley':
    case 'playAction': case 'playMoveAction': case 'playTargetedAction': playCard(state, command); return;
    case 'resolveDiscard': resolveDiscard(state, command); return; case 'resolveRecover': resolveRecover(state, command); return;
    case 'resolveOptionalTrash': resolveOptionalTrash(state, command); return; case 'resolveGain': resolveGain(state, command); return;
    case 'endActionPhase': { const player = state.players[state.activePlayerId]; const treasures = player.deck.hand.filter((card) => resolveCard(state, card.definitionId).type === 'treasure'); player.deck.hand = player.deck.hand.filter((card) => resolveCard(state, card.definitionId).type !== 'treasure'); player.deck.play.push(...treasures); player.money += treasures.reduce((total, card) => total + (resolveCard(state, card.definitionId).money ?? 0), 0) + (player.firstBuyPending ? player.firstBuyMoney : 0); state.phase = 'buy'; record(state, 'phase', { phase: 'buy', money: player.money }); return; }
    case 'buyCard': { const player = state.players[state.activePlayerId]; const definition = resolveCard(state, command.definitionId); player.money -= definition.cost; if (definition.type === 'action') state.supply[definition.id]!--; const card = createCard(state, definition.id); player.deck.discard.push(card); player.purchases.push(definition.id); record(state, 'purchase', { definitionId: definition.id, cost: definition.cost }); return; }
    case 'endBuyPhase': { const actor = state.activePlayerId; const player = state.players[actor]; player.deck.discard.push(...player.deck.hand, ...player.deck.play); player.deck.hand = []; player.deck.play = []; player.money = 0; player.mana = Math.min(player.mana, MAX_CARRIED_MANA); player.firstBuyPending = false; player.firstBuyMoney = 0; state.fighters[actor].aimed = false; state.fighters[opponent(actor)].exposed = false; draw(state, actor, 5); state.turnState = emptyTurnState(); state.activePlayerId = opponent(actor); state.phase = 'action'; state.turn += 1; state.players[state.activePlayerId].positionChanged = false; record(state, 'turn', { turn: state.turn, activePlayerId: state.activePlayerId }); return; }
  }
}
export function applyAction(state: GameState, id: string): GameState { const selected = listLegalActions(state).find((action) => action.id === id); if (!selected) throw new Error(`Unknown or stale legal action: ${id}`); return applyLegalAction(state, selected); }
export function applyLegalAction(state: GameState, action: LegalAction): GameState { if (!action.id.startsWith(`v${state.version}-action-`)) throw new Error(`Unknown or stale legal action: ${action.id}`); const next = cloneGame(state); execute(next, action.command); next.version += 1; return next; }
export function applyCommand(state: GameState, command: GameCommand): GameState { const next = cloneGame(state); if (command.type === 'submitStartingBuild') { execute(next, command); next.version += 1; return next; } const action = listLegalActions(state).find((candidate) => key(candidate.command) === key(command)); if (!action) throw new Error(`Illegal command: ${key(command)}`); return applyAction(state, action.id); }
export function submitStartingBuild(state: GameState, playerId: PlayerId, definitionIds: string[]): GameState { return applyCommand(state, { type: 'submitStartingBuild', playerId, definitionIds }); }
export function replayCommands(initialState: GameState, commands: readonly GameCommand[]): GameState { return commands.reduce((state, command) => applyCommand(state, command), cloneGame(initialState)); }
export function marketCost(state: GameState, definitionIds: readonly string[]): number { return definitionIds.reduce((sum, id) => sum + resolveCard(state, id).cost, 0); }
