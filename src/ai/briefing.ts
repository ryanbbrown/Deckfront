import { CARDS, listLegalActions, rangeBand } from '../game';
import type { GameState, PlayerId } from '../game';

function unordered(cards: Array<{ definitionId: string }>): string[] { return cards.map((card) => card.definitionId).sort(); }
export function buildAiBriefing(state: GameState, aiPlayerId: PlayerId) {
  const ai = state.players[aiPlayerId]; const humanId = aiPlayerId === 'ochre' ? 'indigo' : 'ochre'; const human = state.players[humanId];
  return {
    activePlayerId: state.activePlayerId, aiPlayerId, humanPlayerId: humanId, phase: state.phase, turn: state.turn,
    winner: state.winner, fighters: state.fighters, range: rangeBand(state),
    legalActions: listLegalActions(state).map((action) => ({ id: action.id, summary: action.label })),
    market: Object.values(CARDS).map(({ id, name, cost, text, type }) => ({ id, name, cost, text, type, count: type === 'action' ? state.supply[id] : null })),
    ai: {
      hand: ai.deck.hand.map((card) => ({ ...card, definition: CARDS[card.definitionId] })), money: ai.money,
      zones: { drawCount: ai.deck.draw.length, drawContentsUnordered: unordered(ai.deck.draw), discardCount: ai.deck.discard.length, discardContentsUnordered: unordered(ai.deck.discard), play: unordered(ai.deck.play) }
    },
    completedBuilds: state.players.ochre.startingBuild && state.players.indigo.startingBuild ? { ochre: state.players.ochre.startingBuild, indigo: state.players.indigo.startingBuild } : null,
    humanPublicCounts: { draw: human.deck.draw.length, hand: human.deck.hand.length, discard: human.deck.discard.length, play: human.deck.play.length },
    publicEvents: state.events
  };
}
export function buildAiStartingBuildBriefing() {
  return { budget: 12, baseDeck: Array<string>(7).fill('copper'), market: Object.values(CARDS).map(({ id, name, cost, text, type }) => ({ id, name, cost, text, type })) };
}
