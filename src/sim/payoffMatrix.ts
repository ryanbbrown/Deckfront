import { kingdomMarket } from '../game';
import { emptyAggregate, mergeAggregate } from './pairing';
import type { PairingBlockResult } from './pairing';
import type { PairingRunner } from './pairingRunner';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';
import type { TelemetryAggregate } from './types';

export const MATRIX_PROTOCOL_VERSION = 'four-orientations-v1';

export interface MatrixProtocol {
  kingdomId: string;
  cards: unknown;
  seeds: number[];
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  stateLimit: number;
  orientationProtocol: string;
}

export interface MatrixCell {
  rowId: string;
  columnId: string;
  key: string;
  blocks: PairingBlockResult[];
  complete: boolean;
  centeredPayoff: number;
  matches: number;
  telemetry: TelemetryAggregate;
}

export interface MatrixSnapshot {
  protocol: MatrixProtocol;
  strategies: Strategy[];
  cells: MatrixCell[];
  complete: boolean;
  centeredPayoffs: number[][];
}

export type MatrixCellCache = Map<string, MatrixCell>;
export function createMatrixCellCache(): MatrixCellCache { return new Map(); }

export class InvalidEvaluationError extends Error {
  constructor(message: string, readonly detail: Record<string, unknown>) { super(message); }
}

export function matrixProtocol(
  kingdomId: string, seeds: readonly number[], turnLimitPerPlayer: number, actionCapPerTurn: number,
  stateLimit: number
): MatrixProtocol {
  return {
    kingdomId,
    cards: kingdomMarket(kingdomId).map((card) => card),
    seeds: [...seeds], turnLimitPerPlayer, actionCapPerTurn, stateLimit,
    orientationProtocol: MATRIX_PROTOCOL_VERSION
  };
}

function pairKey(protocol: MatrixProtocol, left: Strategy, right: Strategy): string {
  return stableHash(JSON.stringify({ protocol, strategies: [canonicalStrategy(left), canonicalStrategy(right)] }));
}

function payoff(blocks: readonly PairingBlockResult[]): number {
  const games = blocks.reduce((sum, block) => sum + block.played, 0);
  const score = blocks.reduce((sum, block) => sum + block.score * block.played, 0);
  return games ? 2 * score / games - 1 : 0;
}

export class PayoffMatrix {
  private readonly strategies = new Map<string, Strategy>();
  readonly telemetry = emptyAggregate();
  matches = 0;

  constructor(
    readonly protocol: MatrixProtocol, private readonly runner: PairingRunner,
    private readonly cells: MatrixCellCache = createMatrixCellCache()
  ) {}

  addStrategy(strategy: Strategy): void {
    const previous = this.strategies.get(strategy.id);
    if (previous && canonicalStrategy(previous) !== canonicalStrategy(strategy)) {
      throw new Error(`Strategy id collision for ${strategy.id}.`);
    }
    this.strategies.set(strategy.id, strategy);
  }

  entrants(): Strategy[] { return [...this.strategies.values()].sort((a, b) => a.id.localeCompare(b.id)); }

  private cellId(leftId: string, rightId: string): string {
    return leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
  }

  async fillPair(leftInput: Strategy, rightInput: Strategy, allowEarlyStop: boolean, deadline?: number): Promise<void> {
    this.addStrategy(leftInput); this.addStrategy(rightInput);
    if (leftInput.id === rightInput.id) return;
    const [left, right] = leftInput.id < rightInput.id ? [leftInput, rightInput] : [rightInput, leftInput];
    const id = this.cellId(left.id, right.id);
    const old = this.cells.get(id);
    const playedSeeds = new Set(old?.blocks.map((block) => block.seed) ?? []);
    const seeds = this.protocol.seeds.filter((seed) => !playedSeeds.has(seed));
    if (!seeds.length) return;
    const batch = await this.runner.run([{ candidate: left, opponent: right, options: {
      kingdomId: this.protocol.kingdomId, seeds,
      turnLimitPerPlayer: this.protocol.turnLimitPerPlayer,
      actionCapPerTurn: this.protocol.actionCapPerTurn,
      stateLimit: this.protocol.stateLimit,
      allowEarlyStop
    } }], { deadline });
    const result = batch.outcomes[0];
    if (!result) throw new InvalidEvaluationError('Deadline interrupted a matrix cell.', { left: left.id, right: right.id });
    if (result.record.aborted > 0) {
      const bad = result.aborts[0];
      throw new InvalidEvaluationError('An aborted match invalidated a matrix cell.', {
        left: left.id, right: right.id, seed: bad?.seed,
        orientation: bad?.orientationIndex, reason: bad?.reason
      });
    }
    const blocks = [...(old?.blocks ?? []), ...result.blocks].sort((a, b) =>
      this.protocol.seeds.indexOf(a.seed) - this.protocol.seeds.indexOf(b.seed));
    const telemetry = old?.telemetry ?? emptyAggregate();
    mergeAggregate(telemetry, result.telemetry);
    this.matches += result.matches;
    mergeAggregate(this.telemetry, result.telemetry);
    this.cells.set(id, {
      rowId: left.id, columnId: right.id, key: pairKey(this.protocol, left, right), blocks,
      complete: blocks.length === this.protocol.seeds.length,
      centeredPayoff: payoff(blocks), matches: (old?.matches ?? 0) + result.matches, telemetry
    });
  }

  async fillAll(allowEarlyStop: boolean, deadline?: number): Promise<void> {
    const entrants = this.entrants();
    for (let row = 0; row < entrants.length; row += 1) {
      for (let column = row + 1; column < entrants.length; column += 1) {
        await this.fillPair(entrants[row]!, entrants[column]!, allowEarlyStop, deadline);
      }
    }
  }

  async addRow(strategy: Strategy, allowEarlyStop: boolean, deadline?: number): Promise<void> {
    const previous = this.entrants();
    this.addStrategy(strategy);
    for (const opponent of previous) await this.fillPair(strategy, opponent, allowEarlyStop, deadline);
  }

  async topUpAll(deadline?: number): Promise<void> { await this.fillAll(false, deadline); }

  snapshot(): MatrixSnapshot {
    const strategies = this.entrants();
    const centeredPayoffs = strategies.map((row) => strategies.map((column) => {
      if (row.id === column.id) return 0;
      const cell = this.cells.get(this.cellId(row.id, column.id));
      if (!cell) return Number.NaN;
      return row.id === cell.rowId ? cell.centeredPayoff : -cell.centeredPayoff;
    }));
    const ids = new Set(strategies.map((strategy) => strategy.id));
    const cells = [...this.cells.values()].filter((cell) => ids.has(cell.rowId) && ids.has(cell.columnId))
      .sort((a, b) => a.rowId.localeCompare(b.rowId)
      || a.columnId.localeCompare(b.columnId));
    return {
      protocol: this.protocol, strategies, cells,
      complete: cells.length === strategies.length * (strategies.length - 1) / 2
        && cells.every((cell) => cell.complete),
      centeredPayoffs
    };
  }
}
