import type { Page } from '@playwright/test';
import type { PieceId } from '../../src/game';
import { expect, hex, loadSaved, openScenario, piece, playCard, seedScenario, test } from './fixture';

interface ActorLimitScenario {
  mechanic: string;
  name: string;
  positions?: Record<string, { q: number; r: number }>;
  playFirst: (page: Page) => Promise<void>;
  playSecond: (page: Page) => Promise<void>;
}

const dualTargets = {
  'ochre-a': { q: 0, r: 0 },
  'ochre-b': { q: 0, r: 1 },
  'indigo-a': { q: 1, r: 0 },
  'indigo-b': { q: -1, r: 1 }
};

const pullTargets = {
  'ochre-a': { q: 0, r: 0 },
  'ochre-b': { q: 0, r: 1 },
  'indigo-a': { q: 2, r: 0 },
  'indigo-b': { q: -2, r: 1 }
};

const targetCards = ['shove', 'drive', 'breaker', 'press', 'pin', 'corner'].map((mechanic) => ({
  mechanic,
  name: capitalize(mechanic),
  playFirst: (page: Page) => actorTarget(page, 'ochre-a', 'indigo-a'),
  playSecond: (page: Page) => actorTarget(page, 'ochre-b', 'indigo-b')
}));

const actorLimitScenarios: ActorLimitScenario[] = [
  ...targetCards,
  {
    mechanic: 'pull', name: 'Pull', positions: pullTargets,
    playFirst: (page) => actorTarget(page, 'ochre-a', 'indigo-a'),
    playSecond: (page) => actorTarget(page, 'ochre-b', 'indigo-b')
  },
  {
    mechanic: 'sweep', name: 'Sweep',
    playFirst: async (page) => {
      await actorTarget(page, 'ochre-a', 'indigo-a');
      await hex(page, 1, -1).click();
    },
    playSecond: async (page) => {
      await actorTarget(page, 'ochre-b', 'indigo-b');
      await hex(page, -1, 2).click();
    }
  },
  {
    mechanic: 'block', name: 'Block',
    playFirst: async (page) => {
      await piece(page, 'ochre-a').click();
      await hex(page, 0, -1).click();
    },
    playSecond: async (page) => {
      await piece(page, 'ochre-b').click();
      await hex(page, 1, 1).click();
    }
  },
  {
    mechanic: 'dash', name: 'Dash',
    playFirst: async (page) => {
      await piece(page, 'ochre-a').click();
      await hex(page, 1, -1).click();
    },
    playSecond: async (page) => {
      await piece(page, 'ochre-b').click();
      await hex(page, 1, 1).click();
    }
  },
  {
    mechanic: 'vault', name: 'Vault',
    playFirst: (page) => actorTarget(page, 'ochre-a', 'indigo-a'),
    playSecond: (page) => actorTarget(page, 'ochre-b', 'indigo-b')
  },
  {
    mechanic: 'brace', name: 'Brace',
    playFirst: async (page) => { await piece(page, 'ochre-a').click(); },
    playSecond: async (page) => { await piece(page, 'ochre-b').click(); }
  }
];

for (const scenario of actorLimitScenarios) {
  test(`ACTION-LIMIT-${scenario.mechanic.toUpperCase()}: ${scenario.name} uses each friendly piece once`, async ({ page }) => {
    const { id } = await seedScenario({
      cards: [scenario.mechanic, scenario.mechanic],
      positions: scenario.positions ?? dualTargets
    });
    await openScenario(page, id);

    await selectDuplicate(page, scenario.name);
    await scenario.playFirst(page);
    const afterFirst = await loadSaved(id, 1);
    expect(afterFirst.state.turn.actionUses).toEqual([
      { pieceId: 'ochre-a', definitionId: scenario.mechanic }
    ]);

    await selectDuplicate(page, scenario.name);
    await expect(piece(page, 'ochre-a')).not.toHaveClass(/piece--actor/);
    await expect(piece(page, 'ochre-b')).toHaveClass(/piece--actor/);
    await scenario.playSecond(page);

    const afterSecond = await loadSaved(id, 2);
    expect(afterSecond.state.turn.actionUses).toEqual([
      { pieceId: 'ochre-a', definitionId: scenario.mechanic },
      { pieceId: 'ochre-b', definitionId: scenario.mechanic }
    ]);
    expect(afterSecond.state.players.ochre.deck.play.map((card) => card.definitionId)).toEqual([
      scenario.mechanic, scenario.mechanic
    ]);
  });
}

test('ACTION-LIMIT-NO-ACTOR: a duplicate explains when no legal piece remains', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['shove', 'shove'],
    positions: {
      'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: -2, r: 0 },
      'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: 0, r: 1 }
    }
  });
  await openScenario(page, id);
  await selectDuplicate(page, 'Shove');
  await actorTarget(page, 'ochre-a', 'indigo-a');

  const duplicate = page.getByRole('button', { name: 'Shove, unavailable' });
  await expect(duplicate).toBeDisabled();
  await expect(duplicate).toContainText('No legal piece remains for Shove this turn.');
});

test('ACTION-LIMIT-RELAY: Relay is available only once during a turn', async ({ page }) => {
  const { id } = await seedScenario({ cards: ['relay', 'relay'], positions: dualTargets });
  await openScenario(page, id);
  await selectDuplicate(page, 'Relay');
  await page.getByRole('button', { name: 'Relay friendly pieces' }).click();

  const duplicate = page.getByRole('button', { name: 'Relay, unavailable' });
  await expect(duplicate).toBeDisabled();
  await expect(duplicate).toContainText('Relay was already used this turn.');
  expect((await loadSaved(id, 1)).state.turn.relayUsed).toBe(true);
});

test('ACTION-LIMIT-CULL: duplicate Cull cards remain unrestricted', async ({ page }) => {
  const { id } = await seedScenario({ cards: ['cull', 'cull', 'copper', 'silver'], positions: dualTargets });
  await openScenario(page, id);

  await selectDuplicate(page, 'Cull');
  await page.getByRole('button', { name: /^Copper, unavailable, legal Cull target/ }).click();
  await selectDuplicate(page, 'Cull');
  await page.getByRole('button', { name: /^Silver, unavailable, legal Cull target/ }).click();

  const saved = await loadSaved(id, 2);
  expect(saved.state.players.ochre.deck.play.map((card) => card.definitionId)).toEqual(['cull', 'cull']);
  expect(saved.state.trash.map((card) => card.definitionId)).toEqual(['copper', 'silver']);
  expect(saved.state.turn.actionUses).toEqual([]);
});

test('ACTION-LIMIT-DRIVE-RELAY-DRIVE: Relay gives the other piece the second Drive', async ({ page }) => {
  const { id } = await seedScenario({
    cards: ['drive', 'relay', 'drive'],
    positions: {
      'ochre-a': { q: 0, r: 0 }, 'ochre-b': { q: -1, r: 0 },
      'indigo-a': { q: 1, r: 0 }, 'indigo-b': { q: 0, r: -2 }
    }
  });
  await openScenario(page, id);

  await selectDuplicate(page, 'Drive');
  await actorTarget(page, 'ochre-a', 'indigo-a');
  await playCard(page, 'Relay');
  await page.getByRole('button', { name: 'Relay friendly pieces' }).click();
  await selectDuplicate(page, 'Drive');
  await expect(piece(page, 'ochre-a')).not.toHaveClass(/piece--actor/);
  await expect(piece(page, 'ochre-b')).toHaveClass(/piece--actor/);
  await actorTarget(page, 'ochre-b', 'indigo-a');

  const saved = await loadSaved(id, 3);
  expect(saved.state.pieces['ochre-a'].position).toEqual({ q: -1, r: 0 });
  expect(saved.state.pieces['ochre-b'].position).toEqual({ q: 2, r: 0 });
  expect(saved.state.pieces['indigo-a'].position).toEqual({ q: 3, r: 0 });
  expect(saved.state.turn.actionUses).toEqual([
    { pieceId: 'ochre-a', definitionId: 'drive' },
    { pieceId: 'ochre-b', definitionId: 'drive' }
  ]);
  expect(saved.state.turn.relayUsed).toBe(true);
});

async function selectDuplicate(page: Page, name: string): Promise<void> {
  await page.locator(`[data-card-name="${name}"]`).first().click();
}

async function actorTarget(page: Page, actorId: PieceId, targetId: PieceId): Promise<void> {
  await piece(page, actorId).click();
  await piece(page, targetId).click();
}

function capitalize(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}
