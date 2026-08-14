import { expect, hex, loadSaved, openScenario, piece, playCard, seedScenario, test } from './fixture';

const directions = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
];

test('MOVE-piece-b-directions: piece B baseline moves through all six directions', async ({ context }) => {
  for (const destination of directions) {
    const { id } = await seedScenario({ positions: centeredB() });
    const page = await context.newPage();
    await openScenario(page, id);
    await piece(page, 'ochre-b').click();
    await hex(page, destination.q, destination.r).click();
    await expect(piece(page, 'ochre-b')).toHaveAttribute('data-position', `${destination.q},${destination.r}`);
    await page.close();
  }
});

test('DASH-piece-b-directions: piece B Dashes through all six directions', async ({ context }) => {
  for (const destination of directions) {
    const { id } = await seedScenario({ cards: ['dash'], positions: centeredB() });
    const page = await context.newPage();
    await openScenario(page, id);
    await playCard(page, 'Dash');
    await piece(page, 'ochre-b').click();
    await hex(page, destination.q, destination.r).click();
    await expect(piece(page, 'ochre-b')).toHaveAttribute('data-position', `${destination.q},${destination.r}`);
    await page.close();
  }
});

test('VAULT-piece-b-directions: piece B Vaults through all six directions', async ({ context }) => {
  for (const direction of directions) {
    const landing = { q: direction.q * 2, r: direction.r * 2 };
    const positions: Record<string, { q: number; r: number }> = {
      'ochre-b': { q: 0, r: 0 }, 'ochre-a': { q: -2, r: 0 },
      'indigo-a': direction, 'indigo-b': { q: 2, r: -2 }
    };
    if (landing.q === -2 && landing.r === 0) positions['ochre-a'] = { q: -2, r: 2 };
    if (landing.q === 2 && landing.r === -2) positions['indigo-b'] = { q: -2, r: 2 };
    const { id } = await seedScenario({ cards: ['vault'], positions });
    const page = await context.newPage();
    await openScenario(page, id);
    await playCard(page, 'Vault');
    await piece(page, 'ochre-b').click();
    await piece(page, 'indigo-a').click();
    await expect(piece(page, 'ochre-b')).toHaveAttribute('data-position', `${landing.q},${landing.r}`);
    await page.close();
  }
});

test('BLOCK-piece-b-directions: piece B places a Block through all six directions', async ({ context }) => {
  for (const destination of directions) {
    const { id } = await seedScenario({ cards: ['block'], positions: centeredB() });
    const page = await context.newPage();
    await openScenario(page, id);
    await playCard(page, 'Block');
    await piece(page, 'ochre-b').click();
    await hex(page, destination.q, destination.r).click();
    const saved = await loadSaved(id);
    expect(saved.state.blocks[0]?.position).toEqual(destination);
    await page.close();
  }
});

test('MOVE-then-DASH: baseline movement and card movement interleave through the UI', async ({ page }) => {
  const { id } = await seedScenario({ cards: ['dash'], positions: {
    'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: -2, r: 0 },
    'indigo-a': { q: 0, r: -2 }, 'indigo-b': { q: 2, r: -2 }
  } });
  await openScenario(page, id);
  await piece(page, 'ochre-a').click();
  await hex(page, 1, 0).click();
  await playCard(page, 'Dash');
  await piece(page, 'ochre-a').click();
  await hex(page, 0, 0).click();
  const saved = await loadSaved(id, 2);
  expect(saved.state.pieces['ochre-a'].position).toEqual({ q: 0, r: 0 });
  expect(saved.state.pieces['ochre-a'].baselineMoves).toBe(0);
});

test('PUSH-CARDS-all-actor-target-pairs: target cards use every friendly actor and enemy target', async ({ context }) => {
  for (const mechanic of ['shove', 'drive', 'breaker', 'press', 'pin', 'corner', 'sweep']) {
    for (const actorId of ['ochre-a', 'ochre-b'] as const) {
      for (const targetId of ['indigo-a', 'indigo-b'] as const) {
        const initial = dualTargets();
        const expectedTarget = mechanic === 'pin'
          ? initial[targetId]!
          : mechanic === 'sweep'
            ? sweepDestination(actorId, targetId)
            : pushDestination(actorId, targetId);
        const { id } = await seedScenario({ cards: [mechanic], positions: initial });
        const page = await context.newPage();
        await openScenario(page, id);
        await playCard(page, capitalize(mechanic));
        await piece(page, actorId).click();
        await expect(piece(page, targetId)).toHaveClass(/piece--target/);
        await piece(page, targetId).click();
        if (mechanic === 'sweep') await hex(page, expectedTarget.q, expectedTarget.r).click();
        const saved = await loadSaved(id);
        const otherActor = actorId === 'ochre-a' ? 'ochre-b' : 'ochre-a';
        const otherTarget = targetId === 'indigo-a' ? 'indigo-b' : 'indigo-a';
        expect(saved.state.pieces[actorId].position).toEqual(
          mechanic === 'drive' ? initial[targetId] : initial[actorId]
        );
        expect(saved.state.pieces[otherActor].position).toEqual(initial[otherActor]);
        expect(saved.state.pieces[targetId].position).toEqual(expectedTarget);
        expect(saved.state.pieces[otherTarget].position).toEqual(initial[otherTarget]);
        expect(saved.state.pieces[targetId].pinned === null).toBe(mechanic !== 'pin');
        expect(saved.state.pieces[otherTarget].pinned).toBeNull();
        expect(saved.state.scores).toEqual({ ochre: 0, indigo: 0 });
        expect(saved.state.players.ochre.deck.play.map((card) => card.definitionId)).toEqual([mechanic]);
        expect(saved.draft.commands).toEqual([
          expect.objectContaining({ type: `play${capitalize(mechanic)}`, actorId, targetId })
        ]);
        const cardEvent = saved.state.events.find((event) => event.type === 'cardPlayed');
        expect(cardEvent?.detail).toMatchObject({ definitionId: mechanic });
        if (mechanic === 'pin') {
          expect(saved.state.events.at(-1)?.type).toBe('pin');
          expect(saved.state.events.at(-1)?.detail).toMatchObject({ pieceId: targetId });
        } else if (mechanic === 'drive') {
          expect(saved.state.events.at(-2)?.type).toBe('displacement');
          expect(saved.state.events.at(-2)?.detail).toMatchObject({ pieceId: targetId, to: expectedTarget });
          expect(saved.state.events.at(-1)?.type).toBe('follow');
          expect(saved.state.events.at(-1)?.detail).toMatchObject({ pieceId: actorId, to: initial[targetId] });
        } else {
          expect(saved.state.events.at(-1)?.type).toBe('displacement');
          expect(saved.state.events.at(-1)?.detail).toMatchObject({ pieceId: targetId, to: expectedTarget });
        }
        await page.close();
      }
    }
  }
});

test('PULL-all-actor-target-pairs: either friendly actor pulls either enemy target', async ({ context }) => {
  for (const actorId of ['ochre-a', 'ochre-b'] as const) {
    for (const targetId of ['indigo-a', 'indigo-b'] as const) {
      const otherActor = actorId === 'ochre-a' ? 'ochre-b' : 'ochre-a';
      const otherTarget = targetId === 'indigo-a' ? 'indigo-b' : 'indigo-a';
      const { id } = await seedScenario({
        cards: ['pull'], positions: {
          [actorId]: { q: 0, r: 0 }, [otherActor]: { q: -2, r: 0 },
          [targetId]: { q: 2, r: 0 }, [otherTarget]: { q: 0, r: -2 }
        }
      });
      const page = await context.newPage();
      await openScenario(page, id);
      await playCard(page, 'Pull');
      await piece(page, actorId).click();
      await piece(page, targetId).click();
      const saved = await loadSaved(id);
      expect(saved.state.pieces[targetId].position).toEqual({ q: 1, r: 0 });
      expect(saved.state.pieces[actorId].position).toEqual({ q: 0, r: 0 });
      expect(saved.state.pieces[otherActor].position).toEqual({ q: -2, r: 0 });
      expect(saved.state.pieces[otherTarget].position).toEqual({ q: 0, r: -2 });
      await page.close();
    }
  }
});

test('SWEEP-all-actor-target-pairs: Sweep keeps actor and enemy target roles separate', async ({ context }) => {
  for (const actorId of ['ochre-a', 'ochre-b'] as const) {
    for (const targetId of ['indigo-a', 'indigo-b'] as const) {
      const { id } = await seedScenario({ cards: ['sweep'], positions: dualTargets() });
      const page = await context.newPage();
      await openScenario(page, id);
      await playCard(page, 'Sweep');
      await piece(page, actorId).click();
      await piece(page, targetId).click();
      await page.locator('.hex--legal').first().click();
      expect((await loadSaved(id)).state.pieces[actorId].position).toEqual(dualTargets()[actorId]);
      await page.close();
    }
  }
});

test('VAULT-illegal-patterns: empty, occupied, off-board, and bent jumps are unavailable', async ({ context }) => {
  const cases = [
    centeredB(),
    { 'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: -2, r: 0 }, 'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: 2, r: 0 } },
    { 'ochre-a': { q: 2, r: 0 }, 'ochre-b': { q: -2, r: 0 }, 'indigo-a': { q: 3, r: 0 }, 'indigo-b': { q: 0, r: -2 } },
    { 'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: -2, r: 0 }, 'indigo-a': { q: 1, r: 1 }, 'indigo-b': { q: 2, r: -2 } }
  ];
  for (const positions of cases) {
    const { id } = await seedScenario({ cards: ['vault'], positions });
    const page = await context.newPage();
    await openScenario(page, id);
    await expect(page.getByRole('button', { name: /^Vault, unavailable/ })).toBeDisabled();
    await page.close();
  }
});

test('RELAY-distance-one: Relay swaps adjacent friendly pieces', async ({ page }) => {
  const { id } = await seedScenario({ cards: ['relay'], positions: dualTargets() });
  await openScenario(page, id);
  await playCard(page, 'Relay');
  await page.getByRole('button', { name: 'Relay friendly pieces' }).click();
  const saved = await loadSaved(id);
  expect(saved.state.pieces['ochre-a'].position).toEqual(dualTargets()['ochre-b']);
});

test('BLOCK-never-replace-opponent: the limit replaces only owned blocks', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['block'], positions: centeredB(),
    blocks: [
      { id: 'own-1', ownerId: 'ochre', position: { q: -1, r: -1 }, clearAfterTurn: 2 },
      { id: 'own-2', ownerId: 'ochre', position: { q: -1, r: 2 }, clearAfterTurn: 2 },
      { id: 'enemy', ownerId: 'indigo', position: { q: 1, r: 1 }, clearAfterTurn: 2 }
    ]
  });
  await openScenario(page, id);
  await playCard(page, 'Block');
  await piece(page, 'ochre-b').click();
  await hex(page, 1, 0).click();
  await expect(page.getByRole('button', { name: /Block at 1,1, legal replacement/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Block at -1,-1, legal replacement/ }).click();
  expect((await loadSaved(id)).state.blocks.some((block) => block.id === 'enemy')).toBe(true);
});

function centeredB(): Record<string, { q: number; r: number }> {
  return {
    'ochre-a': { q: -2, r: 0 }, 'ochre-b': { q: 0, r: 0 },
    'indigo-a': { q: 0, r: -2 }, 'indigo-b': { q: 2, r: -2 }
  };
}

function dualTargets(): Record<string, { q: number; r: number }> {
  return {
    'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: 0, r: 1 },
    'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: -1, r: 1 }
  };
}

function capitalize(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}

function pushDestination(actorId: 'ochre-a' | 'ochre-b', targetId: 'indigo-a' | 'indigo-b') {
  return {
    'ochre-a:indigo-a': { q: 2, r: 0 },
    'ochre-a:indigo-b': { q: -2, r: 2 },
    'ochre-b:indigo-a': { q: 2, r: -1 },
    'ochre-b:indigo-b': { q: -2, r: 1 }
  }[`${actorId}:${targetId}`]!;
}

function sweepDestination(actorId: 'ochre-a' | 'ochre-b', targetId: 'indigo-a' | 'indigo-b') {
  return {
    'ochre-a:indigo-a': { q: 1, r: -1 },
    'ochre-a:indigo-b': { q: -1, r: 0 },
    'ochre-b:indigo-a': { q: 1, r: 1 },
    'ochre-b:indigo-b': { q: -1, r: 2 }
  }[`${actorId}:${targetId}`]!;
}
