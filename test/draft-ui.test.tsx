import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARDS } from '../src/game';
import { createGame } from '../src/client/api';
import { CardFace } from '../src/client/Game';

afterEach(() => vi.unstubAllGlobals());
describe('draft UI request boundary', () => {
  it('sends startingDraftEnabled in the strict create request', async () => {
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
      body = String(options?.body); return new Response(JSON.stringify({ id:'game' }), { status:201, headers:{ 'content-type':'application/json' } });
    }));
    await createGame({ mode:'local', variableCardIds:['cull','footwork','aim','volley','feint','drive','muster','prism','reclaim','starfire'], startingDraftEnabled:false });
    expect(JSON.parse(body)).toEqual({ mode:'local', variableCardIds:['cull','footwork','aim','volley','feint','drive','muster','prism','reclaim','starfire'], startingDraftEnabled:false });
  });

  it('renders structured card copy without inferring a headline split', () => {
    const scrap = renderToStaticMarkup(<article><CardFace card={CARDS.scrap!} /></article>);
    expect(scrap).toContain('<strong class="card__headline">1 damage at any range</strong>');
    expect(scrap).toContain('<small class="card__detail">Only the first Scrap you play each turn deals damage.</small>');
    expect(scrap).toContain('Cost 0');

    const precision = renderToStaticMarkup(<article><CardFace card={CARDS.precisionShot!} /></article>);
    expect(precision).toContain('<strong class="card__headline">4 damage</strong>');
    expect(precision).toContain('<small class="card__detail">Other Precision Shots you play this turn deal 2 damage instead.</small>');
    expect(precision).not.toContain('At Near or Far range');
  });

  it('keeps family eligibility implicit and range-dependent effects explicit', () => {
    const copy = (id: string) => `${CARDS[id]!.headline} ${CARDS[id]!.detail ?? ''}`;
    for (const card of Object.values(CARDS).filter((candidate) => candidate.family === 'melee')) {
      expect(`${card.headline} ${card.detail ?? ''}`).not.toContain('At Close range');
    }
    for (const card of Object.values(CARDS).filter((candidate) => candidate.family === 'ranged')) {
      expect(`${card.headline} ${card.detail ?? ''}`).not.toContain('At Near or Far range');
    }
    for (const card of Object.values(CARDS).filter((candidate) => candidate.family === 'mana')) {
      expect(`${card.headline} ${card.detail ?? ''}`).not.toContain('at any range');
    }
    expect(copy('volley')).toContain('Near: 1 damage · Far: 4 damage');
    expect(copy('repellingShot')).toContain('Far: 2 damage · Near: 1 damage');
    expect(copy('scrap')).toContain('at any range');
  });
});
