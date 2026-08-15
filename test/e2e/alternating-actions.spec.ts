import type { Page } from '@playwright/test';
import type { GameRecord } from '../../src/server/types';
import { addCard, clearHands, setPosition } from '../helpers';
import { expect, test } from './fixture';

function seedCard(record: GameRecord, definitionId: string): void {
  clearHands(record.state);
  addCard(record.state, record.humanPlayerId, definitionId);
  setPosition(record.state, 'ochre-a', -1, 0);
  setPosition(record.state, 'ochre-b', -2, 2);
  setPosition(record.state, 'indigo-a', 0, 0);
  setPosition(record.state, 'indigo-b', 2, -2);
}

async function chooseCard(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${name}, playable`) }).first().click();
}

async function confirmPreview(page: Page, text?: RegExp): Promise<void> {
  await expect(page.getByText(/^Preview:/)).toBeVisible();
  if (text) await expect(page.getByText(text)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm action' }).click();
  await expect(page.getByRole('button', { name: 'Confirm action' })).toBeDisabled();
}

test('E2E-BASELINE: visible baseline move previews, undoes, confirms, hands off, and rejects a stale revision', async ({ page, openGame, baseUrl }) => {
  const record = await openGame(page);
  await page.getByLabel('Your piece A, legal actor').click();
  await page.getByLabel('Hex 0,0, legal destination').click();
  await expect(page.getByText('Preview: Move piece A.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Preview: Move piece A.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo action' }).click();
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-position', '-1,0');

  const stale = await fetch(`${baseUrl}/api/games/${record.id}/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 0, actionId: 'v0-action-1' })
  });
  expect(stale.status).toBe(409);

  await page.getByLabel('Your piece A, legal actor').click();
  await page.getByLabel('Hex 0,0, legal destination').click();
  await confirmPreview(page);
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-baseline-moves', '0');
  await expect(page.getByText(/AI action/)).toBeVisible();
});

test('E2E-SHOVE: Shove completes through card, actor, target, preview, and confirmation controls', async ({ page, openGame }) => {
  await openGame(page, (record) => seedCard(record, 'shove'));
  await chooseCard(page, 'Shove');
  await page.getByLabel('Your piece A, legal actor').click();
  await page.getByLabel('AI piece A, legal target').click();
  await confirmPreview(page, /Play Shove/);
  await expect(page.locator('[data-piece-id="indigo-a"]')).toHaveAttribute('data-position', '1,0');
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-position', '-1,0');
});

test('E2E-DASH: Dash completes through a visible destination and preserves baseline movement', async ({ page, openGame }) => {
  await openGame(page, (record) => seedCard(record, 'dash'));
  await chooseCard(page, 'Dash');
  await page.getByLabel('Your piece A, legal actor').click();
  await page.getByLabel('Hex 0,-1, legal destination').click();
  await confirmPreview(page, /Play Dash/);
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-position', '0,-1');
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-baseline-moves', '1');
});

test('E2E-BRACE: Brace completes through visible controls and shows its resolved status', async ({ page, openGame }) => {
  await openGame(page, (record) => seedCard(record, 'brace'));
  await chooseCard(page, 'Brace');
  await page.getByLabel('Your piece A, legal actor').click();
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-braced', 'true');
  await confirmPreview(page, /Play Brace/);
});

test('E2E-CULL: Cull visibly offers and completes both exact two-card selection forms', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    seedCard(record, 'cull'); addCard(record.state, record.humanPlayerId, 'copper'); addCard(record.state, record.humanPlayerId, 'silver');
  });
  await chooseCard(page, 'Cull');
  await page.getByRole('button', { name: 'Trash Copper and Silver with Cull' }).click();
  await confirmPreview(page, /Play Cull/);
  await expect(page.locator('[data-event-type="cull"]')).toHaveCount(2);

  await openGame(page, (record) => { seedCard(record, 'cull'); addCard(record.state, record.humanPlayerId, 'copper'); });
  await chooseCard(page, 'Cull');
  await page.getByRole('button', { name: 'Trash Cull and Copper with Cull' }).click();
  await confirmPreview(page, /Play Cull/);
  await expect(page.getByText('No cards remain in hand.')).toBeVisible();
});

test('E2E-DRIVE-BREAKER: Drive follows and Breaker removes Brace before pushing', async ({ page, openGame }) => {
  await openGame(page, (record) => seedCard(record, 'drive'));
  await chooseCard(page, 'Drive'); await page.getByLabel('Your piece A, legal actor').click(); await page.getByLabel('AI piece A, legal target').click();
  await confirmPreview(page);
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-position', '0,0');
  await expect(page.locator('[data-piece-id="indigo-a"]')).toHaveAttribute('data-position', '1,0');

  await openGame(page, (record) => { seedCard(record, 'breaker'); record.state.pieces['indigo-a'].braced = true; });
  await chooseCard(page, 'Breaker'); await page.getByLabel('Your piece A, legal actor').click(); await page.getByLabel('AI piece A, legal target').click();
  await confirmPreview(page);
  await expect(page.locator('[data-piece-id="indigo-a"]')).toHaveAttribute('data-braced', 'false');
  await expect(page.locator('[data-piece-id="indigo-a"]')).toHaveAttribute('data-position', '1,0');
});

test('E2E-PRESS-PULL: Press uses earlier round displacement and Pull uses exact range', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedCard(record, 'press'); record.state.round.pressSetupPieceIds = ['indigo-a']; });
  await chooseCard(page, 'Press'); await page.getByLabel('Your piece A, legal actor').click(); await page.getByLabel('AI piece A, legal target').click();
  await confirmPreview(page);
  await expect(page.locator('[data-piece-id="indigo-a"]')).toHaveAttribute('data-position', '2,0');

  await openGame(page, (record) => { seedCard(record, 'pull'); setPosition(record.state, 'indigo-a', 1, 0); });
  await chooseCard(page, 'Pull'); await page.getByLabel('Your piece A, legal actor').click(); await page.getByLabel('AI piece A, legal target').click();
  await confirmPreview(page);
  await expect(page.locator('[data-piece-id="indigo-a"]')).toHaveAttribute('data-position', '0,0');
});

test('E2E-VAULT: Vault jumps a friendly piece over an adjacent piece through visible controls', async ({ page, openGame }) => {
  await openGame(page, (record) => { seedCard(record, 'vault'); setPosition(record.state, 'indigo-b', 3, -3); });
  await chooseCard(page, 'Vault'); await page.getByLabel('Your piece A, legal actor').click(); await page.getByLabel('AI piece A, legal target').click();
  await confirmPreview(page);
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-position', '1,0');
});

test('E2E-SWEEP: Sweep exposes both 120-degree destinations and scores off-board', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    seedCard(record, 'sweep'); setPosition(record.state, 'ochre-a', 3, 0); setPosition(record.state, 'indigo-a', 3, -1);
    setPosition(record.state, 'ochre-b', -3, 0); setPosition(record.state, 'indigo-b', 0, 3);
  });
  await chooseCard(page, 'Sweep'); await page.getByLabel('Your piece A, legal actor').click(); await page.getByLabel('AI piece A, legal target').click();
  await expect(page.getByLabel(/legal destination/)).toHaveCount(1);
  const offBoardChoice = page.getByRole('button', { name: /Use Sweep .* to .*4/ });
  await expect(offBoardChoice).toBeVisible();
  await offBoardChoice.click();
  await expect(page.getByLabel('Score')).toContainText('1');
  await confirmPreview(page);
});

test('E2E-RELAY-BLOCK: Relay swaps across the board once and Block uses visible placement controls', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    seedCard(record, 'relay'); addCard(record.state, record.humanPlayerId, 'relay');
    setPosition(record.state, 'ochre-a', -3, 0); setPosition(record.state, 'ochre-b', 3, 0);
    record.state.round.passedPlayerIds = ['indigo'];
  });
  await chooseCard(page, 'Relay'); await page.getByRole('button', { name: /Swap ochre-a and ochre-b with Relay/ }).click(); await confirmPreview(page);
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-position', '3,0');
  await expect(page.getByRole('button', { name: /^Relay, unavailable/ })).toBeVisible();

  await openGame(page, (record) => seedCard(record, 'block'));
  await chooseCard(page, 'Block'); await page.getByLabel('Your piece A, legal actor').click(); await page.getByLabel('Hex 0,-1, legal destination').click();
  await confirmPreview(page);
  await expect(page.locator('[data-block-id]')).toHaveAttribute('data-position', '0,-1');
});

test('E2E-PIN-CORNER: Pin survives refresh and cancels one baseline attempt; Corner uses Pin for a second push', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    seedCard(record, 'dash'); record.state.round.number = 2; record.state.round.startingPlayerId = 'indigo';
    record.state.pieces['ochre-a'].pinned = { sourcePlayerId: 'indigo' };
  });
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-pinned', 'true');
  await page.reload();
  await page.getByLabel('Your piece A, legal actor').click(); await page.getByLabel('Hex 0,-1, legal destination').click();
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-position', '-1,0');
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-pinned', 'false');
  await confirmPreview(page);

  await openGame(page, (record) => { seedCard(record, 'corner'); record.state.pieces['indigo-a'].pinned = { sourcePlayerId: 'ochre' }; });
  await chooseCard(page, 'Corner'); await page.getByLabel('Your piece A, legal actor').click(); await page.getByLabel('AI piece A, legal target').click();
  await confirmPreview(page);
  await expect(page.locator('[data-piece-id="indigo-a"]')).toHaveAttribute('data-position', '2,0');
});

test('E2E-PASS-PURCHASE-REFRESH: pass is final, the other player continues, purchase order and buy-nothing persist', async ({ page, openGame, repository }) => {
  const record = await openGame(page, (saved) => {
    clearHands(saved.state); addCard(saved.state, saved.humanPlayerId, 'gold'); addCard(saved.state, saved.aiPlayerId, 'silver');
    saved.state.pieces['indigo-a'].baselineMoves = 0; saved.state.pieces['indigo-b'].baselineMoves = 0;
  });
  await page.getByRole('button', { name: 'Pass for this round' }).click();
  await expect(page.getByText(/Preview: Pass/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Passed: you, AI/)).toBeVisible();
  await confirmPreview(page);
  await expect(page.getByText(/your purchase/)).toBeVisible();
  await expect(page.locator('.zones').getByText('Money').locator('..')).toContainText('3');
  await page.getByRole('button', { name: 'Buy nothing' }).click();
  await page.reload();
  await expect(page.getByText('Preview: Buy nothing.')).toBeVisible();
  await confirmPreview(page);
  const saved = await repository.load(record.id);
  expect(saved.committedCommands.map((command) => command.type)).toContain('skipPurchase');

  await openGame(page, (next) => {
    clearHands(next.state); addCard(next.state, next.humanPlayerId, 'dash');
    next.state.round.passedPlayerIds = ['indigo'];
  });
  await page.getByLabel('Your piece A, legal actor').click(); await page.getByLabel('Hex 0,0, legal destination').click();
  await confirmPreview(page);
  await expect(page.getByText(/your action/)).toBeVisible();
  await expect(page.getByText(/Passed: AI/)).toBeVisible();
});

test('E2E-TREASURES: Copper, Silver, and Gold auto-play during a visible purchase', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    clearHands(record.state);
    addCard(record.state, record.humanPlayerId, 'copper'); addCard(record.state, record.humanPlayerId, 'silver'); addCard(record.state, record.humanPlayerId, 'gold');
    record.state.pieces['indigo-a'].baselineMoves = 0; record.state.pieces['indigo-b'].baselineMoves = 0;
  });
  await page.getByRole('button', { name: 'Pass for this round' }).click();
  await expect(page.locator('.zones').getByText('Money').locator('..')).toContainText('6');
  await expect(page.getByText('Played').locator('..')).toContainText('3');
  await confirmPreview(page);
  await page.getByRole('button', { name: /Silver.*2 money/ }).click();
  await confirmPreview(page, /Buy Silver/);
});

test('E2E-CLEANUP: Brace and Block expire at round cleanup', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    clearHands(record.state); addCard(record.state, record.humanPlayerId, 'copper');
    record.state.phase = 'purchase'; record.state.round.passedPlayerIds = ['ochre', 'indigo'];
    record.state.round.purchaseOrder = ['ochre', 'indigo']; record.state.round.purchaseIndex = 0;
    record.state.activePlayerId = 'ochre'; record.state.players.ochre.money = 1;
    record.state.pieces['ochre-a'].braced = true;
    record.state.blocks = [{ id: 'cleanup-block', ownerId: 'ochre', position: { q: 0, r: -1 }, expiresAfterRound: 1 }];
  });
  await page.getByRole('button', { name: 'Buy nothing' }).click(); await confirmPreview(page);
  await expect(page.getByRole('button', { name: 'Retry AI turn' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry AI turn' }).click();
  await expect(page.getByText(/Round 2/)).toBeVisible();
  await expect(page.locator('[data-piece-id="ochre-a"]')).toHaveAttribute('data-braced', 'false');
  await expect(page.locator('[data-block-id="cleanup-block"]')).toHaveCount(0);
});

test('E2E-AI-FIRST-PURCHASE: AI-first purchase order reaches the human after one AI purchase', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    clearHands(record.state); record.state.phase = 'purchase';
    record.state.round.passedPlayerIds = ['indigo', 'ochre']; record.state.round.purchaseOrder = ['indigo', 'ochre'];
    record.state.round.purchaseIndex = 0; record.state.activePlayerId = 'indigo'; record.state.players.indigo.money = 0;
  });
  await expect(page.getByText(/AI purchase/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry AI turn' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry AI turn' }).click();
  await expect(page.getByText(/your purchase/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buy nothing' })).toBeEnabled();
});

test('E2E-AI-RETRY: an AI failure shows retry and does not corrupt the saved game', async ({ page, openGame, repository }) => {
  const record = await openGame(page);
  await page.getByRole('button', { name: 'Pass for this round' }).click();
  await confirmPreview(page);
  await expect(page.getByRole('button', { name: 'Retry AI turn' })).toBeVisible();
  const before = await repository.load(record.id);
  expect(before.aiActions).toEqual([]);
  await page.getByRole('button', { name: 'Retry AI turn' }).click();
  await expect.poll(async () => (await repository.load(record.id)).aiActions.length).toBeGreaterThanOrEqual(2);
  const after = await repository.load(record.id);
  expect(after.committedCommands.length).toBeGreaterThanOrEqual(3);
  expect(after.committedCommands[0]?.type).toBe('pass');
});

test('E2E-ENDED-REFRESH: the fifth point ends the match immediately and refresh restores it', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    seedCard(record, 'shove'); record.state.scores.ochre = 4;
    setPosition(record.state, 'ochre-a', 2, 0); setPosition(record.state, 'indigo-a', 3, 0);
    setPosition(record.state, 'ochre-b', -3, 0); setPosition(record.state, 'indigo-b', 0, 3);
  });
  await chooseCard(page, 'Shove'); await page.getByLabel('Your piece A, legal actor').click(); await page.getByLabel('AI piece A, legal target').click();
  await expect(page.getByText(/You win/)).toBeVisible();
  await expect(page.getByLabel('Score')).toContainText('5');
  await confirmPreview(page);
  await page.reload();
  await expect(page.getByText(/You win/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm action' })).toBeDisabled();
});

test('E2E-COMPLETE-MATCH: one match alternates, purchases, starts a new round, and ends on the fifth point', async ({ page, openGame }) => {
  await openGame(page, (record) => {
    clearHands(record.state);
    addCard(record.state, record.humanPlayerId, 'gold');
    addCard(record.state, record.aiPlayerId, 'silver');
    const shove = addCard(record.state, record.humanPlayerId, 'shove');
    record.state.players.ochre.deck.hand = record.state.players.ochre.deck.hand.filter((card) => card.id !== shove.id);
    record.state.players.ochre.deck.draw.unshift(shove);
    record.state.scores.ochre = 4;
    setPosition(record.state, 'ochre-a', 2, 0); setPosition(record.state, 'indigo-a', 3, 0);
    setPosition(record.state, 'ochre-b', -3, 0); setPosition(record.state, 'indigo-b', 0, 3);
    record.state.pieces['indigo-a'].pinned = { sourcePlayerId: 'ochre' };
    record.state.pieces['indigo-a'].baselineMoves = 0; record.state.pieces['indigo-b'].baselineMoves = 0;
  });
  await page.getByRole('button', { name: 'Pass for this round' }).click(); await confirmPreview(page);
  await expect(page.getByText(/your purchase/)).toBeVisible();
  await page.getByRole('button', { name: 'Buy nothing' }).click(); await confirmPreview(page);
  await expect(page.getByRole('button', { name: 'Retry AI turn' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry AI turn' }).click();
  await expect(page.getByText(/Round 2 · your action/)).toBeVisible();
  await chooseCard(page, 'Shove'); await page.getByLabel('Your piece A, legal actor').click(); await page.getByLabel('AI piece A, legal target').click();
  await expect(page.getByText(/You win/)).toBeVisible();
  await confirmPreview(page);
  await expect(page.getByLabel('Score')).toContainText('5');
});
