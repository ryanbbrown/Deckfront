import { afterEach, beforeEach, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { mixtureSchedule } from '../../src/sim/mixtureEvaluation';
import { nativeCompetitiveModalInput } from '../../src/sim/nativeCompetitiveProtocol';
import { fixedBuyPlan, identify } from '../../src/sim/strategy';

const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-007')!;
beforeEach(() => registerKingdom(kingdom));
afterEach(() => resetKingdoms());

it('builds a candidate-first deterministic Modal look input', () => {
  const strategy = (cardId: string) => identify({ id: '', startingBuild: [],
    buyPlan: fixedBuyPlan([{ kind: 'buy', cardId, desiredCount: 2 }]) });
  const resident = [strategy('focus'), strategy('step'), strategy('strike')];
  const candidates = [resident[2]!, resident[0]!];
  const schedule = mixtureSchedule({ [resident[1]!.id]: 1 }, [101, 102], 99);
  const value = nativeCompetitiveModalInput(kingdom, candidates, resident, schedule,
    { kingdomId: kingdom.id, turnLimitPerPlayer: 30, actionCapPerTurn: 200,
      startingDraftEnabled: false }, 4, 4, 'screen-8');
  expect(value.candidateCount).toBe(2);
  expect(value.loadRequest.payload.strategies.map((entry) => entry.id)).toEqual(
    [resident[2]!.id, resident[0]!.id, resident[1]!.id]);
  expect(value.schedule).toEqual([{ seed: 101, opponentIndex: 2 }, { seed: 102, opponentIndex: 2 }]);
  expect(value.inputHash).toMatch(/^[0-9a-f]{64}$/);
  expect(nativeCompetitiveModalInput(kingdom, candidates, resident, schedule,
    { kingdomId: kingdom.id, turnLimitPerPlayer: 30, actionCapPerTurn: 200,
      startingDraftEnabled: false }, 4, 4, 'screen-8')).toEqual(value);
});
