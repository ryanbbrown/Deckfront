import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { FileGameRepository } from '../../src/server/persistence';
import { test, expect, seedHand } from './fixture';

async function playCard(page: import('@playwright/test').Page, name: string) { await page.locator(`[data-card-name="${name}"]`).first().click(); }

test('DD-E2E-001: setup saves a private flexible build, free Copper, prompt, and first-player choice', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await expect(page.getByRole('heading', { name: 'Hexdeck' })).toBeVisible();
  await page.getByLabel('AI strategy').selectOption('close-pressure'); await page.getByLabel('Strategy instructions').fill('# Edited close prompt');
  await page.getByRole('group', { name: 'First player' }).getByText('AI', { exact: true }).click(); await page.getByRole('button', { name: 'Start game' }).click(); await expect(page.getByRole('heading', { name: 'Spend up to 12' })).toBeVisible();
  await page.getByLabel('Add Copper').click(); await page.getByLabel('Add Copper').click(); await page.getByLabel('Add Aim').click(); await expect(page.getByTestId('build-budget')).toHaveText('3 spent · 9 carries');
  await page.reload(); await expect(page.getByLabel('Copper quantity')).toHaveText('2'); await expect(page.getByLabel('Aim quantity')).toHaveText('1');
  await page.getByLabel('Add Gold').click(); await page.getByLabel('Add Gold').click(); await expect(page.getByRole('button', { name: 'Finish starting build' })).toBeDisabled();
  await page.getByLabel('Remove Gold').click(); await page.getByRole('button', { name: 'Finish starting build' }).click();
  await expect(page.getByText('Starting builds')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Copper, Copper, Aim, Gold/)).toBeVisible(); await expect(page.getByText(/Turn 2 · your action/)).toBeVisible();
});

test('DD-E2E-035: two local players draft in sequence and take complete turns on one browser', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByText('Local player', { exact: true }).click(); await page.getByRole('group', { name: 'First player' }).getByText('Player 2', { exact: true }).click(); await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByText('Player 1 starting build')).toBeVisible(); await page.getByLabel('Add Footwork').click(); await page.getByRole('button', { name: 'Finish starting build' }).click();
  await expect(page.getByText('Player 2 starting build')).toBeVisible(); await page.getByLabel('Add Aim').click(); await page.getByRole('button', { name: 'Finish starting build' }).click();
  await expect(page.getByText(/Turn 1 · Player 2 action/)).toBeVisible(); await expect(page.getByRole('heading', { name: 'Player 2 hand' })).toBeVisible(); await expect(page.getByText('AI is building…')).toHaveCount(0); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('title', 'Player 1'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('title', 'Player 2');
  await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByText(/Turn 1 · Player 2 buy/)).toBeVisible(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 1 · Player 2 action/)).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 2 · Player 1 action/)).toBeVisible(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 1 · Player 2 buy/)).toBeVisible();
  await page.getByRole('button', { name: 'End Buy phase' }).click(); await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 3 · Player 2 action/)).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 4 · Player 1 action/)).toBeVisible(); await expect(page.getByRole('heading', { name: 'Player 1 hand' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
});

test('DD-E2E-002: repeated Copper Silver and Gold buys stay available and show public purchase names', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, Array<string>(10).fill('gold')); record.state.players.ochre.firstBuyMoney = 0; });
  await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByTestId('zone-money')).toContainText('30');
  await page.locator('[data-market-card="Copper"]').click(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByTestId('human-purchases')).toContainText('None');
  for (const name of ['Copper', 'Copper', 'Silver', 'Silver', 'Gold', 'Gold']) { await page.locator(`[data-market-card="${name}"]`).click(); }
  await expect(page.getByTestId('zone-money')).toContainText('12'); await expect(page.getByTestId('human-purchases')).toContainText('Copper, Copper, Silver, Silver, Gold, Gold'); await expect(page.locator('[data-market-card="Copper"]')).toBeEnabled(); await expect(page.locator('[data-market-card="Silver"]')).toBeEnabled(); await expect(page.locator('[data-market-card="Gold"]')).toBeEnabled();
});

test('DD-E2E-003: Footwork offers Stay, draws without moving, then can move into a shared space', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork'], ['aim']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await page.locator('[data-card-name="Footwork"]').click(); await expect(page.getByRole('button', { name: 'Play Footwork: Left' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Play Footwork: Stay' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Play Footwork: Right' })).toBeVisible();
  await page.getByRole('button', { name: 'Play Footwork: Stay' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '2'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3'); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await expect(page.getByText('Stayed on space 2')).toBeVisible();
  await page.getByRole('button', { name: 'Undo last action' }).click(); await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '3'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3'); await expect(page.getByTestId('range')).toHaveText('Close range');
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
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('16 HP'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '4'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.getByTestId('range')).toHaveText('Close range'); await expect(page.getByText('Moved both fighters right to space 4')).toBeVisible();
  await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('20 HP'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('Next Close-range attack this turn: +2 damage'); await page.locator('[data-card-name="Drive"]').click(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('16 HP');
});

test('DD-E2E-007: six visible Muster plays make Far Flurry hit its five-damage cap', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'muster', 'muster', 'muster', 'muster', 'muster', 'flurry']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 5; });
  for (let count = 0; count < 6; count += 1) { await page.locator('[data-card-name="Muster"]').first().click(); }
  await playCard(page, 'Flurry'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('15 HP'); await expect(page.getByTestId('range')).toHaveText('Far range');
});

test('DD-E2E-008: consecutive Footwork cards can move onto and past the opponent', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'footwork']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await expect(page.getByTestId('range')).toHaveText('Close range');
  await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3'); await expect(page.getByTestId('range')).toHaveText('Near range');
});

test('DD-E2E-009: Far Aim applies Aimed and Volley deals seven', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 5; });
  await playCard(page, 'Aim'); await expect(page.locator('[data-player-score="ochre"]')).toContainText('Aimed');
  await playCard(page, 'Volley'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('13 HP'); await expect(page.locator('[data-player-score="ochre"]')).not.toContainText('Aimed');
});

test('DD-E2E-010: close combination resolves Footwork Feint Drive Flurry for exact open-space damage', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'feint', 'drive', 'flurry']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 2; });
  await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); await playCard(page, 'Feint'); await page.locator('[data-card-name="Drive"]').click(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click(); await playCard(page, 'Flurry');
  await expect(page.locator('[data-player-score="indigo"]')).toContainText('13 HP'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '3'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '3');
});

test('DD-E2E-011: ranged escape uses two Footwork cards then Aim and Volley for seven at Far', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'footwork', 'aim', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 2; });
  for (let count = 0; count < 2; count += 1) { await page.locator('[data-card-name="Footwork"]').first().click(); await page.getByRole('button', { name: 'Play Footwork: Right' }).click(); }
  await playCard(page, 'Aim'); await playCard(page, 'Volley');
  await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.getByTestId('range')).toHaveText('Far range'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('13 HP');
});

test('DD-E2E-012: winning Volley can be undone and a repeated win persists across refresh', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['volley', 'copper']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 5; record.state.fighters.indigo.health = 5; });
  await page.locator('[data-card-name="Volley"]').click(); await expect(page.getByText('You win')).toBeVisible(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 1 · your action/)).toBeVisible(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('5 HP');
  await page.locator('[data-card-name="Volley"]').click(); await expect(page.getByText('You win')).toBeVisible(); await page.reload(); await expect(page.getByText('You win')).toBeVisible(); await page.getByRole('button', { name: 'New game' }).click(); await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
});

test('DD-E2E-013: wall-blocked direction is absent and Close blocks Aim and Volley', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'aim', 'volley']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 1; });
  await page.locator('[data-card-name="Footwork"]').click(); await expect(page.getByRole('button', { name: 'Play Footwork: Left' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Play Footwork: Stay' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Play Footwork: Right' })).toBeVisible(); await expect(page.locator('[data-card-name="Aim"]')).toContainText('Requires Near or Far range.'); await expect(page.locator('[data-card-name="Volley"]')).toContainText('Requires Near or Far range.');
});

test('DD-E2E-014: chosen Drive direction into a wall deals exact six damage and moves neither fighter', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 5; record.state.fighters.indigo.position = 5; });
  await playCard(page, 'Feint'); await page.locator('[data-card-name="Drive"]').click(); await page.getByRole('button', { name: 'Play Drive: Move Both Right' }).click(); await expect(page.locator('[data-player-score="indigo"]')).toContainText('14 HP'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '5'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '5');
});

test('DD-E2E-015: two unprepared Near Volleys deal four and Aim plus Near Volley deals five', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['volley', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await page.locator('[data-card-name="Volley"]').first().click(); await playCard(page, 'Volley'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('16 HP');
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; }); await playCard(page, 'Aim'); await playCard(page, 'Volley'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('15 HP');
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

test('DD-E2E-019: two visible Muster plays make Near Flurry deal two', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'muster', 'flurry']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  for (let count = 0; count < 2; count += 1) { await page.locator('[data-card-name="Muster"]').first().click(); } await playCard(page, 'Flurry'); await expect(page.locator('[data-player-score="indigo"]')).toContainText('18 HP'); await expect(page.getByTestId('range')).toHaveText('Near range');
});

test('DD-E2E-020: Cull can select and trash itself when it is the only card', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull']); });
  await expect(page.locator('[data-card-name="Cull"]')).toBeEnabled(); await page.locator('[data-card-name="Cull"]').click(); await expect(page.getByText('Select 1 or 2 cards: Cull itself, cards remaining in your hand, or both.')).toBeVisible(); await page.locator('[data-card-name="Cull"]').click(); await expect(page.getByText('1 selected (maximum 2).')).toBeVisible(); await page.getByRole('button', { name: 'Trash selected card' }).click(); await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0); await expect(page.getByTestId('zone-trash')).toContainText('8');
});

test('DD-E2E-021: starting-build carry appears in only the first local Buy phase', async ({ page, openGame }) => {
  await openGame(page, (record) => { record.opponentMode = 'local'; seedHand(record, []); record.state.players.ochre.firstBuyMoney = 12; record.state.players.ochre.firstBuyPending = true; record.state.players.indigo.firstBuyMoney = 0; record.state.players.indigo.firstBuyPending = false; });
  await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 12');
  await page.getByRole('button', { name: 'End Buy phase' }).click(); await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 0');
});

test('DD-E2E-022: normal browser setup completes one human and one fake AI turn', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByRole('button', { name: 'Start game' }).click(); await page.getByLabel('Add Footwork').click(); await page.getByRole('button', { name: 'Finish starting build' }).click();
  await expect(page.getByText(/Turn 1 · your action/)).toBeVisible({ timeout: 15_000 }); await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click();
  await expect(page.getByText(/Turn 3 · your action/)).toBeVisible({ timeout: 15_000 }); await expect(page.getByText('AI:', { exact: true })).toBeVisible();
});

test('DD-E2E-023: Cull can trash one remaining hand card and it stays absent after cleanup', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull', 'copper']); }); await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Copper"]').click(); await expect(page.getByText('1 selected (maximum 2).')).toBeVisible(); await page.getByRole('button', { name: 'Trash selected card' }).click();
  await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0); await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click();
  await expect(page.locator('[data-card-name="Copper"]')).toHaveCount(0);
});

test('DD-E2E-024: rendered HTML never contains private opponent card sentinels', async ({ page, openGame }) => {
  await openGame(page, (record) => { record.state.players.indigo.deck.hand[0]!.id = 'OPPONENT-HAND-SENTINEL'; record.state.players.indigo.deck.draw[0]!.id = 'OPPONENT-DRAW-SENTINEL'; });
  const html = await page.content(); expect(html).not.toContain('OPPONENT-HAND-SENTINEL'); expect(html).not.toContain('OPPONENT-DRAW-SENTINEL');
});

test('DD-E2E-025: prompt can be cleared and rapid build changes serialize without a conflict', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); const prompt = page.getByLabel('Strategy instructions'); await expect(prompt).not.toHaveValue(''); await prompt.fill(''); await expect(prompt).toHaveValue(''); await expect(page.getByRole('button', { name: 'Start game' })).toBeDisabled(); await prompt.fill('# race-safe edited prompt'); await page.getByRole('button', { name: 'Start game' }).click();
  await page.route('**/build', async (route) => { await new Promise((resolve) => setTimeout(resolve, 80)); await route.continue(); }); const add = page.getByLabel('Add Copper'); await add.click(); await expect(page.getByText(/Saving/)).toBeVisible(); await expect(page.getByLabel('Add Aim')).toBeDisabled(); await expect(page.getByLabel('Copper quantity')).toHaveText('1'); await add.click(); await expect(page.getByLabel('Copper quantity')).toHaveText('2'); await expect(page.getByRole('alert')).toHaveCount(0);
});

test('DD-E2E-026: zero-paid build hides the AI build until completion and locks all build edits afterward', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByRole('button', { name: 'Start game' }).click(); await expect(page.getByText('Starting builds', { exact: true })).toHaveCount(0); await expect(page.getByText(/AI:/)).toHaveCount(0); await expect(page.getByTestId('build-budget')).toHaveText('0 spent · 12 carries');
  await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByLabel('Add Copper')).toHaveCount(0); await expect(page.getByText('Starting builds')).toBeVisible({ timeout: 15_000 }); await expect(page.getByText('You: No cards')).toBeVisible();
});

test('DD-E2E-027: edited strategy and model-written summary reach allowlisted trace and UI', async ({ page, baseUrl, traceDirectory }) => {
  await page.goto(baseUrl); await page.getByLabel('Strategy instructions').fill('# browser trace strategy sentinel'); await page.getByRole('button', { name: 'Start game' }).click(); await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByText('AI:', { exact: true })).toBeVisible({ timeout: 15_000 }); await expect(page.getByText('Built the requested strategy package.')).toBeVisible();
  const id = await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId')); const files = await readdir(path.join(traceDirectory, id!)); const trace = await readFile(path.join(traceDirectory, id!, files.sort()[0]!), 'utf8'); expect(trace).toContain('# browser trace strategy sentinel'); expect(trace).toContain('Built the requested strategy package.'); expect(trace).not.toContain('drawContentsUnordered');
});

test('DD-E2E-028: immediate Action, global Undo, and Buy phase restore after refresh', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'copper'], ['aim', 'volley']); record.state.players.ochre.firstBuyMoney = 0; }); await playCard(page, 'Muster'); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await page.reload(); await expect(page.getByRole('button', { name: 'Undo last action' })).toBeEnabled(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.locator('[data-card-name="Muster"]')).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.reload(); await expect(page.getByText(/Turn 1 · your buy/)).toBeVisible();
});

test('DD-E2E-029: AI error survives refresh and retry completes without duplicate setup commands', async ({ page, failingAiBaseUrl, failingAiDataDirectory }) => {
  await page.goto(failingAiBaseUrl); await page.getByRole('button', { name: 'Start game' }).click(); await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByText(/Synthetic one-time AI process failure/)).toBeVisible({ timeout: 15_000 }); await page.reload(); await expect(page.getByText(/Synthetic one-time AI process failure/)).toBeVisible(); await page.getByRole('button', { name: 'Retry AI' }).click(); await expect(page.getByText('Starting builds')).toBeVisible({ timeout: 15_000 });
  const id = await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId')); const record = await new FileGameRepository(failingAiDataDirectory).load(id!); expect(record.committedCommands.filter((command) => command.type === 'submitStartingBuild')).toHaveLength(2);
});

test('DD-E2E-030: server finishes AI turn after page closes and reopened page shows persisted result', async ({ page, context, baseUrl }) => {
  await page.goto(baseUrl); await page.getByRole('group', { name: 'First player' }).getByText('AI', { exact: true }).click(); await page.getByRole('button', { name: 'Start game' }).click(); await page.getByRole('button', { name: 'Finish starting build' }).click(); const id = await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId')); if (!id) throw new Error('Missing game id.'); await expect(page.getByText(/AI is building|AI action/)).toBeVisible(); await page.close();
  let complete = false; for (let count = 0; count < 100 && !complete; count += 1) { const status = await fetch(`${baseUrl}/api/games/${id}/ai-turn`).then((response) => response.json()) as { status: string }; complete = status.status === 'complete'; if (!complete) await new Promise((resolve) => setTimeout(resolve, 20)); } expect(complete).toBe(true);
  const reopened = await context.newPage(); await reopened.goto(baseUrl); await reopened.evaluate((gameId) => localStorage.setItem('hexdeck.activeGameId', gameId), id); await reopened.reload(); await expect(reopened.getByText(/Turn 2 · your action/)).toBeVisible();
});

test('DD-E2E-031: visible market accepts the 10th Footwork and disables the unavailable 11th', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, []); record.state.phase = 'buy'; record.state.players.ochre.money = 2; record.state.players.ochre.firstBuyPending = false; record.state.supply.footwork = 1; record.state.players.ochre.purchases = Array<string>(9).fill('footwork'); }); const footwork = page.locator('[data-market-card="Footwork"]'); await expect(footwork).toContainText('1 left'); await footwork.click(); await expect(footwork).toContainText('0 left'); await expect(footwork).toBeDisabled(); await expect(page.getByTestId('human-purchases')).toContainText('Footwork, Footwork');
});

test('DD-E2E-032: Buy completion redraw reveals cards immediately and can be undone', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.phase = 'buy'; record.state.players.ochre.money = 0; }); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await expect(page.locator('[data-card-name="Volley"]')).toBeVisible(); await page.getByRole('button', { name: 'Undo last action' }).click(); await expect(page.getByText(/Turn 1 · your buy/)).toBeVisible();
});

test('DD-E2E-034: public labels and card rules use explicit player-facing text', async ({ page, openGame }) => {
  await openGame(page, (record) => { record.state.players.ochre.purchases = ['silver', 'footwork']; record.state.players.indigo.purchases = ['aim', 'volley']; }); await expect(page.getByTestId('zone-money')).toHaveText('Money: 0'); await expect(page.getByTestId('human-purchases')).toHaveText('You: Silver, Footwork'); await expect(page.getByTestId('ai-purchases')).toHaveText('AI: Aim, Volley'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('title', 'You'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('title', 'AI');
  await expect(page.locator('[data-market-card="Footwork"]')).toContainText('You may move 1 space left or right. Draw 1 card.'); await expect(page.locator('[data-market-card="Cull"]')).toContainText('Trash 1 or 2 cards. Choose Cull itself, cards remaining in your hand, or both.'); await expect(page.locator('[data-market-card="Feint"]')).toContainText('At Close range, the next Close-range attack this turn deals 2 additional damage.'); await expect(page.locator('[data-market-card="Feint"]')).not.toContainText('Exposed'); await expect(page.locator('[data-market-card="Drive"]')).toContainText('Then move both fighters 1 space left or right so they remain Close.');
});

test('DD-E2E-036: unspent normal money expires before the same local player returns', async ({ page, openGame }) => {
  await openGame(page, (record) => { record.opponentMode = 'local'; seedHand(record, []); record.state.phase = 'buy'; record.state.players.ochre.money = 7; record.state.players.ochre.firstBuyPending = false; record.state.players.indigo.firstBuyPending = false; });
  await expect(page.getByTestId('zone-money')).toContainText('7'); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 2 · Player 2 action/)).toBeVisible();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible(); await page.getByRole('button', { name: 'End Action phase' }).click(); await expect(page.getByTestId('zone-money')).toContainText('0');
});

test('DD-E2E-037: three bought Gold stay Gold in the deck summary and later hand', async ({ page, openGame }) => {
  await openGame(page, (record) => { record.opponentMode = 'local'; seedHand(record, []); expect(Object.values(record.state.players).flatMap((player) => [...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play]).map((card) => card.definitionId)).not.toContain('gold'); record.state.phase = 'buy'; record.state.players.ochre.money = 18; record.state.players.ochre.firstBuyMoney = 0; record.state.players.ochre.firstBuyPending = false; record.state.players.indigo.firstBuyPending = false; });
  await expect(page.locator('[data-card-name="Gold"]')).toHaveCount(0); await expect(page.getByTestId('deck-summary').locator('[data-deck-card="Gold"]')).toHaveCount(0); await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 18');
  for (let count = 0; count < 3; count += 1) await page.locator('[data-market-card="Gold"]').click();
  await expect(page.getByTestId('zone-money')).toHaveText('Player 1 money: 0'); await expect(page.getByTestId('deck-summary').locator('[data-deck-card="Gold"]')).toHaveText('Gold ×3'); await expect(page.locator('.zones div').filter({ hasText: 'Discard' }).locator('strong')).toHaveText('3'); await page.getByRole('button', { name: 'End Buy phase' }).click();
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/Turn 3 · Player 1 action/)).toBeVisible(); await expect(page.locator('[data-card-name="Gold"]')).toHaveCount(3); await expect(page.locator('[data-card-name="Gold"]').first()).toContainText('+3 money');
});

test('DD-E2E-038: a 15-card hand wraps without horizontal overflow at laptop sizes', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, Array<string>(15).fill('muster')); record.state.fighters.ochre.position = 3; record.state.fighters.indigo.position = 3; });
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size); await expect(page.locator('[data-card-name="Muster"]')).toHaveCount(15);
    const layout = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth; const hand = document.querySelector('[data-testid="hand-grid"]')!.getBoundingClientRect(); const market = document.querySelector('.market-panel')!.getBoundingClientRect();
      const cards = Array.from(document.querySelectorAll('[data-card-name="Muster"]')).map((card) => card.getBoundingClientRect()); const marketCards = Array.from(document.querySelectorAll('[data-market-card]')).map((card) => card.getBoundingClientRect());
      const regions = ['.arena-panel', '.health-score', '.play-bar', '.hand-panel', '.market-panel'].map((selector) => document.querySelector(selector)!.getBoundingClientRect());
      return { overflow: document.documentElement.scrollWidth - viewportWidth, rootClips: getComputedStyle(document.documentElement).overflowX === 'hidden', regionsInside: regions.every((region) => region.left >= 0 && region.right <= viewportWidth + 1), handInside: cards.every((card) => card.left >= hand.left && card.right <= hand.right + 1), marketInside: marketCards.every((card) => card.left >= market.left && card.right <= market.right + 1) };
    });
    expect(layout).toEqual({ overflow: 0, rootClips: false, regionsInside: true, handInside: true, marketInside: true });
  }
  await expect(page.locator('[data-player-id="ochre"]')).toBeVisible(); await expect(page.locator('[data-player-id="indigo"]')).toBeVisible(); await page.locator('[data-card-name="Muster"]').last().click(); await expect(page.locator('[data-card-name="Muster"]')).toHaveCount(14);
});

test('DD-E2E-033: normal setup reaches a deterministic human victory within the runtime limit', async ({ page, baseUrl, repository }) => {
  test.setTimeout(60_000);
  await page.route('**/api/games', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const request = route.request(); const body = request.postDataJSON() as Record<string, unknown>;
    const response = await route.fetch({ postData: JSON.stringify({ ...body, seed: 25 }) }); await route.fulfill({ response });
  });
  await page.goto(baseUrl); await page.getByLabel('AI strategy').selectOption('close-pressure'); await page.getByRole('button', { name: 'Start game' }).click(); await expect(page.getByRole('heading', { name: 'Spend up to 12' })).toBeVisible(); const seededId = await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId')); expect((await repository.load(seededId!)).state.seed).toBe(25); for (const card of ['Footwork', 'Footwork', 'Aim', 'Volley']) await page.getByLabel(`Add ${card}`).click(); await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByText(/Turn 1 · your action/)).toBeVisible({ timeout: 15_000 });
  let won = false;
  for (let humanTurn = 0; humanTurn < 20 && !won; humanTurn += 1) {
    for (let actionCount = 0; actionCount < 20 && !won; actionCount += 1) {
      let played = false;
      for (const name of ['Aim', 'Volley', 'Footwork', 'Flurry', 'Feint', 'Drive', 'Muster']) {
        const card = page.locator(`[data-card-name="${name}"]:not([disabled])`).first(); if (await card.count() === 0) continue; const instanceId = await card.getAttribute('data-card-instance-id'); await card.click();
        if (name === 'Footwork') { const left = page.getByRole('button', { name: 'Play Footwork: Left' }); const right = page.getByRole('button', { name: 'Play Footwork: Right' }); if (await left.isVisible()) await left.click(); else if (await right.isVisible()) await right.click(); else continue; }
        if (name === 'Drive') { const right = page.getByRole('button', { name: 'Play Drive: Move Both Right' }); const left = page.getByRole('button', { name: 'Play Drive: Move Both Left' }); if (await right.isVisible()) await right.click(); else if (await left.isVisible()) await left.click(); else continue; }
        if (instanceId) await expect(page.locator(`[data-card-instance-id="${instanceId}"]`)).toHaveCount(0);
        if (await page.getByText('You win').count()) { won = true; break; } played = true; break;
      }
      if (!played) break;
    }
    if (won) break;
    await page.getByRole('button', { name: 'End Action phase' }).click();
    for (const name of ['Volley', 'Aim', 'Footwork']) { const market = page.locator(`[data-market-card="${name}"]:not([disabled])`); if (await market.count()) { await market.click(); } }
    await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByText(/your action|AI wins|You win/)).toBeVisible({ timeout: 15_000 }); if (await page.getByText('AI wins').count()) throw new Error('Deterministic fake AI won before the scripted human strategy.');
  }
  expect(won).toBe(true); const id = await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId')); const saved = await fetch(`${baseUrl}/api/games/${id}`).then((response) => response.json()) as { phase: string; winner: string }; expect(saved).toMatchObject({ phase: 'ended', winner: 'ochre' }); await page.reload(); await expect(page.getByText('You win')).toBeVisible(); await page.getByRole('button', { name: 'New game' }).click(); await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
});
