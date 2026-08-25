import { createCard, kingdomOf, kingdomSupply } from '../../src/game';
import { test, expect, makeAiGame, seedHand, seedPlayerHand } from './fixture';

type CardBounds = { left: number; top: number; width: number; height: number };
async function playCard(page: import('@playwright/test').Page, name: string) { await page.locator(`[data-card-name="${name}"]`).first().click(); }
async function bounds(locator: import('@playwright/test').Locator): Promise<CardBounds> {
  return locator.evaluate((element) => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; });
}
function expectSameBounds(actual: CardBounds, expected: CardBounds): void {
  expect(actual.left).toBeCloseTo(expected.left, 0); expect(actual.top).toBeCloseTo(expected.top, 0);
  expect(actual.width).toBeCloseTo(expected.width, 0); expect(actual.height).toBeCloseTo(expected.height, 0);
}
interface RecordedFlight { name: string; kind: string; at: number; source: CardBounds; target: CardBounds; destinations: CardBounds[]; earlyCardCount: number }
async function recordFlights(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const target = (element: HTMLElement) => ({
      left: Number.parseFloat(element.style.left) + Number.parseFloat(element.style.getPropertyValue('--flight-x')),
      top: Number.parseFloat(element.style.top) + Number.parseFloat(element.style.getPropertyValue('--flight-y')),
      width: Number.parseFloat(element.style.width) * Number.parseFloat(element.style.getPropertyValue('--flight-scale-x')),
      height: Number.parseFloat(element.style.height) * Number.parseFloat(element.style.getPropertyValue('--flight-scale-y'))
    });
    const rect = (element: Element) => { const value = element.getBoundingClientRect(); return { left: value.left, top: value.top, width: value.width, height: value.height }; };
    const state = window as typeof window & { recordedFlights?: RecordedFlight[]; recordedAiSources?: Record<string, CardBounds> };
    state.recordedFlights = []; state.recordedAiSources = {};
    new MutationObserver(() => {
      document.querySelectorAll<HTMLElement>('.hand-panel--ai [data-card-name]').forEach((card) => { const name = card.dataset.cardName!; state.recordedAiSources![name] ??= rect(card); });
      document.querySelectorAll<HTMLElement>('[data-flying-card]:not([data-recorded])').forEach((flight) => {
        flight.dataset.recorded = 'true'; const name = flight.dataset.flyingCard!; const kind = flight.dataset.flightKind!;
        const definitionId = name.replaceAll(' ', '').replace(/^./, (letter) => letter.toLowerCase());
        const destination = kind === 'draw' ? `drawToHand-${definitionId}` : `handToPlayed-${definitionId}`;
        const delay = Number.parseFloat(flight.style.animationDelay) || 0;
        state.recordedFlights!.push({ name, kind, at: performance.now() + delay, source: { left: Number.parseFloat(flight.style.left), top: Number.parseFloat(flight.style.top), width: Number.parseFloat(flight.style.width), height: Number.parseFloat(flight.style.height) }, target: target(flight), destinations: [...document.querySelectorAll(`[data-animation-destination="${destination}"]`)].map((element) => rect(element.querySelector('.hand-card-frame') ?? element)), earlyCardCount: document.querySelectorAll(`[data-card-name="${name}"]`).length });
      });
    }).observe(document.body, { childList: true, subtree: true });
  });
}
async function recordedFlights(page: import('@playwright/test').Page): Promise<RecordedFlight[]> {
  return page.evaluate(() => (window as typeof window & { recordedFlights?: RecordedFlight[] }).recordedFlights ?? []);
}
async function recordedAiSource(page: import('@playwright/test').Page, name: string): Promise<CardBounds | null> {
  return page.evaluate((cardName) => (window as typeof window & { recordedAiSources?: Record<string, CardBounds> }).recordedAiSources?.[cardName] ?? null, name);
}
async function recordDamageFeedback(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as typeof window & { recordedDamage?: Array<{ target: string; amount: string }> }; state.recordedDamage = [];
    new MutationObserver(() => document.querySelectorAll<HTMLElement>('[data-damage-target]:not([data-recorded])').forEach((marker) => {
      marker.dataset.recorded = 'true'; state.recordedDamage!.push({ target: marker.dataset.damageTarget!, amount: marker.dataset.damageAmount! });
    })).observe(document.body, { childList: true, subtree: true });
  });
}
async function marketLayout(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const cardRects = [...document.querySelectorAll<HTMLElement>('.reference-card')].map((card) => card.getBoundingClientRect());
    const imageRects = [...document.querySelectorAll<HTMLElement>('.reference-card .card__image')].map((image) => image.getBoundingClientRect());
    const surface = rect('.market-dialog__surface'); const overlay = rect('.market-dialog'); const rail = rect('.setup-rail,.action-rail');
    const grid = document.querySelector<HTMLElement>('.market-dialog__grid')!;
    return {
      surface: { left: surface.left, top: surface.top, right: surface.right, bottom: surface.bottom, width: surface.width, height: surface.height },
      centeredInTable: Math.abs((surface.left + surface.right) / 2 - (overlay.left + overlay.right) / 2) < 2,
      clearOfRail: overlay.right <= rail.left,
      cardWidths: [...new Set(cardRects.map((card) => Math.round(card.width)))],
      cardHeights: [...new Set(cardRects.map((card) => Math.round(card.height)))],
      rows: new Set(cardRects.map((card) => Math.round(card.top))).size,
      columns: new Set(cardRects.map((card) => Math.round(card.left))).size,
      imageHeights: [...new Set(imageRects.map((image) => Math.round(image.height)))],
      overflow: { horizontal: document.documentElement.scrollWidth - innerWidth, vertical: document.documentElement.scrollHeight - innerHeight },
      gridOverflow: { horizontal: grid.scrollWidth - grid.clientWidth, vertical: grid.scrollHeight - grid.clientHeight },
      viewport: { width: innerWidth, height: innerHeight }
    };
  });
}

test('DD-E2E-001: full-table preview refreshes, explains, and keeps both local builds', async ({ page, baseUrl }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'Deckfront' })).toBeVisible(); await expect(page.getByText('Choose a kingdom')).toBeVisible(); await expect(page.getByLabel('Game setup')).toBeVisible(); await expect(page.getByText('I go first', { exact: true })).toHaveCount(0); await expect(page.getByText('AI goes first', { exact: true })).toHaveCount(0); await expect(page.getByRole('group', { name: 'AI strength' })).toHaveCount(0);
  await expect(page.locator('[data-market-card="Step"]')).toBeVisible(); await expect(page.locator('[data-market-card="Focus"]')).toBeVisible(); await expect(page.locator('[data-market-card="Scrap"]')).toHaveCount(0); await expect(page.locator('[data-market-card]')).toHaveCount(15); await expect(page.locator('[data-market-card][aria-disabled="true"]')).toHaveCount(15); await expect(page.getByLabel('Starting draft')).not.toBeChecked();
  const compactWidths = await page.locator('[data-market-card]').evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().width)));
  expect([...new Set(compactWidths)]).toEqual([137]);
  await page.locator('[data-market-card="Step"]').locator('..').click({ button: 'right' }); const cardPopup = page.getByRole('dialog', { name: 'Step details' }); await expect(cardPopup).toBeVisible(); await expect(cardPopup).toContainText('Move 1 space'); await expect(cardPopup.getByLabel('Cost 2')).toBeVisible(); expect(await cardPopup.evaluate((element) => element.matches(':modal'))).toBe(true); expect(Number.parseFloat(await cardPopup.locator('.card__rules').evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(7); await page.keyboard.press('Escape'); await expect(cardPopup).toHaveCount(0);
  const before = await page.locator('.market-group').nth(1).locator('[data-market-card]').allTextContents(); await page.getByRole('button', { name: 'Refresh market' }).click(); const after = await page.locator('.market-group').nth(1).locator('[data-market-card]').allTextContents(); expect(after).not.toEqual(before);
  for (const viewport of [{ width: 1690, height: 1550 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
    await page.setViewportSize(viewport); await page.getByRole('button', { name: 'Card reference' }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.locator('.market-dialog .reference-card')).toHaveCount(15); await expect(page.locator('.market-dialog .card__image')).toHaveCount(15);
    const layout = await marketLayout(page); expect(layout.cardWidths).toEqual([148]); expect(layout.cardHeights).toEqual([220]); expect(layout.imageHeights).toEqual([96]); expect(layout.rows).toBe(3); expect(layout.columns).toBe(5); expect(layout.surface.width).toBeLessThanOrEqual(840); expect(layout.surface.height).toBeLessThanOrEqual(780); expect(layout.surface.left).toBeGreaterThanOrEqual(0); expect(layout.surface.top).toBeGreaterThanOrEqual(0); expect(layout.surface.right).toBeLessThanOrEqual(layout.viewport.width); expect(layout.surface.bottom).toBeLessThanOrEqual(layout.viewport.height); expect(layout.centeredInTable).toBe(true); expect(layout.clearOfRail).toBe(true); expect(layout.overflow).toEqual({ horizontal: 0, vertical: 0 }); expect(layout.gridOverflow).toEqual({ horizontal: 0, vertical: 0 }); await page.getByRole('button', { name: 'Close market' }).click();
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByLabel('Starting draft').check(); await page.getByRole('button', { name: 'Start game' }).click(); await page.locator('[data-market-card="Copper"]').click(); await page.locator('[data-market-card="Copper"]').click(); await page.locator('[data-market-card="Step"]').click(); await expect(page.getByTestId('build-budget')).toHaveText('2 / 12 · 3 carries');
  await page.reload(); await expect(page.getByRole('button', { name: 'Remove Copper' })).toHaveCount(2); await page.getByRole('button', { name: 'Remove Copper' }).first().click();
  await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByText('Player 2 starting build')).toBeVisible();
  await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Copper"]')).toHaveText('Copper×7'); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Step"]')).toHaveCount(0); await expect(page.getByTestId('deck-summary-indigo').locator('[data-deck-card="Copper"]')).toHaveText('Copper×7');
  await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Copper"]')).toHaveText('Copper×8'); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Step"]')).toHaveText('Step×1');
  await expect(page.getByText(/Turn 1 · Player 1 action/)).toBeVisible();
});
test('DD-E2E-074: shipped card art has valid JPEG delivery, decoding, dimensions, and cache policy', async ({ page, baseUrl }) => {
  await page.goto(baseUrl);
  const delivery = await page.evaluate(async () => {
    const response = await fetch('/card-art/drive.jpg');
    const image = new Image(); image.src = '/card-art/drive.jpg'; document.body.append(image); await image.decode();
    const script = document.querySelector<HTMLScriptElement>('script[src*="/assets/"]')!;
    const hashed = await fetch(script.src, { method: 'HEAD' });
    return {
      status: response.status, type: response.headers.get('content-type'), cache: response.headers.get('cache-control'),
      width: image.naturalWidth, height: image.naturalHeight,
      hashedStatus: hashed.status, hashedCache: hashed.headers.get('cache-control')
    };
  });
  expect(delivery).toEqual({ status: 200, type: 'image/jpeg', cache: 'no-cache', width: 800, height: 536,
    hashedStatus: 200, hashedCache: 'public, max-age=31536000, immutable' });
});

test('DD-E2E-075: arena semantics and focused card controls support accessible inspection', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['drive']); });
  const arena = page.getByRole('group', { name: 'Six space line arena' }); await expect(arena).toBeVisible();
  await expect(arena.getByRole('img', { name: /Player 1, 47 health/ })).toBeVisible();
  await expect(arena.getByRole('img', { name: /Player 2, 50 health/ })).toBeVisible();

  const copper = page.locator('[data-market-card="Copper"]'); await copper.focus(); await page.keyboard.press('Shift+F10');
  let inspector = page.getByRole('dialog', { name: 'Copper details' }); await expect(inspector).toBeVisible();
  const close = inspector.getByRole('button', { name: 'Close card details' }); await expect(close).toBeVisible(); await close.click();

  const drive = page.locator('[data-card-name="Drive"]'); await drive.focus(); await page.keyboard.press('ContextMenu');
  inspector = page.getByRole('dialog', { name: 'Drive details' }); await expect(inspector).toBeVisible(); await inspector.getByRole('button', { name: 'Close card details' }).click();
  await copper.click({ button: 'right', force: true }); await expect(page.getByRole('dialog', { name: 'Copper details' })).toBeVisible();
});

test('DD-E2E-073: full card catalog covers the viewport and shows all cards in approved order', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await openGame(page);
  const controls = page.getByRole('navigation', { name: 'Game controls' });
  await expect(controls.locator('button')).toHaveText(['Undo', 'Reset', 'New game', 'View all cards']);
  await controls.getByRole('button', { name: 'View all cards' }).click();
  const dialog = page.getByRole('dialog', { name: 'All cards' }); await expect(dialog).toBeVisible();
  await expect(dialog.locator('.catalog-card')).toHaveCount(46);
  await expect(dialog.locator('.catalog-section > h3')).toHaveText(['Treasure', 'Engine', 'Melee', 'Ranged', 'Mana']);
  const familyCards = async (family: string) => dialog.locator(`[data-catalog-family="${family}"] [data-card-name]`).evaluateAll((cards) => cards.map((card) => `${card.getAttribute('data-card-name')}:${card.getAttribute('data-card-cost')}`));
  expect(await familyCards('treasure')).toEqual(['Copper:0', 'Silver:3', 'Gold:6']);
  expect((await familyCards('engine')).slice(0, 5)).toEqual(['Scrap:0', 'Discipline:2', 'Step:2', 'Cull:3', 'Footwork:3']);
  expect((await familyCards('melee')).slice(-3)).toEqual(['Feint:5', 'Flurry:5', 'Heavy Blow:5']);
  expect((await familyCards('ranged')).slice(0, 3)).toEqual(['Peppering Shot:3', 'Repelling Shot:3', 'Steady Shot:3']);
  expect((await familyCards('mana')).slice(-3)).toEqual(['Overload:5', 'Prism:5', 'Starfire:6']);
  const layout = await dialog.evaluate((overlay) => {
    const rect = (element: Element) => element.getBoundingClientRect(); const overlayBox = rect(overlay);
    const cards = [...overlay.querySelectorAll('.catalog-card')].map(rect); const body = overlay.querySelector<HTMLElement>('.catalog-dialog__body')!;
    return { overlay: { left: overlayBox.left, top: overlayBox.top, width: overlayBox.width, height: overlayBox.height }, cardWidths: [...new Set(cards.map((card) => Math.round(card.width)))], cardHeights: [...new Set(cards.map((card) => Math.round(card.height)))], bodyScrolls: body.scrollHeight > body.clientHeight, pageOverflow: { horizontal: document.documentElement.scrollWidth - innerWidth, vertical: document.documentElement.scrollHeight - innerHeight }, viewport: { width: innerWidth, height: innerHeight } };
  });
  expect(layout.overlay).toEqual({ left: 0, top: 0, width: layout.viewport.width, height: layout.viewport.height }); expect(layout.cardWidths).toEqual([222]); expect(layout.cardHeights).toEqual([330]); expect(layout.bodyScrolls).toBe(true); expect(layout.pageOverflow).toEqual({ horizontal: 0, vertical: 0 });
  const headerTop = await dialog.locator('.catalog-dialog__surface > header').evaluate((header) => header.getBoundingClientRect().top); await dialog.locator('.catalog-dialog__body').evaluate((body) => { body.scrollTop = body.scrollHeight; }); await expect(dialog.getByRole('heading', { name: 'Mana' })).toBeVisible(); expect(await dialog.locator('.catalog-dialog__surface > header').evaluate((header) => header.getBoundingClientRect().top)).toBe(headerTop);
  await dialog.getByRole('button', { name: 'Close all cards' }).click(); await expect(dialog).toHaveCount(0);
  await controls.getByRole('button', { name: 'View all cards' }).click(); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await controls.getByRole('button', { name: 'View all cards' }).click(); await dialog.click({ position: { x: 5, y: 5 } }); await expect(dialog).toHaveCount(0);
});

test('DD-E2E-035: two local players draft in sequence and take complete turns on one browser', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByLabel('Starting draft').check(); await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByText('Player 1 starting build')).toBeVisible(); await page.locator('[data-market-card="Step"]').click(); await page.getByRole('button', { name: 'Finish starting build' }).click();
  await expect(page.getByText('Player 2 starting build')).toBeVisible(); await page.locator('[data-market-card="Focus"]').click(); await page.getByRole('button', { name: 'Finish starting build' }).click();
  await expect(page.getByText(/Turn 1 · Player 1 action/)).toBeVisible(); await expect(page.getByRole('heading', { name: 'Player 1 hand' })).toBeVisible(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('title', 'Player 1'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('title', 'Player 2');
  await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByText(/Turn 1 · Player 1 buy/)).toBeVisible(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 1 · Player 1 action/)).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 2 · Player 2 action/)).toBeVisible(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 1 · Player 1 buy/)).toBeVisible();
  await page.getByRole('button', { name: 'End Buy phase' }).click(); await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible();
});

test('DD-E2E-002: repeated Copper Silver and Gold buys stay available and show public purchase names', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, Array<string>(10).fill('gold')); record.state.players.ochre.firstBuyMoney = 0; });
  await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByTestId('zone-money')).toContainText('30');
  await page.locator('[data-market-card="Copper"]').click(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByTestId('action-log').getByText('Bought Copper')).toHaveCount(0);
  for (const name of ['Copper', 'Copper', 'Silver', 'Silver', 'Gold', 'Gold']) { await page.locator(`[data-market-card="${name}"]`).click(); }
  await expect(page.getByTestId('zone-money')).toContainText('12'); await expect(page.getByTestId('action-log').getByText(/^Bought /)).toHaveCount(6); await expect(page.locator('[data-market-card="Copper"]')).toBeEnabled(); await expect(page.locator('[data-market-card="Silver"]')).toBeEnabled(); await expect(page.locator('[data-market-card="Gold"]')).toBeEnabled();
});

test('DD-E2E-003: Footwork offers Stay, draws without moving, then can move into a shared space', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork'], ['aim']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await page.locator('[data-card-name="Footwork"]').click(); await expect(page.getByRole('button', { name: 'Play Footwork: Left' })).toHaveText(''); await expect(page.getByRole('button', { name: 'Play Footwork: Stay' })).toHaveText(''); await expect(page.getByRole('button', { name: 'Play Footwork: Right' })).toHaveText(''); await expect(page.getByRole('button', { name: 'Play Footwork: Left' }).locator('..')).toHaveClass(/arena-space--choice/); await expect(page.locator('.choice-bar').filter({ hasText: 'Choose movement' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel movement' }).click(); await expect(page.locator('.arena-space__choice-button')).toHaveCount(0); await expect(page.locator('[data-card-name="Footwork"]')).not.toHaveClass(/card--selected/); await page.locator('[data-card-name="Footwork"]').click();
  await page.getByRole('button', { name: 'Play Footwork: Stay' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '2'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3'); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await expect(page.getByTestId('action-log').getByText('Stayed on space 2')).toBeVisible();
  await page.getByRole('button', { name: 'Undo last action' }).click(); await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '3'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3'); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces');
});

test('DD-E2E-004: Cull selects itself plus one hand card and trashes both', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull', 'copper', 'silver']); });
  await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Copper"]').click(); await expect(page.getByText('2 selected.')).toBeVisible();
  await page.getByRole('button', { name: 'Trash selected cards' }).click(); await expect(page.getByTestId('action-log').getByText('Trashed Cull')).toBeVisible(); await expect(page.getByTestId('action-log').getByText('Trashed Copper')).toBeVisible();
  await expect(page.locator('[data-card-name="Silver"]')).toBeVisible(); await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0);
});

test('DD-E2E-005: Muster draws immediately and global Undo restores the hand', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster']); record.state.players.ochre.deck.discard.push(...['aim', 'volley'].map((id) => ({ id: `extra-${id}`, definitionId: id }))); record.state.nextCardSerial += 2; });
  await playCard(page, 'Muster'); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await expect(page.locator('[data-card-name="Volley"]')).toBeVisible(); await expect(page.getByRole('button', { name: 'Undo last action' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.locator('[data-card-name="Muster"]')).toBeVisible(); await expect(page.locator('[data-card-name="Aim"]')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Undo last action' })).toBeDisabled();
});

test('DD-E2E-006: Close Feint states its damage bonus and Drive moves both fighters', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 3; record.state.fighters.indigo.position = 3; });
  expect(Number.parseFloat(await page.locator('[data-card-name="Feint"] .card__rules').evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(8); expect(Number.parseFloat(await page.locator('[data-card-name="Drive"] .card__rules').evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(7);
  await playCard(page, 'Feint'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('Close-range attacks this turn: +1 damage'); await expect(page.locator('[data-player-score="indigo"]')).not.toContainText('Exposed');
  await page.locator('[data-card-name="Drive"]').click(); await expect(page.getByRole('button', { name: 'Play Drive: Move Both Left' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Play Drive: Move Both Right' })).toBeVisible(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click();
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('46 HP'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '4'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces'); await expect(page.locator('.play-order')).toHaveCount(0); await expect(page.getByText('Numbers show play order.')).toHaveCount(0); await expect(page.getByTestId('action-log').getByText('Moved both fighters right to space 4')).toBeVisible();
  await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('50 HP'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('Close-range attacks this turn: +1 damage'); await page.locator('[data-card-name="Drive"]').click(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('46 HP');
});

test('DD-E2E-007: six visible Footwork plays make uncapped Close Flurry deal six damage', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'footwork', 'footwork', 'footwork', 'footwork', 'footwork', 'flurry']); record.state.fighters.ochre.position = 3; record.state.fighters.indigo.position = 3; });
  for (let count = 0; count < 6; count += 1) { await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Stay' }).click(); }
  await playCard(page, 'Flurry'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('44 HP'); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces');
});

test('DD-E2E-008: consecutive Footwork cards can move onto and past the opponent', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'footwork']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces');
  await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3'); await expect(page.getByTestId('range')).toHaveText('Near · 1 space');
});

test('DD-E2E-009: Far Aim applies Aimed and Volley deals six', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 5; });
  await playCard(page, 'Aim'); await expect(page.locator('[data-player-score="ochre"]')).toContainText('Aimed');
  await playCard(page, 'Volley'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('44 HP'); await expect(page.locator('[data-player-score="ochre"]')).not.toContainText('Aimed');
});

test('DD-E2E-010: close combination resolves Footwork Feint Drive Flurry for eight damage', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'feint', 'drive', 'flurry']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 2; });
  await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await playCard(page, 'Feint'); await page.locator('[data-card-name="Drive"]').click(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click(); await playCard(page, 'Flurry');
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('42 HP'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '3'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3');
});

test('DD-E2E-011: ranged escape uses two Footwork cards then Aim and Volley for six at Far', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'footwork', 'aim', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 2; });
  for (let count = 0; count < 2; count += 1) { await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); }
  await playCard(page, 'Aim'); await playCard(page, 'Volley');
  await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.getByTestId('range')).toHaveText('Far · 2 spaces'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('44 HP');
});

test('DD-E2E-012: winning Volley can be undone and a repeated win persists across refresh', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['volley', 'copper']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 5; record.state.fighters.indigo.health = 3; });
  await page.locator('[data-card-name="Volley"]').click(); await expect(page.getByText('Player 1 wins')).toBeVisible(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 1 · Player 1 action/)).toBeVisible(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('3 HP');
  await page.locator('[data-card-name="Volley"]').click(); await expect(page.getByText('Player 1 wins')).toBeVisible(); await page.reload(); await expect(page.getByText('Player 1 wins')).toBeVisible(); await page.getByRole('button', { name: 'New game' }).click(); await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
});

test('DD-E2E-013: wall-blocked direction is absent and Close blocks Aim and Volley', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'aim', 'volley']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 1; });
  await page.locator('[data-card-name="Footwork"]').click(); await expect(page.getByRole('button', { name: 'Play Footwork: Left' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Play Footwork: Stay' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Play Footwork: Right' })).toBeVisible(); await expect(page.locator('[data-card-name="Aim"]')).toContainText('Requires Near or Far range.'); await expect(page.locator('[data-card-name="Volley"]')).toContainText('Requires Near or Far range.');
});

test('DD-E2E-014: chosen Drive direction into a wall deals exact six damage and moves neither fighter', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 6; record.state.fighters.indigo.position = 6; });
  await playCard(page, 'Feint'); await page.locator('[data-card-name="Drive"]').click(); const wall = page.getByRole('button', { name: 'Play Drive: Move Both Right' }); await expect(wall).toHaveAccessibleName('Play Drive: Move Both Right'); await expect(wall.locator('..')).toHaveAttribute('data-space', '6'); await wall.click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('44 HP'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '6'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '6'); await expect(page.getByTestId('action-log').getByText('Wall blocked right; neither fighter moved')).toBeVisible();
});

test('DD-E2E-015: two unprepared Near Volleys deal two and Aim plus Near Volley deals three', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['volley', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await page.locator('[data-card-name="Volley"]').first().click(); await playCard(page, 'Volley'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('48 HP');
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; }); await playCard(page, 'Aim'); await playCard(page, 'Volley'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('47 HP');
});

test('DD-E2E-016: Cull trashes two other hand cards and never offers an already played card', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'cull', 'copper', 'silver']); });
  await playCard(page, 'Muster'); await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Copper"]').click(); await page.locator('[data-card-name="Silver"]').click();
  await expect(page.locator('[data-card-name="Muster"]')).toHaveCount(0); await page.getByRole('button', { name: 'Trash selected cards' }).click(); await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0); await expect(page.getByTestId('action-log').getByText('Trashed Copper')).toBeVisible(); await expect(page.getByTestId('action-log').getByText('Trashed Silver')).toBeVisible();
});

test('DD-E2E-017: Vault is absent and close cards are enabled in a shared space', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 2; });
  await expect(page.locator('[data-card-name="Vault"]')).toHaveCount(0); await expect(page.locator('[data-market-card="Vault"]')).toHaveCount(0); await expect(page.locator('[data-card-name="Feint"]')).toBeEnabled(); await expect(page.locator('[data-card-name="Drive"]')).toBeEnabled();
});

test('DD-E2E-018: Feint and Drive are disabled at Near with a specific reason', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 4; });
  await expect(page.locator('[data-card-name="Feint"]')).toContainText('Requires Close range.'); await expect(page.locator('[data-card-name="Drive"]')).toContainText('Requires Close range.');
});

test('DD-E2E-019: two visible Footwork plays make Close Flurry deal two', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'footwork', 'flurry']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 2; });
  for (let count = 0; count < 2; count += 1) { await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Stay' }).click(); } await playCard(page, 'Flurry'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('48 HP'); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces');
});

test('DD-E2E-020: Cull can select and trash itself when it is the only card', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull']); });
  await expect(page.locator('[data-card-name="Cull"]')).toBeEnabled(); await page.locator('[data-card-name="Cull"]').click(); await expect(page.getByText('Select 1 or 2 cards to trash. Click a grouped card twice to select two physical copies. 0 selected.')).toBeVisible(); await page.locator('[data-card-name="Cull"]').click(); await expect(page.getByText('1 selected.')).toBeVisible(); await page.getByRole('button', { name: 'Trash selected card' }).click(); await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0); await expect(page.getByTestId('action-log').getByText('Trashed Cull')).toBeVisible();
});

test('DD-E2E-021: starting-build carry appears in only the first local Buy phase', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, []); record.state.players.ochre.firstBuyMoney = 3; record.state.players.ochre.firstBuyPending = true; record.state.players.indigo.firstBuyMoney = 0; record.state.players.indigo.firstBuyPending = false; });
  await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 3');
  await page.getByRole('button', { name: 'End Buy phase' }).click(); await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 0');
});

test('DD-E2E-023: Cull can trash one remaining hand card and it stays absent after cleanup', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull', 'copper']); }); await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Copper"]').click(); await expect(page.getByText('1 selected.')).toBeVisible(); await page.getByRole('button', { name: 'Trash selected card' }).click();
  await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0); await expect(page.getByTestId('action-log').getByText('Trashed Copper')).toBeVisible(); await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click();
  await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Copper"]')).toHaveCount(0);
});

test('DD-E2E-025: delayed build updates keep the market dialog stable through every close path', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByLabel('Starting draft').check(); await page.getByRole('button', { name: 'Start game' }).click();
  await page.route('**/build', async (route) => { await new Promise((resolve) => setTimeout(resolve, 150)); await route.continue(); }); const copper = page.locator('[data-market-card="Copper"]'); const response = page.waitForResponse('**/build'); await copper.click(); await expect(copper).toBeDisabled(); await expect(page.locator('[data-market-card="Step"]')).toBeDisabled(); await page.getByRole('button', { name: 'Card reference' }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await response; await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Close market' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Card reference' }).click(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await page.getByRole('button', { name: 'Card reference' }).click(); await page.getByRole('dialog').click({ position: { x: 5, y: 5 } }); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Remove Copper' })).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0);
});
test('DD-E2E-026: a zero-paid build locks after completion and passes to Player 2', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByLabel('Starting draft').check(); await page.getByRole('button', { name: 'Start game' }).click(); await expect(page.getByTestId('build-budget')).toHaveText('0 / 12 · 3 carries');
  await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.locator('[data-market-card="Copper"]')).toBeVisible(); await expect(page.getByText('Player 2 starting build')).toBeVisible(); await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Copper"]')).toHaveText('Copper×7'); await expect(page.getByTestId('deck-summary-indigo').locator('[data-deck-card="Copper"]')).toHaveText('Copper×7');
});
test('DD-E2E-028: immediate Action, global Undo, and Buy phase restore after refresh', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'copper'], ['aim', 'volley']); record.state.players.ochre.firstBuyMoney = 0; }); await playCard(page, 'Muster'); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await page.reload(); await expect(page.getByRole('button', { name: 'Undo last action' })).toBeEnabled(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.locator('[data-card-name="Muster"]')).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.reload(); await expect(page.getByText(/Turn 1 · Player 1 buy/)).toBeVisible();
});

test('DD-E2E-031: visible market accepts the 10th Channel and disables the unavailable 11th', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, []); record.state.phase = 'buy'; record.state.players.ochre.money = 3; record.state.players.ochre.firstBuyPending = false; record.state.supply.channel = 1; record.state.players.ochre.purchases = Array<string>(9).fill('channel'); }); const channel = page.locator('[data-market-card="Channel"]'); await expect(channel).toContainText('1 left'); await channel.click(); await expect(channel).toContainText('0 left'); await expect(channel).toBeDisabled(); await expect(page.getByTestId('action-log').getByText('Bought Channel')).toBeVisible();
});

test('DD-E2E-032: Buy completion switches players immediately and can be undone', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.phase = 'buy'; record.state.players.ochre.money = 0; }); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 2 · Player 2 action/)).toBeVisible(); await expect(page.getByRole('heading', { name: 'Player 2 hand' })).toBeVisible(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 1 · Player 1 buy/)).toBeVisible();
});

test('DD-E2E-034: public labels and card rules use explicit player-facing text', async ({ page, openGame }) => {
  await openGame(page); await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 0'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('title', 'Player 1'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('title', 'Player 2');
  await page.getByRole('button', { name: 'Card reference' }).click(); const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-card-name="Step"] .card__headline')).toHaveText('Move 1 space'); await expect(dialog.locator('[data-card-name="Channel"] .card__headline')).toHaveText('+1 mana · +1 card'); await expect(dialog.locator('[data-card-name="Cascade"] .card__detail')).toContainText('+2 damage for each other spell you played this turn.');
  await expect(dialog.locator('[data-card-name="Gold"]')).toHaveClass(/card--treasure/); await expect(dialog.locator('[data-card-name="Step"]')).toHaveClass(/card--engine/); await expect(dialog.locator('[data-card-name="Focus"]')).toHaveClass(/card--mana/); await expect(dialog.locator('[data-card-name="Scrap"]')).toHaveCount(0);
});

test('DD-E2E-036: unspent normal money expires before the same local player returns', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, []); record.state.phase = 'buy'; record.state.players.ochre.money = 7; record.state.players.ochre.firstBuyPending = false; record.state.players.indigo.firstBuyPending = false; });
  await expect(page.getByTestId('zone-money')).toContainText('7'); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 2 · Player 2 action/)).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible(); await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByTestId('zone-money')).toContainText('0');
});

test('DD-E2E-037: three bought Gold stay Gold in the deck summary and later hand', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, []); expect(Object.values(record.state.players).flatMap((player) => [...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play]).map((card) => card.definitionId)).not.toContain('gold'); record.state.phase = 'buy'; record.state.players.ochre.money = 18; record.state.players.ochre.firstBuyMoney = 0; record.state.players.ochre.firstBuyPending = false; record.state.players.indigo.firstBuyPending = false; });
  await expect(page.locator('[data-card-name="Gold"]')).toHaveCount(0); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Gold"]')).toHaveCount(0); await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 18');
  for (let count = 0; count < 3; count += 1) await page.locator('[data-market-card="Gold"]').click();
  await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 0'); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Gold"]')).toHaveText('Gold×3'); await page.getByRole('button', { name: 'End Buy phase' }).click();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible(); await expect(page.locator('[data-testid="hand-grid"] [data-card-name="Gold"]')).toHaveCount(1); await expect(page.locator('[data-testid="hand-grid"] [data-card-name="Gold"]')).toHaveAttribute('data-card-count', '3'); await expect(page.getByTestId('hand-count-gold')).toHaveText('×3'); await expect(page.locator('[data-testid="hand-grid"] [data-card-name="Gold"]')).toContainText('+3 money');
});

test('DD-E2E-038: a grouped hand and the full table fit at 1920 by 1080', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await openGame(page, (record) => { seedHand(record, Array<string>(15).fill('muster')); record.state.fighters.ochre.position = 3; record.state.fighters.indigo.position = 3; });
  const card = page.locator('[data-testid="hand-grid"] [data-card-name="Muster"]'); await expect(card).toHaveCount(1); await expect(card).toHaveAttribute('data-card-count', '15'); await expect(page.getByTestId('hand-count-muster')).toHaveText('×15');
  const layout = await page.evaluate(() => { const root = document.documentElement; const hand = document.querySelector('[data-testid="hand-grid"]')!.getBoundingClientRect(); const played = document.querySelector('[data-testid="played-row"]')!.getBoundingClientRect(); const cardBox = document.querySelector('[data-testid="hand-grid"] [data-card-name="Muster"]')!.getBoundingClientRect(); const phase = document.querySelector('.hand-phase-button')!.getBoundingClientRect(); const controls = document.querySelector('.hand-control-bar')!.getBoundingClientRect(); return { horizontal: root.scrollWidth - root.clientWidth, vertical: root.scrollHeight - root.clientHeight, portrait: cardBox.height / cardBox.width, playedAboveHand: played.bottom <= hand.top, cardInside: cardBox.left >= hand.left && cardBox.right <= hand.right + 1, centered: Math.abs((cardBox.left + cardBox.right) / 2 - (hand.left + hand.right) / 2) < 2, phaseCentered: Math.abs((phase.left + phase.right) / 2 - (controls.left + controls.right) / 2) < 2 }; });
  expect(layout).toMatchObject({ horizontal: 0, vertical: 0, playedAboveHand: true, cardInside: true, centered: true, phaseCentered: true }); expect(layout.portrait).toBeGreaterThan(1.3);
  await card.click(); await expect(page.getByTestId('hand-count-muster')).toHaveText('×14'); await expect(page.locator('[data-testid="played-row"] [data-played-card-name="Muster"]')).toHaveCount(1);
});

test('DD-E2E-039: grouped Cull selects two physical copies from one card group', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull', 'copper', 'copper', 'silver']); });
  const copper = page.locator('[data-testid="hand-grid"] [data-card-name="Copper"]'); await expect(copper).toHaveCount(1); await expect(copper).toHaveAttribute('data-card-count', '2');
  await page.locator('[data-testid="hand-grid"] [data-card-name="Cull"]').click(); await copper.click(); await copper.click(); await expect(copper).toContainText('Selected ×2'); await expect(page.getByText('2 selected.')).toBeVisible();
  await page.getByRole('button', { name: 'Trash selected cards' }).click(); await expect(copper).toHaveCount(0); await expect(page.locator('[data-testid="played-row"] [data-played-card-name="Cull"]')).toHaveCount(1);
});

test('DD-E2E-040: large unique hands overlap and the action rail stays visible', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await openGame(page, (record) => { seedHand(record, ['copper', 'silver', 'gold', 'step', 'cull', 'focus', 'footwork', 'muster', 'muster', 'muster', 'feint', 'drive', 'flurry', 'aim', 'volley', 'stipend', 'reclaim', 'adapt']); });
  const before = await page.evaluate(() => { const cards = Array.from(document.querySelectorAll<HTMLElement>('.hand-card-slot')); const first = cards[0]!.getBoundingClientRect(); const second = cards[1]!.getBoundingClientRect(); return { count: cards.length, sameRow: cards.every((card) => Math.abs(card.getBoundingClientRect().top - first.top) < 1), delta: second.left - first.left, width: document.querySelector<HTMLElement>('.full-card')!.getBoundingClientRect().width, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
  expect(before).toMatchObject({ count: 16, sameRow: true, overflow: 0 }); expect(before.delta).toBeLessThan(before.width); expect(before.delta).toBeGreaterThan(0);
  const footwork = page.locator('[data-testid="hand-grid"] [data-card-name="Footwork"]'); const resting = await footwork.evaluate((card) => getComputedStyle(card).transform); const hoverPoint = await footwork.evaluate((card) => { const box = card.getBoundingClientRect(); for (let x = Math.ceil(box.left); x < box.right; x += 1) { const hit = document.elementFromPoint(x, box.top + box.height / 2); if (hit && card.contains(hit)) return { x, y: box.top + box.height / 2 }; } throw new Error('Footwork has no exposed hover point.'); }); await page.mouse.move(hoverPoint.x, hoverPoint.y); await expect.poll(() => footwork.evaluate((card) => getComputedStyle(card).transform)).not.toBe(resting); await page.mouse.move(0, 0); await footwork.focus(); await expect(footwork).toBeFocused(); await expect.poll(() => footwork.evaluate((card) => getComputedStyle(card).transform)).not.toBe(resting); const focused = await footwork.evaluate((card) => ({ transform: getComputedStyle(card).transform, zIndex: getComputedStyle(card.parentElement!.parentElement!).zIndex })); expect(Number(focused.zIndex)).toBe(250);
  const controls = await page.locator('[data-card-name="Muster"]').evaluate((card) => { const frame = card.parentElement!.getBoundingClientRect(); const badge = card.parentElement!.querySelector<HTMLElement>('.quantity-badge')!.getBoundingClientRect(); const playAll = card.parentElement!.querySelector<HTMLElement>('.play-all-button')!.getBoundingClientRect(); return { frameWidth: frame.width, badgeAtRight: Math.abs(badge.right - (frame.right + 10)) < 1, playAllInside: playAll.right <= frame.right && playAll.bottom <= frame.bottom }; }); expect(controls).toEqual({ frameWidth: 148, badgeAtRight: true, playAllInside: true });
  for (const name of ['Copper', 'Drive']) { const card = page.locator(`[data-testid="hand-grid"] [data-card-name="${name}"]`); await expect(card).toHaveAttribute('aria-disabled', 'true'); const beforeFocus = await card.evaluate((element) => getComputedStyle(element).transform); await card.focus(); await expect(card).toBeFocused(); await expect.poll(() => card.evaluate((element) => getComputedStyle(element).transform)).not.toBe(beforeFocus); const afterFocus = await card.evaluate((element) => ({ transform: getComputedStyle(element).transform, zIndex: getComputedStyle(element.parentElement!.parentElement!).zIndex })); expect(Number(afterFocus.zIndex)).toBe(250); await page.keyboard.press('Enter'); await expect(card).toBeVisible(); } await expect(page.locator('[data-testid="played-row"] [data-played-card-name]')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: /Action history/ })).toBeVisible(); await expect(page.locator('.side-drawer,.edge-toggle')).toHaveCount(0); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Footwork"]')).toHaveText('Footwork×1');
});

test('DD-E2E-043: a projected pending choice renders and clears after selection', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    const kingdom = kingdomOf('three-way-engine'); record.kingdom = kingdom; record.state.kingdomId = kingdom.id;
    record.state.startingHealth = kingdom.startingHealth; record.state.supply = kingdomSupply(kingdom);
    seedHand(record, ['prism', 'copper', 'copper'], ['silver']);
  });
  await page.locator('[data-card-name="Prism"]').click();
  await expect(page.getByText('Select one card to discard')).toBeVisible(); await expect(page.locator('.hand-control-bar .hand-choice-controls')).toBeVisible();
  const discard = page.locator('[data-card-name="Copper"]'); await expect(discard).toHaveAttribute('data-card-count', '2');
  await discard.click(); await expect(discard).toHaveClass(/card--selected/);
  await page.getByRole('button', { name: 'Confirm discard' }).click(); await expect(discard).toHaveAttribute('data-card-count', '1');
  await expect(page.getByText('Select one card to discard')).toHaveCount(0);
  await expect(page.locator('[data-card-name="Silver"]')).toBeVisible();
});

test('DD-E2E-042: AI-first games show public automatic turns and undo to a human state', async ({ page, baseUrl }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto(baseUrl); await page.getByText('Play against AI', { exact: true }).click(); await expect(page.getByText('AI goes first', { exact: true })).toBeVisible(); await page.getByText('AI goes first', { exact: true }).click();
  const difficulty = page.getByRole('group', { name: 'AI strength' }); await expect(difficulty.getByRole('button')).toHaveText(['Easy', 'Normal', 'Hard', 'Expert']); await expect(difficulty.getByRole('button', { name: 'Expert' })).toHaveAttribute('aria-pressed', 'true'); await difficulty.getByRole('button', { name: 'Hard' }).click(); await page.getByLabel('Starting draft').check();
  let createRequest: Record<string, unknown> | null = null;
  await page.route('**/api/games', async (route) => { createRequest = route.request().postDataJSON() as Record<string, unknown>; await new Promise((resolve) => setTimeout(resolve, 100)); await route.continue(); }); await page.getByRole('button', { name: 'Start game' }).click(); await expect(page.getByText('Training opponent…')).toBeVisible();
  await expect(page.getByText('Player 2 starting build')).toBeVisible(); await recordFlights(page); await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByRole('heading', { name: 'AI hand' })).toBeVisible(); await expect(page.locator('.choice-bar,.hand-choice-controls,.card-picker,.arena-space__choice-button')).toHaveCount(0); await expect(page.getByText(/Turn 2 · Player 2 action/)).toBeVisible(); const firstAiFlight = (await recordedFlights(page)).find((flight) => flight.kind === 'play')!; const firstAiSource = await recordedAiSource(page, firstAiFlight.name); expect(firstAiSource).not.toBeNull(); expectSameBounds(firstAiFlight.source, firstAiSource!); await expect(page.getByTestId('action-log').getByText('Bought Silver').last()).toBeVisible(); await expect(page.getByTestId('action-log').getByText('Turn 1 started')).toBeVisible(); await expect(page.getByTestId('action-log').getByText('Turn 2 started')).toBeVisible();
  expect(createRequest).toMatchObject({ mode: 'ai', humanPlayerId: 'indigo', aiDifficulty: 'hard' });
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 4 · Player 2 action/)).toBeVisible(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 2 · Player 2 buy/)).toBeVisible(); await page.reload(); await expect(page.getByText(/Turn 2 · Player 2 buy/)).toBeVisible();
});

test('DD-E2E-044: every action undoes to setup and Step can take a different direction', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['step', 'muster']); record.state.fighters.ochre.position = 3; record.state.fighters.indigo.position = 5; });
  await page.locator('[data-card-name="Step"]').click(); await page.getByRole('button', { name: 'Play Step: Right' }).click(); await playCard(page, 'Muster'); await page.getByRole('button', { name: 'End Action phase' }).click();
  await expect(page.getByText(/Turn 1 · Player 1 buy/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 1 · Player 1 action/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.locator('[data-card-name="Muster"]')).toBeVisible(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4');
  await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.locator('[data-card-name="Step"]')).toBeVisible(); await expect(page.getByRole('button', { name: 'Undo last action' })).toBeDisabled();
  await page.locator('[data-card-name="Step"]').click(); await page.getByRole('button', { name: 'Play Step: Left' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '2');
});

test('DD-E2E-045: the fixed action rail shows public actions from both local players', async ({ page, openGame }) => {
  await openGame(page); const rail = page.getByRole('complementary', { name: /Action history/ }); await expect(rail).toBeVisible();
  await expect(page.locator('.side-drawer,.edge-toggle')).toHaveCount(0); await expect(rail.getByRole('navigation', { name: 'Game controls' }).locator('button')).toHaveText(['Undo', 'Reset', 'New game', 'View all cards']);
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await page.getByRole('button', { name: 'End Action phase' }).click();
  await expect(page.getByTestId('action-log').locator('li').filter({ hasText: 'Player 1' }).filter({ hasText: 'Started Buy phase' })).toHaveCount(1);
  await expect(page.getByTestId('action-log').locator('li').filter({ hasText: 'Player 2' }).filter({ hasText: 'Started Buy phase' })).toHaveCount(1);
  await expect(page.getByTestId('action-log').getByText('Turn 1 started')).toBeVisible(); await expect(page.getByTestId('action-log').getByText('Turn 2 started')).toBeVisible();
});

test('DD-E2E-046: only the long log scrolls while exact deck summaries stay fixed at 1920 by 1080', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame(page, (record) => {
    seedHand(record, ['copper', 'copper', 'step']);
    for (let index = 0; index < 80; index += 1) record.state.events.push({ sequence: record.state.events.length, type: 'turn', playerId: index % 2 ? 'indigo' : 'ochre', detail: { turn: index + 2, activePlayerId: index % 2 ? 'indigo' : 'ochre' } });
  });
  await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card]')).toHaveCount(2); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Copper"]')).toHaveText('Copper×2'); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Step"]')).toHaveText('Step×1');
  await expect(page.getByTestId('deck-summary-indigo').locator('[data-deck-card]')).toHaveCount(1); await expect(page.getByTestId('deck-summary-indigo').locator('[data-deck-card="Copper"]')).toHaveText('Copper×7'); await expect(page.getByRole('heading', { name: 'Zones' })).toHaveCount(0);
  const layout = await page.evaluate(() => {
    const root = document.documentElement; const log = document.querySelector<HTMLElement>('[data-testid="action-log"]')!; const decks = document.querySelector<HTMLElement>('.rail-decks')!; const controls = document.querySelector<HTMLElement>('.rail-controls')!; const rail = document.querySelector<HTMLElement>('.action-rail')!; const lastPile = [...document.querySelectorAll<HTMLElement>('.market-group:nth-of-type(2) [data-market-card]')].at(-1)!;
    const logRect = log.getBoundingClientRect(); const decksRect = decks.getBoundingClientRect(); const controlsRect = controls.getBoundingClientRect(); const railRect = rail.getBoundingClientRect(); const pileRect = lastPile.getBoundingClientRect();
    return { horizontal: root.scrollWidth - root.clientWidth, vertical: root.scrollHeight - root.clientHeight, logScrolls: log.scrollHeight > log.clientHeight, newestVisible: log.scrollTop + log.clientHeight >= log.scrollHeight - 1, logOverflow: getComputedStyle(log).overflowY, decksBelowLog: logRect.bottom <= decksRect.top + 1, controlsBelowDecks: decksRect.bottom <= controlsRect.top + 1, controlsVisible: controlsRect.bottom <= innerHeight, decksVisible: decksRect.bottom <= innerHeight && decksRect.top >= 0, railVisible: railRect.right <= innerWidth && railRect.left >= 0, marketClear: pileRect.right <= railRect.left };
  });
  expect(layout).toEqual({ horizontal: 0, vertical: 0, logScrolls: true, newestVisible: true, logOverflow: 'auto', decksBelowLog: true, controlsBelowDecks: true, controlsVisible: true, decksVisible: true, railVisible: true, marketClear: true });
});

test('DD-E2E-047: replacing the latest event at the same count scrolls it into view without moving focus', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    for (let index = 0; index < 80; index += 1) record.state.events.push({ sequence: record.state.events.length, type: 'turn', playerId: index % 2 ? 'indigo' : 'ochre', detail: { turn: index + 2, activePlayerId: index % 2 ? 'indigo' : 'ochre' } });
  });
  const eventCount = await page.getByTestId('action-log').locator('li').count();
  await page.route('**/actions', async (route) => {
    const response = await route.fetch(); const view = await response.json() as { events: Array<{ sequence: number; type: string; playerId: string; detail: Record<string, unknown> }> };
    view.events = view.events.slice(0, eventCount); const latest = view.events.at(-1)!;
    view.events[eventCount - 1] = { ...latest, type: 'turn', playerId: 'indigo', detail: { turn: 999, activePlayerId: 'indigo' } };
    await route.fulfill({ response, json: view });
  });
  await page.getByTestId('action-log').evaluate((log) => { log.scrollTop = 0; }); const newGame = page.getByRole('button', { name: 'New game' }); await newGame.focus();
  await page.getByRole('button', { name: 'End Action phase' }).evaluate((button: HTMLButtonElement) => button.click()); await expect(page.getByTestId('action-log').getByText('Turn 999 started')).toBeVisible(); await expect(newGame).toBeFocused();
  expect(await page.getByTestId('action-log').evaluate((log) => log.scrollTop + log.clientHeight >= log.scrollHeight - 1)).toBe(true);
});

test('DD-E2E-049: draft-off setup starts with rendered Scrap that stays outside the market', async ({ page, baseUrl, openGame }) => {
  await page.goto(baseUrl);
  const draft = page.getByLabel('Starting draft'); await expect(draft).not.toBeChecked();
  let request: Record<string, unknown> | null = null;
  await page.route('**/api/games', async (route) => { request = route.request().postDataJSON() as Record<string, unknown>; await route.continue(); });
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByText(/Turn 1 · Player 1 action/)).toBeVisible(); await expect(page.getByText('Player 1 starting build')).toHaveCount(0);
  expect(request).toMatchObject({ mode: 'local', startingDraftEnabled: false });
  await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Scrap"]')).toHaveText('Scrap×3');
  await expect(page.locator('[data-market-card="Scrap"]')).toHaveCount(0);

  await openGame(page, (record) => { seedHand(record, ['scrap']); });
  const scrap = page.locator('[data-card-name="Scrap"]');
  await expect(scrap.locator('.card__headline')).toHaveText('1 damage at any range');
  await scrap.click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('49 HP');
  await expect(page.getByTestId('action-log').getByText('Played Scrap')).toBeVisible();
  await expect(page.locator('[data-market-card="Scrap"]')).toHaveCount(0);
});

test('DD-E2E-050: single-target discard and trash choices complete their card effects', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['bullRush','strike']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 2; });
  await page.locator('[data-card-name="Bull Rush"]').click();
  await expect(page.getByText('Select 1 card to discard. 0 selected.')).toBeVisible();
  await expect(page.getByText('Click a grouped card twice')).toHaveCount(0);
  await page.locator('[data-card-name="Strike"]').click();
  await page.getByRole('button', { name:'Discard selected card' }).click();
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('45 HP');
  await expect(page.locator('[data-card-name="Strike"]')).toHaveCount(0);
  await expect(page.getByTestId('action-log').getByText('Discarded Strike')).toBeVisible();

  await openGame(page, (record) => { seedHand(record, ['salvageShot','steadyShot'], ['gold']); });
  await page.locator('[data-card-name="Salvage Shot"]').click();
  await expect(page.getByText('Select 1 card to discard. 0 selected.')).toBeVisible();
  await page.locator('[data-card-name="Steady Shot"]').click();
  await page.getByRole('button', { name:'Discard selected card' }).click();
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('47 HP');
  await expect(page.locator('[data-card-name="Gold"]')).toBeVisible();
  await expect(page.getByTestId('action-log').getByText('Discarded Steady Shot')).toBeVisible();

  await openGame(page, (record) => { seedHand(record, ['discipline']); });
  await page.locator('[data-card-name="Discipline"]').click();
  await expect(page.getByText('Select 1 card to trash. 0 selected.')).toBeVisible();
  await expect(page.getByText('Click a grouped card twice')).toHaveCount(0);
  await page.locator('[data-card-name="Discipline"]').click();
  await page.getByRole('button', { name: 'Trash selected card' }).click();
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('49 HP');
  await expect(page.getByTestId('action-log').getByText('Trashed Discipline')).toBeVisible();
});

test('DD-E2E-051: Sharpen can skip or complete its optional post-draw trash', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['sharpen'], ['gold']); });
  await page.locator('[data-card-name="Sharpen"]').click();
  await expect(page.getByText('Select one card to trash, or skip')).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByText('Select one card to trash, or skip')).toHaveCount(0);
  await expect(page.locator('[data-card-name="Gold"]')).toBeVisible();

  await openGame(page, (record) => { seedHand(record, ['sharpen'], ['gold']); });
  await page.locator('[data-card-name="Sharpen"]').click();
  await page.locator('[data-card-name="Gold"]').click();
  await page.getByRole('button', { name: 'Confirm trash' }).click();
  await expect(page.locator('[data-card-name="Gold"]')).toHaveCount(0);
  await expect(page.getByTestId('action-log').getByText('Trashed Gold')).toBeVisible();

  await openGame(page, (record) => { seedHand(record, ['sharpen'], ['gold']); });
  await page.locator('[data-card-name="Sharpen"]').click();
  const playedSharpen = page.locator('[data-played-card-name="Sharpen"]'); await expect(playedSharpen).toHaveRole('button');
  await playedSharpen.click(); await expect(playedSharpen).toHaveClass(/card--selected/);
  await page.getByRole('button', { name: 'Confirm trash' }).click();
  await expect(playedSharpen).toHaveCount(0); await expect(page.getByTestId('action-log').getByText('Trashed Sharpen')).toBeVisible();
});

test('DD-E2E-052: Reforge trashes a target and completes its market gain choice', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['reforge','copper']); });
  await page.locator('[data-card-name="Reforge"]').click();
  await expect(page.getByText('Select 1 card to trash. 0 selected.')).toBeVisible();
  await page.locator('[data-card-name="Copper"]').click();
  await page.getByRole('button', { name: 'Trash selected card' }).click();
  const gainPicker = page.getByRole('dialog', { name: 'Choose a card to gain' }); await expect(gainPicker).toBeVisible();
  const channel = gainPicker.locator('[data-picker-card="Channel"]'); await expect(channel).toBeVisible(); await expect(channel.locator('.card__headline')).toHaveText('+1 mana · +1 card');
  await gainPicker.getByRole('button', { name: 'Gain Channel' }).click();
  await expect(page.getByText('Choose a card to gain')).toHaveCount(0);
  await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Channel"]')).toHaveText('Channel×1');
  await expect(page.getByTestId('action-log').getByText('Trashed Copper')).toBeVisible();
  await expect(page.getByTestId('action-log').getByText('Gained Channel')).toBeVisible();
});

test('DD-E2E-053: Scour completes zero, one, and two-target selections', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['scour']); });
  await page.locator('[data-card-name="Scour"]').click();
  await expect(page.getByText('Select up to 2 cards to trash. Click a grouped card twice to select two physical copies. 0 selected.')).toBeVisible();
  await page.getByRole('button', { name: 'Play with no targets' }).click();
  await expect(page.locator('[data-testid="played-row"] [data-played-card-name="Scour"]')).toBeVisible();

  await openGame(page, (record) => { seedHand(record, ['scour','copper'], ['gold']); });
  await page.locator('[data-card-name="Scour"]').click();
  await page.locator('[data-card-name="Copper"]').click();
  await page.getByRole('button', { name: 'Trash selected card' }).click();
  await expect(page.locator('[data-card-name="Gold"]')).toBeVisible();
  await expect(page.getByTestId('action-log').getByText('Trashed Copper')).toBeVisible();

  await openGame(page, (record) => { seedHand(record, ['scour','copper','silver'], ['gold','gold']); });
  await page.locator('[data-card-name="Scour"]').click();
  await page.locator('[data-card-name="Copper"]').click();
  await page.locator('[data-card-name="Silver"]').click();
  await page.getByRole('button', { name: 'Trash selected cards' }).click();
  await expect(page.getByTestId('hand-count-gold')).toHaveText('×2');
  await expect(page.getByTestId('action-log').getByText('Trashed Copper')).toBeVisible();
  await expect(page.getByTestId('action-log').getByText('Trashed Silver')).toBeVisible();
});

test('DD-E2E-054: Reclaim groups identical discard cards in a canonical picker', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    seedHand(record, ['reclaim']);
    record.state.players.ochre.deck.discard.push(createCard(record.state, 'silver'), createCard(record.state, 'silver'), createCard(record.state, 'gold'));
  });
  await page.locator('[data-card-name="Reclaim"]').click();
  const picker = page.getByRole('dialog', { name: 'Choose a card to recover' });
  await expect(picker).toBeVisible(); await expect(picker.locator('[data-picker-card="Silver"]')).toHaveCount(1);
  await expect(page.getByTestId('picker-count-silver')).toHaveText('×2');
  await picker.getByRole('button', { name: 'Recover Silver' }).click();
  await expect(picker).toHaveCount(0); await expect(page.locator('[data-card-name="Silver"]')).toBeVisible();
});

test('DD-E2E-055: Play all resolves direct copies only and movement copies keep their choice', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'muster', 'muster', 'footwork', 'footwork', 'reclaim', 'reclaim', 'sharpen', 'sharpen']); record.state.fighters.ochre.position = 3; });
  await expect(page.getByRole('button', { name: 'Play all', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Play all', exact: true }).click();
  await expect(page.locator('[data-card-name="Muster"]')).toHaveCount(0);
  await expect(page.locator('[data-played-card-name="Muster"]')).toHaveAttribute('data-card-count', '3');
  await page.locator('[data-card-name="Footwork"]').click();
  await expect(page.getByRole('button', { name: 'Play Footwork: Stay' }).locator('..')).toHaveClass(/arena-space--choice/);
});

test('DD-E2E-056: hand groups keep turn slots and append newly drawn definitions', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['stipend', 'stipend', 'copper'], ['gold']); });
  const stipend = page.locator('[data-card-name="Stipend"]'); const copper = page.locator('[data-card-name="Copper"]');
  const slotLeft = () => stipend.evaluate((card) => card.closest('.hand-card-slot')!.getBoundingClientRect().left);
  const before = await slotLeft();
  await stipend.click(); await expect(stipend).toHaveAttribute('data-card-count', '1');
  expect(await slotLeft()).toBe(before);
  expect(await page.locator('[data-card-name="Gold"]').evaluate((card) => card.getBoundingClientRect().left)).toBeGreaterThan(await copper.evaluate((card) => card.getBoundingClientRect().left));
  await page.getByRole('button', { name: 'Undo last action' }).click();
  await expect(stipend).toHaveAttribute('data-card-count', '2'); expect(await slotLeft()).toBe(before);
});

test('DD-E2E-059: one and multiple new draw groups hold exact centered landing slots', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster'], ['aim', 'volley']); record.state.players.ochre.deck.discard.push(createCard(record.state, 'gold')); });
  await expect(page.getByTestId('draw-pile')).toHaveAttribute('aria-label', '2 cards in draw pile');
  await expect(page.getByTestId('discard-pile')).toHaveAttribute('aria-label', '1 card in discard pile');
  await expect(page.locator('[data-discard-card="Gold"]')).toBeVisible();
  await recordFlights(page); await page.locator('[data-card-name="Muster"]').click();
  await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await expect(page.locator('[data-card-name="Volley"]')).toBeVisible();
  const flights = await recordedFlights(page); const musterFlight = flights.find((flight) => flight.name === 'Muster')!; const aimFlight = flights.find((flight) => flight.name === 'Aim')!; const volleyFlight = flights.find((flight) => flight.name === 'Volley')!;
  expect(musterFlight).toBeDefined(); expect(musterFlight.earlyCardCount).toBe(0); expect(aimFlight.earlyCardCount).toBe(0); expect(volleyFlight.earlyCardCount).toBe(0);
  expect(aimFlight.target.left).not.toBeCloseTo(volleyFlight.target.left, 0); expect(aimFlight.destinations).toHaveLength(1); expect(volleyFlight.destinations).toHaveLength(1);
  expectSameBounds(aimFlight.target, aimFlight.destinations[0]!); expectSameBounds(volleyFlight.target, volleyFlight.destinations[0]!);
  expectSameBounds(await bounds(page.locator('[data-card-name="Aim"]')), aimFlight.target); expectSameBounds(await bounds(page.locator('[data-card-name="Volley"]')), volleyFlight.target);
  await expect(page.getByTestId('draw-pile')).toHaveAttribute('aria-label', '0 cards in draw pile');

  await openGame(page, (record) => { seedHand(record, ['muster'], ['aim']); }); await recordFlights(page); await page.locator('[data-card-name="Muster"]').click();
  await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); const singleFlight = (await recordedFlights(page)).find((flight) => flight.name === 'Aim')!;
  expect(singleFlight.earlyCardCount).toBe(0); expect(singleFlight.destinations).toHaveLength(1); expectSameBounds(singleFlight.target, singleFlight.destinations[0]!); expectSameBounds(await bounds(page.locator('[data-card-name="Aim"]')), singleFlight.target);
});

test('DD-E2E-061: the AI animation setting persists across reload', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByText('Play against AI', { exact: true }).click();
  const setting = page.getByLabel('Animate AI turns'); await expect(setting).toBeChecked(); await setting.uncheck();
  await page.reload(); await page.getByText('Play against AI', { exact: true }).click(); await expect(page.getByLabel('Animate AI turns')).not.toBeChecked();
});

test('DD-E2E-060: reduced motion installs accepted card state without a flight', async ({ page, openGame }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGame(page, (record) => { seedHand(record, ['muster'], ['aim']); });
  await page.locator('[data-card-name="Muster"]').click();
  await expect(page.locator('[data-played-card-name="Muster"]')).toBeVisible();
  await expect(page.locator('[data-card-name="Aim"]')).toBeVisible();
  await expect(page.locator('[data-flying-card]')).toHaveCount(0);
});

test('DD-E2E-062: duplicate draws share one stable destination and repeated plays land on the trailing stack', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster'], ['aim', 'aim']); }); await recordFlights(page); await page.locator('[data-card-name="Muster"]').click();
  await expect(page.getByTestId('hand-count-aim')).toHaveText('×2'); const duplicateFlights = (await recordedFlights(page)).filter((flight) => flight.name === 'Aim'); expect(duplicateFlights).toHaveLength(2);
  expect(duplicateFlights.every((flight) => flight.earlyCardCount === 0 && flight.destinations.length === 1)).toBe(true); expectSameBounds(duplicateFlights[0]!.target, duplicateFlights[1]!.target); expectSameBounds(await bounds(page.locator('[data-card-name="Aim"]')), duplicateFlights[0]!.target);

  await openGame(page, (record) => { seedHand(record, ['muster']); record.state.players.ochre.deck.play = ['muster', 'stipend', 'muster'].map((id) => createCard(record.state, id)); });
  const playedMusters = page.locator('[data-played-card-name="Muster"]'); await expect(playedMusters).toHaveCount(2); const firstLeft = (await bounds(playedMusters.first())).left; const trailingLeft = (await bounds(playedMusters.last())).left;
  await recordFlights(page); await page.locator('[data-card-name="Muster"]').click(); await expect(playedMusters.last()).toHaveAttribute('data-card-count', '2'); const playFlight = (await recordedFlights(page)).find((flight) => flight.name === 'Muster')!; const landed = await bounds(playedMusters.last());
  expect(playFlight.target.left).toBeCloseTo(trailingLeft, 0); expect(playFlight.target.left).not.toBeCloseTo(firstLeft, 0); expectSameBounds(landed, playFlight.target);
});

test('DD-E2E-063: AI-first creation paints its hand before ordered flights and animation can stop immediately', async ({ page, baseUrl, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto(baseUrl); await page.getByText('Play against AI', { exact: true }).click(); await page.getByText('AI goes first', { exact: true }).click();
  await page.evaluate(() => {
    const state = window as typeof window & { sawAiHand?: boolean; flashedFinalBeforeAi?: boolean };
    new MutationObserver(() => { const hasAi = document.querySelector('.hand-panel--ai h2')?.textContent === 'AI hand'; if (hasAi) state.sawAiHand = true; if (!state.sawAiHand && /Turn 2 · Player 2 action/.test(document.body.textContent ?? '')) state.flashedFinalBeforeAi = true; }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await recordFlights(page); await page.getByRole('button', { name: 'Start game' }).click(); await expect(page.getByRole('heading', { name: 'AI hand' })).toBeVisible();
  const firstAiCard = page.locator('.hand-panel--ai [data-card-name="Scrap"]'); const source = await bounds(firstAiCard);
  await expect(page.getByText(/Turn 2 · Player 2 action/)).toBeVisible(); const creationFlights = (await recordedFlights(page)).filter((flight) => flight.kind === 'play'); expect(creationFlights.length).toBeGreaterThan(0);
  const firstFlight = creationFlights.find((flight) => flight.name === 'Scrap')!; expect(firstFlight).toBeDefined(); expectSameBounds(firstFlight.source, source);
  expect(await page.evaluate(() => (window as typeof window & { flashedFinalBeforeAi?: boolean }).flashedFinalBeforeAi ?? false)).toBe(false);

  await openGame(page, (record) => { makeAiGame(record); seedPlayerHand(record, 'indigo', ['precisionShot', 'precisionShot']); }); await page.getByLabel('Animate AI turns').check();
  await recordFlights(page); await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByRole('heading', { name: 'AI hand' })).toBeVisible();
  await page.getByLabel('Animate AI turns').uncheck(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible(); await expect(page.locator('[data-flying-card]')).toHaveCount(0);
});

test('DD-E2E-064: AI playback batches consecutive card copies and Undo or visibility interruption finishes safely', async ({ page, openGame }) => {
  const openAi = async () => { await openGame(page, (record) => { makeAiGame(record); seedPlayerHand(record, 'indigo', ['precisionShot', 'precisionShot']); }); await page.getByLabel('Animate AI turns').check(); };
  const startAi = async () => { await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByRole('heading', { name: 'AI hand' })).toBeVisible(); };
  await openAi(); await recordFlights(page); await startAi(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible();
  const aiFlights = (await recordedFlights(page)).filter((flight) => flight.kind === 'play' && flight.name === 'Precision Shot'); expect(aiFlights.length).toBeGreaterThanOrEqual(2); expect(aiFlights[1]!.at - aiFlights[0]!.at).toBeGreaterThanOrEqual(70); expect(aiFlights[1]!.at - aiFlights[0]!.at).toBeLessThanOrEqual(120);

  await openAi(); await startAi(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 1 · Player 1 buy/)).toBeVisible(); await expect(page.getByRole('heading', { name: 'AI hand' })).toHaveCount(0); await expect(page.locator('[data-flying-card]')).toHaveCount(0);

  await openAi(); await startAi(); await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible(); await expect(page.locator('[data-flying-card]')).toHaveCount(0);
});

test('DD-E2E-065: New game ignores late action successes and errors', async ({ page, openGame }) => {
  const interrupt = async (status: number) => {
    await openGame(page); await page.route('**/actions', async (route) => { await new Promise((resolve) => setTimeout(resolve, 300)); if (status === 200) await route.continue(); else await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'late old-game failure' }) }); });
    await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'New game' }).click(); await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible(); await page.waitForTimeout(450);
    await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0); await page.unroute('**/actions');
  };
  await interrupt(200); await interrupt(500);
});

test('DD-E2E-066: centered hands and zone piles do not overflow at supported desktop sizes', async ({ page, openGame }) => {
  for (const width of [1920, 1600]) {
    await page.setViewportSize({ width, height: 1080 }); await openGame(page, (record) => { seedHand(record, ['muster', 'aim', 'volley', 'stipend', 'gold']); });
    const layout = await page.evaluate(() => {
      const root = document.documentElement; const content = document.querySelector<HTMLElement>('.hand-content')!.getBoundingClientRect(); const piles = document.querySelector<HTMLElement>('.zone-piles')!.getBoundingClientRect(); const cards = [...document.querySelectorAll<HTMLElement>('[data-testid="hand-grid"] .hand-card-frame')].map((card) => card.getBoundingClientRect());
      const center = (Math.min(...cards.map((card) => card.left)) + Math.max(...cards.map((card) => card.right))) / 2;
      return { centered: Math.abs(center - (content.left + content.right) / 2) < 2, pilesVisible: piles.left >= content.left && piles.right <= cards[0]!.left && piles.bottom <= content.bottom, horizontal: root.scrollWidth - root.clientWidth, vertical: root.scrollHeight - root.clientHeight };
    });
    expect(layout).toEqual({ centered: true, pilesVisible: true, horizontal: 0, vertical: 0 });
  }
});

test('DD-E2E-067: Play all uses the same stack cadence as automatic Treasure play', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); const intervals = (flights: RecordedFlight[]) => flights.slice(1).map((flight, index) => flight.at - flights[index]!.at);
  await openGame(page, (record) => { seedHand(record, ['precisionShot', 'precisionShot', 'precisionShot']); record.state.fighters.indigo.health = 50; }); await recordFlights(page);
  await page.getByRole('button', { name: 'Play all', exact: true }).click(); await expect(page.locator('[data-played-card-name="Precision Shot"]')).toHaveAttribute('data-card-count', '3');
  const repeated = (await recordedFlights(page)).filter((flight) => flight.name === 'Precision Shot'); expect(repeated).toHaveLength(3);

  await openGame(page, (record) => { seedHand(record, ['gold', 'gold', 'gold']); }); await recordFlights(page); await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.locator('[data-played-card-name="Gold"]')).toHaveAttribute('data-card-count', '3');
  const treasures = (await recordedFlights(page)).filter((flight) => flight.name === 'Gold'); expect(treasures).toHaveLength(3);
  const repeatedIntervals = intervals(repeated); const treasureIntervals = intervals(treasures);
  for (const interval of [...repeatedIntervals, ...treasureIntervals]) { expect(interval).toBeGreaterThanOrEqual(70); expect(interval).toBeLessThanOrEqual(120); }
  expect(repeatedIntervals).toEqual(treasureIntervals.map((interval) => expect.closeTo(interval, 0)));
});

test('DD-E2E-068: human and AI purchases show a readable market-anchored card preview', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await openGame(page, (record) => { seedHand(record, ['gold']); }); await page.getByRole('button', { name: 'End Action phase' }).click();
  const pile = page.locator('[data-market-card="Silver"]'); await pile.click(); const preview = page.locator('[data-purchase-preview="Silver"]'); await expect(preview).toBeVisible();
  await expect(preview.locator('.card__headline')).toHaveText('+2 money'); await expect(preview.locator('.card__image')).toBeVisible();
  const pileBox = await bounds(pile); const previewBox = await bounds(preview); expect(Math.abs((pileBox.left + pileBox.width / 2) - (previewBox.left + previewBox.width / 2))).toBeLessThan(2);
  await expect(preview).toHaveCount(0);

  await openGame(page, (record) => { makeAiGame(record); seedPlayerHand(record, 'ochre', []); seedPlayerHand(record, 'indigo', ['gold']); }); await page.getByLabel('Animate AI turns').check();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click();
  await expect(page.locator('[data-purchase-preview="Silver"]')).toBeVisible(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible();

  await page.emulateMedia({ reducedMotion: 'reduce' }); await openGame(page, (record) => { seedHand(record, ['gold']); }); await page.getByRole('button', { name: 'End Action phase' }).click(); await page.locator('[data-market-card="Copper"]').click();
  await expect(page.locator('[data-purchase-preview]')).toHaveCount(0);
});

test('DD-E2E-069: damaging human and AI cards mark the correct fighter and exact amount', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await openGame(page, (record) => { seedHand(record, ['precisionShot']); }); await recordDamageFeedback(page); await page.locator('[data-card-name="Precision Shot"]').click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('46 HP');
  await expect.poll(() => page.evaluate(() => (window as typeof window & { recordedDamage?: Array<{ target: string; amount: string }> }).recordedDamage ?? [])).toContainEqual({ target: 'indigo', amount: '4' }); await expect(page.locator('[data-damage-target]')).toHaveCount(0);

  await openGame(page, (record) => { seedHand(record, ['aim']); }); await page.locator('[data-card-name="Aim"]').click(); await expect(page.locator('[data-damage-target]')).toHaveCount(0);

  await openGame(page, (record) => { makeAiGame(record); seedPlayerHand(record, 'ochre', []); seedPlayerHand(record, 'indigo', ['precisionShot']); }); await page.getByLabel('Animate AI turns').check(); await recordDamageFeedback(page);
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { recordedDamage?: Array<{ target: string; amount: string }> }).recordedDamage ?? [])).toContainEqual({ target: 'ochre', amount: '4' }); await expect(page.locator('[data-player-score="ochre"]')).toContainText('43 HP');
});

test('DD-E2E-057: canonical card faces keep long rules inside hand and scaled played cards', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame(page, (record) => { seedHand(record, ['reclaim', 'reclaim', 'precisionShot', 'salvageShot', 'drive', 'fireball', 'repellingShot']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 4; });
  const fit = await page.locator('[data-testid="hand-grid"] .card').evaluateAll((cards) => cards.map((card) => { const cardRect = card.getBoundingClientRect(); const header = card.querySelector('.card__header')!.getBoundingClientRect(); const rules = card.querySelector('.card__rules')!.getBoundingClientRect(); const title = card.querySelector('.card__title')!.getBoundingClientRect(); const cost = card.querySelector('.card__cost')!.getBoundingClientRect(); return { name: card.getAttribute('data-card-name'), headerOffset: header.top - cardRect.top, rulesOverflow: rules.bottom - cardRect.bottom, titleCentered: Math.abs((title.left + title.right) / 2 - (cardRect.left + cardRect.right) / 2) < 1, costBottomLeft: cost.left - cardRect.left < 10 && cardRect.bottom - cost.bottom < 10 }; }));
  expect(fit.filter((entry) => entry.headerOffset > 4 || entry.rulesOverflow > 1 || !entry.titleCentered || !entry.costBottomLeft)).toEqual([]);
  const precisionCopy = page.locator('[data-card-name="Precision Shot"]');
  await expect(precisionCopy.locator('.card__headline')).toHaveText('4 damage');
  await expect(precisionCopy.locator('.card__detail')).toHaveText('Other Precision Shots you play this turn deal 2 damage instead.');
  expect(await precisionCopy.locator('.card__headline').evaluate((headline) => ({ align: getComputedStyle(headline).textAlign, weight: Number(getComputedStyle(headline).fontWeight) }))).toMatchObject({ align: 'center', weight: 900 });
  const cardCopySizes = await page.locator('[data-testid="hand-grid"]').evaluate(() => {
    const size = (card: string, copy: string) => Number.parseFloat(getComputedStyle(document.querySelector(`[data-card-name="${card}"] ${copy}`)!).fontSize);
    return { driveHeadline: size('Drive', '.card__headline'), driveDetail: size('Drive', '.card__detail'), fireballHeadline: size('Fireball', '.card__headline') };
  });
  expect(cardCopySizes.driveHeadline).toBe(cardCopySizes.fireballHeadline); expect(cardCopySizes.driveDetail).toBeLessThan(cardCopySizes.driveHeadline);
  await page.locator('[data-card-name="Reclaim"]').click();
  const handBox = await page.locator('[data-card-name="Reclaim"]').boundingBox(); const playedBox = await page.locator('[data-played-card-name="Reclaim"]').boundingBox(); const playedRowBox = await page.getByTestId('played-row').boundingBox();
  expect(handBox).not.toBeNull(); expect(playedBox).not.toBeNull(); expect(playedRowBox).not.toBeNull();
  expect(Math.abs(handBox!.height / handBox!.width - playedBox!.height / playedBox!.width)).toBeLessThan(.02); expect(playedBox!.y + playedBox!.height).toBeLessThanOrEqual(playedRowBox!.y + playedRowBox!.height + 1);
});

test('DD-E2E-058: a long played row fans cards without clipping its final card and scales stack badges', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    seedHand(record, []);
    const ids = ['footwork','regroup','jab','jab','footwork','muster','precisionShot','reclaim','drive','repellingShot','scrap','reforge','step','copper','regroup','jab','focus','bullRush','adapt'];
    record.state.players.ochre.deck.play = ids.map((id) => createCard(record.state, id));
  });
  const rowBox = await page.getByTestId('played-row').boundingBox(); const cards = await page.locator('[data-testid="played-row"] [data-played-card-name]').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
  expect(rowBox).not.toBeNull(); expect(cards.length).toBeGreaterThan(12); expect(cards.at(-1)!.right).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1); expect(cards.some((card, index) => index > 0 && card.left < cards[index - 1]!.right)).toBe(true);
  const stackedSlot = page.locator('.played-card-slot').filter({ has: page.locator('[data-card-count="2"]') }).first(); const stackedCard = await stackedSlot.locator('[data-card-count="2"]').boundingBox(); const badge = await stackedSlot.locator('.played-card-count').boundingBox();
  expect(stackedCard).not.toBeNull(); expect(badge).not.toBeNull(); expect(badge!.height / stackedCard!.height).toBeLessThan(.16);
});

test('DD-E2E-070: text controls confirm and reset the same game while Cancel preserves progress', async ({ page, baseUrl }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto(baseUrl); await page.getByRole('button', { name: 'Start game' }).click();
  const controls = page.getByRole('navigation', { name: 'Game controls' });
  await expect(controls.locator('button')).toHaveText(['Undo', 'Reset', 'New game', 'View all cards']);
  await expect(controls.locator('button').first()).toBeDisabled();
  const gameId = await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId'));
  const kingdom = await page.locator('.market-group').nth(1).locator('[data-market-card]').allTextContents();
  const openingHand = await page.locator('[data-testid="hand-grid"] [data-card-name]').evaluateAll((cards) => cards.map((card) => ({ name: card.getAttribute('data-card-name'), count: card.getAttribute('data-card-count') })));
  await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByText(/Turn 1 · Player 1 buy/)).toBeVisible();
  await controls.getByRole('button', { name: 'Reset' }).click(); const confirmation = page.getByRole('dialog', { name: 'Reset this game?' });
  await expect(confirmation).toContainText('same game and kingdom'); await expect(confirmation.getByRole('button')).toHaveText(['Yes, reset', 'Cancel']);
  await confirmation.getByRole('button', { name: 'Cancel' }).click(); await expect(confirmation).toHaveCount(0); await expect(page.getByText(/Turn 1 · Player 1 buy/)).toBeVisible(); await expect(controls.locator('button').first()).toBeEnabled();
  await controls.getByRole('button', { name: 'Reset' }).click(); await page.getByRole('button', { name: 'Yes, reset' }).click();
  await expect(page.getByText(/Turn 1 · Player 1 action/)).toBeVisible(); await expect(controls.locator('button').first()).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId'))).toBe(gameId);
  expect(await page.locator('.market-group').nth(1).locator('[data-market-card]').allTextContents()).toEqual(kingdom);
  expect(await page.locator('[data-testid="hand-grid"] [data-card-name]').evaluateAll((cards) => cards.map((card) => ({ name: card.getAttribute('data-card-name'), count: card.getAttribute('data-card-count') })))).toEqual(openingHand);
});

test('DD-E2E-072: Reset interrupts AI playback and reuses the existing trained game', async ({ page, baseUrl }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); let createRequests = 0;
  page.on('request', (request) => { const url = new URL(request.url()); if (request.method() === 'POST' && url.pathname === '/api/games') createRequests += 1; });
  await page.goto(baseUrl); await page.getByText('Play against AI', { exact: true }).click(); await page.getByText('AI goes first', { exact: true }).click(); await page.getByRole('button', { name: 'Start game' }).click();
  const playbackStatus = page.locator('.playback-label'); await expect(playbackStatus).toHaveText('Playing AI turn…');
  await expect(playbackStatus).toHaveAttribute('role', 'status'); await expect(playbackStatus).toHaveAttribute('aria-live', 'polite'); await expect(playbackStatus).toHaveAttribute('aria-atomic', 'true');
  const gameId = await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId'));
  await page.getByRole('button', { name: 'Reset' }).click(); await expect(page.getByRole('dialog', { name: 'Reset this game?' })).toBeVisible(); await expect(page.getByText('Playing AI turn…')).toHaveCount(0); await expect(page.locator('[data-flying-card]')).toHaveCount(0);
  const response = page.waitForResponse('**/api/games/*/reset'); await page.getByRole('button', { name: 'Yes, reset' }).click(); expect((await response).status()).toBe(200);
  await expect(page.getByText(/Turn 2 · Player 2 action/)).toBeVisible(); expect(createRequests).toBe(1); expect(await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId'))).toBe(gameId); await expect(page.getByRole('navigation', { name: 'Game controls' }).locator('button').first()).toBeDisabled();
});

test('DD-E2E-071: unavailable warning stays inside the card and stacks above rules and cost', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await openGame(page, (record) => { seedHand(record, ['feint']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 4; });
  const geometry = await page.locator('[data-card-name="Feint"]').evaluate((card) => {
    const warning = card.querySelector<HTMLElement>('em')!; const rules = card.querySelector<HTMLElement>('.card__rules')!; const cost = card.querySelector<HTMLElement>('.card__cost')!;
    const box = (element: Element) => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; };
    const cardBox = box(card); const warningBox = box(warning); const costBox = box(cost);
    const overlaps = (left: ReturnType<typeof box>, right: ReturnType<typeof box>) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
    const top = document.elementFromPoint((costBox.left + costBox.right) / 2, (costBox.top + costBox.bottom) / 2);
    return { cardBox, warningBox, warningZ: Number(getComputedStyle(warning).zIndex), rulesZ: Number(getComputedStyle(rules).zIndex), costZ: Number(getComputedStyle(cost).zIndex), warningFits: warning.scrollHeight <= warning.clientHeight, overlapsCost: overlaps(warningBox, costBox), warningAtCost: top === warning || warning.contains(top) };
  });
  expect(geometry.warningBox.left).toBeGreaterThanOrEqual(geometry.cardBox.left); expect(geometry.warningBox.top).toBeGreaterThanOrEqual(geometry.cardBox.top); expect(geometry.warningBox.right).toBeLessThanOrEqual(geometry.cardBox.right); expect(geometry.warningBox.bottom).toBeLessThanOrEqual(geometry.cardBox.bottom);
  expect(geometry).toMatchObject({ warningFits: true, overlapsCost: true, warningAtCost: true }); expect(geometry.warningZ).toBeGreaterThan(geometry.rulesZ); expect(geometry.warningZ).toBeGreaterThan(geometry.costZ);
});

test('DD-E2E-048: kingdom piles wrap before the action rail at a narrower desktop width', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1600, height: 1080 }); await openGame(page);
  const layout = await page.evaluate(() => {
    const root = document.documentElement; const market = document.querySelector<HTMLElement>('.market-zone')!; const rail = document.querySelector<HTMLElement>('.action-rail')!;
    const group = document.querySelector<HTMLElement>('.market-group:last-of-type')!; const row = group.querySelector<HTMLElement>('.compact-market__row')!;
    const piles = [...group.querySelectorAll<HTMLElement>('[data-market-card]')];
    const rects = piles.map((pile) => pile.getBoundingClientRect()); const marketRect = market.getBoundingClientRect(); const railRect = rail.getBoundingClientRect(); const groupRect = group.getBoundingClientRect(); const rowRect = row.getBoundingClientRect();
    const rowLefts = [...new Set(rects.map((rect) => Math.round(rect.left)))];
    return {
      count: piles.length, rows: new Set(rects.map((rect) => Math.round(rect.top))).size, columns: rowLefts.length,
      centered: Math.abs((Math.min(...rects.map((rect) => rect.left)) + Math.max(...rects.map((rect) => rect.right))) / 2 - marketRect.left - marketRect.width / 2) < 2,
      symmetricGutter: Math.abs(rowRect.left - groupRect.left - (groupRect.right - rowRect.right)) < 2,
      clearOfRail: rects.every((rect) => rect.right <= railRect.left), insideMarket: rects.every((rect) => rect.bottom <= marketRect.bottom),
      horizontal: root.scrollWidth - root.clientWidth, vertical: root.scrollHeight - root.clientHeight
    };
  });
  expect(layout).toEqual({ count: 10, rows: 2, columns: 5, centered: true, symmetricGutter: true, clearOfRail: true, insideMarket: true, horizontal: 0, vertical: 0 });
});
