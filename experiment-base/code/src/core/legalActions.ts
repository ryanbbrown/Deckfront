import type { GameState, LegalAction } from './types';

export function listLegalActions(state: GameState): LegalAction[] {
  if (state.ended) {
    return [];
  }
  if (state.pending) {
    return pendingActions(state);
  }

  const player = state.players[state.activePlayer];
  if (!player) {
    return [];
  }

  if (state.phase === 'action') {
    const actions: LegalAction[] = [];
    if (player.actions > 0) {
      player.hand.forEach((cardId, handIndex) => {
        const card = state.cards[cardId];
        if (card?.type === 'action') {
          actions.push({
            action: { type: 'playAction', handIndex },
            description: `Play ${card.name}`
          });
        }
      });
    }
    actions.push({ action: { type: 'moveToBuy' }, description: 'Move to buy phase' });
    if (player.freeTrashUsed !== true && player.play.length === 0) {
      player.hand.forEach((cardId, handIndex) => {
        const card = state.cards[cardId];
        actions.push({
          action: { type: 'trashCard', handIndex },
          description: `Trash ${card?.name ?? cardId}`
        });
      });
    }
    return actions;
  }

  if (state.phase === 'buy') {
    const actions: LegalAction[] = [];
    if (player.buys > 0) {
      for (const pile of state.config.supply) {
        const card = state.cards[pile.card];
        if (card && (state.supply[pile.card] ?? 0) > 0 && card.cost <= player.money) {
          actions.push({
            action: { type: 'buyCard', cardId: card.id },
            description: `Buy ${card.name} (${card.cost})`
          });
        }
      }
    }
    actions.push({ action: { type: 'endTurn' }, description: 'End turn' });
    return actions;
  }

  return [{ action: { type: 'endTurn' }, description: 'End turn' }];
}

function pendingActions(state: GameState): LegalAction[] {
  const pending = state.pending;
  if (!pending) {
    return [];
  }
  const player = state.players[pending.player];
  if (!player) {
    return [];
  }
  const actions: LegalAction[] = [];

  if (pending.kind === 'discard' || pending.kind === 'trash') {
    player.hand.forEach((cardId, handIndex) => {
      const card = state.cards[cardId];
      actions.push({
        action: { type: 'resolvePending', choice: 'select', handIndex },
        description: `${pending.kind === 'discard' ? 'Discard' : 'Trash'} ${card?.name ?? cardId}`
      });
    });
  }

  if (pending.kind === 'lookahead') {
    (pending.exposed ?? []).forEach((cardId, exposedIndex) => {
      const card = state.cards[cardId];
      for (const destination of pending.choices ?? []) {
        actions.push({
          action: { type: 'resolvePending', choice: 'lookahead', exposedIndex, destination },
          description: `${labelDestination(destination)} ${card?.name ?? cardId}`
        });
      }
    });
  }

  if (pending.optional) {
    actions.push({ action: { type: 'resolvePending', choice: 'skip' }, description: 'Skip remaining effect' });
  }

  return actions;
}

function labelDestination(destination: string): string {
  if (destination === 'draw') {
    return 'Draw';
  }
  if (destination === 'discard') {
    return 'Discard';
  }
  if (destination === 'trash') {
    return 'Trash';
  }
  if (destination === 'top') {
    return 'Keep on top';
  }
  return destination;
}
