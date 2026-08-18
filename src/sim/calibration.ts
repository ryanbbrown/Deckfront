/**
 * The one hard gate in `GOAL.md`. `rigged-melee` sells Heavy Blow for 3 and deals 6 with it, so a
 * search that works must find it. Its threshold, its kingdom, and its strategies must never be tuned
 * to make it pass: a failure here is a result to record, not a defect to repair.
 */

export const CALIBRATION_CARD_ID = 'heavyBlow';

export interface CalibrationInput {
  // Last generation's leaders only, in rank order, excluding the fixed seeds.
  finalLeaders: readonly { strategyId: string; rank: number }[];
  // definition id -> copies acquired, summed over every match the strategy played.
  // Acquisition is starting build plus purchases. Agendas are not acquisitions.
  acquisitionsByStrategy: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface CalibrationResult {
  passed: boolean;
  topStrategyId: string;
  topStrategyCopies: number;
  leadersWhoAcquired: number;
  leaderCount: number;
}

/**
 * Passes when the top final leader acquired at least one Heavy Blow, or when at least 80 percent of
 * the final leaders did.
 *
 * Acquisition is the starting build plus purchases, never purchases alone. Heavy Blow costs 3 here,
 * so a strong melee leader can put three copies in its 12-money starting build and satisfy its
 * agenda before the first Buy phase. Counting purchases would report a blocker for exactly the
 * behaviour this gate exists to confirm.
 *
 * The threshold is integer arithmetic, so the result cannot turn on float rounding. The caller owns
 * the leader set: it must hold the last generation's leaders only, with the fixed seeds excluded
 * from both the numerator and the denominator, because most fixed seeds cannot acquire
 * Heavy Blow and any wider reading makes the 80 percent branch unreachable.
 */
export function checkRiggedMelee(input: CalibrationInput): CalibrationResult {
  if (!input.finalLeaders.length) {
    throw new Error('The rigged-melee calibration check needs at least one final leader.');
  }
  const copies = (strategyId: string): number =>
    input.acquisitionsByStrategy[strategyId]?.[CALIBRATION_CARD_ID] ?? 0;

  // `strategyId` is the stable hash of the canonical strategy form, so equal ranks break the same
  // way leader selection breaks them and the gate stays deterministic.
  let top = input.finalLeaders[0]!;
  for (const leader of input.finalLeaders) {
    if (leader.rank < top.rank || (leader.rank === top.rank && leader.strategyId < top.strategyId)) top = leader;
  }

  const leaderCount = input.finalLeaders.length;
  const leadersWhoAcquired = input.finalLeaders.filter((leader) => copies(leader.strategyId) > 0).length;
  const topStrategyCopies = copies(top.strategyId);
  return {
    passed: topStrategyCopies > 0 || leadersWhoAcquired * 10 >= leaderCount * 8,
    topStrategyId: top.strategyId,
    topStrategyCopies,
    leadersWhoAcquired,
    leaderCount
  };
}
