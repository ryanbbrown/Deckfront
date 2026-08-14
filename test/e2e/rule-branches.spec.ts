import { expect, hex, loadSaved, openScenario, piece, playCard, seedScenario, test } from './fixture';

test('SHOVE-blocked-destination: an occupied push destination disables Shove', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['shove'], positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 2 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 1, r: 0 }
    }
  });
  await openScenario(page, id);
  await expect(page.getByRole('button', { name: /^Shove, unavailable/ })).toBeDisabled();
});

test('DRIVE-brace: Brace cancels Drive and prevents the automatic follow', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['drive'], braced: ['indigo-a'], positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 2 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 2, r: -1 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Drive');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  const saved = await loadSaved(id);
  expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
  expect(saved.state.pieces['indigo-a'].braced).toBe(false);
});

test('PRESS-basic: Press without prior setup pushes exactly once', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['press'], positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 2 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 2, r: -1 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Press');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  expect((await loadSaved(id)).state.pieces['indigo-a'].position).toEqual({ q: 1, r: 0 });
});

test('PULL-occupied-middle: Pull is unavailable unless Brace can absorb it', async ({ page }) => {
  const positions = {
    'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: 0, r: 0 },
    'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: 2, r: -1 }
  };
  const unbraced = await seedScenario({ cards: ['pull'], positions });
  await openScenario(page, unbraced.id);
  await expect(page.getByRole('button', { name: /^Pull, unavailable/ })).toBeDisabled();

  const braced = await seedScenario({ cards: ['pull'], positions, braced: ['indigo-a'] });
  const bracedPage = await page.context().newPage();
  await openScenario(bracedPage, braced.id);
  await playCard(bracedPage, 'Pull');
  await piece(bracedPage, 'ochre-a').click();
  await piece(bracedPage, 'indigo-a').click();
  const saved = await loadSaved(braced.id);
  expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 1, r: 0 });
  expect(saved.state.pieces['indigo-a'].braced).toBe(false);
  expect(saved.state.pieces['ochre-a'].position).toEqual({ q: -1, r: 0 });
});

for (const scenario of [
  { id: 'wrong-range', target: { q: 1, r: 0 } },
  { id: 'bent-line', target: { q: 1, r: 1 } }
] as const) {
  test(`PULL-${scenario.id}: Pull rejects ${scenario.id}`, async ({ page }) => {
    const { id } = await seedScenario({
      cards: ['pull'], positions: {
        'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: -2, r: 2 },
        'indigo-a': scenario.target, 'indigo-b': { q: 2, r: -1 }
      }
    });
    await openScenario(page, id);
    await expect(page.getByRole('button', { name: /^Pull, unavailable/ })).toBeDisabled();
    await expect(piece(page, 'indigo-a')).not.toHaveClass(/piece--target/);
    expect((await loadSaved(id, 0)).revision).toBe(0);
  });
}

test('SWEEP-counterclockwise: each rotation resolves independently', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['sweep'], positions: {
      'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: -2, r: 0 },
      'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: 0, r: -2 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Sweep');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  await hex(page, 0, 1).click();
  expect((await loadSaved(id)).state.pieces['indigo-a'].position).toEqual({ q: 0, r: 1 });
});

test('SWEEP-off-board: an off-board rotation is a visible scoring choice', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['sweep'], positions: {
      'ochre-a': { q: 3, r: -1 }, 'ochre-b': { q: -2, r: 0 },
      'indigo-a': { q: 3, r: 0 }, 'indigo-b': { q: 0, r: -2 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Sweep');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  await page.getByRole('button', { name: /Sweep: .* to 4,-1/ }).click();
  const saved = await loadSaved(id);
  expect(saved.state.scores.ochre).toBe(1);
  expect(saved.state.pieces['indigo-a'].position).toBeNull();
});

test('RELAY-range: Relay is unavailable beyond distance two', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['relay'], positions: {
      'ochre-a': { q: -2, r: 0 }, 'ochre-b': { q: 0, r: 2 },
      'indigo-a': { q: 2, r: -1 }, 'indigo-b': { q: 1, r: -2 }
    }
  });
  await openScenario(page, id);
  await expect(page.getByRole('button', { name: /^Relay, unavailable/ })).toBeDisabled();
});

test('CORNER-owned-block: only the active player block earns the second push', async ({ page }) => {
  const positions = {
    'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 2 },
    'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 2, r: -1 }
  };
  const opponentBlock = await seedScenario({
    cards: ['corner'], positions,
    blocks: [{ id: 'enemy-block', ownerId: 'indigo', position: { q: 1, r: -1 }, clearAfterTurn: 2 }]
  });
  await openScenario(page, opponentBlock.id);
  await playCard(page, 'Corner');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  expect((await loadSaved(opponentBlock.id)).state.pieces['indigo-a'].position).toEqual({ q: 1, r: 0 });

  const ownedBlock = await seedScenario({
    cards: ['corner'], positions,
    blocks: [{ id: 'own-block', ownerId: 'ochre', position: { q: 1, r: -1 }, clearAfterTurn: 2 }]
  });
  const ownedPage = await page.context().newPage();
  await openScenario(ownedPage, ownedBlock.id);
  await playCard(ownedPage, 'Corner');
  await piece(ownedPage, 'ochre-a').click();
  await piece(ownedPage, 'indigo-a').click();
  expect((await loadSaved(ownedBlock.id)).state.pieces['indigo-a'].position).toEqual({ q: 2, r: 0 });
});

test('BUY-illegal: unaffordable and empty piles cannot be selected', async ({ page }) => {
  const { id } = await seedScenario({ phase: 'buy', money: 0, buys: 1, supply: { copper: 0 } });
  await openScenario(page, id, 'Your buy phase');
  await expect(page.locator('.market-card').filter({ hasText: /^0Copper/ })).toBeDisabled();
  await expect(page.locator('.market-card').filter({ hasText: /^3Silver/ })).toBeDisabled();
});

test('RESPAWN-two: two ringed pieces respawn one at a time', async ({ page }) => {
  const { id } = await seedScenario({
    braced: ['ochre-a', 'ochre-b'], pinned: ['ochre-a', 'ochre-b'],
    phase: 'respawn', positions: {
      'ochre-a': null, 'ochre-b': null,
      'indigo-a': { q: 2, r: -1 }, 'indigo-b': { q: 1, r: -2 }
    }
  });
  await openScenario(page, id, 'Your respawn phase');
  await expect(page.getByRole('status')).toContainText('respawn your piece');
  await hex(page, -1, 0).click();
  await expect(page.getByText('Your respawn phase')).toBeVisible();
  await hex(page, -1, 1).click();
  await expect(page.getByText('Your action phase')).toBeVisible();
  const saved = await loadSaved(id, 2);
  expect(saved.state.pieces['ochre-a'].baselineMoves).toBe(1);
  expect(saved.state.pieces['ochre-b'].baselineMoves).toBe(1);
  expect(saved.state.pieces['ochre-a'].braced).toBe(false);
  expect(saved.state.pieces['ochre-b'].braced).toBe(false);
  expect(saved.state.pieces['ochre-a'].pinned).toBeNull();
  expect(saved.state.pieces['ochre-b'].pinned).toBeNull();
});
