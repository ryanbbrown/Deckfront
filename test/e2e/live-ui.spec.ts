import type { Page } from '@playwright/test';
import { expect, hex, loadSaved, openScenario, piece, playCard, seedScenario, test } from './fixture';

const directions = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
];

const remotePositions = {
  'ochre-a': { q: 0, r: 0 },
  'ochre-b': { q: -2, r: 0 },
  'indigo-a': { q: 0, r: -2 },
  'indigo-b': { q: 2, r: -2 }
};

const dualShovePositions = {
  'ochre-a': { q: 0, r: 0 },
  'ochre-b': { q: 0, r: 1 },
  'indigo-a': { q: 1, r: 0 },
  'indigo-b': { q: -1, r: 1 }
};

test('BOARD-radius-three: all 37 hexes fit without control overlap at desktop and mobile sizes', async ({ page }) => {
  const { id } = await seedScenario();
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await openScenario(page, id);
    await expect(page.locator('[data-hex]')).toHaveCount(37);
    await expect(page.getByRole('img', { name: '37 hex game board' })).toBeVisible();

    const geometry = await boardGeometry(page);
    for (const rectangle of geometry.hexes) expect(isInside(rectangle, geometry.svg)).toBe(true);
    if (viewport.width > 900) {
      expect(geometry.boardPanel.right).toBeLessThanOrEqual(geometry.turnControls.left);
    } else {
      expect(geometry.boardPanel.bottom).toBeLessThanOrEqual(geometry.turnControls.top);
      expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width);
    }
  }
});

interface Rectangle {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

async function boardGeometry(page: Page): Promise<{
  svg: Rectangle;
  hexes: Rectangle[];
  boardPanel: Rectangle;
  turnControls: Rectangle;
  documentWidth: number;
}> {
  return page.evaluate(() => {
    function rectangle(selector: string): Rectangle {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing layout element: ${selector}`);
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left };
    }

    return {
      svg: rectangle('.board'),
      hexes: Array.from(document.querySelectorAll('[data-hex]')).map((element) => {
        const bounds = element.getBoundingClientRect();
        return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left };
      }),
      boardPanel: rectangle('.board-panel'),
      turnControls: rectangle('.phase-panel'),
      documentWidth: document.documentElement.scrollWidth
    };
  });
}

function isInside(inner: Rectangle, outer: Rectangle): boolean {
  const tolerance = 0.5;
  return inner.top >= outer.top - tolerance
    && inner.right <= outer.right + tolerance
    && inner.bottom <= outer.bottom + tolerance
    && inner.left >= outer.left - tolerance;
}

test('SHOVE-roles-both-actors-and-targets: actor then enemy target moves only that enemy', async ({ page }) => {
  const { id } = await seedScenario({ cards: ['shove'], positions: dualShovePositions });
  await openScenario(page, id);

  await playCard(page, 'Shove');
  await expect(page.locator('.piece--actor')).toHaveCount(2);
  await expect(piece(page, 'ochre-a')).toHaveClass(/piece--actor/);
  await expect(piece(page, 'ochre-b')).toHaveClass(/piece--actor/);
  await expect(piece(page, 'indigo-a')).not.toHaveClass(/piece--target/);
  await expect(page.getByRole('status')).toContainText('Choose a highlighted friendly piece');

  await piece(page, 'ochre-a').click();
  await expect(page.getByRole('status')).toContainText('Choose a highlighted target');
  await expect(piece(page, 'indigo-a')).toHaveClass(/piece--target/);
  await expect(piece(page, 'indigo-b')).toHaveClass(/piece--target/);
  await expect(piece(page, 'ochre-b')).not.toHaveClass(/piece--target/);
  await piece(page, 'indigo-a').click();

  await expect(piece(page, 'ochre-a')).toHaveAttribute('data-position', '0,0');
  await expect(piece(page, 'indigo-a')).toHaveAttribute('data-position', '2,0');
  const saved = await loadSaved(id);
  expect(saved.state.pieces['ochre-a'].position).toEqual({ q: 0, r: 0 });
  expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 2, r: 0 });
  expect(saved.state.players.ochre.deck.play.map((card) => card.definitionId)).toEqual(['shove']);
});

for (const [index, direction] of directions.entries()) {
  test(`MOVE-direction-${index}: baseline move reaches direction ${direction.q},${direction.r}`, async ({ page }) => {
    const { id } = await seedScenario({ positions: remotePositions });
    await openScenario(page, id);
    await piece(page, 'ochre-a').click();
    await expect(hex(page, direction.q, direction.r)).toHaveClass(/hex--legal/);
    await hex(page, direction.q, direction.r).click();
    await expect(piece(page, 'ochre-a')).toHaveAttribute('data-position', `${direction.q},${direction.r}`);
    const saved = await loadSaved(id);
    expect(saved.state.pieces['ochre-a'].baselineMoves).toBe(0);
    expect(saved.state.pieces['ochre-b'].baselineMoves).toBe(1);
  });

  test(`DASH-direction-${index}: Dash reaches direction ${direction.q},${direction.r}`, async ({ page }) => {
    const { id } = await seedScenario({ cards: ['dash'], positions: remotePositions });
    await openScenario(page, id);
    await playCard(page, 'Dash');
    await piece(page, 'ochre-a').click();
    await hex(page, direction.q, direction.r).click();
    await expect(piece(page, 'ochre-a')).toHaveAttribute('data-position', `${direction.q},${direction.r}`);
    const saved = await loadSaved(id);
    expect(saved.state.pieces['ochre-a'].baselineMoves).toBe(1);
  });

  test(`VAULT-direction-${index}: Vault jumps in direction ${direction.q},${direction.r}`, async ({ page }) => {
    const landing = { q: direction.q * 2, r: direction.r * 2 };
    const positions = {
      'ochre-a': { q: 0, r: 0 },
      'ochre-b': { q: -2, r: 0 },
      'indigo-a': direction,
      'indigo-b': { q: 2, r: -2 }
    };
    if (`${landing.q},${landing.r}` === '2,-2') positions['indigo-b'] = { q: -2, r: 2 };
    if (`${landing.q},${landing.r}` === '-2,0') positions['ochre-b'] = { q: -2, r: 2 };
    const { id } = await seedScenario({ cards: ['vault'], positions });
    await openScenario(page, id);
    await playCard(page, 'Vault');
    await piece(page, 'ochre-a').click();
    await piece(page, 'indigo-a').click();
    await expect(piece(page, 'ochre-a')).toHaveAttribute('data-position', `${landing.q},${landing.r}`);
    expect((await loadSaved(id)).state.pieces['ochre-a'].baselineMoves).toBe(1);
  });

  test(`BLOCK-direction-${index}: Block places in direction ${direction.q},${direction.r}`, async ({ page }) => {
    const { id } = await seedScenario({ cards: ['block'], positions: remotePositions });
    await openScenario(page, id);
    await playCard(page, 'Block');
    await piece(page, 'ochre-a').click();
    await hex(page, direction.q, direction.r).click();
    const saved = await loadSaved(id);
    expect(saved.state.blocks).toContainEqual(expect.objectContaining({ ownerId: 'ochre', position: direction }));
  });
}

test('SHOVE-brace-and-blocked: Brace is consumed and occupied destinations are not offered', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['shove'],
    positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 1 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 1, r: 0 }
    },
    braced: ['indigo-a']
  });
  await openScenario(page, id);
  await playCard(page, 'Shove');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  const saved = await loadSaved(id);
  expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
  expect(saved.state.pieces['indigo-a'].braced).toBe(false);
});

test('SHOVE-ring-out: an edge shove scores one point and starts respawn next turn', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['shove'],
    positions: {
      'ochre-a': { q: 2, r: 0 }, 'ochre-b': { q: -2, r: 0 },
      'indigo-a': { q: 3, r: 0 }, 'indigo-b': { q: 1, r: -2 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Shove');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  await expect(page.getByLabel('Score')).toContainText('1');
  const saved = await loadSaved(id);
  expect(saved.state.scores).toEqual({ ochre: 1, indigo: 0 });
  expect(saved.state.pieces['indigo-a'].position).toBeNull();
  expect(saved.state.pieces['indigo-a'].needsRespawn).toBe(true);
});

test('BRACE-friendly-only: either friendly piece can be braced and enemies cannot be selected', async ({ page }) => {
  for (const actorId of ['ochre-a', 'ochre-b'] as const) {
    const { id } = await seedScenario({ cards: ['brace'], positions: remotePositions });
    await openScenario(page, id);
    await playCard(page, 'Brace');
    await expect(page.locator('.piece--actor')).toHaveCount(2);
    await expect(piece(page, 'indigo-a')).not.toHaveClass(/piece--actor|piece--target/);
    await expect(piece(page, 'indigo-b')).not.toHaveClass(/piece--actor|piece--target/);
    await piece(page, actorId).click();
    const saved = await loadSaved(id);
    expect(saved.state.pieces[actorId].braced).toBe(true);
    expect(saved.state.pieces[actorId === 'ochre-a' ? 'ochre-b' : 'ochre-a'].braced).toBe(false);
  }
});

test('CULL-other-card: Cull selects only a card in hand and updates all zones', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['cull', 'copper'], discardCards: ['silver'], playCards: ['gold'],
    aiCards: ['copper'], positions: remotePositions
  });
  await openScenario(page, id);
  await playCard(page, 'Cull');
  await expect(page.getByRole('button', { name: /^Copper, unavailable, legal Cull target/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Silver, unavailable, legal Cull target/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Gold, unavailable, legal Cull target/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Copper, unavailable, legal Cull target/ }).click();
  const saved = await loadSaved(id);
  expect(saved.state.trash.map((card) => card.definitionId)).toContain('copper');
  expect(saved.state.players.ochre.deck.play.map((card) => card.definitionId)).toEqual(['gold', 'cull']);
  expect(saved.state.players.ochre.deck.discard.map((card) => card.definitionId)).toContain('silver');
  await expect(page.getByText('Played', { exact: true }).locator('..')).toContainText('2');
  expect(saved.state.players.ochre.deck.hand).toEqual([]);
  await page.getByRole('button', { name: 'Enter buy phase' }).click();
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.getByText('Your action phase')).toBeVisible({ timeout: 15_000 });
  const cleaned = await loadSaved(id, 4);
  expect(cleaned.state.trash.map((card) => card.definitionId)).toEqual(['copper']);
  expect(cleaned.state.players.ochre.deck.play).toEqual([]);
  expect(cleaned.state.players.ochre.deck.hand).toHaveLength(5);
  expect(cleaned.state.players.ochre.deck.discard.map((card) => card.definitionId)).toEqual(expect.arrayContaining(['silver', 'gold', 'cull']));
});

test('CULL-self: Cull can trash itself with the explicit choice', async ({ page }) => {
  const { id } = await seedScenario({ cards: ['cull'], positions: remotePositions });
  await openScenario(page, id);
  await playCard(page, 'Cull');
  await page.getByRole('button', { name: /Trash Cull.*this Cull/ }).click();
  const saved = await loadSaved(id);
  expect(saved.state.trash.map((card) => card.definitionId)).toEqual(['cull']);
  expect(saved.state.players.ochre.deck.play).toEqual([]);
});

test('DRIVE-auto-follow: Drive pushes and follows as soon as the target is chosen', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['drive'],
    positions: {
      'ochre-a': { q: -2, r: 1 }, 'ochre-b': { q: 0, r: 1 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: -2, r: 0 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Drive');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-b').click();
  const saved = await loadSaved(id);
  expect(saved.state.pieces['ochre-a'].position).toEqual({ q: -2, r: 0 });
  expect(saved.state.pieces['indigo-b'].position).toEqual({ q: -2, r: -1 });
});

test('DRIVE-braced-no-follow: Drive does not follow when Brace cancels the push', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['drive'],
    braced: ['indigo-a'],
    positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 1 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 2, r: -1 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Drive');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  const saved = await loadSaved(id);
  expect(saved.state.pieces['ochre-a'].position).toEqual({ q: -1, r: 0 });
  expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
  expect(saved.state.pieces['indigo-a'].braced).toBe(false);
});

test('BREAKER-braced: Breaker removes Brace and still pushes', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['breaker'], braced: ['indigo-a'],
    positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 1 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 2, r: -1 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Breaker');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  const saved = await loadSaved(id);
  expect(saved.state.pieces['indigo-a'].braced).toBe(false);
  expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 1, r: 0 });
});

test('PRESS-setup: Press takes its earned second push and does not move the actor', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['press'], pressSetupPieceIds: ['indigo-a'],
    positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 1 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 2, r: -1 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Press');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  const saved = await loadSaved(id);
  expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 2, r: 0 });
  expect(saved.state.pieces['ochre-a'].position).toEqual({ q: -1, r: 0 });
});

test('PULL-exact-line: Pull selects an enemy two hexes away and moves it to the middle', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['pull'],
    positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 1 },
      'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: 2, r: -1 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Pull');
  await piece(page, 'ochre-a').click();
  await expect(piece(page, 'indigo-a')).toHaveClass(/piece--target/);
  await piece(page, 'indigo-a').click();
  const saved = await loadSaved(id);
  expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 0, r: 0 });
  expect(saved.state.pieces['ochre-a'].position).toEqual({ q: -1, r: 0 });
});

test('VAULT-friendly: Vault can jump over the other friendly piece', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['vault'],
    positions: {
      'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: 1, r: 0 },
      'indigo-a': { q: 0, r: -2 }, 'indigo-b': { q: -2, r: 2 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Vault');
  await piece(page, 'ochre-a').click();
  await page.getByRole('button', { name: 'Vault over piece B with piece A' }).click();
  expect((await loadSaved(id)).state.pieces['ochre-a'].position).toEqual({ q: 2, r: 0 });
});

test('SWEEP-directions: Sweep offers both rotations and resolves the chosen destination', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['sweep'],
    positions: {
      'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: -2, r: 0 },
      'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: 0, r: -2 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Sweep');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  await expect(page.locator('.hex--legal')).toHaveCount(2);
  await hex(page, 1, -1).click();
  expect((await loadSaved(id)).state.pieces['indigo-a'].position).toEqual({ q: 1, r: -1 });
});

test('RELAY-friendly-only: Relay confirms one swap and preserves statuses and moves', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['relay'], braced: ['ochre-b'], baselineMoves: { 'ochre-a': 0 },
    positions: remotePositions
  });
  await openScenario(page, id);
  await playCard(page, 'Relay');
  await expect(piece(page, 'indigo-a')).not.toHaveClass(/piece--actor|piece--target/);
  await expect(piece(page, 'indigo-b')).not.toHaveClass(/piece--actor|piece--target/);
  await page.getByRole('button', { name: 'Relay friendly pieces' }).click();
  const saved = await loadSaved(id);
  expect(saved.state.pieces['ochre-a'].position).toEqual(remotePositions['ochre-b']);
  expect(saved.state.pieces['ochre-b'].position).toEqual(remotePositions['ochre-a']);
  expect(saved.state.pieces['ochre-a'].baselineMoves).toBe(0);
  expect(saved.state.pieces['ochre-b'].braced).toBe(true);
});

test('BLOCK-replacement: the third Block asks which owned block to replace', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['block'], positions: remotePositions,
    blocks: [
      { id: 'old-1', ownerId: 'ochre', position: { q: -1, r: -1 }, clearAfterTurn: 2 },
      { id: 'old-2', ownerId: 'ochre', position: { q: -1, r: 1 }, clearAfterTurn: 2 }
    ]
  });
  await openScenario(page, id);
  await playCard(page, 'Block');
  await piece(page, 'ochre-a').click();
  await hex(page, 1, 0).click();
  await page.getByRole('button', { name: 'Block at -1,-1, legal replacement' }).click();
  const saved = await loadSaved(id);
  expect(saved.state.blocks).toHaveLength(2);
  expect(saved.state.blocks.some((block) => block.id === 'old-1')).toBe(false);
  expect(saved.state.blocks.some((block) => block.position.q === 1 && block.position.r === 0)).toBe(true);
});

for (const actorId of ['ochre-a', 'ochre-b'] as const) {
  test(`BLOCK-selection-order-${actorId}: replacement follows the exact actor and destination`, async ({ page }) => {
    const destination = actorId === 'ochre-a' ? { q: 1, r: 0 } : { q: -2, r: 1 };
    const replacedId = actorId === 'ochre-a' ? 'old-1' : 'old-2';
    const { id } = await seedScenario({
      cards: ['block'], positions: remotePositions,
      blocks: [
        { id: 'old-1', ownerId: 'ochre', position: { q: -1, r: -1 }, clearAfterTurn: 2 },
        { id: 'old-2', ownerId: 'ochre', position: { q: -1, r: 1 }, clearAfterTurn: 2 },
        { id: 'enemy', ownerId: 'indigo', position: { q: 1, r: -1 }, clearAfterTurn: 2 }
      ]
    });
    await openScenario(page, id);

    const replacement = page.locator(`[data-block-id="${replacedId}"]`);
    await replacement.dispatchEvent('click');
    await expect(page.getByText('Revision 0')).toBeVisible();
    expect((await loadSaved(id, 0)).revision).toBe(0);
    await playCard(page, 'Block');
    await replacement.dispatchEvent('click');
    await expect(page.getByText('Revision 0')).toBeVisible();
    expect((await loadSaved(id, 0)).revision).toBe(0);
    await piece(page, actorId).click();
    await replacement.dispatchEvent('click');
    await expect(page.getByText('Revision 0')).toBeVisible();
    expect((await loadSaved(id, 0)).revision).toBe(0);
    await expect(page.getByRole('button', { name: /legal replacement/ })).toHaveCount(0);

    await hex(page, destination.q, destination.r).click();
    await expect(page.getByRole('button', { name: /legal replacement/ })).toHaveCount(2);
    await expect(page.locator('[data-block-id="enemy"]')).not.toHaveAttribute('role', 'button');
    await replacement.click();

    const saved = await loadSaved(id);
    expect(saved.state.blocks.map((block) => ({ id: block.id, ownerId: block.ownerId, position: block.position })))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ ownerId: 'ochre', position: destination }),
        expect.objectContaining({ id: replacedId === 'old-1' ? 'old-2' : 'old-1' }),
        expect.objectContaining({ id: 'enemy', ownerId: 'indigo', position: { q: 1, r: -1 } })
      ]));
    expect(saved.state.blocks.some((block) => block.id === replacedId)).toBe(false);
    expect(saved.draft.commands).toEqual([
      expect.objectContaining({ type: 'playBlock', actorId, destination, replaceBlockId: replacedId })
    ]);
    expect(saved.state.events.at(-1)?.detail).toEqual({ position: destination, replaced: replacedId });
  });
}

test('VAULT-direct-actor-switch: a shared actor and target role never resolves prematurely', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['vault'], positions: {
      'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: 1, r: 0 },
      'indigo-a': { q: 0, r: -2 }, 'indigo-b': { q: -2, r: 2 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Vault');
  await piece(page, 'ochre-a').click();
  await piece(page, 'ochre-b').click();
  await expect(page.getByRole('status')).toContainText('Selected actor: piece B');
  expect((await loadSaved(id, 0)).revision).toBe(0);
  await page.getByRole('button', { name: 'Vault over piece A with piece B' }).click();
  const saved = await loadSaved(id);
  expect(saved.state.pieces['ochre-a'].position).toEqual({ q: 0, r: 0 });
  expect(saved.state.pieces['ochre-b'].position).toEqual({ q: -1, r: 0 });
  expect(saved.state.pieces['ochre-b'].baselineMoves).toBe(1);
});

test('PIN-enemy-only: Pin selects an adjacent enemy and prevents its next baseline move', async ({ page }) => {
  const { id } = await seedScenario({ cards: ['pin'], positions: dualShovePositions });
  await openScenario(page, id);
  await playCard(page, 'Pin');
  await piece(page, 'ochre-b').click();
  await expect(piece(page, 'ochre-a')).not.toHaveClass(/piece--target/);
  await piece(page, 'indigo-b').click();
  expect((await loadSaved(id)).state.pieces['indigo-b'].pinned).not.toBeNull();
});

test('CORNER-pinned: Corner uses a pre-pinned target for a second push', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['corner'], pinned: ['indigo-a'],
    positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -2, r: 1 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 2, r: -1 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Corner');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  expect((await loadSaved(id)).state.pieces['indigo-a'].position).toEqual({ q: 2, r: 0 });
});

test('SELECTION-all-cards: every playable card can be selected and deselected', async ({ page }) => {
  const names = ['Shove', 'Dash', 'Brace', 'Cull', 'Drive', 'Breaker', 'Press', 'Pull', 'Vault', 'Sweep', 'Relay', 'Block', 'Pin', 'Corner'];
  const { id } = await seedScenario({
    cards: names.map((name) => name.toLowerCase()),
    positions: {
      'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: -1, r: 1 },
      'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: 0, r: 2 }
    }
  });
  await openScenario(page, id);
  for (const name of names) {
    const card = page.getByRole('button', { name: new RegExp(`^${name}, playable`) });
    await card.click();
    await expect(card).toHaveClass(/card--selected/);
    await card.click();
    await expect(card).not.toHaveClass(/card--selected/);
  }
});

test('SELECTION-change-actor: changing the actor changes the exact legal enemy targets', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['shove'],
    positions: {
      'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -1, r: 2 },
      'indigo-a': { q: 0, r: 0 }, 'indigo-b': { q: 0, r: 1 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Shove');
  await piece(page, 'ochre-a').click();
  await expect(piece(page, 'indigo-a')).toHaveClass(/piece--target/);
  await expect(piece(page, 'indigo-b')).not.toHaveClass(/piece--target/);
  await piece(page, 'ochre-b').click();
  await expect(piece(page, 'indigo-b')).toHaveClass(/piece--target/);
  await expect(piece(page, 'indigo-a')).not.toHaveClass(/piece--target/);
});

test('ILLEGAL-cards-and-destinations: unavailable actions explain why and illegal hexes stay inert', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['shove', 'pull', 'vault', 'pin', 'corner', 'breaker', 'dash', 'block'],
    positions: {
      'ochre-a': { q: -2, r: 0 }, 'ochre-b': { q: 0, r: 2 },
      'indigo-a': { q: 2, r: -1 }, 'indigo-b': { q: 1, r: -2 }
    },
    blocks: [{ id: 'occupied', ownerId: 'indigo', position: { q: -1, r: 0 }, clearAfterTurn: 2 }]
  });
  await openScenario(page, id);
  for (const name of ['Shove', 'Pull', 'Vault', 'Pin', 'Corner', 'Breaker']) {
    const card = page.getByRole('button', { name: new RegExp(`^${name}, unavailable`) });
    await expect(card).toBeDisabled();
    await expect(card).toHaveAttribute('title', 'No complete legal action is available for this card.');
  }
  await piece(page, 'ochre-a').click();
  await expect(hex(page, -1, 0)).not.toHaveClass(/hex--legal/);
  await expect(hex(page, -4, 0)).toHaveCount(0);
  await hex(page, -1, 0).dispatchEvent('click');
  await expect(page.getByText('Revision 0')).toBeVisible();
  await piece(page, 'ochre-a').click();
  await playCard(page, 'Dash');
  await piece(page, 'ochre-a').click();
  await expect(hex(page, -1, 0)).not.toHaveClass(/hex--legal/);
  await expect(hex(page, -4, 0)).toHaveCount(0);
  await playCard(page, 'Block');
  await piece(page, 'ochre-a').click();
  await expect(hex(page, -1, 0)).not.toHaveClass(/hex--legal/);
  await expect(hex(page, -4, 0)).toHaveCount(0);
});

test('PIN-baseline-only: a pinned piece cannot baseline move but can use Dash', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['dash'], positions: remotePositions, pinned: ['ochre-a'], baselineMoves: { 'ochre-a': 0 }
  });
  await openScenario(page, id);
  await expect(piece(page, 'ochre-a')).not.toHaveClass(/piece--actor/);
  await playCard(page, 'Dash');
  await expect(piece(page, 'ochre-a')).toHaveClass(/piece--actor/);
  await piece(page, 'ochre-a').click();
  await hex(page, 1, 0).click();
  expect((await loadSaved(id)).state.pieces['ochre-a'].position).toEqual({ q: 1, r: 0 });
});

test('UNDO-and-reload: Undo restores exact state and reload preserves the current draft', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['dash', 'shove'], positions: dualShovePositions,
    braced: ['ochre-b'], pinned: ['indigo-b'], scores: { ochre: 1, indigo: 2 },
    blocks: [{ id: 'reload-block', ownerId: 'ochre', position: { q: -1, r: 0 }, clearAfterTurn: 2 }]
  });
  await openScenario(page, id);
  await playCard(page, 'Dash');
  await piece(page, 'ochre-a').click();
  await hex(page, 1, -1).click();
  await expect(piece(page, 'ochre-a')).toHaveAttribute('data-position', '1,-1');

  const renderedBefore = await renderedGameState(page);
  const persistedBefore = await loadSaved(id);
  await page.reload();
  await expect(page.getByText('Your action phase')).toBeVisible();
  expect(await renderedGameState(page)).toEqual(renderedBefore);
  const persistedAfter = await loadSaved(id);
  expect(persistedAfter.state).toEqual(persistedBefore.state);
  expect(persistedAfter.draft).toEqual(persistedBefore.draft);

  await playCard(page, 'Shove');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  await expect(piece(page, 'indigo-a')).toHaveAttribute('data-position', '1,1');
  await expect(page.getByText('Revision 2')).toBeVisible();
  await page.getByRole('button', { name: 'Undo action' }).click();
  await expect(page.getByText('Revision 3')).toBeVisible();
  const saved = await loadSaved(id, 3);
  expect(saved.state).toEqual(persistedBefore.state);
  expect(saved.draft.commands).toEqual(persistedBefore.draft.commands);
});

test('STALE-revision: a stale browser is rejected without corrupting the saved game', async ({ page, context }) => {
  const { id } = await seedScenario({ positions: remotePositions });
  await openScenario(page, id);
  const stale = await context.newPage();
  await openScenario(stale, id);
  await piece(page, 'ochre-a').click();
  await hex(page, 1, 0).click();
  await expect(piece(page, 'ochre-a')).toHaveAttribute('data-position', '1,0');
  await piece(stale, 'ochre-b').click();
  await hex(stale, -1, 0).click();
  await expect(stale.getByRole('alert')).toContainText('Expected revision 0, but current revision is 1');
  const saved = await loadSaved(id);
  expect(saved.state.pieces['ochre-a'].position).toEqual({ q: 1, r: 0 });
  expect(saved.state.pieces['ochre-b'].position).toEqual({ q: -2, r: 0 });
});

const marketCards = ['copper', 'silver', 'gold', 'shove', 'dash', 'brace', 'cull', 'drive', 'breaker', 'press', 'pull', 'vault', 'sweep', 'relay', 'block', 'pin', 'corner'];
for (const definitionId of marketCards) {
  test(`BUY-${definitionId}: purchases ${definitionId} into discard`, async ({ page }) => {
    const { id } = await seedScenario({ phase: 'buy', money: 99, buys: 1 });
    await openScenario(page, id, 'Your buy phase');
    await page.locator('.market-card').filter({ hasText: new RegExp(`^\\d+${definitionId}`, 'i') }).click();
    const saved = await loadSaved(id);
    expect(saved.state.players.ochre.deck.discard.map((card) => card.definitionId)).toContain(definitionId);
    expect(saved.state.supply[definitionId]).toBe((saved.initialState.supply[definitionId] ?? 0) - 1);
    expect(saved.state.players.ochre.buys).toBe(0);
  });
}

test('RESPAWN-anchors-and-fallback: only empty legal respawn hexes are selectable', async ({ page }) => {
  const anchors = await seedScenario({
    phase: 'respawn', positions: {
      'ochre-a': null, 'ochre-b': { q: 0, r: 1 },
      'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: 2, r: 0 }
    }
  });
  await openScenario(page, anchors.id, 'Your respawn phase');
  await expect(hex(page, -1, 0)).toHaveClass(/hex--legal/);
  await expect(hex(page, -1, 1)).toHaveClass(/hex--legal/);
  await expect(page.locator('.hex--legal')).toHaveCount(2);

  const fallback = await seedScenario({
    phase: 'respawn', positions: {
      'ochre-a': null, 'ochre-b': { q: -1, r: 1 },
      'indigo-a': { q: -1, r: 0 }, 'indigo-b': { q: 2, r: 0 }
    }
  });
  await openScenario(page, fallback.id, 'Your respawn phase');
  await expect(hex(page, -1, 0)).not.toHaveClass(/hex--legal/);
  await expect(hex(page, -1, 1)).not.toHaveClass(/hex--legal/);
  const fallbackHexes = await page.locator('.hex--legal').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-hex')).sort()
  );
  expect(fallbackHexes).toEqual(['-1,-1', '-1,2', '-2,0', '-2,1', '-2,2', '0,-1', '0,0', '0,1']);
  await hex(page, -2, 0).click();
  await expect(page.getByText('Your action phase')).toBeVisible();
  const saved = await loadSaved(fallback.id);
  expect(saved.state.pieces['ochre-a'].position).toEqual({ q: -2, r: 0 });
  expect(saved.state.pieces['ochre-a'].baselineMoves).toBe(1);
});

test('MATCH-END: the fifth point ends the match and disables all further work', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['shove'], scores: { ochre: 4, indigo: 0 },
    positions: {
      'ochre-a': { q: 2, r: 0 }, 'ochre-b': { q: -2, r: 0 },
      'indigo-a': { q: 3, r: 0 }, 'indigo-b': { q: 0, r: -2 }
    }
  });
  await openScenario(page, id);
  await playCard(page, 'Shove');
  await piece(page, 'ochre-a').click();
  await piece(page, 'indigo-a').click();
  await expect(page.getByText(/You win/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter buy phase' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'End turn' })).toHaveCount(0);
  await expect(page.locator('.market-card:enabled')).toHaveCount(0);
  await expect(page.getByText(/AI is choosing its turn/)).toHaveCount(0);
  const saved = await loadSaved(id);
  expect(saved.state.winner).toBe('ochre');
  expect(saved.state.phase).toBe('ended');
  expect(saved.state.scores.ochre).toBe(5);
  expect(saved.aiTurns).toEqual([]);
  expect(saved.state.events.some((event) => event.type === 'enterBuyPhase' || event.type === 'endTurn')).toBe(false);
});

test('AI-HANDOFF: progress is visible and the AI opening turn changes the board', async ({ page }) => {
  const { id } = await seedScenario({ cards: [], aiCards: ['copper'], positions: remotePositions });
  await openScenario(page, id);
  await page.getByRole('button', { name: 'Enter buy phase' }).click();
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.getByText(/AI is choosing its turn/)).toBeVisible();
  await expect(page.getByText('Your action phase')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.ai-summary')).toHaveText('AI: AI made 1 baseline move. AI bought copper.');
  const saved = await loadSaved(id, 3);
  const moved = (['indigo-a', 'indigo-b'] as const).some((pieceId) =>
    JSON.stringify(saved.state.pieces[pieceId].position) !== JSON.stringify(saved.initialState.pieces[pieceId].position)
  );
  expect(moved).toBe(true);
  expect(saved.aiTurns.at(-1)?.summary).toBe('AI made 1 baseline move. AI bought copper.');
  const aiCommands = saved.committedCommands.slice(-4);
  expect(aiCommands.some((command) => command.type === 'baselineMove')).toBe(true);
  expect(aiCommands).toContainEqual({ type: 'buyCard', definitionId: 'copper' });
  expect(aiCommands.at(-1)).toEqual({ type: 'endTurn' });
});

const undoPositions = {
  'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: -1, r: 1 },
  'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: 0, r: 2 }
};

const undoCards = ['shove', 'dash', 'brace', 'cull', 'drive', 'breaker', 'press', 'pull', 'vault', 'sweep', 'relay', 'block', 'pin', 'corner'];
for (const mechanic of undoCards) {
  test(`UNDO-${mechanic}: Undo restores the exact pre-${mechanic} view`, async ({ page }) => {
    const cards = mechanic === 'cull' ? ['cull', 'copper'] : [mechanic];
    const { id } = await seedScenario({ cards, positions: undoPositions });
    await openScenario(page, id);
    await performCard(page, mechanic);
    await expect(page.getByText('Revision 1')).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Choose a card');
    await expect(page.locator('.card--selected')).toHaveCount(0);
    await expect(page.locator('.piece--target, .piece--selected')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo action' }).click();
    await expect(page.getByText('Revision 2')).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Choose a card');
    await expect(page.locator('.card--selected')).toHaveCount(0);
    await expect(page.locator('.piece--target, .piece--selected')).toHaveCount(0);
    const saved = await loadSaved(id, 2);
    expect(saved.state).toEqual(saved.initialState);
  });
}

async function performCard(page: import('@playwright/test').Page, mechanic: string): Promise<void> {
  const name = mechanic[0]!.toUpperCase() + mechanic.slice(1);
  await playCard(page, name);
  switch (mechanic) {
    case 'shove':
    case 'breaker':
    case 'press':
    case 'pin':
    case 'corner':
      await piece(page, 'ochre-a').click();
      await piece(page, 'indigo-a').click();
      return;
    case 'dash':
      await piece(page, 'ochre-a').click();
      await hex(page, 0, -1).click();
      return;
    case 'brace':
      await piece(page, 'ochre-b').click();
      return;
    case 'cull':
      await page.getByRole('button', { name: /^Copper, unavailable, legal Cull target/ }).click();
      return;
    case 'drive':
      await piece(page, 'ochre-a').click();
      await piece(page, 'indigo-a').click();
      return;
    case 'pull':
      await piece(page, 'ochre-a').click();
      await piece(page, 'indigo-b').click();
      return;
    case 'vault':
      await piece(page, 'ochre-a').click();
      await piece(page, 'indigo-a').click();
      return;
    case 'sweep':
      await piece(page, 'ochre-a').click();
      await piece(page, 'indigo-a').click();
      await hex(page, 1, -1).click();
      return;
    case 'relay':
      await page.getByRole('button', { name: 'Relay friendly pieces' }).click();
      return;
    case 'block':
      await piece(page, 'ochre-a').click();
      await hex(page, 0, -1).click();
  }
}

async function renderedGameState(page: import('@playwright/test').Page) {
  const pieces = await page.locator('[data-piece-id]').evaluateAll((elements) => elements.map((element) => ({
    id: element.getAttribute('data-piece-id'),
    position: element.getAttribute('data-position'),
    ownerId: element.getAttribute('data-owner-id'),
    braced: element.getAttribute('data-braced'),
    pinned: element.getAttribute('data-pinned'),
    baselineMoves: element.getAttribute('data-baseline-moves')
  })).sort((left, right) => String(left.id).localeCompare(String(right.id))));
  const blocks = await page.locator('[data-block-id]').evaluateAll((elements) => elements.map((element) => ({
    id: element.getAttribute('data-block-id'),
    position: element.getAttribute('data-position'),
    ownerId: element.getAttribute('data-owner-id')
  })).sort((left, right) => String(left.id).localeCompare(String(right.id))));
  const hand = await page.locator('.hand-panel [data-card-instance-id]').evaluateAll((elements) => elements.map((element) => ({
    id: element.getAttribute('data-card-instance-id'),
    name: element.getAttribute('data-card-name'),
    label: element.getAttribute('aria-label')
  })).sort((left, right) => String(left.id).localeCompare(String(right.id))));
  const history = await page.locator('[data-event-sequence]').evaluateAll((elements) => elements.map((element) => ({
    sequence: element.getAttribute('data-event-sequence'),
    type: element.getAttribute('data-event-type'),
    text: element.textContent?.trim() ?? ''
  })));
  return {
    pieces,
    blocks,
    hand,
    history,
    phase: (await page.locator('.turn-banner').textContent())?.trim(),
    score: (await page.getByLabel('Score').textContent())?.replace(/\s+/g, ' ').trim(),
    instruction: (await page.getByRole('status').textContent())?.replace(/\s+/g, ' ').trim()
  };
}
