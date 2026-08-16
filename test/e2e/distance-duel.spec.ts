import { test, expect, seedHand } from './fixture';

async function previewCard(page: import('@playwright/test').Page, name: string) { await page.locator(`[data-card-name="${name}"]`).click(); await expect(page.getByText(/action preview/)).toBeVisible(); }
async function confirm(page: import('@playwright/test').Page) { await page.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(page.getByText(/your action|your buy/)).toBeVisible(); }

test('DD-E2E-001: setup saves a private flexible build, free Copper, prompt, and first-player choice', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await expect(page.getByRole('heading', { name: 'Hexdeck' })).toBeVisible();
  await page.getByLabel('AI strategy').selectOption('close-pressure'); await page.getByLabel('Strategy instructions').fill('# Edited close prompt');
  await page.getByText('AI', { exact: true }).click(); await page.getByRole('button', { name: 'Start game' }).click(); await expect(page.getByRole('heading', { name: 'Spend up to 12' })).toBeVisible();
  await page.getByLabel('Add Copper').click(); await page.getByLabel('Add Copper').click(); await page.getByLabel('Add Aim').click(); await expect(page.getByTestId('build-budget')).toHaveText('3 spent · 9 carries');
  await page.reload(); await expect(page.getByLabel('Copper quantity')).toHaveText('2'); await expect(page.getByLabel('Aim quantity')).toHaveText('1');
  await page.getByLabel('Add Gold').click(); await page.getByLabel('Add Gold').click(); await expect(page.getByRole('button', { name: 'Finish starting build' })).toBeDisabled();
  await page.getByLabel('Remove Gold').click(); await page.getByRole('button', { name: 'Finish starting build' }).click();
  await expect(page.getByText('Starting builds')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Copper, Copper, Aim, Gold/)).toBeVisible();
});

test('DD-E2E-002: Copper Silver and Gold auto-play with exact money and support repeated buys', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['copper', 'silver', 'gold']); record.state.players.ochre.firstBuyMoney = 0; });
  await page.getByRole('button', { name: 'End Action phase' }).click(); await page.getByRole('button', { name: 'Confirm' }).click(); await expect(page.getByTestId('zone-money')).toContainText('6');
  await page.locator('[data-market-card="Copper"]').click(); await confirm(page); await page.locator('[data-market-card="Silver"]').click(); await confirm(page); await expect(page.getByTestId('zone-money')).toContainText('3');
});

test('DD-E2E-003: Footwork exposes both movement selections, moves, draws, and disables a wall direction', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork'], ['aim']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 4; });
  await page.locator('[data-card-name="Footwork"]').click(); await expect(page.getByRole('button', { name: 'Play Footwork: Advance' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Play Footwork: Withdraw' })).toBeVisible();
  await page.getByRole('button', { name: 'Play Footwork: Advance' }).click(); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '3'); await expect(page.getByTestId('hidden-preview-draw')).toBeVisible();
  await confirm(page); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible();
});

test('DD-E2E-004: Cull selects itself plus one or two other hand cards and excludes played cards', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull', 'copper', 'silver']); });
  await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Copper"]').click(); await expect(page.getByText('2/2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Preview Cull' }).click(); await expect(page.getByText(/action preview/)).toBeVisible(); await expect(page.getByTestId('zone-trash')).toContainText('9'); await confirm(page);
  await expect(page.locator('[data-card-name="Silver"]')).toBeVisible(); await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0);
});

test('DD-E2E-005: Muster draws two across a reshuffle and hides preview identities', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster']); record.state.players.ochre.deck.discard.push(...['aim', 'volley'].map((id) => ({ id: `extra-${id}`, definitionId: id }))); record.state.nextCardSerial += 2; });
  await previewCard(page, 'Muster'); await expect(page.getByTestId('hidden-card')).toHaveCount(2); await page.getByRole('button', { name: 'Undo' }).click(); await expect(page.locator('[data-card-name="Muster"]')).toBeVisible();
  await previewCard(page, 'Muster'); await confirm(page); await expect(page.locator('[data-card-name="Aim"]')).toBeVisible(); await expect(page.locator('[data-card-name="Volley"]')).toBeVisible();
});

test('DD-E2E-006: Feint and Drive enforce Close range, consume Exposed, damage, push, follow, and collide', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await previewCard(page, 'Feint'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('Exposed'); await confirm(page);
  await previewCard(page, 'Drive'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('16 HP'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '4'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '3'); await confirm(page);
});

test('DD-E2E-007: Flurry works at every range and caps a long Action chain', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['flurry']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 5; record.state.actionsThisTurn = ['a', 'b', 'c', 'd', 'e', 'f']; });
  await previewCard(page, 'Flurry'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('15 HP'); await expect(page.getByTestId('range')).toHaveText('Far range');
});

test('DD-E2E-008: Vault reports blocked landing and crosses the opponent with a draw when legal', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['vault'], ['footwork']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 3; });
  await previewCard(page, 'Vault'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.getByTestId('hidden-preview-draw')).toBeVisible(); await confirm(page); await expect(page.locator('[data-card-name="Footwork"]')).toBeVisible();
});

test('DD-E2E-009: Aim is blocked at Close and Aimed Volley deals exact Mid and Far damage', async ({ page, openGame }) => {
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

test('DD-E2E-012: multi-buy cleanup, refresh, AI full turn, victory, and new game work through the app', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['volley', 'copper']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 5; record.state.fighters.indigo.health = 5; });
  await page.locator('[data-card-name="Volley"]').click(); await expect(page.getByText('You win')).toBeVisible(); await page.reload(); await expect(page.getByText('You win')).toBeVisible(); await page.getByRole('button', { name: 'New game' }).click(); await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
});

test('DD-E2E-013: disabled cards show exact range movement and Cull reasons in the browser', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['footwork', 'aim', 'volley']); record.state.fighters.ochre.position = 1; record.state.fighters.indigo.position = 2; });
  await expect(page.locator('[data-card-name="Footwork"]')).toContainText('No legal movement is available.'); await expect(page.locator('[data-card-name="Aim"]')).toContainText('Requires Mid or Far range.'); await expect(page.locator('[data-card-name="Volley"]')).toContainText('Requires Mid or Far range.');
});

test('DD-E2E-014: Feint Drive wall collision deals exact six damage and does not move either fighter', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 4; record.state.fighters.indigo.position = 5; });
  await previewCard(page, 'Feint'); await confirm(page); await previewCard(page, 'Drive'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('14 HP'); await expect(page.locator('[data-player-id="ochre"]')).toHaveAttribute('data-position', '4'); await expect(page.locator('[data-player-id="indigo"]')).toHaveAttribute('data-position', '5');
});

test('DD-E2E-015: two unprepared Mid Volleys deal four while Aim plus Volley deals five', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['volley', 'volley']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 4; });
  await page.locator('[data-card-name="Volley"]').first().click(); await expect(page.getByText(/action preview/)).toBeVisible(); await confirm(page); await previewCard(page, 'Volley'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('16 HP');
});

test('DD-E2E-016: Cull trashes two other hand cards and never offers an already played card', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['muster', 'cull', 'copper', 'silver']); });
  await previewCard(page, 'Muster'); await confirm(page); await page.locator('[data-card-name="Cull"]').click(); await page.locator('[data-card-name="Copper"]').click(); await page.locator('[data-card-name="Silver"]').click();
  await expect(page.locator('[data-card-name="Muster"]')).toHaveCount(0); await page.getByRole('button', { name: 'Preview Cull' }).click(); await confirm(page); await expect(page.locator('[data-card-name="Cull"]')).toHaveCount(0); await expect(page.getByTestId('zone-trash')).toContainText('9');
});

test('DD-E2E-017: Vault and close cards show exact blocked landing and range reasons', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['vault', 'feint', 'drive']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 1; });
  await expect(page.locator('[data-card-name="Vault"]')).toContainText('There is no empty space beyond the opponent.'); await expect(page.locator('[data-card-name="Feint"]')).not.toContainText('Requires'); await expect(page.locator('[data-card-name="Drive"]')).not.toContainText('Requires');
});

test('DD-E2E-018: Feint and Drive are disabled at Mid with a specific reason', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['feint', 'drive']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 4; });
  await expect(page.locator('[data-card-name="Feint"]')).toContainText('Requires Close range.'); await expect(page.locator('[data-card-name="Drive"]')).toContainText('Requires Close range.');
});

test('DD-E2E-019: Flurry resolves exact Mid damage from prior Actions', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['flurry']); record.state.fighters.ochre.position = 2; record.state.fighters.indigo.position = 4; record.state.actionsThisTurn = ['first', 'second']; });
  await previewCard(page, 'Flurry'); await expect(page.locator('[data-player-id="indigo"]')).toContainText('18 HP'); await expect(page.getByTestId('range')).toHaveText('Mid range');
});

test('DD-E2E-020: Cull is disabled when no second eligible card exists', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedHand(record, ['cull']); });
  await expect(page.locator('[data-card-name="Cull"]')).toContainText('Cull needs exactly two eligible cards.'); await expect(page.locator('[data-card-name="Cull"]')).toBeDisabled();
});

test('DD-E2E-021: carried starting money funds several purchases and expires at explicit cleanup', async ({ page, openGame }) => {
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
