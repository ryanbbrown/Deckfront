import { CARDS, listLegalActions } from '../game';
import type { GameState, PlayerId } from '../game';

function unorderedDefinitions(cards: Array<{ definitionId: string }>): string[] {
  return cards.map((card) => card.definitionId).sort();
}

export function buildAiBriefing(state: GameState, aiPlayerId: PlayerId, maximumPoints: number) {
  const ai = state.players[aiPlayerId];
  const humanPlayerId = aiPlayerId === 'ochre' ? 'indigo' : 'ochre';
  const human = state.players[humanPlayerId];
  const actions = listLegalActions(state);
  const tacticalActions = actions.filter((action) => ![
    'enterBuyPhase', 'buyCard', 'endTurn'
  ].includes(action.command.type));
  const affordableCards = actions.flatMap((action) =>
    action.command.type === 'buyCard' ? [{ id: action.command.definitionId, ...CARDS[action.command.definitionId] }] : []
  );
  return {
    activePlayerId: state.activePlayerId,
    aiPlayerId,
    humanPlayerId,
    phase: state.phase,
    scores: state.scores,
    winner: state.winner,
    maximumPointsAvailable: maximumPoints,
    pointsScoredThisPreview: 0,
    pieces: state.pieces,
    blocks: state.blocks,
    market: Object.entries(state.supply).map(([id, count]) => ({ id, count, ...CARDS[id] })),
    ai: {
      hand: ai.deck.hand.map((card) => ({ ...card, definition: CARDS[card.definitionId] })),
      zones: {
        drawCount: ai.deck.draw.length,
        drawContentsUnordered: unorderedDefinitions(ai.deck.draw),
        discardCount: ai.deck.discard.length,
        discardContentsUnordered: unorderedDefinitions(ai.deck.discard),
        play: ai.deck.play.map((card) => ({ ...card, definition: CARDS[card.definitionId] }))
      },
      money: ai.money,
      buys: ai.buys
    },
    humanPublicCounts: {
      draw: human.deck.draw.length,
      hand: human.deck.hand.length,
      discard: human.deck.discard.length,
      play: human.deck.play.length
    },
    publicEvents: state.events,
    legalActions: tacticalActions,
    canEnterBuyPhase: actions.some((action) => action.command.type === 'enterBuyPhase'),
    affordableCards
  };
}

export function updateAiBriefing(
  state: GameState,
  aiPlayerId: PlayerId,
  maximumPoints: number,
  initialScore: number
) {
  return {
    ...buildAiBriefing(state, aiPlayerId, maximumPoints),
    pointsScoredThisPreview: state.scores[aiPlayerId] - initialScore
  };
}
