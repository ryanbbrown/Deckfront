/** Prints a readable turn-by-turn trace of a saved game so the play can actually be read. */
import fs from 'node:fs';
import process from 'node:process';
import { applyCommand, registerKingdom, resolveCard } from '../src/game';
import type { GameState, PlayerId } from '../src/game';

const file = process.argv[2]!;
const record = JSON.parse(fs.readFileSync(file, 'utf8')) as {
  kingdom: unknown; initialState: GameState; committedCommands: { type: string }[];
  humanPlayerId: PlayerId; aiDifficulty: string; state: GameState; aiStrategy: unknown;
};
registerKingdom(record.kingdom as Parameters<typeof registerKingdom>[0]);
const ai: PlayerId = record.humanPlayerId === 'ochre' ? 'indigo' : 'ochre';

console.log(`ai=${ai} human=${record.humanPlayerId} difficulty=${record.aiDifficulty}`);
console.log(`ai strategy: ${JSON.stringify(record.aiStrategy)}`);
const market = (record.kingdom as { actionPiles: { cardId: string }[] }).actionPiles.map((p) => p.cardId);
console.log(`market: ${market.join(', ')}`);

let state = record.initialState;
const label = (id: PlayerId): string => (id === ai ? 'AI   ' : 'HUMAN');
const hand = (s: GameState, id: PlayerId): string =>
  s.players[id].deck.hand.map((c) => c.definitionId).sort().join(',');
const board = (s: GameState): string =>
  `[o@${s.fighters.ochre.position} ${s.fighters.ochre.health}hp | i@${s.fighters.indigo.position} ${s.fighters.indigo.health}hp]`;

let lastTurn = -1;
for (const command of record.committedCommands) {
  const actor = state.activePlayerId;
  if (state.turn !== lastTurn && state.phase === 'action') {
    lastTurn = state.turn;
    console.log(`\n--- turn ${state.turn} ${label(actor)} ${board(state)} hand: ${hand(state, actor)}`);
  }
  const before = { o: state.fighters.ochre.health, i: state.fighters.indigo.health };
  const type = command.type;
  let text = type;
  if ('cardInstanceId' in command) {
    const id = (command as { cardInstanceId: string }).cardInstanceId;
    const card = [...state.players[actor].deck.hand, ...state.players[actor].deck.play]
      .find((c) => c.id === id);
    const extra = 'movement' in command ? ` ${String((command as { movement: string }).movement)}`
      : 'direction' in command ? ` ${String((command as { direction: string }).direction)}` : '';
    const trash = 'trashInstanceIds' in command
      ? ` trash=${(command as { trashInstanceIds: string[] }).trashInstanceIds
        .map((t) => [...state.players[actor].deck.hand, ...state.players[actor].deck.play]
          .find((c) => c.id === t)?.definitionId ?? '?').join('+')}`
      : '';
    text = `play ${card ? resolveCard(state, card.definitionId).name : '?'}${extra}${trash}`;
  } else if (type === 'buyCard') {
    text = `buy ${(command as unknown as { definitionId: string }).definitionId}`;
  }

  state = applyCommand(state, command as Parameters<typeof applyCommand>[1]);
  const after = { o: state.fighters.ochre.health, i: state.fighters.indigo.health };
  const dealt = (before.o - after.o) + (before.i - after.i);
  if (type !== 'endActionPhase' && type !== 'endBuyPhase' && type !== 'submitStartingBuild') {
    console.log(`   ${label(actor)} ${text}${dealt ? `  -> ${dealt} damage` : ''}`
      + (dealt ? `  ${board(state)}` : ''));
  }
  if (type === 'endActionPhase') {
    const left = state.players[actor].deck.hand.map((c) => c.definitionId).sort().join(',');
    console.log(`   ${label(actor)} end action phase; left in hand: ${left || 'nothing'}`);
  }
}
console.log(`\nwinner: ${String(state.winner)} ${board(state)}`);
