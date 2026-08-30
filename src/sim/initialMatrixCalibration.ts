import { nativeRuleFingerprint } from './nativeGoldfishProtocol';
import {
  CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION, CURRENT_ORDERED_PRODUCT_VERSION,
  ORDERED_PRODUCT_SPACE_COUNT, createCurrentOrderedProductMembershipValidator,
  deriveCurrentOrderedProductIdentity, orderedProductSeedsValid, orderedProductTarget,
  validateOrderedProductRankedRecord
} from './orderedGoldfishProduct';
import type { OrderedProductReservoirArtifact } from './orderedGoldfishProduct';
import type { Strategy } from './strategy';

export interface OrderedCalibrationRankedHeader {
  schemaVersion: number;
  version: string;
  runId: string;
  buildVersion: string;
  ruleFingerprint: string;
  scorerVersion: string;
  config: {
    kingdomId: string;
    candidateCount: number;
    retainedCount: number;
    reservoirCount: number;
    seeds: number[];
    turnLimit: number;
    actionCapPerTurn: number;
  };
  candidateSpace: { provenanceDigest: string };
  productIdentity?: ReturnType<typeof deriveCurrentOrderedProductIdentity>;
  recordCount: number;
}

export interface InitialMatrixSourceIdentity {
  kingdomId: string;
  rankedSha256: string;
  reservoirSha256: string;
  runId: string;
  productVersion: string;
  buildVersion: string;
  scorerVersion: string;
  ruleFingerprint: string;
  candidateProvenanceDigest: string;
}

function exact(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function validSha256(value: string): boolean { return /^[0-9a-f]{64}$/.test(value); }

interface OrderedCalibrationSourceInput {
  kingdomId: string;
  ranked: unknown;
  reservoir: unknown;
  rankedSha256: string;
  reservoirSha256: string;
}

export function validateOrderedCalibrationSourceForCounts(input: OrderedCalibrationSourceInput,
  counts: { retainedCount: number; reservoirCount: number; strategyCount: number }
): { source: InitialMatrixSourceIdentity; strategies: Strategy[] } {
  if (!Number.isSafeInteger(counts.retainedCount) || counts.retainedCount < 1
    || !Number.isSafeInteger(counts.reservoirCount) || counts.reservoirCount < counts.strategyCount
    || counts.reservoirCount > counts.retainedCount || !Number.isSafeInteger(counts.strategyCount)
    || counts.strategyCount < 1) throw new Error('Ordered calibration source counts are invalid.');
  if (!validSha256(input.rankedSha256) || !validSha256(input.reservoirSha256)
    || !input.ranked || typeof input.ranked !== 'object' || !input.reservoir || typeof input.reservoir !== 'object') {
    throw new Error('Ordered calibration source hashes or artifacts are invalid.');
  }
  const ranked = input.ranked as OrderedCalibrationRankedHeader;
  const reservoir = input.reservoir as OrderedProductReservoirArtifact;
  const expectedRules = nativeRuleFingerprint(input.kingdomId, 30, 200);
  let sourceIdentityValid = false;
  if (ranked.schemaVersion === 1) {
    try {
      const target = orderedProductTarget(input.kingdomId);
      sourceIdentityValid = ranked.version === target.version
        && orderedProductSeedsValid(ranked.config.seeds)
        && ranked.candidateSpace?.provenanceDigest === target.candidateProvenanceDigest;
    } catch { sourceIdentityValid = false; }
  } else if (ranked.schemaVersion === CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION && ranked.productIdentity) {
    try {
      const expected = deriveCurrentOrderedProductIdentity({ kingdomId: input.kingdomId,
        seeds: ranked.config.seeds, scorerVersion: ranked.scorerVersion, buildVersion: ranked.buildVersion });
      sourceIdentityValid = ranked.version === CURRENT_ORDERED_PRODUCT_VERSION
        && exact(ranked.productIdentity, expected)
        && ranked.candidateSpace?.provenanceDigest === expected.candidateProvenanceDigest;
    } catch { sourceIdentityValid = false; }
  }
  if (!sourceIdentityValid || ranked.config?.kingdomId !== input.kingdomId
    || ranked.config.candidateCount !== ORDERED_PRODUCT_SPACE_COUNT
    || ranked.config.retainedCount !== counts.retainedCount
    || ranked.recordCount !== ranked.config.retainedCount || ranked.config.reservoirCount !== counts.reservoirCount
    || ranked.config.turnLimit !== 30 || ranked.config.actionCapPerTurn !== 200 || ranked.ruleFingerprint !== expectedRules
    || reservoir.schemaVersion !== ranked.schemaVersion || reservoir.version !== ranked.version
    || reservoir.productIdentityHash !== ranked.productIdentity?.identityHash || reservoir.runId !== ranked.runId
    || reservoir.sourceArtifactSha256 !== input.rankedSha256 || reservoir.reservoirCount !== counts.reservoirCount
    || !Array.isArray(reservoir.entries) || reservoir.entries.length !== counts.reservoirCount) {
    throw new Error('Ordered calibration source metadata, rules, or 20,000-entry reservoir is stale or invalid.');
  }
  const currentMembership = ranked.schemaVersion === CURRENT_ORDERED_PRODUCT_SCHEMA_VERSION
    ? createCurrentOrderedProductMembershipValidator(ranked.productIdentity!) : undefined;
  const ids = new Set<string>();
  const canonicals = new Set<string>();
  for (let index = 0; index < reservoir.entries.length; index += 1) {
    const entry = reservoir.entries[index]!;
    if (!validateOrderedProductRankedRecord(entry) || currentMembership && !currentMembership(entry)
      || entry.rank !== index + 1 || ids.has(entry.strategy.id) || canonicals.has(entry.canonicalStrategy)) {
      throw new Error(`Ordered calibration reservoir entry ${index + 1} is invalid or out of order.`);
    }
    ids.add(entry.strategy.id);
    canonicals.add(entry.canonicalStrategy);
  }
  return {
    source: {
      kingdomId: input.kingdomId, rankedSha256: input.rankedSha256,
      reservoirSha256: input.reservoirSha256, runId: ranked.runId,
      productVersion: ranked.version, buildVersion: ranked.buildVersion,
      scorerVersion: ranked.scorerVersion, ruleFingerprint: ranked.ruleFingerprint,
      candidateProvenanceDigest: ranked.candidateSpace.provenanceDigest
    },
    strategies: reservoir.entries.slice(0, counts.strategyCount).map((entry) => structuredClone(entry.strategy))
  };
}
