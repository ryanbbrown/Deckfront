import { cardDefinition } from './config';
import {
  DIRECTIONS, add, allBoardCoordinates, directionFromTo, distance, equal, key,
  lineDirection, onBoard, rotate60
} from './hex';
import { SeededRandom, shuffle } from './random';
import {
  RESPAWN_ANCHORS, cloneGame, createPurchasedCard, opponent, startTurn
} from './state';
import type {
  CardInstance, Coordinate, GameCommand, GameEvent, GameEventType, GameState, LegalAction,
  PieceId, PieceState, PlayerId, TemporaryBlock, TurnPreview
} from './types';

function commandKey(command: GameCommand): string {
  return JSON.stringify(command);
}

function actionId(state: GameState, command: GameCommand): string {
  return `${state.version}:${commandKey(command)}`;
}

function legal(state: GameState, label: string, command: GameCommand): LegalAction {
  return { id: actionId(state, command), label, command };
}

function livingPieces(state: GameState): PieceState[] {
  return Object.values(state.pieces).filter((piece) => piece.position !== null);
}

function friendlyPieces(state: GameState): PieceState[] {
  return livingPieces(state).filter((piece) => piece.ownerId === state.activePlayerId);
}

function enemyPieces(state: GameState): PieceState[] {
  return livingPieces(state).filter((piece) => piece.ownerId !== state.activePlayerId);
}

function occupantAt(state: GameState, coordinate: Coordinate): PieceState | TemporaryBlock | null {
  return livingPieces(state).find((piece) => piece.position && equal(piece.position, coordinate))
    ?? state.blocks.find((block) => equal(block.position, coordinate))
    ?? null;
}

function isEmpty(state: GameState, coordinate: Coordinate): boolean {
  return onBoard(coordinate) && occupantAt(state, coordinate) === null;
}

function adjacentEnemies(state: GameState, actor: PieceState): PieceState[] {
  if (!actor.position) return [];
  return enemyPieces(state).filter(
    (target) => target.position && distance(actor.position as Coordinate, target.position) === 1
  );
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
  return target.braced || canDisplace(state, actor, target);
}

export function legalRespawnLocations(state: GameState, pieceId: PieceId): Coordinate[] {
  const piece = state.pieces[pieceId];
  if (!piece.needsRespawn || piece.ownerId !== state.activePlayerId) return [];
  const anchors = RESPAWN_ANCHORS[piece.ownerId];
  const emptyAnchors = anchors.filter((anchor) => isEmpty(state, anchor));
  if (emptyAnchors.length > 0) return emptyAnchors.map((anchor) => ({ ...anchor }));
  const available = allBoardCoordinates().filter((coordinate) => isEmpty(state, coordinate));
  const nearestDistance = Math.min(
    ...available.map((coordinate) => Math.min(...anchors.map((anchor) => distance(coordinate, anchor))))
  );
  return available.filter(
    (coordinate) => Math.min(...anchors.map((anchor) => distance(coordinate, anchor))) === nearestDistance
  );
}

function listRespawns(state: GameState): LegalAction[] {
  const piece = Object.values(state.pieces).find(
    (candidate) => candidate.ownerId === state.activePlayerId && candidate.needsRespawn
  );
  if (!piece) return [];
  return legalRespawnLocations(state, piece.id).map((destination) => legal(
    state,
    `Respawn ${piece.id} at ${key(destination)}`,
    { type: 'respawn', pieceId: piece.id, destination }
  ));
}

function listBaselineMoves(state: GameState): LegalAction[] {
  return friendlyPieces(state).flatMap((piece) => {
    if (!piece.position || piece.baselineMoves <= 0) return [];
    return DIRECTIONS.map((direction) => add(piece.position as Coordinate, direction))
      .filter((destination) => isEmpty(state, destination))
      .map((destination) => legal(
        state,
        `Move ${piece.id} to ${key(destination)}`,
        { type: 'baselineMove', pieceId: piece.id, destination }
      ));
  });
}

function listPushCard(state: GameState, card: CardInstance, mechanic: 'shove' | 'drive' | 'breaker' | 'press' | 'corner'): LegalAction[] {
  const actions: LegalAction[] = [];
  for (const actor of friendlyPieces(state)) {
    for (const target of adjacentEnemies(state, actor)) {
      if (mechanic === 'breaker' ? !canBreaker(state, actor, target) : !canDisplace(state, actor, target)) continue;
      if (mechanic === 'drive') {
        actions.push(legal(state, `Drive: ${actor.id} → ${target.id}`, {
          type: 'playDrive', cardInstanceId: card.id, actorId: actor.id, targetId: target.id
        }));
      } else {
        const type = {
          shove: 'playShove', breaker: 'playBreaker', press: 'playPress', corner: 'playCorner'
        }[mechanic] as 'playShove' | 'playBreaker' | 'playPress' | 'playCorner';
        actions.push(legal(state, `${cardDefinition(card.definitionId).name}: ${actor.id} → ${target.id}`, {
          type,
          cardInstanceId: card.id,
          actorId: actor.id,
          targetId: target.id
        }));
      }
    }
  }
  return actions;
}

function listDash(state: GameState, card: CardInstance): LegalAction[] {
  return friendlyPieces(state).flatMap((piece) => {
    if (!piece.position) return [];
    return DIRECTIONS.map((direction) => add(piece.position as Coordinate, direction))
      .filter((destination) => isEmpty(state, destination))
      .map((destination) => legal(state, `Dash ${piece.id} to ${key(destination)}`, {
        type: 'playDash', cardInstanceId: card.id, pieceId: piece.id, destination
      }));
  });
}

function listBrace(state: GameState, card: CardInstance): LegalAction[] {
  return friendlyPieces(state).filter((piece) => !piece.braced).map((piece) => legal(
    state,
    `Brace ${piece.id}`,
    { type: 'playBrace', cardInstanceId: card.id, pieceId: piece.id }
  ));
}

function listCull(state: GameState, card: CardInstance): LegalAction[] {
  return state.players[state.activePlayerId].deck.hand.map((target) => legal(
    state,
    `Trash ${cardDefinition(target.definitionId).name}${target.id === card.id ? ' (this Cull)' : ''}`,
    { type: 'playCull', cardInstanceId: card.id, trashInstanceId: target.id }
  ));
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
      actions.push(legal(state, `Pull: ${actor.id} → ${target.id}`, {
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
    for (const jumpedPiece of livingPieces(state)) {
      if (!jumpedPiece.position || jumpedPiece.id === piece.id) continue;
      const direction = directionFromTo(piece.position, jumpedPiece.position);
      if (!direction) continue;
      const destination = add(jumpedPiece.position, direction);
      if (!isEmpty(state, destination)) continue;
      actions.push(legal(state, `Vault ${piece.id} over ${jumpedPiece.id}`, {
        type: 'playVault', cardInstanceId: card.id, pieceId: piece.id, jumpedPieceId: jumpedPiece.id
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
        const destination = add(actor.position, rotate60(direction, clockwise));
        if (!target.braced && onBoard(destination) && !isEmpty(state, destination)) continue;
        actions.push(legal(state, `Sweep: ${actor.id} moves ${target.id} to ${key(destination)}`, {
          type: 'playSweep', cardInstanceId: card.id, actorId: actor.id,
          targetId: target.id, destination
        }));
      }
    }
  }
  return actions;
}

function listRelay(state: GameState, card: CardInstance): LegalAction[] {
  if (state.turn.relayUsed) return [];
  const pieces = friendlyPieces(state);
  if (pieces.length !== 2 || !pieces[0]?.position || !pieces[1]?.position) return [];
  if (distance(pieces[0].position, pieces[1].position) > 2) return [];
  return [legal(state, 'Relay friendly pieces', { type: 'playRelay', cardInstanceId: card.id })];
}

function listBlock(state: GameState, card: CardInstance): LegalAction[] {
  const ownedBlocks = state.blocks.filter((block) => block.ownerId === state.activePlayerId);
  const replacements = ownedBlocks.length < 2 ? [undefined] : ownedBlocks.map((block) => block.id);
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
        const replaced = replaceBlockId
          ? ownedBlocks.find((candidate) => candidate.id === replaceBlockId)?.position
          : null;
        actions.push(legal(
          state,
          `Block ${key(destination)}${replaced ? `, replace ${key(replaced)}` : ''}`,
          command
        ));
      }
    }
  }
  return actions;
}

function listPin(state: GameState, card: CardInstance): LegalAction[] {
  return friendlyPieces(state).flatMap((actor) => adjacentEnemies(state, actor).map((target) => legal(
    state,
    `Pin: ${actor.id} → ${target.id}`,
    { type: 'playPin', cardInstanceId: card.id, actorId: actor.id, targetId: target.id }
  )));
}

function cardActionActorId(command: GameCommand): PieceId | null {
  switch (command.type) {
    case 'playDash':
    case 'playBrace':
    case 'playVault':
      return command.pieceId;
    case 'playShove':
    case 'playDrive':
    case 'playBreaker':
    case 'playPress':
    case 'playPull':
    case 'playSweep':
    case 'playBlock':
    case 'playPin':
    case 'playCorner':
      return command.actorId;
    default:
      return null;
  }
}

function actorCanUseCard(state: GameState, definitionId: string, action: LegalAction): boolean {
  const pieceId = cardActionActorId(action.command);
  return pieceId === null || !state.turn.actionUses.some(
    (use) => use.pieceId === pieceId && use.definitionId === definitionId
  );
}

function listCardActions(state: GameState): LegalAction[] {
  const hand = state.players[state.activePlayerId].deck.hand;
  return hand.flatMap((card) => {
    const mechanic = cardDefinition(card.definitionId).mechanic;
    let actions: LegalAction[];
    switch (mechanic) {
      case 'money': actions = []; break;
      case 'shove': actions = listPushCard(state, card, 'shove'); break;
      case 'dash': actions = listDash(state, card); break;
      case 'brace': actions = listBrace(state, card); break;
      case 'cull': actions = listCull(state, card); break;
      case 'drive': actions = listPushCard(state, card, 'drive'); break;
      case 'breaker': actions = listPushCard(state, card, 'breaker'); break;
      case 'press': actions = listPushCard(state, card, 'press'); break;
      case 'pull': actions = listPull(state, card); break;
      case 'vault': actions = listVault(state, card); break;
      case 'sweep': actions = listSweep(state, card); break;
      case 'relay': actions = listRelay(state, card); break;
      case 'block': actions = listBlock(state, card); break;
      case 'pin': actions = listPin(state, card); break;
      case 'corner': actions = listPushCard(state, card, 'corner'); break;
    }
    return actions.filter((action) => actorCanUseCard(state, card.definitionId, action));
  });
}

function listBuyActions(state: GameState): LegalAction[] {
  const player = state.players[state.activePlayerId];
  const actions: LegalAction[] = [];
  if (player.buys > 0) {
    for (const [definitionId, count] of Object.entries(state.supply).sort(([left], [right]) => left.localeCompare(right))) {
      if (count <= 0) continue;
      const definition = cardDefinition(definitionId);
      if (definition.cost <= player.money) actions.push(legal(
        state,
        `Buy ${definition.name}`,
        { type: 'buyCard', definitionId }
      ));
    }
  }
  actions.push(legal(state, 'End turn', { type: 'endTurn' }));
  return actions;
}

export function listLegalActions(state: GameState): LegalAction[] {
  if (state.phase === 'ended') return [];
  if (state.phase === 'respawn') return listRespawns(state);
  if (state.phase === 'buy') return listBuyActions(state);
  return [
    ...listBaselineMoves(state),
    ...listCardActions(state),
    legal(state, 'Enter buy phase', { type: 'enterBuyPhase' })
  ];
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
  const event: GameEvent = {
    sequence: state.events.length,
    type,
    playerId: state.activePlayerId,
    detail
  };
  state.events.push(event);
}

interface DisplacementResult {
  moved: boolean;
  ringedOut: boolean;
  canceledByBrace: boolean;
  blocked: boolean;
  origin: Coordinate;
}

function ringOut(state: GameState, target: PieceState): void {
  target.position = null;
  target.needsRespawn = true;
  target.braced = false;
  target.pinned = null;
  target.baselineMoves = 0;
  const scorer = opponent(target.ownerId);
  state.scores[scorer] += 1;
  record(state, 'ringOut', { pieceId: target.id, scorer, score: state.scores[scorer] });
  if (state.scores[scorer] >= 5) {
    state.winner = scorer;
    state.phase = 'ended';
  }
}

function displaceTo(state: GameState, target: PieceState, destination: Coordinate, ignoreBrace = false): DisplacementResult {
  if (!target.position) throw new Error('Target is not on the board.');
  const origin = { ...target.position };
  if (target.braced && !ignoreBrace) {
    target.braced = false;
    record(state, 'braceCanceledDisplacement', { pieceId: target.id });
    return { moved: false, ringedOut: false, canceledByBrace: true, blocked: false, origin };
  }
  if (ignoreBrace) target.braced = false;
  if (onBoard(destination) && !isEmpty(state, destination)) {
    return { moved: false, ringedOut: false, canceledByBrace: false, blocked: true, origin };
  }
  if (!onBoard(destination)) {
    state.turn.displacedPieceIds.push(target.id);
    ringOut(state, target);
    return { moved: true, ringedOut: true, canceledByBrace: false, blocked: false, origin };
  }
  target.position = { ...destination };
  if (!state.turn.displacedPieceIds.includes(target.id)) state.turn.displacedPieceIds.push(target.id);
  record(state, 'displacement', { pieceId: target.id, from: origin, to: destination });
  return { moved: true, ringedOut: false, canceledByBrace: false, blocked: false, origin };
}

function pushOnce(state: GameState, actor: PieceState, target: PieceState, ignoreBrace = false): DisplacementResult {
  return displaceTo(state, target, pushDestination(actor, target), ignoreBrace);
}

function markPressSetup(state: GameState, targetId: PieceId, result: DisplacementResult): void {
  if (result.moved && !state.turn.pressSetupPieceIds.includes(targetId)) {
    state.turn.pressSetupPieceIds.push(targetId);
  }
}

function applyPlayCommand(state: GameState, command: Exclude<GameCommand,
  { type: 'respawn' | 'baselineMove' | 'enterBuyPhase' | 'buyCard' | 'endTurn' }
>): void {
  const card = takeCardFromHand(state, command.cardInstanceId);
  record(state, 'cardPlayed', {
    cardInstanceId: card.id,
    definitionId: card.definitionId,
    command
  });
  const actorId = cardActionActorId(command);
  if (actorId) state.turn.actionUses.push({ pieceId: actorId, definitionId: card.definitionId });
  if (command.type === 'playRelay') state.turn.relayUsed = true;
  switch (command.type) {
    case 'playDash': {
      const piece = state.pieces[command.pieceId];
      const from = piece.position;
      piece.position = { ...command.destination };
      record(state, 'dash', { pieceId: piece.id, from, to: command.destination });
      break;
    }
    case 'playBrace':
      state.pieces[command.pieceId].braced = true;
      record(state, 'brace', { pieceId: command.pieceId });
      break;
    case 'playCull': {
      const deck = state.players[state.activePlayerId].deck;
      let source: CardInstance[] = deck.hand;
      let index = source.findIndex((card) => card.id === command.trashInstanceId);
      if (index < 0) {
        source = deck.play;
        index = source.findIndex((card) => card.id === command.trashInstanceId);
      }
      const [trashed] = source.splice(index, 1);
      if (!trashed) throw new Error('Cull target is no longer available.');
      state.trash.push(trashed);
      record(state, 'cull', { cardInstanceId: trashed.id, definitionId: trashed.definitionId });
      break;
    }
    case 'playShove': {
      const result = pushOnce(state, state.pieces[command.actorId], state.pieces[command.targetId]);
      markPressSetup(state, command.targetId, result);
      break;
    }
    case 'playDrive': {
      const actor = state.pieces[command.actorId];
      const target = state.pieces[command.targetId];
      const result = pushOnce(state, actor, target);
      markPressSetup(state, command.targetId, result);
      if (result.moved && actor.position && !state.winner) {
        actor.position = result.origin;
        record(state, 'follow', { pieceId: actor.id, to: result.origin });
      }
      break;
    }
    case 'playBreaker': {
      const result = pushOnce(state, state.pieces[command.actorId], state.pieces[command.targetId], true);
      markPressSetup(state, command.targetId, result);
      break;
    }
    case 'playPress': {
      const actor = state.pieces[command.actorId];
      const target = state.pieces[command.targetId];
      const earnedExtra = state.turn.pressSetupPieceIds.includes(target.id);
      const first = pushOnce(state, actor, target);
      if (earnedExtra && first.moved && !first.ringedOut && target.position && !state.winner) {
        const direction = directionFromTo(first.origin, target.position);
        if (!direction) throw new Error('Press lost its direction.');
        displaceTo(state, target, add(target.position, direction));
      }
      break;
    }
    case 'playPull': {
      const actor = state.pieces[command.actorId];
      const target = state.pieces[command.targetId];
      if (!actor.position || !target.position) throw new Error('Pull pieces must be on board.');
      const direction = lineDirection(actor.position, target.position, 2);
      if (!direction) throw new Error('Pull target is not in line.');
      const result = displaceTo(state, target, add(actor.position, direction));
      markPressSetup(state, command.targetId, result);
      break;
    }
    case 'playVault': {
      const piece = state.pieces[command.pieceId];
      const jumped = state.pieces[command.jumpedPieceId];
      if (!piece.position || !jumped.position) throw new Error('Vault pieces must be on board.');
      const direction = directionFromTo(piece.position, jumped.position);
      if (!direction) throw new Error('Vault target is not adjacent.');
      const from = piece.position;
      piece.position = add(jumped.position, direction);
      record(state, 'vault', { pieceId: piece.id, over: jumped.id, from, to: piece.position });
      break;
    }
    case 'playSweep': {
      const result = displaceTo(state, state.pieces[command.targetId], command.destination);
      markPressSetup(state, command.targetId, result);
      break;
    }
    case 'playRelay': {
      const pieces = friendlyPieces(state);
      if (!pieces[0]?.position || !pieces[1]?.position) throw new Error('Relay needs two pieces.');
      const first = pieces[0].position;
      pieces[0].position = pieces[1].position;
      pieces[1].position = first;
      record(state, 'relay', { pieceIds: [pieces[0].id, pieces[1].id] });
      break;
    }
    case 'playBlock': {
      if (command.replaceBlockId) {
        state.blocks = state.blocks.filter((block) => block.id !== command.replaceBlockId);
      }
      const player = state.players[state.activePlayerId];
      state.blocks.push({
        id: `block-${state.nextBlockSerial++}`,
        ownerId: state.activePlayerId,
        position: { ...command.destination },
        clearAfterTurn: player.turnsTaken + 2
      });
      record(state, 'block', { position: command.destination, replaced: command.replaceBlockId });
      break;
    }
    case 'playPin': {
      const player = state.players[state.activePlayerId];
      state.pieces[command.targetId].pinned = {
        sourcePlayerId: state.activePlayerId,
        clearAfterTurn: player.turnsTaken + 2
      };
      record(state, 'pin', { pieceId: command.targetId });
      break;
    }
    case 'playCorner': {
      const actor = state.pieces[command.actorId];
      const target = state.pieces[command.targetId];
      const wasPinned = target.pinned !== null;
      const first = pushOnce(state, actor, target);
      markPressSetup(state, command.targetId, first);
      if (!first.moved || first.ringedOut || !target.position || state.winner) break;
      const touchesBlock = state.blocks.some(
        (block) => block.ownerId === state.activePlayerId && distance(block.position, target.position as Coordinate) === 1
      );
      if (wasPinned || touchesBlock) {
        const direction = directionFromTo(first.origin, target.position);
        if (!direction) throw new Error('Corner lost its direction.');
        displaceTo(state, target, add(target.position, direction));
      }
      break;
    }
  }
}

function drawFive(state: GameState, playerId: PlayerId): void {
  const deck = state.players[playerId].deck;
  const random = new SeededRandom(state.rngState);
  while (deck.hand.length < 5) {
    if (deck.draw.length === 0) {
      if (deck.discard.length === 0) break;
      deck.draw = shuffle(deck.discard, random);
      deck.discard = [];
    }
    const card = deck.draw.shift();
    if (!card) break;
    deck.hand.push(card);
  }
  state.rngState = random.snapshot();
}

function cleanupAndAdvance(state: GameState): void {
  const playerId = state.activePlayerId;
  const player = state.players[playerId];
  player.deck.discard.push(...player.deck.hand, ...player.deck.play);
  player.deck.hand = [];
  player.deck.play = [];
  player.turnsTaken += 1;
  for (const piece of Object.values(state.pieces)) {
    if (piece.pinned?.sourcePlayerId === playerId && piece.pinned.clearAfterTurn <= player.turnsTaken) {
      piece.pinned = null;
    }
  }
  state.blocks = state.blocks.filter(
    (block) => block.ownerId !== playerId || block.clearAfterTurn > player.turnsTaken
  );
  drawFive(state, playerId);
  state.activePlayerId = opponent(playerId);
  startTurn(state);
}

function execute(state: GameState, command: GameCommand): void {
  switch (command.type) {
    case 'respawn': {
      const piece = state.pieces[command.pieceId];
      piece.position = { ...command.destination };
      piece.needsRespawn = false;
      piece.baselineMoves = 1;
      piece.braced = false;
      piece.pinned = null;
      record(state, 'respawn', { pieceId: piece.id, destination: command.destination });
      if (!Object.values(state.pieces).some(
        (candidate) => candidate.ownerId === state.activePlayerId && candidate.needsRespawn
      )) state.phase = 'action';
      break;
    }
    case 'baselineMove': {
      const piece = state.pieces[command.pieceId];
      const from = piece.position;
      piece.position = { ...command.destination };
      piece.baselineMoves -= 1;
      record(state, 'baselineMove', { pieceId: piece.id, from, to: command.destination });
      break;
    }
    case 'enterBuyPhase': {
      const player = state.players[state.activePlayerId];
      const treasures = player.deck.hand.filter((card) => cardDefinition(card.definitionId).type === 'treasure');
      player.deck.hand = player.deck.hand.filter((card) => cardDefinition(card.definitionId).type !== 'treasure');
      for (const treasure of treasures) {
        player.deck.play.push(treasure);
        player.money += cardDefinition(treasure.definitionId).money ?? 0;
      }
      state.phase = 'buy';
      record(state, 'enterBuyPhase', { treasureCount: treasures.length, money: player.money });
      break;
    }
    case 'buyCard': {
      const player = state.players[state.activePlayerId];
      const definition = cardDefinition(command.definitionId);
      player.money -= definition.cost;
      player.buys -= 1;
      state.supply[command.definitionId] = (state.supply[command.definitionId] ?? 0) - 1;
      player.deck.discard.push(createPurchasedCard(state, command.definitionId));
      record(state, 'purchase', { definitionId: command.definitionId, cost: definition.cost });
      break;
    }
    case 'endTurn':
      record(state, 'endTurn', {});
      cleanupAndAdvance(state);
      break;
    default:
      applyPlayCommand(state, command);
  }
}

export function applyAction(state: GameState, id: string): GameState {
  const selected = listLegalActions(state).find((action) => action.id === id);
  if (!selected) throw new Error(`Unknown or stale legal action: ${id}`);
  const next = cloneGame(state);
  execute(next, selected.command);
  next.version += 1;
  return next;
}

export function applyCommand(state: GameState, command: GameCommand): GameState {
  const selected = listLegalActions(state).find((action) => commandKey(action.command) === commandKey(command));
  if (!selected) throw new Error(`Illegal command: ${commandKey(command)}`);
  return applyAction(state, selected.id);
}

export function createTurnPreview(state: GameState): TurnPreview {
  return { baseState: cloneGame(state), commands: [], state: cloneGame(state) };
}

export function applyPreviewAction(preview: TurnPreview, id: string): TurnPreview {
  const selected = listLegalActions(preview.state).find((action) => action.id === id);
  if (!selected) throw new Error(`Unknown or stale legal action: ${id}`);
  return {
    baseState: preview.baseState,
    commands: [...preview.commands, selected.command],
    state: applyAction(preview.state, id)
  };
}

export function undoPreviewAction(preview: TurnPreview): TurnPreview {
  const commands = preview.commands.slice(0, -1);
  const state = commands.reduce((current, command) => applyCommand(current, command), cloneGame(preview.baseState));
  return { baseState: preview.baseState, commands, state };
}

export function replayCommands(initialState: GameState, commands: readonly GameCommand[]): GameState {
  return commands.reduce((state, command) => applyCommand(state, command), cloneGame(initialState));
}
