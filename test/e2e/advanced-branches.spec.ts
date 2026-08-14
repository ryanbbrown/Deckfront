import { expect, hex, loadSaved, openScenario, piece, playCard, seedScenario, test } from './fixture';

const forcePositions = {
  'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 2 },
  'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 2, r: -1 }
};

test('DRIVE-ring-out: Drive follows automatically after a ring-out', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['drive'], positions: {
      'ochre-a': { q: 2, r: 0 }, 'ochre-b': { q: -2, r: 2 },
      'indigo-a': { q: 3, r: 0 }, 'indigo-b': { q: 0, r: -2 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Drive');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  const saved = await loadSaved(id);
  expect(saved.state.scores.ochre).toBe(1);
  expect(saved.state.pieces['ochre-a'].position).toEqual({ q: 3, r: 0 });
});

test('DRIVE-blocked: an occupied destination makes Drive unavailable', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['drive'], positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 2 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 1, r: 0 }
    }
  });
  await openScenario(page, id);
  await expect(page.getByRole('button', { name: /^Drive, unavailable/ })).toBeDisabled();
});

test('BREAKER-occupied: Breaker removes Brace but cannot enter an occupied destination', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['breaker'], braced: ['indigo-a'], positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 2 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 1, r: 0 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Breaker');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  const saved = await loadSaved(id);
  expect(saved.state.pieces['indigo-a'].braced).toBe(false);
  expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
});

for (const setup of ['shove', 'drive', 'breaker', 'pull', 'sweep', 'corner'] as const) {
  test(`PRESS-setup-${setup}: ${setup} executes through the UI before Press pushes twice`, async ({ page }) => {
    const needsBaseline = setup === 'shove' || setup === 'breaker' || setup === 'corner';
    const positions = setup === 'pull'
      ? {
        'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 2 },
        'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: 2, r: -2 }
      }
      : setup === 'sweep'
        ? {
          'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 2 },
          'indigo-a': { q: 0, r: -1 }, 'indigo-b': { q: 2, r: -2 }
        }
        : {
          'ochre-a': { q: -2, r: 0 }, 'ochre-b': { q: -2, r: 2 },
          'indigo-a': { q: -1, r: 0 }, 'indigo-b': { q: 2, r: -2 }
        };
    const { id } = await seedScenario({ cards: [setup, 'press'], positions });
    await openScenario(page, id);

    await playCard(page, capitalize(setup));
    await piece(page, 'ochre-a').click();
    await piece(page, 'indigo-a').click();
    if (setup === 'sweep') await hex(page, 0, 0).click();
    const setupState = await loadSaved(id);
    expect(setupState.state.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
    expect(setupState.state.turn.pressSetupPieceIds).toContain('indigo-a');
    expect(setupState.draft.commands[0]?.type).toBe(`play${capitalize(setup)}`);

    if (needsBaseline) {
      await piece(page, 'ochre-a').click();
      await hex(page, -1, 0).click();
    }
    await playCard(page, 'Press');
    await piece(page, 'ochre-a').click();
    await piece(page, 'indigo-a').click();

    const saved = await loadSaved(id, needsBaseline ? 3 : 2);
    expect(saved.state.pieces['ochre-a'].position).toEqual({ q: -1, r: 0 });
    expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 2, r: 0 });
    expect(saved.state.scores).toEqual({ ochre: 0, indigo: 0 });
    expect(saved.state.players.ochre.deck.play.map((card) => card.definitionId)).toEqual([setup, 'press']);
    const targetDisplacements = saved.state.events.filter((event) =>
      event.type === 'displacement' && event.detail.pieceId === 'indigo-a'
    );
    expect(targetDisplacements.slice(-2).map((event) => ({ from: event.detail.from, to: event.detail.to }))).toEqual([
      { from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
      { from: { q: 1, r: 0 }, to: { q: 2, r: 0 } }
    ]);
  });
}

test('PRESS-does-not-self-setup: one Press does not qualify the next Press', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['press', 'press'], positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: 1, r: -1 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: -2, r: 2 }
    }
  });
  await openScenario(page, id);
  await page.locator('.card').filter({ hasText: 'Press' }).first().click();
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  await expect(page.getByText('Revision 1')).toBeVisible();
  await playCard(page, 'Press');
  await piece(page, 'ochre-b').click();
  await piece(page, 'indigo-a').click();
  expect((await loadSaved(id, 2)).state.pieces['indigo-a'].position).toEqual({ q: 1, r: 1 });
});

for (const mechanic of ['press', 'corner']) {
  test(`${mechanic.toUpperCase()}-brace: Brace stops the complete multi-step effect`, async ({ page }) => {
    const { id } = await seedScenario({
      cards: [mechanic], braced: ['indigo-a'], pressSetupPieceIds: ['indigo-a'],
      pinned: mechanic === 'corner' ? ['indigo-a'] : [], positions: forcePositions
    });
    await openScenario(page, id);
    await playCard(page, mechanic === 'press' ? 'Press' : 'Corner');
    await piece(page, 'ochre-a').click();
    await piece(page, 'indigo-a').click();
    const saved = await loadSaved(id);
    expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
    expect(saved.state.pieces['indigo-a'].braced).toBe(false);
  });
}

test('PRESS-first-step-ring-out: Press stops when its first step rings out', async ({ page }) => {
  await ringOutWith(page, 'press', { q: 2, r: 0 }, { q: 3, r: 0 }, true);
});

test('PRESS-second-step-ring-out: Press awards one point on its earned second step', async ({ page }) => {
  await ringOutWith(page, 'press', { q: 1, r: 0 }, { q: 2, r: 0 }, true);
});

test('CORNER-first-step-ring-out: Corner stops when its first step rings out', async ({ page }) => {
  await ringOutWith(page, 'corner', { q: 2, r: 0 }, { q: 3, r: 0 }, true);
});

test('CORNER-second-step-ring-out: Corner awards one point on its setup step', async ({ page }) => {
  await ringOutWith(page, 'corner', { q: 1, r: 0 }, { q: 2, r: 0 }, true);
});

test('SWEEP-occupied: Sweep offers only the unoccupied rotation', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['sweep'], positions: {
      'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: -2, r: 0 },
      'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: 0, r: -2 }
    }, blocks: [{ id: 'occupied', ownerId: 'indigo', position: { q: 1, r: -1 }, clearAfterTurn: 2 }]
  });
  await openScenario(page, id);
  await playCard(page, 'Sweep');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  await expect(hex(page, 1, -1)).not.toHaveClass(/hex--legal/);
  await expect(hex(page, 0, 1)).toHaveClass(/hex--legal/);
});

test('SWEEP-brace: Brace is consumed without moving the Sweep target', async ({ page }) => {
  const { id } = await seedScenario({ cards: ['sweep'], braced: ['indigo-a'], positions: forcePositions });
  await openScenario(page, id);
  await playCard(page, 'Sweep');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  await page.locator('.hex--legal').first().click();
  const saved = await loadSaved(id);
  expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
  expect(saved.state.pieces['indigo-a'].braced).toBe(false);
});

test('TURN-interleave: both baseline moves and multiple cards can interleave', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['dash', 'brace'], positions: {
      'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: -1, r: 1 },
      'indigo-a': { q: 2, r: -1 }, 'indigo-b': { q: 1, r: -2 }
    }
  });
  await openScenario(page, id);
  await piece(page, 'ochre-a').click();
  await hex(page, 1, 0).click();
  await playCard(page, 'Brace');
  await piece(page, 'ochre-b').click();
  await piece(page, 'ochre-b').click();
  await hex(page, -1, 0).click();
  await playCard(page, 'Dash');
  await piece(page, 'ochre-a').click();
  await hex(page, 0, 0).click();
  const saved = await loadSaved(id, 4);
  expect(saved.state.players.ochre.deck.play.map((card) => card.definitionId).sort()).toEqual(['brace', 'dash']);
  expect(saved.state.pieces['ochre-a'].baselineMoves).toBe(0);
  expect(saved.state.pieces['ochre-b'].baselineMoves).toBe(0);
});

test('TURN-buy-and-cleanup: treasure, purchase, cleanup, shuffle, and draw resolve through the UI', async ({ page }) => {
  let firstDeck: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { id } = await seedScenario({ cards: ['copper', 'silver'], aiCards: ['copper'] });
    await openScenario(page, id);
    await page.getByRole('button', { name: 'Enter buy phase' }).click();
    await expect(page.getByRole('button', { name: 'Enter buy phase' })).toHaveCount(0);
    await expect(page.getByText('Money', { exact: true }).locator('..')).toContainText('3');
    await page.locator('.market-card').filter({ hasText: /^3Silver/ }).click();
    await page.getByRole('button', { name: 'End turn' }).click();
    await expect(page.getByText('Your action phase')).toBeVisible({ timeout: 15_000 });
    const saved = await loadSaved(id, 4);
    const deck = saved.state.players.ochre.deck;
    expect(deck.hand).toHaveLength(5);
    expect(deck.play).toHaveLength(0);
    expect(deck.discard.map((card) => card.definitionId)).toEqual(expect.arrayContaining(['silver', 'copper']));
    if (firstDeck === null) firstDeck = deck;
    else expect(deck).toEqual(firstDeck);
  }
});

test('TURN-cleanup-status-expiry: Brace, Pin, and Block expire at their boundaries', async ({ page }) => {
  const { id } = await seedScenario({
    cards: [], aiCards: ['copper'], braced: ['ochre-a'], pinned: ['indigo-a'], turnsTaken: { ochre: 1, indigo: 0 },
    blocks: [{ id: 'expiring', ownerId: 'ochre', position: { q: 0, r: 0 }, clearAfterTurn: 2 }]
  });
  await openScenario(page, id);
  await expect(page.locator('[data-block-id="expiring"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Enter buy phase' }).click();
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.getByText('Your action phase')).toBeVisible({ timeout: 15_000 });
  const saved = await loadSaved(id, 3);
  expect(saved.state.pieces['ochre-a'].braced).toBe(false);
  expect(saved.state.pieces['indigo-a'].pinned).toBeNull();
  expect(saved.state.blocks).toEqual([]);
});

async function ringOutWith(
  page: import('@playwright/test').Page,
  mechanic: 'press' | 'corner',
  actor: { q: number; r: number },
  target: { q: number; r: number },
  setup: boolean
): Promise<void> {
  const { id } = await seedScenario({
    cards: [mechanic],
    pressSetupPieceIds: mechanic === 'press' && setup ? ['indigo-a'] : [],
    pinned: mechanic === 'corner' && setup ? ['indigo-a'] : [],
    positions: {
      'ochre-a': actor, 'ochre-b': { q: -2, r: 2 },
      'indigo-a': target, 'indigo-b': { q: 0, r: -2 }
    }
  });
  await openScenario(page, id);
  await playCard(page, mechanic === 'press' ? 'Press' : 'Corner');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  const saved = await loadSaved(id);
  expect(saved.state.scores.ochre).toBe(1);
  expect(saved.state.pieces['indigo-a'].position).toBeNull();
  expect(saved.state.events.filter((event) => event.type === 'ringOut')).toHaveLength(1);
}

function capitalize(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}
