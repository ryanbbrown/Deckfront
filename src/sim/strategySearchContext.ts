import type { Kingdom } from '../game';
import {
  candidateIndexAt, createOrderedCandidateSpace, orderedGoldfishCardIds
} from './orderedGoldfishBenchmark';
import type { OrderedCandidateSpace } from './orderedGoldfishBenchmark';
import type { Strategy } from './strategy';
import { strategySearchKingdom } from './strategySearchKingdoms';

export interface StrategySearchContext {
  kingdomId: string;
  kingdom: Kingdom;
  candidateSpace: OrderedCandidateSpace;
  strategyAt(position: number): Strategy;
}

export function createStrategySearchContext(kingdomId: string): StrategySearchContext {
  const kingdom = strategySearchKingdom(kingdomId);
  const candidateSpace = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
  return Object.freeze({ kingdomId, kingdom, candidateSpace,
    strategyAt: (position: number) => candidateSpace.candidateAt(
      candidateIndexAt(position, candidateSpace.candidateCount)) });
}
