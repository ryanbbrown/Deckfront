import { createCard, kingdomOf, kingdomSupply } from '../../src/game';
import { test, expect, seedHand } from './fixture';

async function playCard(page: import('@playwright/test').Page, name: string) { await page.locator(`[data-card-name="${name}"]`).first().click(); }
async function marketLayout(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const cardRects = [...document.querySelectorAll<HTMLElement>('.reference-card')].map((card) => card.getBoundingClientRect());
    const imageRects = [...document.querySelectorAll<HTMLElement>('.reference-card .card__image')].map((image) => image.getBoundingClientRect());
    const surface = rect('.market-dialog__surface');
    return {
      surface: { left: surface.left, top: surface.top, right: surface.right, bottom: surface.bottom, width: surface.width, height: surface.height },
      cardWidths: [...new Set(cardRects.map((card) => Math.round(card.width)))],
      cardHeights: [...new Set(cardRects.map((card) => Math.round(card.height)))],
      rows: new Set(cardRects.map((card) => Math.round(card.top))).size,
      columns: new Set(cardRects.map((card) => Math.round(card.left))).size,
      imageHeights: [...new Set(imageRects.map((image) => Math.round(image.height)))],
      overflow: { horizontal: document.documentElement.scrollWidth - innerWidth, vertical: document.documentElement.scrollHeight - innerHeight },
      viewport: { width: innerWidth, height: innerHeight }
    };
  });
}

test('DD-E2E-001: full-table preview refreshes, explains, and keeps both local builds', async ({ page, baseUrl }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'Hexdeck' })).toBeVisible(); await expect(page.getByText('Choose a kingdom')).toBeVisible(); await expect(page.getByText('I go first', { exact: true })).toHaveCount(0); await expect(page.getByText('AI goes first', { exact: true })).toHaveCount(0); await expect(page.getByLabel('AI strength')).toHaveCount(0);
  await expect(page.locator('[data-market-card="Step"]')).toBeVisible(); await expect(page.locator('[data-market-card="Focus"]')).toBeVisible(); await expect(page.locator('[data-market-card="Scrap"]')).toHaveCount(0); await expect(page.locator('[data-market-card]')).toHaveCount(15); await expect(page.locator('[data-market-card][aria-disabled="true"]')).toHaveCount(15); await expect(page.getByLabel('Starting draft')).toBeChecked();
  const compactWidths = await page.locator('[data-market-card]').evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().width)));
  expect([...new Set(compactWidths)]).toEqual([137]);
  await page.locator('[data-market-card="Step"]').locator('..').click({ button: 'right' }); const cardPopup = page.getByRole('dialog', { name: 'Step details' }); await expect(cardPopup).toBeVisible(); await expect(cardPopup).toContainText('Move 1 space'); await expect(cardPopup.getByLabel('Cost 2')).toBeVisible(); expect(await cardPopup.evaluate((element) => element.matches(':modal'))).toBe(false); expect(Number.parseFloat(await cardPopup.locator('.card__rules').evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(7); await page.keyboard.press('Escape'); await expect(cardPopup).toHaveCount(0);
  const before = await page.locator('.market-group').nth(1).locator('[data-market-card]').allTextContents(); await page.getByRole('button', { name: 'Refresh market' }).click(); const after = await page.locator('.market-group').nth(1).locator('[data-market-card]').allTextContents(); expect(after).not.toEqual(before);
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
    await page.setViewportSize(viewport); await page.getByRole('button', { name: 'View cards' }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.locator('.market-dialog .reference-card')).toHaveCount(15); await expect(page.locator('.market-dialog .card__image')).toHaveCount(15);
    const layout = await marketLayout(page); expect(layout.cardWidths).toEqual([148]); expect(layout.cardHeights).toEqual([220]); expect(layout.imageHeights).toEqual([72]); expect(layout.rows).toBe(2); expect(layout.columns).toBe(8); expect(layout.surface.width).toBeLessThanOrEqual(1320); expect(layout.surface.height).toBeLessThanOrEqual(540); expect(layout.surface.left).toBeGreaterThanOrEqual(0); expect(layout.surface.top).toBeGreaterThanOrEqual(0); expect(layout.surface.right).toBeLessThanOrEqual(layout.viewport.width); expect(layout.surface.bottom).toBeLessThanOrEqual(layout.viewport.height); expect(layout.overflow).toEqual({ horizontal: 0, vertical: 0 }); await page.getByRole('button', { name: 'Close market' }).click();
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('button', { name: 'Start game' }).click(); await page.locator('[data-market-card="Copper"]').click(); await page.locator('[data-market-card="Copper"]').click(); await page.locator('[data-market-card="Step"]').click(); await expect(page.getByTestId('build-budget')).toHaveText('2 / 12 · 3 carries');
  await page.reload(); await expect(page.getByRole('button', { name: 'Remove Copper' })).toHaveCount(2); await page.getByRole('button', { name: 'Remove Copper' }).first().click();
  await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByText('Player 2 starting build')).toBeVisible();
  await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Copper"]')).toHaveText('Copper×7'); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Step"]')).toHaveCount(0); await expect(page.getByTestId('deck-summary-indigo').locator('[data-deck-card="Copper"]')).toHaveText('Copper×7');
  await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Copper"]')).toHaveText('Copper×8'); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Step"]')).toHaveText('Step×1');
  await expect(page.getByText(/Turn 1 · Player 1 action/)).toBeVisible();
});
test('DD-E2E-035: two local players draft in sequence and take complete turns on one browser', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByRole('button', { name: 'Start game' }).click();
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
  await page.locator('[data-card-name="Footwork"]').click(); await expect(page.getByRole('button', { name: 'Play Footwork: Left' })).toHaveText(/Left/); await expect(page.getByRole('button', { name: 'Play Footwork: Stay' })).toHaveText(/Stay/); await expect(page.getByRole('button', { name: 'Play Footwork: Right' })).toHaveText(/Right/); await expect(page.getByRole('button', { name: 'Play Footwork: Left' })).toHaveClass(/arena-space--choice/); await expect(page.locator('.choice-bar').filter({ hasText: 'Choose movement' })).toHaveCount(0);
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
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('37 HP'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '4'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces'); await expect(page.locator('.play-order')).toHaveCount(0); await expect(page.getByText('Numbers show play order.')).toHaveCount(0); await expect(page.getByTestId('action-log').getByText('Moved both fighters right to space 4')).toBeVisible();
  await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('40 HP'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('Close-range attacks this turn: +1 damage'); await page.locator('[data-card-name="Drive"]').click(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('37 HP');
});

test('DD-E2E-007: six visible Footwork plays make uncapped Close Flurry deal six damage', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'footwork', 'footwork', 'footwork', 'footwork', 'footwork', 'flurry']); record.state.fighters.ochre.position = 3; record.state.fighters.indigo.position = 3; });
  for (let count = 0; count < 6; count += 1) { await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Stay' }).click(); }
  await playCard(page, 'Flurry'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('34 HP'); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces');
});

test('DD-E2E-008: consecutive Footwork cards can move onto and past the opponent', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'footwork']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces');
  await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3'); await expect(page.getByTestId('range')).toHaveText('Near · 1 space');
});

test('DD-E2E-009: Far Aim applies Aimed and Volley deals six', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 5; });
  await playCard(page, 'Aim'); await expect(page.locator('[data-player-score="ochre"]')).toContainText('Aimed');
  await playCard(page, 'Volley'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('34 HP'); await expect(page.locator('[data-player-score="ochre"]')).not.toContainText('Aimed');
});

test('DD-E2E-010: close combination resolves Footwork Feint Drive Flurry for seven damage', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'feint', 'drive', 'flurry']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 2; });
  await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await playCard(page, 'Feint'); await page.locator('[data-card-name="Drive"]').click(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click(); await playCard(page, 'Flurry');
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('33 HP'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '3'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3');
});

test('DD-E2E-011: ranged escape uses two Footwork cards then Aim and Volley for six at Far', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'footwork', 'aim', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 2; });
  for (let count = 0; count < 2; count += 1) { await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); }
  await playCard(page, 'Aim'); await playCard(page, 'Volley');
  await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.getByTestId('range')).toHaveText('Far · 2 spaces'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('34 HP');
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
  await playCard(page, 'Feint'); await page.locator('[data-card-name="Drive"]').click(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('34 HP'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '6'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '6'); await expect(page.getByTestId('action-log').getByText('Wall blocked right; neither fighter moved')).toBeVisible();
});

test('DD-E2E-015: two unprepared Near Volleys deal two and Aim plus Near Volley deals three', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['volley', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await page.locator('[data-card-name="Volley"]').first().click(); await playCard(page, 'Volley'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('38 HP');
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; }); await playCard(page, 'Aim'); await playCard(page, 'Volley'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('37 HP');
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
  for (let count = 0; count < 2; count += 1) { await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Stay' }).click(); } await playCard(page, 'Flurry'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('38 HP'); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces');
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
  await page.goto(baseUrl); await page.getByRole('button', { name: 'Start game' }).click();
  await page.route('**/build', async (route) => { await new Promise((resolve) => setTimeout(resolve, 150)); await route.continue(); }); const copper = page.locator('[data-market-card="Copper"]'); const response = page.waitForResponse('**/build'); await copper.click(); await expect(copper).toBeDisabled(); await expect(page.locator('[data-market-card="Step"]')).toBeDisabled(); await page.getByRole('button', { name: 'View all cards' }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await response; await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Close market' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'View all cards' }).click(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await page.getByRole('button', { name: 'View all cards' }).click(); await page.getByRole('dialog').click({ position: { x: 5, y: 5 } }); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Remove Copper' })).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0);
});
test('DD-E2E-026: a zero-paid build locks after completion and passes to Player 2', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByRole('button', { name: 'Start game' }).click(); await expect(page.getByTestId('build-budget')).toHaveText('0 / 12 · 3 carries');
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
  await page.getByRole('button', { name: 'View all cards' }).click(); const dialog = page.getByRole('dialog');
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
  const layout = await page.evaluate(() => { const root = document.documentElement; const hand = document.querySelector('[data-testid="hand-grid"]')!.getBoundingClientRect(); const played = document.querySelector('[data-testid="played-row"]')!.getBoundingClientRect(); const cardBox = document.querySelector('[data-testid="hand-grid"] [data-card-name="Muster"]')!.getBoundingClientRect(); return { horizontal: root.scrollWidth - root.clientWidth, vertical: root.scrollHeight - root.clientHeight, portrait: cardBox.height / cardBox.width, playedAboveHand: played.bottom <= hand.top, cardInside: cardBox.left >= hand.left && cardBox.right <= hand.right + 1 }; });
  expect(layout).toMatchObject({ horizontal: 0, vertical: 0, playedAboveHand: true, cardInside: true }); expect(layout.portrait).toBeGreaterThan(1.3);
  await card.click(); await expect(page.getByTestId('hand-count-muster')).toHaveText('×14'); await expect(page.locator('[data-testid="played-row"] [data-played-card-name="Muster"]')).toHaveCount(1);
});

test('DD-E2E-039: grouped Cull selects two physical copies from one card group', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull', 'copper', 'copper', 'silver']); });
  const copper = page.locator('[data-testid="hand-grid"] [data-card-name="Copper"]'); await expect(copper).toHaveCount(1); await expect(copper).toHaveAttribute('data-card-count', '2');
  await page.locator('[data-testid="hand-grid"] [data-card-name="Cull"]').click(); await copper.click(); await copper.click(); await expect(copper).toContainText('Selected ×2'); await expect(page.getByText('2 selected.')).toBeVisible();
  await page.getByRole('button', { name: 'Trash selected cards' }).click(); await expect(copper).toHaveCount(0); await expect(page.locator('[data-testid="played-row"] [data-played-card-name="Cull"]')).toHaveCount(1);
});

test('DD-E2E-040: large unique hands overlap and the action rail stays visible', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await openGame(page, (record) => { seedHand(record, ['copper', 'silver', 'gold', 'step', 'cull', 'focus', 'footwork', 'muster', 'feint', 'drive', 'flurry', 'aim', 'volley', 'stipend', 'reclaim', 'adapt']); });
  const before = await page.evaluate(() => { const cards = Array.from(document.querySelectorAll<HTMLElement>('.hand-card-slot')); const first = cards[0]!.getBoundingClientRect(); const second = cards[1]!.getBoundingClientRect(); return { count: cards.length, sameRow: cards.every((card) => Math.abs(card.getBoundingClientRect().top - first.top) < 1), delta: second.left - first.left, width: document.querySelector<HTMLElement>('.full-card')!.getBoundingClientRect().width, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
  expect(before).toMatchObject({ count: 16, sameRow: true, overflow: 0 }); expect(before.delta).toBeLessThan(before.width); expect(before.delta).toBeGreaterThan(0);
  const footwork = page.locator('[data-testid="hand-grid"] [data-card-name="Footwork"]'); const resting = await footwork.evaluate((card) => getComputedStyle(card).transform); await footwork.hover(); const lifted = await footwork.evaluate((card) => getComputedStyle(card).transform); expect(lifted).not.toBe(resting); await page.mouse.move(0, 0); await footwork.focus(); const focused = await footwork.evaluate((card) => ({ transform: getComputedStyle(card).transform, zIndex: getComputedStyle(card.parentElement!).zIndex })); expect(focused.transform).not.toBe(resting); expect(Number(focused.zIndex)).toBe(250);
  for (const name of ['Copper', 'Drive']) { const card = page.locator(`[data-testid="hand-grid"] [data-card-name="${name}"]`); await expect(card).toHaveAttribute('aria-disabled', 'true'); const beforeFocus = await card.evaluate((element) => getComputedStyle(element).transform); await card.focus(); await expect(card).toBeFocused(); const afterFocus = await card.evaluate((element) => ({ transform: getComputedStyle(element).transform, zIndex: getComputedStyle(element.parentElement!).zIndex })); expect(afterFocus.transform).not.toBe(beforeFocus); expect(Number(afterFocus.zIndex)).toBe(250); await page.keyboard.press('Enter'); await expect(card).toBeVisible(); } await expect(page.locator('[data-testid="played-row"] [data-played-card-name]')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Action history and deck compositions' })).toBeVisible(); await expect(page.locator('.side-drawer,.edge-toggle')).toHaveCount(0); await expect(page.getByTestId('deck-summary-ochre').locator('[data-deck-card="Footwork"]')).toHaveText('Footwork×1');
});

test('DD-E2E-043: a projected pending choice renders and clears after selection', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    const kingdom = kingdomOf('three-way-engine'); record.kingdom = kingdom; record.state.kingdomId = kingdom.id;
    record.state.startingHealth = kingdom.startingHealth; record.state.supply = kingdomSupply(kingdom);
    seedHand(record, ['prism', 'copper'], ['silver']);
  });
  await page.locator('[data-card-name="Prism"]').click();
  await expect(page.getByText('Select one card to discard')).toBeVisible();
  const discard = page.locator('[data-card-name="Copper"]');
  await discard.click(); await expect(discard).toHaveClass(/card--selected/);
  await page.getByRole('button', { name: 'Confirm discard' }).click();
  await expect(page.getByText('Select one card to discard')).toHaveCount(0);
  await expect(page.locator('[data-card-name="Silver"]')).toBeVisible();
});

test('DD-E2E-042: AI-first games show public automatic turns and undo to a human state', async ({ page, baseUrl }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto(baseUrl); await page.getByText('Play against AI', { exact: true }).click(); await expect(page.getByText('AI goes first', { exact: true })).toBeVisible(); await page.getByText('AI goes first', { exact: true }).click();
  const difficulty = page.getByLabel('AI strength'); await expect(difficulty.locator('option')).toHaveText(['Easy', 'Normal', 'Hard', 'Expert']); await expect(difficulty).toHaveValue('expert'); await difficulty.selectOption('hard');
  let createRequest: Record<string, unknown> | null = null;
  await page.route('**/api/games', async (route) => { createRequest = route.request().postDataJSON() as Record<string, unknown>; await new Promise((resolve) => setTimeout(resolve, 100)); await route.continue(); }); await page.getByRole('button', { name: 'Start game' }).click(); await expect(page.getByText('Training opponent…')).toBeVisible();
  await expect(page.getByText('Player 2 starting build')).toBeVisible(); await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByText(/Turn 2 · Player 2 action/)).toBeVisible(); await expect(page.getByTestId('action-log').getByText('Bought Silver').last()).toBeVisible(); await expect(page.getByTestId('action-log').getByText('Turn 1 started')).toBeVisible(); await expect(page.getByTestId('action-log').getByText('Turn 2 started')).toBeVisible();
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
  await openGame(page); const rail = page.getByRole('complementary', { name: 'Action history and deck compositions' }); await expect(rail).toBeVisible();
  await expect(page.locator('.side-drawer,.edge-toggle')).toHaveCount(0);
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
    const root = document.documentElement; const log = document.querySelector<HTMLElement>('[data-testid="action-log"]')!; const decks = document.querySelector<HTMLElement>('.rail-decks')!; const rail = document.querySelector<HTMLElement>('.action-rail')!; const lastPile = [...document.querySelectorAll<HTMLElement>('.market-group:nth-of-type(2) [data-market-card]')].at(-1)!;
    const logRect = log.getBoundingClientRect(); const decksRect = decks.getBoundingClientRect(); const railRect = rail.getBoundingClientRect(); const pileRect = lastPile.getBoundingClientRect();
    return { horizontal: root.scrollWidth - root.clientWidth, vertical: root.scrollHeight - root.clientHeight, logScrolls: log.scrollHeight > log.clientHeight, newestVisible: log.scrollTop + log.clientHeight >= log.scrollHeight - 1, logOverflow: getComputedStyle(log).overflowY, decksBelowLog: logRect.bottom <= decksRect.top + 1, decksVisible: decksRect.bottom <= innerHeight && decksRect.top >= 0, railVisible: railRect.right <= innerWidth && railRect.left >= 0, marketClear: pileRect.right <= railRect.left };
  });
  expect(layout).toEqual({ horizontal: 0, vertical: 0, logScrolls: true, newestVisible: true, logOverflow: 'auto', decksBelowLog: true, decksVisible: true, railVisible: true, marketClear: true });
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
  const draft = page.getByLabel('Starting draft'); await expect(draft).toBeChecked(); await draft.uncheck();
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
  await scrap.click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('39 HP');
  await expect(page.getByTestId('action-log').getByText('Played Scrap')).toBeVisible();
  await expect(page.locator('[data-market-card="Scrap"]')).toHaveCount(0);
});

test('DD-E2E-050: single-target discard and trash choices complete their card effects', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['bullRush','strike']); record.state.fighters.indigo.position = 2; });
  await page.locator('[data-card-name="Bull Rush"]').click();
  await expect(page.getByText('Select 1 card to discard. 0 selected.')).toBeVisible();
  await expect(page.getByText('Click a grouped card twice')).toHaveCount(0);
  await page.locator('[data-card-name="Strike"]').click();
  await page.getByRole('button', { name:'Discard selected card' }).click();
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('35 HP');
  await expect(page.locator('[data-card-name="Strike"]')).toHaveCount(0);
  await expect(page.getByTestId('action-log').getByText('Discarded Strike')).toBeVisible();

  await openGame(page, (record) => { seedHand(record, ['salvageShot','steadyShot'], ['gold']); });
  await page.locator('[data-card-name="Salvage Shot"]').click();
  await expect(page.getByText('Select 1 card to discard. 0 selected.')).toBeVisible();
  await page.locator('[data-card-name="Steady Shot"]').click();
  await page.getByRole('button', { name:'Discard selected card' }).click();
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('37 HP');
  await expect(page.locator('[data-card-name="Gold"]')).toBeVisible();
  await expect(page.getByTestId('action-log').getByText('Discarded Steady Shot')).toBeVisible();

  await openGame(page, (record) => { seedHand(record, ['discipline']); });
  await page.locator('[data-card-name="Discipline"]').click();
  await expect(page.getByText('Select 1 card to trash. 0 selected.')).toBeVisible();
  await expect(page.getByText('Click a grouped card twice')).toHaveCount(0);
  await page.locator('[data-card-name="Discipline"]').click();
  await page.getByRole('button', { name: 'Trash selected card' }).click();
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('39 HP');
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
});

test('DD-E2E-052: Reforge trashes a target and completes its market gain choice', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['reforge','copper']); });
  await page.locator('[data-card-name="Reforge"]').click();
  await expect(page.getByText('Select 1 card to trash. 0 selected.')).toBeVisible();
  await page.locator('[data-card-name="Copper"]').click();
  await page.getByRole('button', { name: 'Trash selected card' }).click();
  await expect(page.getByText('Choose a card to gain')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gain Channel' })).toBeVisible();
  await page.getByRole('button', { name: 'Gain Channel' }).click();
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
  await openGame(page, (record) => { seedHand(record, ['muster', 'muster', 'muster', 'footwork', 'footwork']); record.state.fighters.ochre.position = 3; });
  await expect(page.getByRole('button', { name: 'Play all ×3' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Play all ×2/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Play all ×3' }).click();
  await expect(page.locator('[data-card-name="Muster"]')).toHaveCount(0);
  await expect(page.locator('[data-played-card-name="Muster"]')).toHaveAttribute('data-card-count', '3');
  await page.locator('[data-card-name="Footwork"]').click();
  await expect(page.getByRole('button', { name: 'Play Footwork: Stay' })).toHaveClass(/arena-space--choice/);
});

test('DD-E2E-056: hand groups keep turn slots and append newly drawn definitions', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['stipend', 'stipend', 'copper'], ['gold']); });
  const stipend = page.locator('[data-card-name="Stipend"]'); const copper = page.locator('[data-card-name="Copper"]');
  const before = await stipend.evaluate((card) => card.getBoundingClientRect().left);
  await stipend.click(); await expect(stipend).toHaveAttribute('data-card-count', '1');
  expect(await stipend.evaluate((card) => card.getBoundingClientRect().left)).toBe(before);
  expect(await page.locator('[data-card-name="Gold"]').evaluate((card) => card.getBoundingClientRect().left)).toBeGreaterThan(await copper.evaluate((card) => card.getBoundingClientRect().left));
  await page.getByRole('button', { name: 'Undo last action' }).click();
  await expect(stipend).toHaveAttribute('data-card-count', '2'); expect(await stipend.evaluate((card) => card.getBoundingClientRect().left)).toBe(before);
});

test('DD-E2E-057: canonical card faces keep long rules inside hand and scaled played cards', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['reclaim', 'reclaim', 'precisionShot', 'salvageShot', 'drive', 'repellingShot']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 4; });
  const fit = await page.locator('[data-testid="hand-grid"] .card').evaluateAll((cards) => cards.map((card) => { const cardRect = card.getBoundingClientRect(); const header = card.querySelector('.card__header')!.getBoundingClientRect(); const rules = card.querySelector('.card__rules')!.getBoundingClientRect(); return { headerAtTop: header.top <= cardRect.top + 4, rulesInside: rules.bottom <= cardRect.bottom + 1 }; }));
  expect(fit.every((entry) => entry.headerAtTop && entry.rulesInside)).toBe(true);
  const precisionCopy = page.locator('[data-card-name="Precision Shot"]');
  await expect(precisionCopy.locator('.card__headline')).toHaveText('4 damage');
  await expect(precisionCopy.locator('.card__detail')).toHaveText('Other Precision Shots you play this turn deal 2 damage instead.');
  expect(await precisionCopy.locator('.card__headline').evaluate((headline) => ({ align: getComputedStyle(headline).textAlign, weight: Number(getComputedStyle(headline).fontWeight) }))).toMatchObject({ align: 'center', weight: 900 });
  await page.locator('[data-card-name="Reclaim"]').click();
  const sizes = await page.evaluate(() => { const hand = document.querySelector<HTMLElement>('[data-card-name="Reclaim"]')!.getBoundingClientRect(); const played = document.querySelector<HTMLElement>('[data-played-card-name="Reclaim"]')!.getBoundingClientRect(); return { handRatio: hand.height / hand.width, playedRatio: played.height / played.width }; });
  expect(Math.abs(sizes.handRatio - sizes.playedRatio)).toBeLessThan(.02);
});

test('DD-E2E-048: kingdom piles wrap before the action rail at a narrower desktop width', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1600, height: 1080 }); await openGame(page);
  const layout = await page.evaluate(() => {
    const root = document.documentElement; const market = document.querySelector<HTMLElement>('.market-zone')!; const rail = document.querySelector<HTMLElement>('.action-rail')!;
    const piles = [...document.querySelectorAll<HTMLElement>('.market-group:last-of-type [data-market-card]')];
    const rects = piles.map((pile) => pile.getBoundingClientRect()); const marketRect = market.getBoundingClientRect(); const railRect = rail.getBoundingClientRect();
    const rowLefts = [...new Set(rects.map((rect) => Math.round(rect.left)))];
    return {
      count: piles.length, rows: new Set(rects.map((rect) => Math.round(rect.top))).size, columns: rowLefts.length,
      centered: Math.abs((Math.min(...rects.map((rect) => rect.left)) + Math.max(...rects.map((rect) => rect.right))) / 2 - marketRect.left - marketRect.width / 2) < 2,
      clearOfRail: rects.every((rect) => rect.right <= railRect.left), insideMarket: rects.every((rect) => rect.bottom <= marketRect.bottom),
      horizontal: root.scrollWidth - root.clientWidth, vertical: root.scrollHeight - root.clientHeight
    };
  });
  expect(layout).toEqual({ count: 10, rows: 2, columns: 5, centered: true, clearOfRail: true, insideMarket: true, horizontal: 0, vertical: 0 });
});
