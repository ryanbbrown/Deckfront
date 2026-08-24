import type { CardActionChoice, GameView } from '../shared/api';

export function Board({ game, movementChoices = [], busy = false, onMovement }: {
  game: GameView;
  movementChoices?: CardActionChoice[];
  busy?: boolean;
  onMovement?: (choice: CardActionChoice) => void;
}) {
  return (
    <div className="arena" aria-label="Six space line arena">
      {[1, 2, 3, 4, 5, 6].map((space) => {
        const fighters = Object.values(game.fighters).filter((candidate) => candidate.position === space);
        const movement = movementChoices.find((choice) => choice.destination === space);
        const contents = <>
          <span className="arena-space__number">{space}</span>
          <div className="arena-space__fighters">
            {fighters.map((fighter) => {
              const name = fighter.playerId === 'ochre' ? 'Player 1' : 'Player 2';
              const status = [fighter.aimed ? 'Aimed' : '', fighter.exposed ? 'Close-range attacks this turn: +1 damage' : ''].filter(Boolean).join(', ');
              return <div key={fighter.playerId} className={`fighter fighter--${fighter.playerId}`} data-player-id={fighter.playerId} data-position={space} data-player-score={fighter.playerId} title={name} aria-label={`${name}, ${fighter.health} health${status ? `, ${status}` : ''}`}>
                <strong>{fighter.playerId === 'ochre' ? 'P1' : 'P2'}</strong><small>{fighter.health} HP</small>{status ? <em>{status}</em> : null}
              </div>;
            })}
          </div>
          {movement ? <span className="arena-space__action">{movement.text}</span> : null}
        </>;
        return movement ? <button type="button" key={space} className="arena-space arena-space--choice" data-space={space} aria-label={movement.label} disabled={busy} onClick={() => onMovement?.(movement)}>{contents}</button>
          : <div key={space} className="arena-space" data-space={space}>{contents}</div>;
      })}
    </div>
  );
}
