import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { FileGameRepository } from '../../src/server/persistence';
import { test, expect, seedHand } from './fixture';

async function previewCard(page: import('@playwright/test').Page, name: string) { await page.locator(`[data-card-name="${name}"]`).click(); await expect(page.getByText(/action preview/)).toBeVisible(); }
async function confirm(page: import('@playwright/test').Page) { await page.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(page.getByText(/your action|your buy/)).toBeVisible(); }

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
  await expect(page.getByText(/Turn 1 · Player 2 action/)).toBeVisible(); await expect(page.getByRole('heading', { name: 'Player 2 hand' })).toBeVisible(); await expect(page.getByText('AI is building…')).toHaveCount(0);
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(page.getByText(/Turn 1 · Player 2 buy/)).toBeVisible();
  await page.getByRole('button', { name: 'End Buy phase' }).click(); await page.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(page.getByText(/Turn 2 · Player 1 action/)).toBeVisible(); await expect(page.getByRole('heading', { name: 'Player 1 hand' })).toBeVisible();
});

test('DD-E2E-002: repeated Copper Silver and Gold buys stay available and show public purchase names', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, Array<string>(10).fill('gold')); record.state.players.ochre.firstBuyMoney = 0; });
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'Confirm' }).click(); await expect(page.getByTestId('zone-money')).toContainText('30');
  for (const name of ['Copper', 'Copper', 'Silver', 'Silver', 'Gold', 'Gold']) { await page.locator(`[data-market-card="${name}"]`).click(); await confirm(page); }
  await expect(page.getByTestId('zone-money')).toContainText('12'); await expect(page.getByTestId('human-purchases')).toContainText('Copper, Copper, Silver, Silver, Gold, Gold'); await expect(page.locator('[data-market-card="Copper"]')).toBeEnabled(); await expect(page.locator('[data-market-card="Silver"]')).toBeEnabled(); await expect(page.locator('[data-market-card="Gold"]')).toBeEnabled();
});

test('DD-E2E-003: Footwork exposes both movement selections then advances and draws', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork'], ['aim']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 4; });
  await page.locator('[data-card-name="Footwork"]').click(); await expect(page.getByRole('button', { name: 'Play Footwork: Advance' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Play Footwork: Withdraw' })).toBeVisible();
  await page.getByRole('button', { name: 'Play Footwork: Advance' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '3'); await expect(page.getByTestId('hidden-preview-draw')).toBeVisible();
  await confirm(page); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible();
});

test('DD-E2E-004: Cull selects itself plus one hand card and trashes both', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull', 'copper', 'silver']); });
  await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Copper"]').click(); await expect(page.getByText('2/2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Preview Cull' }).click(); await expect(page.getByText(/action preview/)).toBeVisible(); await expect(page.getByTestId('zone-trash')).toContainText('9'); await confirm(page);
  await expect(page.locator('[data-card-name="Silver"]')).toBeVisible(); await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0);
});

test('DD-E2E-005: Muster draws two across a reshuffle and hides preview identities', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster']); record.state.players.ochre.deck.discard.push(...['aim', 'volley'].map((id) => ({ id: `extra-${id}`, definitionId: id }))); record.state.nextCardSerial += 2; });
  await previewCard(page, 'Muster'); await expect(page.getByTestId('hidden-card')).toHaveCount(2); const previewHtml = await page.content(); expect(previewHtml).not.toContain('extra-aim'); expect(previewHtml).not.toContain('extra-volley'); expect(page.locator('[data-card-name="Aim"]')).toHaveCount(0); await page.getByRole('button', { name: 'Undo' }).click(); await expect(page.locator('[data-card-name="Muster"]')).toBeVisible();
  await previewCard(page, 'Muster'); await confirm(page); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await expect(page.locator('[data-card-name="Volley"]')).toBeVisible();
});

test('DD-E2E-006: Close Feint and Drive consume Exposed, deal four, push, and follow', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await previewCard(page, 'Feint'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('Exposed'); await confirm(page);
  await previewCard(page, 'Drive'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('16 HP'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '4'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '3'); await confirm(page);
});

test('DD-E2E-007: six visible Muster plays make Far Flurry hit its five-damage cap', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'muster', 'muster', 'muster', 'muster', 'muster', 'flurry']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 5; });
  for (let count = 0; count < 6; count += 1) { await page.locator('[data-card-name="Muster"]').first().click(); await confirm(page); }
  await previewCard(page, 'Flurry'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('15 HP'); await expect(page.getByTestId('range')).toHaveText('Far range');
});

test('DD-E2E-008: legal Vault crosses the opponent and draws Footwork', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['vault'], ['footwork']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await previewCard(page, 'Vault'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.getByTestId('hidden-preview-draw')).toBeVisible(); await confirm(page); await expect(page.locator('[data-card-name="Footwork"]')).toBeVisible();
});

test('DD-E2E-009: Far Aim applies Aimed and Volley deals seven', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 5; });
  await previewCard(page, 'Aim'); await expect(page.locator('[data-player-id="ochre"]')).toContainText('Aimed'); await confirm(page);
  await previewCard(page, 'Volley'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('13 HP'); await expect(page.locator('[data-player-id="ochre"]')).not.toContainText('Aimed');
});

test('DD-E2E-010: close combination resolves Footwork Feint Drive Flurry for exact open-space damage', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'feint', 'drive', 'flurry']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 3; });
  await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Advance' }).click(); await confirm(page); await previewCard(page, 'Feint'); await confirm(page); await previewCard(page, 'Drive'); await confirm(page); await previewCard(page, 'Flurry');
  await expect(page.locator('[data-player-id="indigo"]')).toContainText('13 HP'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '3'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '4');
});

test('DD-E2E-011: ranged escape combination reverses sides, withdraws, aims, and volleys for 5 at Mid', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['vault', 'footwork', 'aim', 'volley']); record.state.fighters.ochre.position = 4; record.state.fighters.indigo.position = 3; });
  await previewCard(page, 'Vault'); await confirm(page); await page.locator('[data-card-name="Footwork"]').click(); await page.getByRole('button', { name: 'Play Footwork: Withdraw' }).click(); await confirm(page); await previewCard(page, 'Aim'); await confirm(page); await previewCard(page, 'Volley');
  await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '1'); await expect(page.getByTestId('range')).toHaveText('Mid range'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('15 HP');
});

test('DD-E2E-012: confirmed winning Volley persists ended state across refresh and New game clears it', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['volley', 'copper']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 5; record.state.fighters.indigo.health = 5; });
  await page.locator('[data-card-name="Volley"]').click(); await expect(page.getByText('You win')).toBeVisible(); await page.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(page.getByText('You win')).toBeVisible(); await page.reload(); await expect(page.getByText('You win')).toBeVisible(); await page.getByRole('button', { name: 'New game' }).click(); await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
});

test('DD-E2E-013: wall-blocked Footwork and Close-blocked Aim and Volley show exact reasons', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'aim', 'volley']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 2; });
  await expect(page.locator('[data-card-name="Footwork"]')).toContainText('No legal movement is available.'); await expect(page.locator('[data-card-name="Aim"]')).toContainText('Requires Mid or Far range.'); await expect(page.locator('[data-card-name="Volley"]')).toContainText('Requires Mid or Far range.');
});

test('DD-E2E-014: Feint Drive wall collision deals exact six damage and does not move either fighter', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 4; record.state.fighters.indigo.position = 5; });
  await previewCard(page, 'Feint'); await confirm(page); await previewCard(page, 'Drive'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('14 HP'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '5');
});

test('DD-E2E-015: two unprepared Mid Volleys deal four and Aim plus Mid Volley deals five', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['volley', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 4; });
  await page.locator('[data-card-name="Volley"]').first().click(); await expect(page.getByText(/action preview/)).toBeVisible(); await confirm(page); await previewCard(page, 'Volley'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('16 HP');
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 4; }); await previewCard(page, 'Aim'); await confirm(page); await previewCard(page, 'Volley'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('15 HP');
});

test('DD-E2E-016: Cull trashes two other hand cards and never offers an already played card', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'cull', 'copper', 'silver']); });
  await previewCard(page, 'Muster'); await confirm(page); await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Copper"]').click(); await page.locator('[data-card-name="Silver"]').click();
  await expect(page.locator('[data-card-name="Muster"]')).toHaveCount(0); await page.getByRole('button', { name: 'Preview Cull' }).click(); await confirm(page); await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0); await expect(page.getByTestId('zone-trash')).toContainText('9');
});

test('DD-E2E-017: Vault and close cards show exact blocked landing and range reasons', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['vault', 'feint', 'drive']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 1; });
  await expect(page.locator('[data-card-name="Vault"]')).toBeDisabled(); await expect(page.locator('[data-card-name="Vault"]')).toContainText('There is no empty space beyond the opponent.'); await expect(page.locator('[data-card-name="Feint"]')).toBeEnabled(); await expect(page.locator('[data-card-name="Drive"]')).toBeEnabled();
});

test('DD-E2E-018: Feint and Drive are disabled at Mid with a specific reason', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 4; });
  await expect(page.locator('[data-card-name="Feint"]')).toContainText('Requires Close range.'); await expect(page.locator('[data-card-name="Drive"]')).toContainText('Requires Close range.');
});

test('DD-E2E-019: two visible Muster plays make Mid Flurry deal two', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'muster', 'flurry']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 4; });
  for (let count = 0; count < 2; count += 1) { await page.locator('[data-card-name="Muster"]').first().click(); await confirm(page); } await previewCard(page, 'Flurry'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('18 HP'); await expect(page.getByTestId('range')).toHaveText('Mid range');
});

test('DD-E2E-020: Cull is disabled when no second eligible card exists', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull']); });
  await expect(page.locator('[data-card-name="Cull"]')).toContainText('Cull needs exactly two eligible cards.'); await expect(page.locator('[data-card-name="Cull"]')).toBeDisabled();
});

test('DD-E2E-021: carried starting money funds two Gold purchases before explicit cleanup', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, []); record.state.players.ochre.firstBuyMoney = 12; record.state.players.ochre.firstBuyPending = true; });
  await page.getByRole('button', { name: 'End Action phase' }).click(); await confirm(page); await expect(page.getByTestId('zone-money')).toContainText('12');
  await page.locator('[data-market-card="Gold"]').click(); await confirm(page); await page.locator('[data-market-card="Gold"]').click(); await confirm(page); await expect(page.getByTestId('zone-money')).toContainText('0');
  await page.getByRole('button', { name: 'End Buy phase' }).click(); await page.getByRole('button', { name: 'Confirm' }).click(); await expect(page.getByText(/AI action|AI buy|your action/)).toBeVisible();
});

test('DD-E2E-022: normal browser setup completes one human and one fake AI turn', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByRole('button', { name: 'Start game' }).click(); await page.getByLabel('Add Footwork').click(); await page.getByRole('button', { name: 'Finish starting build' }).click();
  await expect(page.getByText(/Turn 1 · your action/)).toBeVisible({ timeout: 15_000 }); await page.getByRole('button', { name: 'End Action phase' }).click(); await confirm(page); await page.getByRole('button', { name: 'End Buy phase' }).click(); await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/Turn 3 · your action/)).toBeVisible({ timeout: 15_000 }); await expect(page.getByText('AI:', { exact: true })).toBeVisible();
});

test('DD-E2E-023: trashed cards remain absent after cleanup and reshuffle', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull', 'copper', 'silver']); }); await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Copper"]').click(); await page.locator('[data-card-name="Silver"]').click(); await page.getByRole('button', { name: 'Preview Cull' }).click(); await confirm(page);
  await page.getByRole('button', { name: 'End Action phase' }).click(); await confirm(page); await page.getByRole('button', { name: 'End Buy phase' }).click(); await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('[data-card-name="Copper"]')).toHaveCount(0); await expect(page.locator('[data-card-name="Silver"]')).toHaveCount(0);
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

test('DD-E2E-028: Action preview confirmed Action and Buy phase each restore after refresh', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'copper'], ['aim', 'volley']); record.state.players.ochre.firstBuyMoney = 0; }); await previewCard(page, 'Muster'); await page.reload(); await expect(page.getByText(/action preview/)).toBeVisible(); await expect(page.getByTestId('hidden-card')).toHaveCount(2); await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.reload(); await expect(page.getByText(/Turn 1 · your action/)).toBeVisible(); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'Confirm', exact: true }).click(); await page.reload(); await expect(page.getByText(/Turn 1 · your buy/)).toBeVisible();
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
  await openGame(page, (record) => { seedHand(record, []); record.state.phase = 'buy'; record.state.players.ochre.money = 2; record.state.players.ochre.firstBuyPending = false; record.state.supply.footwork = 1; record.state.players.ochre.purchases = Array<string>(9).fill('footwork'); }); const footwork = page.locator('[data-market-card="Footwork"]'); await expect(footwork).toContainText('1 left'); await footwork.click(); await expect(page.getByText(/action preview/)).toBeVisible(); await expect(footwork).toContainText('0 left'); await page.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(footwork).toBeDisabled(); await expect(page.getByTestId('human-purchases')).toContainText('Footwork, Footwork');
});

test('DD-E2E-032: Buy-completion redraw stays opaque in rendered HTML until confirmation', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['aim', 'volley']); record.state.phase = 'buy'; record.state.players.ochre.money = 0; }); await page.getByRole('button', { name: 'End Buy phase' }).click(); await expect(page.getByTestId('hidden-card')).toHaveCount(2); const html = await page.content(); expect(html).not.toContain('card-15'); expect(page.locator('[data-card-name="Aim"]')).toHaveCount(0); expect(page.locator('[data-card-name="Volley"]')).toHaveCount(0); await page.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await expect(page.locator('[data-card-name="Volley"]')).toBeVisible();
});

test('DD-E2E-034: public purchase panel renders both human and AI card names', async ({ page, openGame }) => {
  await openGame(page, (record) => { record.state.players.ochre.purchases = ['silver', 'footwork']; record.state.players.indigo.purchases = ['aim', 'volley']; }); await expect(page.getByTestId('human-purchases')).toHaveText('You: Silver, Footwork'); await expect(page.getByTestId('ai-purchases')).toHaveText('AI: Aim, Volley');
});

test('DD-E2E-033: normal setup reaches a confirmed deterministic human victory within the runtime limit', async ({ page, baseUrl }) => {
  test.setTimeout(60_000); await page.goto(baseUrl); await page.getByLabel('AI strategy').selectOption('close-pressure'); await page.getByRole('button', { name: 'Start game' }).click(); for (const card of ['Footwork', 'Aim', 'Volley']) await page.getByLabel(`Add ${card}`).click(); await page.getByRole('button', { name: 'Finish starting build' }).click(); await expect(page.getByText(/Turn 1 · your action/)).toBeVisible({ timeout: 15_000 });
  let won = false;
  for (let humanTurn = 0; humanTurn < 20 && !won; humanTurn += 1) {
    for (let actionCount = 0; actionCount < 20 && !won; actionCount += 1) {
      let played = false;
      for (const name of ['Vault', 'Aim', 'Volley', 'Footwork', 'Flurry', 'Feint', 'Drive', 'Muster']) {
        const card = page.locator(`[data-card-name="${name}"]:not([disabled])`).first(); if (await card.count() === 0) continue; await card.click();
        if (name === 'Footwork') { const withdraw = page.getByRole('button', { name: 'Play Footwork: Withdraw' }); const advance = page.getByRole('button', { name: 'Play Footwork: Advance' }); if (await withdraw.isVisible()) await withdraw.click(); else if (await advance.isVisible()) await advance.click(); else continue; }
        await expect(page.getByText(/action preview|You win/)).toBeVisible(); if (await page.getByText('You win').count()) { await page.getByRole('button', { name: 'Confirm', exact: true }).click(); won = true; break; } await confirm(page); played = true; break;
      }
      if (!played) break;
    }
    if (won) break;
    await page.getByRole('button', { name: 'End Action phase' }).click(); await confirm(page);
    for (const name of ['Volley', 'Aim', 'Vault', 'Footwork']) { const market = page.locator(`[data-market-card="${name}"]:not([disabled])`); if (await market.count()) { await market.click(); await confirm(page); } }
    await page.getByRole('button', { name: 'End Buy phase' }).click(); await page.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(page.getByText(/your action|AI wins|You win/)).toBeVisible({ timeout: 15_000 }); if (await page.getByText('AI wins').count()) throw new Error('Deterministic fake AI won before the scripted human strategy.');
  }
  expect(won).toBe(true); const id = await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId')); const saved = await fetch(`${baseUrl}/api/games/${id}`).then((response) => response.json()) as { phase: string; winner: string }; expect(saved).toMatchObject({ phase: 'ended', winner: 'ochre' }); await page.reload(); await expect(page.getByText('You win')).toBeVisible(); await page.getByRole('button', { name: 'New game' }).click(); await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
});
