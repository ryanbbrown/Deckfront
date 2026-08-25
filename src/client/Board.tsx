import { ARENA_MAX, ARENA_MIN } from '../game';
import type { PlayerId } from '../game';
import type { CardActionChoice, GameView } from '../shared/api';

export function FighterCounter({ playerId, health, aimed = false, exposed = false, position, damageFeedback }: {
  playerId: PlayerId; health: number; aimed?: boolean; exposed?: boolean; position?: number;
  damageFeedback?: { id: string; targetId: PlayerId; amount: number } | null | undefined;
}) {
  const name = playerId === 'ochre' ? 'Player 1' : 'Player 2';
  const statuses = [aimed ? 'Aimed' : '', exposed ? 'Exposed' : ''].filter(Boolean);
  const accessibleStatus = [aimed ? 'Aimed' : '', exposed ? 'Exposed, Close-range attacks this turn: +1 damage' : ''].filter(Boolean).join(', ');
  const damage = damageFeedback?.targetId === playerId ? damageFeedback : null;
  return <div role="img" className={`fighter fighter--${playerId}${damage ? ' fighter--damaged' : ''}`} data-player-id={playerId} data-position={position} data-player-score={playerId} title={name} aria-label={`${name}, ${health} health${accessibleStatus ? `, ${accessibleStatus}` : ''}`}>
    <span className="fighter__figure" aria-hidden="true"><svg viewBox="0 0 36 42"><path d="M7 40v-7c0-7 4-11 11-11s11 4 11 11v7z" fill="#26332e" stroke="#fff" strokeWidth="2"/><circle cx="18" cy="14" r="7" fill="#e7c49d" stroke="#fff" strokeWidth="2"/><path d="M10 14c0-7 3-10 8-10s8 3 8 10h-4c0-3-1-5-4-5s-4 2-4 5z" fill="#43524b" stroke="#fff" strokeWidth="1.5"/><path d="M4 31 30 5M26 5h5v5" fill="none" stroke="#f4e5b9" strokeWidth="2"/></svg></span>
    <span className="fighter__details"><strong>{playerId === 'ochre' ? 'P1' : 'P2'}</strong>{/* Fighters currently have a maximum of 50 health. */}<small style={{ '--health': `${String(Math.max(0, Math.min(100, health * 2)))}%` } as React.CSSProperties}>{health} HP</small></span>
    {statuses.length ? <em>{statuses.join(' · ')}</em> : null}{damage ? <span key={damage.id} className="damage-burst" data-damage-target={playerId} data-damage-amount={damage.amount}>−{damage.amount}</span> : null}
  </div>;
}

export function Board({ game, movementChoices = [], busy = false, damageFeedback, onMovement }: {
  game: GameView;
  movementChoices?: CardActionChoice[];
  busy?: boolean;
  damageFeedback?: { id: string; targetId: PlayerId; amount: number } | null;
  onMovement?: (choice: CardActionChoice) => void;
}) {
  const spaces = Array.from({ length: ARENA_MAX - ARENA_MIN + 1 }, (_, index) => ARENA_MIN + index);
  return (
    <div className="arena battlefield" role="group" aria-label="Six space line arena">
      {spaces.map((space) => {
        const fighters = Object.values(game.fighters).filter((candidate) => candidate.position === space);
        const movement = movementChoices.find((choice) => choice.destination === space);
        return <div key={space} className={`arena-space${fighters.length > 1 ? ' arena-space--shared' : ''}${movement ? ' arena-space--choice' : ''}`} data-space={space}>
          <span className="arena-space__number">{space}</span>
          {movement ? <button type="button" className="arena-space__choice-button" aria-label={movement.label} disabled={busy} onClick={() => onMovement?.(movement)} /> : null}
          <div className="arena-space__fighters">
            {fighters.map((fighter) => <FighterCounter key={fighter.playerId} playerId={fighter.playerId} health={fighter.health} aimed={fighter.aimed} exposed={fighter.exposed} position={space} damageFeedback={damageFeedback} />)}
          </div>
        </div>;
      })}
    </div>
  );
}
