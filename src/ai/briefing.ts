import { CARDS, listLegalActions } from '../game';
import type { GameState, PlayerId } from '../game';

function unorderedDefinitions(cards: Array<{ definitionId: string }>): string[] {
  return cards.map((card) => card.definitionId).sort();
}
export function buildAiBriefing(state: GameState, aiPlayerId: PlayerId) {
  const ai = state.players[aiPlayerId];
  const humanPlayerId = aiPlayerId === 'ochre' ? 'indigo' : 'ochre';
  const human = state.players[humanPlayerId];
  return {
    activePlayerId: state.activePlayerId,
    aiPlayerId,
    humanPlayerId,
    phase: state.phase,
    scores: state.scores,
    winner: state.winner,
    round: state.round,
    remainingBaselineMoves: Object.fromEntries(Object.values(state.pieces).map((piece) => [piece.id, piece.baselineMoves])),
    legalActions: listLegalActions(state).map((action) => ({ id: action.id, summary: action.label })),
    pieces: state.pieces,
    blocks: state.blocks,
    market: state.phase === 'purchase' ? Object.entries(state.supply).map(([id, count]) => ({ id, count, ...CARDS[id] })) : [],
    ai: {
      hand: ai.deck.hand.map((card) => ({ ...card, definition: CARDS[card.definitionId] })),
      zones: {
        drawCount: ai.deck.draw.length, drawContentsUnordered: unorderedDefinitions(ai.deck.draw),
        discardCount: ai.deck.discard.length, discardContentsUnordered: unorderedDefinitions(ai.deck.discard),
        play: ai.deck.play.map((card) => ({ ...card, definition: CARDS[card.definitionId] }))
      }, money: ai.money, buys: ai.buys
    },
    humanPublicCounts: { draw: human.deck.draw.length, hand: human.deck.hand.length, discard: human.deck.discard.length, play: human.deck.play.length },
    publicEvents: state.events
  };
}
