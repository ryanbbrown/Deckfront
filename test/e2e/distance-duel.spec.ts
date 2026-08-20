import { kingdomOf, kingdomSupply } from '../../src/game';
import { test, expect, seedHand } from './fixture';

async function playCard(page: import('@playwright/test').Page, name: string) { await page.locator(`[data-card-name="${name}"]`).first().click(); }

test('DD-E2E-001: full-table preview refreshes, explains, and keeps both local builds', async ({ page, baseUrl }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'Hexdeck' })).toBeVisible(); await expect(page.getByText('Choose a kingdom')).toBeVisible();
  await expect(page.locator('[data-market-card="Step"]')).toBeVisible(); await expect(page.locator('[data-market-card="Cull"]')).toBeVisible(); await expect(page.locator('[data-market-card="Focus"]')).toBeVisible();
  const before = await page.locator('.market-group').nth(1).locator('[data-market-card]').allTextContents(); await page.getByRole('button', { name: 'Refresh market' }).click(); const after = await page.locator('.market-group').nth(1).locator('[data-market-card]').allTextContents(); expect(after).not.toEqual(before);
  await page.getByRole('button', { name: 'View cards' }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.locator('.market-dialog .reference-card')).toHaveCount(16); await expect(page.locator('.market-dialog .card__image')).toHaveCount(16); const dialogOverflow = await page.locator('.market-dialog__surface').evaluate((element) => ({ horizontal: element.scrollWidth - element.clientWidth, vertical: element.scrollHeight - element.clientHeight })); expect(dialogOverflow).toEqual({ horizontal: 0, vertical: 0 }); await page.getByRole('button', { name: 'Close market' }).click();
  await page.getByRole('button', { name: 'Start game' }).click(); await page.locator('[data-market-card="Copper"]').click(); await page.locator('[data-market-card="Copper"]').click(); await page.locator('[data-market-card="Step"]').click(); await expect(page.getByTestId('build-budget')).toHaveText('2 / 12 · 3 carries');
  await page.reload(); await expect(page.getByRole('button', { name: 'Remove Copper' })).toHaveCount(2); await page.getByRole('button', { name: 'Remove Copper' }).first().click();
  await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByText('Player 2 starting build')).toBeVisible(); await page.getByRole('button', { name: 'Finish starting build' }).click();
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
  await page.locator('[data-market-card="Copper"]').click(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByTestId('player-one-purchases')).toContainText('None');
  for (const name of ['Copper', 'Copper', 'Silver', 'Silver', 'Gold', 'Gold']) { await page.locator(`[data-market-card="${name}"]`).click(); }
  await expect(page.getByTestId('zone-money')).toContainText('12'); await expect(page.getByTestId('player-one-purchases')).toContainText('Copper, Copper, Silver, Silver, Gold, Gold'); await expect(page.locator('[data-market-card="Copper"]')).toBeEnabled(); await expect(page.locator('[data-market-card="Silver"]')).toBeEnabled(); await expect(page.locator('[data-market-card="Gold"]')).toBeEnabled();
});

test('DD-E2E-003: Footwork offers Stay, draws without moving, then can move into a shared space', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork'], ['aim']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await page.locator('[data-card-name="Footwork"]').click(); await expect(page.getByRole('button', { name: 'Play Footwork: Left' })).toHaveText('Left'); await expect(page.getByRole('button', { name: 'Play Footwork: Stay' })).toHaveText('Stay'); await expect(page.getByRole('button', { name: 'Play Footwork: Right' })).toHaveText('Right');
  await page.getByRole('button', { name: 'Play Footwork: Stay' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '2'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3'); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await page.getByRole('button', { name: /Deck ·/ }).click(); await expect(page.getByText('Moved to space 2')).toBeVisible(); await page.getByRole('button', { name: 'Close Deck and zones' }).click();
  await page.getByRole('button', { name: 'Undo last action' }).click(); await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '3'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3'); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces');
});

test('DD-E2E-004: Cull selects itself plus one hand card and trashes both', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull', 'copper', 'silver']); });
  await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Copper"]').click(); await expect(page.getByText('2 selected (maximum 2).')).toBeVisible();
  await page.getByRole('button', { name: 'Trash selected cards' }).click(); await expect(page.getByTestId('zone-trash')).toContainText('9');
  await expect(page.locator('[data-card-name="Silver"]')).toBeVisible(); await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0);
});

test('DD-E2E-005: Muster draws immediately and global Undo restores the hand', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster']); record.state.players.ochre.deck.discard.push(...['aim', 'volley'].map((id) => ({ id: `extra-${id}`, definitionId: id }))); record.state.nextCardSerial += 2; });
  await playCard(page, 'Muster'); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await expect(page.locator('[data-card-name="Volley"]')).toBeVisible(); await expect(page.getByRole('button', { name: 'Undo last action' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.locator('[data-card-name="Muster"]')).toBeVisible(); await expect(page.locator('[data-card-name="Aim"]')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Undo last action' })).toBeDisabled();
});

test('DD-E2E-006: Close Feint states its damage bonus and Drive moves both fighters', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 3; record.state.fighters.indigo.position = 3; });
  await playCard(page, 'Feint'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('Next Close-range attack this turn: +2 damage'); await expect(page.locator('[data-player-score="indigo"]')).not.toContainText('Exposed');
  await page.locator('[data-card-name="Drive"]').click(); await expect(page.getByRole('button', { name: 'Play Drive: Move Both Left' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Play Drive: Move Both Right' })).toBeVisible(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click();
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('35 HP'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '4'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces');
  await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('40 HP'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('Next Close-range attack this turn: +2 damage'); await page.locator('[data-card-name="Drive"]').click(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('35 HP');
});

test('DD-E2E-007: six visible Footwork plays make Close Flurry hit its five-damage cap', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'footwork', 'footwork', 'footwork', 'footwork', 'footwork', 'flurry']); record.state.fighters.ochre.position = 3; record.state.fighters.indigo.position = 3; });
  for (let count = 0; count < 6; count += 1) { await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Stay' }).click(); }
  await playCard(page, 'Flurry'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('35 HP'); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces');
});

test('DD-E2E-008: consecutive Footwork cards can move onto and past the opponent', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'footwork']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await expect(page.getByTestId('range')).toHaveText('Close · 0 spaces');
  await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3'); await expect(page.getByTestId('range')).toHaveText('Near · 1 space');
});

test('DD-E2E-009: Far Aim applies Aimed and Volley deals five', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 5; });
  await playCard(page, 'Aim'); await expect(page.locator('[data-player-score="ochre"]')).toContainText('Aimed');
  await playCard(page, 'Volley'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('35 HP'); await expect(page.locator('[data-player-score="ochre"]')).not.toContainText('Aimed');
});

test('DD-E2E-010: close combination resolves Footwork Feint Drive Flurry for eight damage', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'feint', 'drive', 'flurry']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 2; });
  await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await playCard(page, 'Feint'); await page.locator('[data-card-name="Drive"]').click(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click(); await playCard(page, 'Flurry');
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('32 HP'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '3'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3');
});

test('DD-E2E-011: ranged escape uses two Footwork cards then Aim and Volley for five at Far', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'footwork', 'aim', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 2; });
  for (let count = 0; count < 2; count += 1) { await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); }
  await playCard(page, 'Aim'); await playCard(page, 'Volley');
  await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.getByTestId('range')).toHaveText('Far · 2 spaces'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('35 HP');
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

test('DD-E2E-014: chosen Drive direction into a wall deals exact seven damage and moves neither fighter', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 5; record.state.fighters.indigo.position = 5; });
  await playCard(page, 'Feint'); await page.locator('[data-card-name="Drive"]').click(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('33 HP'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '5'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '5');
});

test('DD-E2E-015: two unprepared Near Volleys deal two and Aim plus Near Volley deals four', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['volley', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await page.locator('[data-card-name="Volley"]').first().click(); await playCard(page, 'Volley'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('38 HP');
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; }); await playCard(page, 'Aim'); await playCard(page, 'Volley'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('36 HP');
});

test('DD-E2E-016: Cull trashes two other hand cards and never offers an already played card', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'cull', 'copper', 'silver']); });
  await playCard(page, 'Muster'); await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Copper"]').click(); await page.locator('[data-card-name="Silver"]').click();
  await expect(page.locator('[data-card-name="Muster"]')).toHaveCount(0); await page.getByRole('button', { name: 'Trash selected cards' }).click(); await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0); await expect(page.getByTestId('zone-trash')).toContainText('9');
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
  await expect(page.locator('[data-card-name="Cull"]')).toBeEnabled(); await page.locator('[data-card-name="Cull"]').click(); await expect(page.getByText('Select 1 or 2 cards. Click a grouped card twice to select two physical copies.')).toBeVisible(); await page.locator('[data-card-name="Cull"]').click(); await expect(page.getByText('1 selected (maximum 2).')).toBeVisible(); await page.getByRole('button', { name: 'Trash selected card' }).click(); await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0); await expect(page.getByTestId('zone-trash')).toContainText('8');
});

test('DD-E2E-021: starting-build carry appears in only the first local Buy phase', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, []); record.state.players.ochre.firstBuyMoney = 3; record.state.players.ochre.firstBuyPending = true; record.state.players.indigo.firstBuyMoney = 0; record.state.players.indigo.firstBuyPending = false; });
  await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 3');
  await page.getByRole('button', { name: 'End Buy phase' }).click(); await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 0');
});

test('DD-E2E-023: Cull can trash one remaining hand card and it stays absent after cleanup', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull', 'copper']); }); await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Copper"]').click(); await expect(page.getByText('1 selected (maximum 2).')).toBeVisible(); await page.getByRole('button', { name: 'Trash selected card' }).click();
  await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0); await expect(page.getByTestId('zone-trash')).toContainText('8'); await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click();
  await expect(page.getByTestId('zone-trash')).toContainText('8');
});

test('DD-E2E-025: a pending build update locks the compact market without a revision conflict', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByRole('button', { name: 'Start game' }).click();
  await page.route('**/build', async (route) => { await new Promise((resolve) => setTimeout(resolve, 80)); await route.continue(); }); const copper = page.locator('[data-market-card="Copper"]'); await copper.click(); await expect(copper).toBeDisabled(); await expect(page.locator('[data-market-card="Step"]')).toBeDisabled(); await expect(page.getByRole('button', { name: 'Remove Copper' })).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0);
});
test('DD-E2E-026: a zero-paid build locks after completion and passes to Player 2', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByRole('button', { name: 'Start game' }).click(); await expect(page.getByTestId('build-budget')).toHaveText('0 / 12 · 3 carries');
  await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.locator('[data-market-card="Copper"]')).toBeVisible(); await expect(page.getByText('Player 2 starting build')).toBeVisible(); await page.getByRole('button', { name: 'Finish starting build' }).click(); await page.getByRole('button', { name: /Deck ·/ }).click(); await expect(page.getByText('Starting builds')).toBeVisible(); await expect(page.getByText('Player 1: No cards')).toBeVisible();
});
test('DD-E2E-028: immediate Action, global Undo, and Buy phase restore after refresh', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'copper'], ['aim', 'volley']); record.state.players.ochre.firstBuyMoney = 0; }); await playCard(page, 'Muster'); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await page.reload(); await expect(page.getByRole('button', { name: 'Undo last action' })).toBeEnabled(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.locator('[data-card-name="Muster"]')).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.reload(); await expect(page.getByText(/Turn 1 · Player 1 buy/)).toBeVisible();
});

test('DD-E2E-031: visible market accepts the 10th Footwork and disables the unavailable 11th', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, []); record.state.phase = 'buy'; record.state.players.ochre.money = 3; record.state.players.ochre.firstBuyPending = false; record.state.supply.footwork = 1; record.state.players.ochre.purchases = Array<string>(9).fill('footwork'); }); const footwork = page.locator('[data-market-card="Footwork"]'); await expect(footwork).toContainText('1 left'); await footwork.click(); await expect(footwork).toContainText('0 left'); await expect(footwork).toBeDisabled(); await expect(page.getByTestId('player-one-purchases')).toContainText('Footwork, Footwork');
});

test('DD-E2E-032: Buy completion switches players immediately and can be undone', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.phase = 'buy'; record.state.players.ochre.money = 0; }); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 2 · Player 2 action/)).toBeVisible(); await expect(page.getByRole('heading', { name: 'Player 2 hand' })).toBeVisible(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 1 · Player 1 buy/)).toBeVisible();
});

test('DD-E2E-034: public labels and card rules use explicit player-facing text', async ({ page, openGame }) => {
  await openGame(page, (record) => { record.state.players.ochre.purchases = ['silver', 'footwork']; record.state.players.indigo.purchases = ['aim', 'volley']; }); await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 0'); await expect(page.getByTestId('player-one-purchases')).toHaveText('Player 1: Silver, Footwork'); await expect(page.getByTestId('player-two-purchases')).toHaveText('Player 2: Aim, Volley'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('title', 'Player 1'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('title', 'Player 2');
  await page.getByRole('button', { name: 'View all cards' }).click(); const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-card-name="Footwork"]')).toContainText('You may move 1 space left or right. Draw 1 card.'); await expect(dialog.locator('[data-card-name="Cull"]')).toContainText('Trash 1 or 2 cards. Choose Cull itself, cards remaining in your hand, or both.'); await expect(dialog.locator('[data-card-name="Feint"]')).toContainText('At Close range, the next Close-range attack this turn deals 2 additional damage.'); await expect(dialog.locator('[data-card-name="Drive"]')).toContainText('Then move both fighters 1 space left or right so they remain Close.');
  await expect(dialog.locator('[data-card-name="Gold"]')).toHaveClass(/card--treasure/); await expect(dialog.locator('[data-card-name="Footwork"]')).toHaveClass(/card--engine/); await expect(dialog.locator('[data-card-name="Volley"]')).toHaveClass(/card--ranged/); await expect(dialog.locator('[data-card-name="Focus"]')).toHaveClass(/card--mana/); await expect(dialog.locator('[data-card-name="Drive"]')).toHaveClass(/card--melee/);
});

test('DD-E2E-036: unspent normal money expires before the same local player returns', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, []); record.state.phase = 'buy'; record.state.players.ochre.money = 7; record.state.players.ochre.firstBuyPending = false; record.state.players.indigo.firstBuyPending = false; });
  await expect(page.getByTestId('zone-money')).toContainText('7'); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 2 · Player 2 action/)).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible(); await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByTestId('zone-money')).toContainText('0');
});

test('DD-E2E-037: three bought Gold stay Gold in the deck summary and later hand', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, []); expect(Object.values(record.state.players).flatMap((player) => [...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play]).map((card) => card.definitionId)).not.toContain('gold'); record.state.phase = 'buy'; record.state.players.ochre.money = 18; record.state.players.ochre.firstBuyMoney = 0; record.state.players.ochre.firstBuyPending = false; record.state.players.indigo.firstBuyPending = false; });
  await expect(page.locator('[data-card-name="Gold"]')).toHaveCount(0); await expect(page.getByTestId('deck-summary').locator('[data-deck-card="Gold"]')).toHaveCount(0); await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 18');
  for (let count = 0; count < 3; count += 1) await page.locator('[data-market-card="Gold"]').click();
  await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 0'); await expect(page.getByTestId('deck-summary').locator('[data-deck-card="Gold"]')).toHaveText('Gold ×3'); await expect(page.locator('.zones div').filter({ hasText: 'Discard' }).locator('strong')).toHaveText('3'); await page.getByRole('button', { name: 'End Buy phase' }).click();
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
  await page.locator('[data-testid="hand-grid"] [data-card-name="Cull"]').click(); await copper.click(); await copper.click(); await expect(copper).toContainText('Selected ×2'); await expect(page.getByText('2 selected (maximum 2).')).toBeVisible();
  await page.getByRole('button', { name: 'Trash selected cards' }).click(); await expect(copper).toHaveCount(0); await expect(page.locator('[data-testid="played-row"] [data-played-card-name="Cull"]')).toHaveCount(1);
});

test('DD-E2E-040: large unique hands overlap, lift on hover, and keep drawers collapsed', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await openGame(page, (record) => { seedHand(record, ['copper', 'silver', 'gold', 'step', 'cull', 'focus', 'footwork', 'muster', 'feint', 'drive', 'flurry', 'aim', 'volley', 'stipend', 'reclaim', 'adapt']); });
  const before = await page.evaluate(() => { const cards = Array.from(document.querySelectorAll<HTMLElement>('.hand-card-slot')); const first = cards[0]!.getBoundingClientRect(); const second = cards[1]!.getBoundingClientRect(); return { count: cards.length, sameRow: cards.every((card) => Math.abs(card.getBoundingClientRect().top - first.top) < 1), delta: second.left - first.left, width: document.querySelector<HTMLElement>('.full-card')!.getBoundingClientRect().width, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
  expect(before).toMatchObject({ count: 16, sameRow: true, overflow: 0 }); expect(before.delta).toBeLessThan(before.width); expect(before.delta).toBeGreaterThan(0);
  const footwork = page.locator('[data-testid="hand-grid"] [data-card-name="Footwork"]'); const resting = await footwork.evaluate((card) => getComputedStyle(card).transform); await footwork.hover(); const lifted = await footwork.evaluate((card) => getComputedStyle(card).transform); expect(lifted).not.toBe(resting); await page.mouse.move(0, 0); await footwork.focus(); const focused = await footwork.evaluate((card) => ({ transform: getComputedStyle(card).transform, zIndex: getComputedStyle(card.parentElement!).zIndex })); expect(focused.transform).not.toBe(resting); expect(Number(focused.zIndex)).toBe(250);
  const toggle = page.getByRole('button', { name: /Deck ·/ }); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(page.getByRole('complementary', { name: 'Deck and match details' })).toHaveClass(/side-drawer--open/); await expect(page.getByTestId('deck-summary')).toContainText('Footwork ×1');
});

test('DD-E2E-043: a projected pending choice renders and clears after selection', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    const kingdom = kingdomOf('three-way-engine'); record.kingdom = kingdom; record.state.kingdomId = kingdom.id;
    record.state.startingHealth = kingdom.startingHealth; record.state.supply = kingdomSupply(kingdom);
    seedHand(record, ['prism', 'copper'], ['silver']);
  });
  await page.locator('[data-card-name="Prism"]').click();
  await expect(page.getByText('Choose a card to discard')).toBeVisible();
  const discard = page.getByRole('button', { name: 'Discard Copper', exact: true });
  await expect(discard).toBeVisible(); await discard.click();
  await expect(page.getByText('Choose a card to discard')).toHaveCount(0);
  await expect(page.locator('[data-card-name="Silver"]')).toBeVisible();
});

test('DD-E2E-042: AI-first games train, hide automatic turns, and undo to a human state', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByText('Play against AI', { exact: true }).click(); await expect(page.getByText('AI goes first', { exact: true })).toBeVisible(); await page.getByText('AI goes first', { exact: true }).click();
  await page.route('**/api/games', async (route) => { await new Promise((resolve) => setTimeout(resolve, 100)); await route.continue(); }); await page.getByRole('button', { name: 'Start game' }).click(); await expect(page.getByText('Training opponent…')).toBeVisible();
  await expect(page.getByText('Player 2 starting build')).toBeVisible(); await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByText(/Turn 2 · Player 2 action/)).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 4 · Player 2 action/)).toBeVisible(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 2 · Player 2 buy/)).toBeVisible();
});
