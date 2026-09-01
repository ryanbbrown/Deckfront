import { ARENA_MAX, ARENA_MIN } from '../game';
import type { PlayerId } from '../game';
import type { CardActionChoice, GameView } from '../shared/api';
import { playerLabel, playerShortLabel } from './playerLabel';

export function FighterCounter({ playerId, health, aimBonus = 0, exposed = false, position, damageFeedback, label, shortLabel }: {
  playerId: PlayerId; health: number; aimBonus?: number; exposed?: boolean; position?: number;
  damageFeedback?: { id: string; targetId: PlayerId; amount: number } | null | undefined; label: string; shortLabel: string;
}) {
  const statuses = [aimBonus ? `Aimed +${aimBonus}` : '', exposed ? 'Exposed' : ''].filter(Boolean);
  const accessibleStatus = [aimBonus ? `Aimed, next Ranged attack: +${aimBonus} damage` : '', exposed ? 'Exposed, Close-range attacks this turn: +1 damage' : ''].filter(Boolean).join(', ');
  const damage = damageFeedback?.targetId === playerId ? damageFeedback : null;
  return <div role="img" className={`fighter fighter--${playerId}${damage ? ' fighter--damaged' : ''}`} data-player-id={playerId} data-position={position} data-player-score={playerId} title={label} aria-label={`${label}, ${health} health${accessibleStatus ? `, ${accessibleStatus}` : ''}`}>
    <span className="fighter__figure" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 4 39 9v12c0 11-6 18-15 23C15 39 9 32 9 21V9z" fill="#f4e5b9" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round"/><path d="M24 10v27M14 18h20" fill="none" stroke="#26332e" strokeWidth="3"/><circle cx="24" cy="18" r="4" fill="#f4e5b9" stroke="#26332e" strokeWidth="2"/></svg></span>
    <span className="fighter__details"><strong>{shortLabel}</strong><small style={{ '--health': `${String(Math.max(0, Math.min(100, health / 50 * 100)))}%` } as React.CSSProperties}><span>{health} HP</span></small></span>
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
            {fighters.map((fighter) => <FighterCounter key={fighter.playerId} playerId={fighter.playerId} health={fighter.health} aimBonus={fighter.aimBonus} exposed={fighter.exposed} position={space} damageFeedback={damageFeedback} label={playerLabel(game, fighter.playerId)} shortLabel={playerShortLabel(game, fighter.playerId)} />)}
          </div>
        </div>;
      })}
    </div>
  );
}
