import type { GameView } from '../shared/api';

export function Board({ game }: { game: GameView }) {
  return (
    <div className="arena" role="img" aria-label="Five space line arena">
      {[1, 2, 3, 4, 5].map((space) => {
        const fighters = Object.values(game.fighters).filter((candidate) => candidate.position === space);
        return (
          <div key={space} className="arena-space" data-space={space}>
            <span className="arena-space__number">{space}</span>
            <div className="arena-space__fighters">
              {fighters.map((fighter) => {
                const name = fighter.playerId === 'ochre' ? 'Player 1' : 'Player 2';
                const status = [fighter.aimed ? 'Aimed' : '', fighter.exposed ? 'Next Close-range attack this turn: +2 damage' : ''].filter(Boolean).join(', ');
                return <div key={fighter.playerId} className={`fighter fighter--${fighter.playerId}`} data-player-id={fighter.playerId} data-position={space} data-player-score={fighter.playerId} title={name} aria-label={`${name}, ${fighter.health} health${status ? `, ${status}` : ''}`}>
                  <strong>{fighter.playerId === 'ochre' ? 'P1' : 'P2'}</strong><small>{fighter.health} HP</small>{status ? <em>{status}</em> : null}
                </div>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
