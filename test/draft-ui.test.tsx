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

  it('renders Scrap from the shared card definition', () => {
    const html = renderToStaticMarkup(<article><CardFace card={CARDS.scrap!} /></article>);
    expect(html).toContain('Scrap'); expect(html).toContain('Deal 1 damage at any range.'); expect(html).toContain('Cost 0');
  });
});
