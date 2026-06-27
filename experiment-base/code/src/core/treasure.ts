import type { GameState, PlayerState } from './types';

export function autoPlayTreasures(state: GameState, player: PlayerState): void {
  for (let index = 0; index < player.hand.length; ) {
    const cardId = player.hand[index];
    const card = cardId ? state.cards[cardId] : undefined;
    if (card?.type !== 'treasure') {
      index += 1;
      continue;
    }
    player.hand.splice(index, 1);
    player.play.push(card.id);
    player.money += card.treasure ?? 0;
  }
}
