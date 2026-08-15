import { cardDefinition } from './config';
import {
  DIRECTIONS, add, allBoardCoordinates, directionFromTo, distance, equal, key,
  lineDirection, onBoard, rotate60
} from './hex';
import { SeededRandom, shuffle } from './random';
import { RESPAWN_ANCHORS, cloneGame, createPurchasedCard, opponent } from './state';
import type {
  ActionPreview, CardInstance, Coordinate, GameCommand, GameEventType, GameState, LegalAction,
  PieceId, PieceState, PlayerId, TemporaryBlock
} from './types';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([name, child]) => [name, stableValue(child)]));
  }
  return value;
}
function commandKey(command: GameCommand): string { return JSON.stringify(stableValue(command)); }
function legal(label: string, command: GameCommand): LegalAction { return { id: '', label, command }; }
function withOpaqueIds(state: GameState, actions: LegalAction[]): LegalAction[] {
  return actions.map((action, index) => ({ ...action, id: `v${state.version}-action-${index + 1}` }));
}
function livingPieces(state: GameState): PieceState[] { return Object.values(state.pieces).filter((piece) => piece.position !== null); }
function friendlyPieces(state: GameState): PieceState[] { return livingPieces(state).filter((piece) => piece.ownerId === state.activePlayerId); }
function enemyPieces(state: GameState): PieceState[] { return livingPieces(state).filter((piece) => piece.ownerId !== state.activePlayerId); }
function occupantAt(state: GameState, coordinate: Coordinate): PieceState | TemporaryBlock | null {
  return livingPieces(state).find((piece) => piece.position && equal(piece.position, coordinate))
    ?? state.blocks.find((block) => equal(block.position, coordinate)) ?? null;
}
function isEmpty(state: GameState, coordinate: Coordinate): boolean { return onBoard(coordinate) && occupantAt(state, coordinate) === null; }
function adjacentEnemies(state: GameState, actor: PieceState): PieceState[] {
  if (!actor.position) return [];
  return enemyPieces(state).filter((target) => target.position && distance(actor.position!, target.position) === 1);
}
function pushDestination(actor: PieceState, target: PieceState): Coordinate {
  if (!actor.position || !target.position) throw new Error('Displacement needs two board pieces.');
  const direction = directionFromTo(actor.position, target.position);
  if (!direction) throw new Error('Displacement target must be adjacent.');
  return add(target.position, direction);
}
function canDisplace(state: GameState, actor: PieceState, target: PieceState): boolean {
  if (target.braced) return true;
  const destination = pushDestination(actor, target);
  return !onBoard(destination) || isEmpty(state, destination);
}
function canBreaker(state: GameState, actor: PieceState, target: PieceState): boolean {
  const destination = pushDestination(actor, target);
  return !onBoard(destination) || isEmpty(state, destination);
}

export function legalRespawnLocations(state: GameState, pieceId: PieceId): Coordinate[] {
  const piece = state.pieces[pieceId];
  if (!piece.needsRespawn) return [];
  const anchors = RESPAWN_ANCHORS[piece.ownerId];
  const emptyAnchors = anchors.filter((anchor) => isEmpty(state, anchor));
  if (emptyAnchors.length) return emptyAnchors.map((anchor) => ({ ...anchor }));
  const available = allBoardCoordinates().filter((coordinate) => isEmpty(state, coordinate));
  if (!available.length) return [];
  const nearest = Math.min(...available.map((coordinate) => Math.min(...anchors.map((anchor) => distance(coordinate, anchor)))));
  return available.filter((coordinate) => Math.min(...anchors.map((anchor) => distance(coordinate, anchor))) === nearest);
}
function respawnRequiredPieces(state: GameState): void {
  for (const piece of Object.values(state.pieces).filter(
    (candidate) => candidate.ownerId === state.activePlayerId && candidate.needsRespawn
  )) {
    const destination = legalRespawnLocations(state, piece.id).sort((left, right) => key(left).localeCompare(key(right)))[0];
    if (!destination) throw new Error(`No respawn location is available for ${piece.id}.`);
    piece.position = { ...destination };
    piece.needsRespawn = false;
    record(state, 'respawn', { pieceId: piece.id, destination });
  }
}
function listBaselineMoves(state: GameState): LegalAction[] {
  return friendlyPieces(state).flatMap((piece) => {
    if (!piece.position || piece.baselineMoves <= 0) return [];
    return DIRECTIONS.map((direction) => add(piece.position!, direction)).filter((destination) => isEmpty(state, destination)).map(
      (destination) => legal(
        piece.pinned ? `Attempt move with pinned ${piece.id} from ${key(piece.position!)} to ${key(destination)}` : `Move ${piece.id} from ${key(piece.position!)} to ${key(destination)}`,
        { type: 'baselineMove', pieceId: piece.id, destination }
      )
    );
  });
}
function listPushCard(state: GameState, card: CardInstance, mechanic: 'shove' | 'drive' | 'breaker' | 'press' | 'corner'): LegalAction[] {
  const actions: LegalAction[] = [];
  for (const actor of friendlyPieces(state)) for (const target of adjacentEnemies(state, actor)) {
    if (mechanic === 'breaker' ? !canBreaker(state, actor, target) : !canDisplace(state, actor, target)) continue;
    const type = ({ shove: 'playShove', drive: 'playDrive', breaker: 'playBreaker', press: 'playPress', corner: 'playCorner' } as const)[mechanic];
    actions.push(legal(`Use ${cardDefinition(card.definitionId).name} with ${actor.id} against ${target.id}`, {
      type, cardInstanceId: card.id, actorId: actor.id, targetId: target.id
    }));
  }
  return actions;
}
function listDash(state: GameState, card: CardInstance): LegalAction[] {
  return friendlyPieces(state).flatMap((piece) => piece.position ? DIRECTIONS.map((direction) => add(piece.position!, direction))
    .filter((destination) => isEmpty(state, destination)).map((destination) => legal(`Use Dash to move ${piece.id} to ${key(destination)}`, {
      type: 'playDash', cardInstanceId: card.id, pieceId: piece.id, destination
    })) : []);
}
function listBrace(state: GameState, card: CardInstance): LegalAction[] {
  return friendlyPieces(state).filter((piece) => !piece.braced).map((piece) => legal(`Give ${piece.id} Brace`, {
    type: 'playBrace', cardInstanceId: card.id, pieceId: piece.id
  }));
}
function listCull(state: GameState, card: CardInstance): LegalAction[] {
  const hand = state.players[state.activePlayerId].deck.hand;
  const actions: LegalAction[] = [];
  for (let first = 0; first < hand.length; first += 1) for (let second = first + 1; second < hand.length; second += 1) {
    const left = hand[first]!;
    const right = hand[second]!;
    actions.push(legal(`Trash ${cardDefinition(left.definitionId).name} and ${cardDefinition(right.definitionId).name} with Cull`, {
      type: 'playCull', cardInstanceId: card.id, trashInstanceIds: [left.id, right.id]
    }));
  }
  return actions;
}
function listPull(state: GameState, card: CardInstance): LegalAction[] {
  const actions: LegalAction[] = [];
  for (const actor of friendlyPieces(state)) {
    if (!actor.position) continue;
    for (const target of enemyPieces(state)) {
      if (!target.position) continue;
      const direction = lineDirection(actor.position, target.position, 2);
      if (!direction) continue;
      const destination = add(actor.position, direction);
      if (!target.braced && !isEmpty(state, destination)) continue;
      actions.push(legal(`Use Pull with ${actor.id} against ${target.id}`, {
        type: 'playPull', cardInstanceId: card.id, actorId: actor.id, targetId: target.id
      }));
    }
  }
  return actions;
}
function listVault(state: GameState, card: CardInstance): LegalAction[] {
  const actions: LegalAction[] = [];
  for (const piece of friendlyPieces(state)) {
    if (!piece.position) continue;
    for (const jumped of livingPieces(state)) {
      if (!jumped.position || jumped.id === piece.id) continue;
      const direction = directionFromTo(piece.position, jumped.position);
      if (!direction || !isEmpty(state, add(jumped.position, direction))) continue;
      actions.push(legal(`Use Vault with ${piece.id} over ${jumped.id}`, {
        type: 'playVault', cardInstanceId: card.id, pieceId: piece.id, jumpedPieceId: jumped.id
      }));
    }
  }
  return actions;
}
function listSweep(state: GameState, card: CardInstance): LegalAction[] {
  const actions: LegalAction[] = [];
  for (const actor of friendlyPieces(state)) {
    if (!actor.position) continue;
    for (const target of adjacentEnemies(state, actor)) {
      if (!target.position) continue;
      const direction = directionFromTo(actor.position, target.position);
      if (!direction) continue;
      for (const clockwise of [true, false]) {
        const once = rotate60(direction, clockwise);
        const destination = add(actor.position, rotate60(once, clockwise));
        if (!target.braced && onBoard(destination) && !isEmpty(state, destination)) continue;
        actions.push(legal(`Use Sweep ${clockwise ? 'clockwise' : 'counterclockwise'} with ${actor.id} against ${target.id} to ${key(destination)}`, {
          type: 'playSweep', cardInstanceId: card.id, actorId: actor.id, targetId: target.id, destination
        }));
      }
    }
  }
  return actions;
}
function listRelay(state: GameState, card: CardInstance): LegalAction[] {
  if (state.round.relayUsed[state.activePlayerId]) return [];
  const pieces = friendlyPieces(state);
  if (pieces.length !== 2 || !pieces[0]?.position || !pieces[1]?.position) return [];
  return [legal(`Swap ${pieces[0].id} and ${pieces[1].id} with Relay`, { type: 'playRelay', cardInstanceId: card.id })];
}
function listBlock(state: GameState, card: CardInstance): LegalAction[] {
  const owned = state.blocks.filter((block) => block.ownerId === state.activePlayerId);
  const replacements = owned.length < 2 ? [undefined] : owned.map((block) => block.id);
  const actions: LegalAction[] = [];
  for (const actor of friendlyPieces(state)) {
    if (!actor.position) continue;
    for (const direction of DIRECTIONS) {
      const destination = add(actor.position, direction);
      if (!isEmpty(state, destination)) continue;
      for (const replaceBlockId of replacements) {
        const command: GameCommand = replaceBlockId
          ? { type: 'playBlock', cardInstanceId: card.id, actorId: actor.id, destination, replaceBlockId }
          : { type: 'playBlock', cardInstanceId: card.id, actorId: actor.id, destination };
        actions.push(legal(`Place Block at ${key(destination)}${replaceBlockId ? ` replacing ${replaceBlockId}` : ''}`, command));
      }
    }
  }
  return actions;
}
function listPin(state: GameState, card: CardInstance): LegalAction[] {
  return friendlyPieces(state).flatMap((actor) => adjacentEnemies(state, actor).map((target) => legal(`Use Pin with ${actor.id} against ${target.id}`, {
    type: 'playPin', cardInstanceId: card.id, actorId: actor.id, targetId: target.id
  })));
}
function listCardActions(state: GameState): LegalAction[] {
  return state.players[state.activePlayerId].deck.hand.flatMap((card) => {
    switch (cardDefinition(card.definitionId).mechanic) {
      case 'money': return [];
      case 'shove': return listPushCard(state, card, 'shove');
      case 'dash': return listDash(state, card);
      case 'brace': return listBrace(state, card);
      case 'cull': return listCull(state, card);
      case 'drive': return listPushCard(state, card, 'drive');
      case 'breaker': return listPushCard(state, card, 'breaker');
      case 'press': return listPushCard(state, card, 'press');
      case 'pull': return listPull(state, card);
      case 'vault': return listVault(state, card);
      case 'sweep': return listSweep(state, card);
      case 'relay': return listRelay(state, card);
      case 'block': return listBlock(state, card);
      case 'pin': return listPin(state, card);
      case 'corner': return listPushCard(state, card, 'corner');
    }
  });
}
function listPurchaseActions(state: GameState): LegalAction[] {
  const player = state.players[state.activePlayerId];
  const actions = Object.entries(state.supply).sort(([left], [right]) => left.localeCompare(right)).flatMap(([definitionId, count]) => {
    const definition = cardDefinition(definitionId);
    return count > 0 && player.buys > 0 && definition.cost <= player.money
      ? [legal(`Buy ${definition.name}`, { type: 'buyCard' as const, definitionId })] : [];
  });
  return [...actions, legal('Buy nothing', { type: 'skipPurchase' })];
}
function boardActions(state: GameState): LegalAction[] { return [...listBaselineMoves(state), ...listCardActions(state)]; }
export function listLegalActions(state: GameState): LegalAction[] {
  if (state.phase === 'ended') return [];
  if (state.phase === 'purchase') return withOpaqueIds(state, listPurchaseActions(state));
  return withOpaqueIds(state, [...boardActions(state), legal('Pass for this round', { type: 'pass' })]);
}

function takeCardFromHand(state: GameState, instanceId: string): CardInstance {
  const deck = state.players[state.activePlayerId].deck;
  const index = deck.hand.findIndex((card) => card.id === instanceId);
  if (index < 0) throw new Error(`Card is not in hand: ${instanceId}`);
  const [card] = deck.hand.splice(index, 1);
  if (!card) throw new Error(`Card is not in hand: ${instanceId}`);
  deck.play.push(card);
  return card;
}
function record(state: GameState, type: GameEventType, detail: Record<string, unknown>): void {
  state.events.push({ sequence: state.events.length, type, playerId: state.activePlayerId, detail });
}
interface DisplacementResult { moved: boolean; ringedOut: boolean; origin: Coordinate }
function ringOut(state: GameState, target: PieceState): void {
  target.position = null;
  target.needsRespawn = true;
  target.braced = false;
  const scorer = opponent(target.ownerId);
  state.scores[scorer] += 1;
  record(state, 'ringOut', { pieceId: target.id, scorer, score: state.scores[scorer] });
  if (state.scores[scorer] >= 5) { state.winner = scorer; state.phase = 'ended'; }
}
function displaceTo(state: GameState, target: PieceState, destination: Coordinate, ignoreBrace = false): DisplacementResult {
  if (!target.position) throw new Error('Target is not on the board.');
  const origin = { ...target.position };
  if (target.braced && !ignoreBrace) {
    target.braced = false;
    record(state, 'braceCanceledDisplacement', { pieceId: target.id });
    return { moved: false, ringedOut: false, origin };
  }
  if (ignoreBrace) target.braced = false;
  if (onBoard(destination) && !isEmpty(state, destination)) return { moved: false, ringedOut: false, origin };
  if (!state.round.pressSetupPieceIds.includes(target.id)) state.round.pressSetupPieceIds.push(target.id);
  if (!onBoard(destination)) {
    ringOut(state, target);
    return { moved: true, ringedOut: true, origin };
  }
  target.position = { ...destination };
  record(state, 'displacement', { pieceId: target.id, from: origin, to: destination });
  return { moved: true, ringedOut: false, origin };
}
function pushOnce(state: GameState, actor: PieceState, target: PieceState, ignoreBrace = false): DisplacementResult {
  return displaceTo(state, target, pushDestination(actor, target), ignoreBrace);
}
function cardActor(command: GameCommand): PieceId | null {
  switch (command.type) {
    case 'playDash': case 'playBrace': case 'playVault': return command.pieceId;
    case 'playShove': case 'playDrive': case 'playBreaker': case 'playPress': case 'playPull':
    case 'playSweep': case 'playBlock': case 'playPin': case 'playCorner': return command.actorId;
    default: return null;
  }
}
function applyPlayCommand(state: GameState, command: Extract<GameCommand, { cardInstanceId: string }>): void {
  const card = takeCardFromHand(state, command.cardInstanceId);
  record(state, 'cardPlayed', { cardInstanceId: card.id, definitionId: card.definitionId, actorId: cardActor(command), command });
  switch (command.type) {
    case 'playDash': {
      const piece = state.pieces[command.pieceId]; const from = piece.position;
      piece.position = { ...command.destination }; record(state, 'dash', { pieceId: piece.id, from, to: command.destination }); break;
    }
    case 'playBrace': state.pieces[command.pieceId].braced = true; record(state, 'brace', { pieceId: command.pieceId }); break;
    case 'playCull': {
      const deck = state.players[state.activePlayerId].deck;
      for (const instanceId of command.trashInstanceIds) {
        let zone = deck.hand; let index = zone.findIndex((candidate) => candidate.id === instanceId);
        if (index < 0) { zone = deck.play; index = zone.findIndex((candidate) => candidate.id === instanceId); }
        if (index < 0) throw new Error('Cull target is no longer available.');
        const [trashed] = zone.splice(index, 1);
        if (!trashed) throw new Error('Cull target is no longer available.');
        state.trash.push(trashed); record(state, 'cull', { cardInstanceId: trashed.id, definitionId: trashed.definitionId });
      }
      break;
    }
    case 'playShove': pushOnce(state, state.pieces[command.actorId], state.pieces[command.targetId]); break;
    case 'playDrive': {
      const actor = state.pieces[command.actorId]; const result = pushOnce(state, actor, state.pieces[command.targetId]);
      if (result.moved && actor.position && !state.winner) { actor.position = result.origin; record(state, 'follow', { pieceId: actor.id, to: result.origin }); }
      break;
    }
    case 'playBreaker': pushOnce(state, state.pieces[command.actorId], state.pieces[command.targetId], true); break;
    case 'playPress': {
      const actor = state.pieces[command.actorId]; const target = state.pieces[command.targetId];
      const earnedExtra = state.round.pressSetupPieceIds.includes(target.id);
      const direction = actor.position && target.position ? directionFromTo(actor.position, target.position) : null;
      if (!direction) throw new Error('Press pieces must be adjacent.');
      const first = pushOnce(state, actor, target);
      if (earnedExtra && !first.ringedOut && target.position && !state.winner) {
        displaceTo(state, target, add(target.position, direction));
      }
      break;
    }
    case 'playPull': {
      const actor = state.pieces[command.actorId]; const target = state.pieces[command.targetId];
      if (!actor.position || !target.position) throw new Error('Pull pieces must be on board.');
      const direction = lineDirection(actor.position, target.position, 2);
      if (!direction) throw new Error('Pull target is not in line.');
      displaceTo(state, target, add(actor.position, direction)); break;
    }
    case 'playVault': {
      const piece = state.pieces[command.pieceId]; const jumped = state.pieces[command.jumpedPieceId];
      if (!piece.position || !jumped.position) throw new Error('Vault pieces must be on board.');
      const direction = directionFromTo(piece.position, jumped.position);
      if (!direction) throw new Error('Vault target is not adjacent.');
      const from = piece.position; piece.position = add(jumped.position, direction);
      record(state, 'vault', { pieceId: piece.id, over: jumped.id, from, to: piece.position }); break;
    }
    case 'playSweep': displaceTo(state, state.pieces[command.targetId], command.destination); break;
    case 'playRelay': {
      const pieces = friendlyPieces(state);
      if (!pieces[0]?.position || !pieces[1]?.position) throw new Error('Relay needs two pieces.');
      const first = pieces[0].position; pieces[0].position = pieces[1].position; pieces[1].position = first;
      state.round.relayUsed[state.activePlayerId] = true;
      record(state, 'relay', { pieceIds: [pieces[0].id, pieces[1].id] }); break;
    }
    case 'playBlock': {
      if (command.replaceBlockId) state.blocks = state.blocks.filter((block) => block.id !== command.replaceBlockId);
      state.blocks.push({ id: `block-${state.nextBlockSerial++}`, ownerId: state.activePlayerId,
        position: { ...command.destination }, expiresAfterRound: state.round.number });
      record(state, 'block', { position: command.destination, replaced: command.replaceBlockId }); break;
    }
    case 'playPin': state.pieces[command.targetId].pinned = { sourcePlayerId: state.activePlayerId };
      record(state, 'pin', { pieceId: command.targetId }); break;
    case 'playCorner': {
      const actor = state.pieces[command.actorId]; const target = state.pieces[command.targetId]; const wasPinned = Boolean(target.pinned);
      const direction = actor.position && target.position ? directionFromTo(actor.position, target.position) : null;
      if (!direction) throw new Error('Corner pieces must be adjacent.');
      const first = pushOnce(state, actor, target);
      if (first.ringedOut || !target.position || state.winner) break;
      const touchesBlock = state.blocks.some((block) => block.ownerId === state.activePlayerId && distance(block.position, target.position!) === 1);
      if (wasPinned || touchesBlock) {
        displaceTo(state, target, add(target.position, direction));
      }
      break;
    }
  }
}
function drawFive(state: GameState, playerId: PlayerId): void {
  const deck = state.players[playerId].deck; const random = new SeededRandom(state.rngState);
  while (deck.hand.length < 5) {
    if (!deck.draw.length) { if (!deck.discard.length) break; deck.draw = shuffle(deck.discard, random); deck.discard = []; }
    const card = deck.draw.shift(); if (!card) break; deck.hand.push(card);
  }
  state.rngState = random.snapshot();
}
function autoPlayTreasures(state: GameState): void {
  const player = state.players[state.activePlayerId];
  const treasures = player.deck.hand.filter((card) => cardDefinition(card.definitionId).type === 'treasure');
  player.deck.hand = player.deck.hand.filter((card) => cardDefinition(card.definitionId).type !== 'treasure');
  player.deck.play.push(...treasures);
  player.money = treasures.reduce((total, card) => total + (cardDefinition(card.definitionId).money ?? 0), 0);
  player.buys = 1;
}
function beginPurchases(state: GameState): void {
  state.phase = 'purchase'; state.round.purchaseOrder = [...state.round.passedPlayerIds]; state.round.purchaseIndex = 0;
  state.activePlayerId = state.round.purchaseOrder[0]!; autoPlayTreasures(state);
}
function cleanupAndStartRound(state: GameState): void {
  for (const playerId of ['ochre', 'indigo'] as const) {
    const player = state.players[playerId];
    player.deck.discard.push(...player.deck.hand, ...player.deck.play); player.deck.hand = []; player.deck.play = [];
    player.money = 0; player.buys = 1; player.roundsCompleted += 1;
  }
  for (const piece of Object.values(state.pieces)) { piece.braced = false; piece.baselineMoves = 1; }
  state.blocks = [];
  drawFive(state, 'ochre'); drawFive(state, 'indigo');
  const startingPlayerId = opponent(state.round.startingPlayerId);
  state.round = { number: state.round.number + 1, startingPlayerId, passedPlayerIds: [], purchaseOrder: [], purchaseIndex: 0,
    actionStep: 1, pressSetupPieceIds: [], relayUsed: { ochre: false, indigo: false } };
  state.activePlayerId = startingPlayerId; state.phase = 'action';
  respawnRequiredPieces(state); record(state, 'roundStarted', { round: state.round.number, startingPlayerId });
  settleAutomaticPasses(state);
}
function finishPurchase(state: GameState): void {
  const nextIndex = state.round.purchaseIndex + 1;
  if (nextIndex < state.round.purchaseOrder.length) {
    state.round.purchaseIndex = nextIndex; state.activePlayerId = state.round.purchaseOrder[nextIndex]!; autoPlayTreasures(state);
  } else cleanupAndStartRound(state);
}
function settleAutomaticPasses(state: GameState): void {
  while (state.phase === 'action' && !state.winner) {
    respawnRequiredPieces(state);
    if (boardActions(state).length) return;
    const playerId = state.activePlayerId;
    if (!state.round.passedPlayerIds.includes(playerId)) {
      state.round.passedPlayerIds.push(playerId); record(state, 'pass', { automatic: true });
    }
    if (state.round.passedPlayerIds.length === 2) { beginPurchases(state); return; }
    state.activePlayerId = opponent(playerId); state.round.actionStep += 1;
  }
}
function finishActionStep(state: GameState, actingPlayerId: PlayerId): void {
  if (state.winner) return;
  state.round.actionStep += 1;
  const other = opponent(actingPlayerId);
  state.activePlayerId = state.round.passedPlayerIds.includes(other) ? actingPlayerId : other;
  settleAutomaticPasses(state);
}
function execute(state: GameState, command: GameCommand): void {
  const actingPlayerId = state.activePlayerId;
  switch (command.type) {
    case 'baselineMove': {
      const piece = state.pieces[command.pieceId]; const from = piece.position; piece.baselineMoves -= 1;
      if (piece.pinned) { piece.pinned = null; record(state, 'baselineMovePinned', { pieceId: piece.id, attemptedDestination: command.destination }); }
      else { piece.position = { ...command.destination }; record(state, 'baselineMove', { pieceId: piece.id, from, to: command.destination }); }
      finishActionStep(state, actingPlayerId); break;
    }
    case 'pass': {
      state.round.passedPlayerIds.push(actingPlayerId); record(state, 'pass', { automatic: false });
      if (state.round.passedPlayerIds.length === 2) beginPurchases(state); else finishActionStep(state, actingPlayerId);
      break;
    }
    case 'buyCard': {
      const player = state.players[actingPlayerId]; const definition = cardDefinition(command.definitionId);
      player.money -= definition.cost; player.buys = 0; state.supply[command.definitionId]!--;
      player.deck.discard.push(createPurchasedCard(state, command.definitionId));
      record(state, 'purchase', { definitionId: command.definitionId, cost: definition.cost }); finishPurchase(state); break;
    }
    case 'skipPurchase': playerSkip(state); break;
    default: applyPlayCommand(state, command); finishActionStep(state, actingPlayerId);
  }
}
function playerSkip(state: GameState): void {
  state.players[state.activePlayerId].buys = 0; record(state, 'skipPurchase', {}); finishPurchase(state);
}
export function applyAction(state: GameState, id: string): GameState {
  const selected = listLegalActions(state).find((action) => action.id === id);
  if (!selected) throw new Error(`Unknown or stale legal action: ${id}`);
  const next = cloneGame(state); execute(next, selected.command); next.version += 1; return next;
}
export function applyCommand(state: GameState, command: GameCommand): GameState {
  const selected = listLegalActions(state).find((action) => commandKey(action.command) === commandKey(command));
  if (!selected) throw new Error(`Illegal command: ${commandKey(command)}`);
  return applyAction(state, selected.id);
}
export function createActionPreview(state: GameState): ActionPreview {
  return { baseState: cloneGame(state), command: null, state: cloneGame(state) };
}
export function applyPreviewAction(preview: ActionPreview, id: string): ActionPreview {
  if (preview.command) throw new Error('An action is already waiting for confirmation.');
  const selected = listLegalActions(preview.baseState).find((action) => action.id === id);
  if (!selected) throw new Error(`Unknown or stale legal action: ${id}`);
  return { baseState: preview.baseState, command: selected.command, state: applyAction(preview.baseState, id) };
}
export function undoPreviewAction(preview: ActionPreview): ActionPreview { return createActionPreview(preview.baseState); }
export function replayCommands(initialState: GameState, commands: readonly GameCommand[]): GameState {
  return commands.reduce((state, command) => applyCommand(state, command), cloneGame(initialState));
}
