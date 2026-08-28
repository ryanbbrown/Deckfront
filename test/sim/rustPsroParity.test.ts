import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { rustPsroParityFixture as fixture } from '../fixtures/rustPsroParity';
import { solveEquilibrium, SUPPORT_TOLERANCE } from '../../src/sim/equilibrium';
import { stableHash } from '../../src/sim/strategy';
import { classifyConfirmation, classifyThreshold, orderConfirmedQueue,
  weightedFairSchedule } from '../../src/sim/thresholdRacingPsro';

function identity(number: number, rank: number) {
  return { goldfishRank: rank, strategyId: `gf-${number}`, canonicalStrategy: String(number) };
}

function raceSeeds(race: (typeof fixture.races)[number], used: Set<number>): number[] {
  const maximum = race.kind === 'screen' ? 512 : 6_400;
  const seeds: number[] = [];
  for (let position = 0; position < maximum; position += 1) {
    let nonce = 0;
    while (true) {
      const preimage = `rust-psro-v1:${fixture.kingdom}:${fixture.reservoirCrc}:${fixture.initialPairsCrc}`
        + `:${race.search}:${race.kind}:${race.race}:${position}:nonce:${nonce}`;
      const seed = Number.parseInt(stableHash(preimage).slice(0, 8), 16) >>> 0;
      if (!used.has(seed)) { used.add(seed); seeds.push(seed); break; }
      nonce += 1;
    }
  }
  return seeds;
}

function scheduleDigest(race: (typeof fixture.races)[number], used: Set<number>): string {
  const ids = race.numbers.map((number) => `gf-${number}`);
  const weights = Object.fromEntries(ids.map((id, index) => [id, race.weights[index]!]));
  const numericTieKeys = Object.fromEntries(ids.flatMap((id, index) =>
    race.weights[index]! > 0 ? [[id, race.numbers[index]!]] : []));
  const schedule = weightedFairSchedule(weights, raceSeeds(race, used), numericTieKeys);
  const bytes = Buffer.alloc(race.depth * 8);
  schedule.blocks.slice(0, race.depth).forEach((block, index) => {
    bytes.writeUInt32LE(block.seed, index * 8);
    bytes.writeUInt32LE(Number(block.opponentId.slice(3)), index * 8 + 4);
  });
  return createHash('sha256').update(bytes).digest('hex');
}

function scores(hex: string): number[] {
  return Array.from(Buffer.from(hex, 'hex'), (value) => value / 4);
}

describe('Rust PSRO fixture parity', () => {
  it('matches every persisted numeric opponent schedule', () => {
    const used = new Set([4_100_000, 4_100_001, 4_100_002, 4_100_003]);
    for (let seed = 4_200_001; seed <= 4_200_125; seed += 1) used.add(seed);
    expect(fixture.races.map((race) => scheduleDigest(race, used)))
      .toEqual(fixture.races.map((race) => race.scheduleSha256));
  });

  it('matches every terminal confidence decision and confirmation family', () => {
    const calculated = fixture.decisions.map((decision) => {
      const values = scores(decision.scores);
      const alpha = decision.kind === 'screen' ? 0.05 : 0.05 / decision.familySize;
      const held = decision.kind === 'screen'
        ? classifyThreshold(identity(decision.number, decision.rank), values, alpha)
        : classifyConfirmation(identity(decision.number, decision.rank), values, alpha);
      const status = held.status === 'unresolved' ? 0
        : held.status === 'below' || held.status === 'rejected' ? 1 : 2;
      expect(Math.abs(held.mean - decision.mean)).toBeLessThanOrEqual(Number.EPSILON);
      expect(Math.abs(held.interval.lower - decision.lower)).toBeLessThanOrEqual(2 ** -20);
      expect(Math.abs(held.interval.upper - decision.upper)).toBeLessThanOrEqual(2 ** -20);
      expect(status).toBe(decision.status);
      return { decision, held };
    });

    for (const family of fixture.confirmationFamilies) {
      if (family.kind === 'confirmation') {
        const derived = fixture.decisions.filter((decision) => decision.kind === 'screen'
          && decision.search === family.search && decision.status === 2)
          .sort((left, right) => left.rank - right.rank).map((decision) => decision.number);
        expect(derived).toEqual(family.numbers);
      } else {
        const admission = fixture.admissions.find((entry) => entry.search === family.search)!;
        const rank = new Map(fixture.decisions.map((decision) => [decision.number, decision.rank]));
        const derived = admission.queue.slice(1).sort((left, right) => rank.get(left)! - rank.get(right)!);
        expect(derived).toEqual(family.numbers);
      }
    }
    expect(calculated).toHaveLength(fixture.decisions.length);
  });

  it('matches admission order and final support', () => {
    for (const admission of fixture.admissions) {
      const confirmed = fixture.decisions.filter((decision) => decision.kind === 'confirmation'
        && decision.search === admission.search && decision.status === 2).map((decision) => {
        const values = scores(decision.scores);
        return classifyConfirmation(identity(decision.number, decision.rank), values,
          0.05 / decision.familySize);
      });
      expect(orderConfirmedQueue(confirmed).orderedStrategyIds.map((id) => Number(id.slice(3))))
        .toEqual(admission.queue);
      expect(admission.candidate).toBe(admission.queue[0]);
    }

    const ids = fixture.finalNumbers.map((number) => `gf-${number}`);
    const payoff = fixture.finalPercentages.map((row) => row.map((value) => (value - 50) / 50));
    const result = solveEquilibrium(ids, payoff);
    expect(ids.filter((id) => result.weights[id]! > SUPPORT_TOLERANCE)).toEqual(['gf-10681409']);
    expect(result.maximumKnownAdvantage).toBeLessThanOrEqual(1e-6);
  });
});
