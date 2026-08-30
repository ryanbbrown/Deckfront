import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardFace } from '../src/client/Game';
import { groupCardCatalog } from '../src/client/cardCatalog';
import { CARDS } from '../src/game';

describe('card catalog assets and presentation', () => {
  it('has one selected public image for every card definition', () => {
    const ids = Object.keys(CARDS).sort();
    const imageIds = readdirSync(path.resolve('public/card-art'))
      .filter((file) => file.endsWith('.jpg'))
      .map((file) => file.slice(0, -4))
      .sort();
    expect(imageIds).toEqual(ids);
    for (const id of ids) expect(existsSync(path.resolve('public/card-art', `${id}.jpg`)), id).toBe(true);
  });

  it('groups every card in family, cost, and name order', () => {
    const actual = groupCardCatalog(Object.values(CARDS)).map((group) => ({
      heading: group.heading,
      cards: group.cards.map((card) => `${card.name}:${card.cost}`)
    }));
    expect(actual).toEqual([
      { heading: 'Treasure', cards: ['Copper:0', 'Silver:3', 'Gold:6'] },
      { heading: 'Engine', cards: ['Scrap:0', 'Discipline:2', 'Step:2', 'Cull:3', 'Footwork:3', 'Reclaim:3', 'Regroup:3', 'Sharpen:3', 'Stipend:3', 'Adapt:4', 'Reforge:4', 'Improvise:5', 'Muster:5', 'Scour:5', 'Regiment:7'] },
      { heading: 'Melee', cards: ['Bull Rush:3', 'Jab:3', 'Opening Strike:3', 'Rally:3', 'Strike:3', 'Drive:4', 'Feint:5', 'Flurry:5', 'Heavy Blow:5'] },
      { heading: 'Ranged', cards: ['Longshot:3', 'Peppering Shot:3', 'Steady Shot:3', 'Repelling Shot:4', 'Salvage Shot:4', 'Aim:5', 'Precision Shot:5', 'Volley:5'] },
      { heading: 'Mana', cards: ['Focus:1', 'Channel:3', 'Ley Step:3', 'Arc Bolt:4', 'Attune:4', 'Discharge:4', 'Cascade:5', 'Fireball:5', 'Overload:5', 'Prism:5', 'Starfire:6'] }
    ]);
  });

  it('renders the selected art URL from the card id', () => {
    const markup = renderToStaticMarkup(<CardFace card={CARDS.drive!} />);
    expect(markup).toContain('class="card__image"');
    expect(markup).toContain('src="/card-art/drive.jpg"');
    expect(markup).toContain('loading="eager"');
  });
});
