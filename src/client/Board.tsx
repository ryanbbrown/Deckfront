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
                return <div key={fighter.playerId} className={`fighter fighter--${fighter.playerId}`} data-player-id={fighter.playerId} data-position={space} title={name} aria-label={name}>
                  {fighter.playerId === 'ochre' ? 'P1' : 'P2'}
                </div>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
