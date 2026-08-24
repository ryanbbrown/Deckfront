import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CardDefinition } from '../game';
import type { GameUpdateView, GameView, PresentationFrame } from '../shared/api';

export const AI_ANIMATION_KEY = 'deckfront.animateAiTurns';
export const PLAY_DURATION_MS = 280;
export const DRAW_DURATION_MS = 260;
export const DRAW_STAGGER_MS = 90;
export const HUMAN_SETTLE_MS = 80;
export const AI_SETTLE_MS = 220;

export interface Flight {
  id: string;
  card: CardDefinition;
  from: DOMRect;
  to: DOMRect;
  duration: number;
  delay: number;
  kind: 'play' | 'draw';
}

export function updateGame(update: GameUpdateView): GameView {
  const game = { ...update } as GameView & { presentation?: GameUpdateView['presentation'] };
  delete game.presentation;
  return game;
}

export function gameAtFrame(finalGame: GameView, frame: PresentationFrame, withheldIds: ReadonlySet<string> = new Set()): GameView {
  const players = Object.fromEntries((['ochre', 'indigo'] as const).map((playerId) => {
    const player = frame.state.players[playerId];
    return [playerId, {
      ...player,
      hand: player.hand.filter((card) => !withheldIds.has(card.id)),
      played: player.played.filter((card) => !withheldIds.has(card.id))
    }];
  })) as GameView['players'];
  return {
    ...finalGame,
    activePlayerId: frame.state.activePlayerId,
    phase: frame.state.phase,
    turn: frame.state.turn,
    winner: frame.state.winner,
    fighters: frame.state.fighters,
    range: frame.state.range,
    supply: frame.state.supply,
    players,
    trashCount: frame.state.trashCount,
    events: finalGame.events.slice(0, frame.eventCount),
    actions: { cards: [], phases: [], buys: [], selection: null }
  };
}

export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return reduced;
}

export function FlyingCards({ flights, renderCard }: { flights: Flight[]; renderCard: (card: CardDefinition) => React.ReactNode }) {
  if (!flights.length) return null;
  return createPortal(<div className="flight-layer" aria-hidden="true">{flights.map((flight) => {
    const dx = flight.to.left - flight.from.left;
    const dy = flight.to.top - flight.from.top;
    const scaleX = flight.to.width / flight.from.width;
    const scaleY = flight.to.height / flight.from.height;
    return <article key={flight.id} className={`card full-card flying-card flying-card--${flight.kind} card--${flight.card.family}`} data-flying-card={flight.card.name} data-flight-kind={flight.kind} style={{
      left: flight.from.left, top: flight.from.top, width: flight.from.width, height: flight.from.height,
      '--flight-x': `${dx}px`, '--flight-y': `${dy}px`, '--flight-scale-x': String(scaleX), '--flight-scale-y': String(scaleY),
      animationDuration: `${flight.duration}ms`, animationDelay: `${flight.delay}ms`
    } as React.CSSProperties}>{renderCard(flight.card)}</article>;
  })}</div>, document.body);
}
