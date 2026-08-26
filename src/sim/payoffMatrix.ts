import { kingdomMarket } from '../game';
import { emptyAggregate, mergeAggregate } from './pairing';
import type { SeedEvaluationResult, PairingOutcome } from './pairing';
import type { PairingJob, PairingRunner } from './pairingRunner';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';
import type { TelemetryAggregate } from './types';
import { rulesFingerprint } from './rulesFingerprint';
export { MATRIX_PROTOCOL_VERSION } from './protocolVersions';
import { MATRIX_PROTOCOL_VERSION } from './protocolVersions';


export interface MatrixProtocol {
  kingdomId: string;
  cards: unknown;
  seeds: number[];
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  startingDraftEnabled: boolean;
  orientationProtocol: string;
  rulesFingerprint: string;
}

export interface MatrixCell {
  rowId: string;
  columnId: string;
  key: string;
  blocks: SeedEvaluationResult[];
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

interface PendingCell {
  left: Strategy;
  right: Strategy;
  id: string;
  old: MatrixCell | undefined;
  job: PairingJob;
}

export class InvalidEvaluationError extends Error {
  constructor(message: string, readonly detail: Record<string, unknown>) { super(message); }
}

export class DeadlineInterruptionError extends Error {
  constructor(message: string, readonly detail: Record<string, unknown>) { super(message); }
}

export function matrixProtocol(
  kingdomId: string, seeds: readonly number[], turnLimitPerPlayer: number, actionCapPerTurn: number,
  startingDraftEnabled = true
): MatrixProtocol {
  const fingerprint = rulesFingerprint(
    kingdomId, turnLimitPerPlayer, actionCapPerTurn, startingDraftEnabled
  );
  return {
    kingdomId,
    cards: kingdomMarket(kingdomId).map((card) => card),
    seeds: [...seeds], turnLimitPerPlayer, actionCapPerTurn, startingDraftEnabled,
    orientationProtocol: MATRIX_PROTOCOL_VERSION, rulesFingerprint: fingerprint.hash
  };
}

export function payoffMatrixPairKey(protocol: MatrixProtocol, left: Strategy, right: Strategy): string {
  return stableHash(JSON.stringify({ protocol, strategies: [canonicalStrategy(left), canonicalStrategy(right)] }));
}

function payoff(blocks: readonly SeedEvaluationResult[]): number {
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

  private cellId(left: Strategy, right: Strategy): string {
    const [first, second] = left.id < right.id ? [left, right] : [right, left];
    return `${payoffMatrixPairKey(this.protocol, first, second)}:${first.id}|${second.id}`;
  }

  private pendingCell(leftInput: Strategy, rightInput: Strategy, allowEarlyStop: boolean): PendingCell | null {
    this.addStrategy(leftInput); this.addStrategy(rightInput);
    if (leftInput.id === rightInput.id) return null;
    const [left, right] = leftInput.id < rightInput.id ? [leftInput, rightInput] : [rightInput, leftInput];
    const id = this.cellId(left, right);
    const old = this.cells.get(id);
    const playedSeeds = new Set(old?.blocks.map((block) => block.seed) ?? []);
    const seeds = this.protocol.seeds.filter((seed) => !playedSeeds.has(seed));
    if (!seeds.length) return null;
    return { left, right, id, old, job: { candidate: left, opponent: right, options: {
      kingdomId: this.protocol.kingdomId, seeds,
      turnLimitPerPlayer: this.protocol.turnLimitPerPlayer,
      actionCapPerTurn: this.protocol.actionCapPerTurn,
      startingDraftEnabled: this.protocol.startingDraftEnabled,
      allowEarlyStop
    } } };
  }

  private storeResult(pending: PendingCell, result: PairingOutcome): void {
    const { left, right, id, old } = pending;
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
      rowId: left.id, columnId: right.id, key: payoffMatrixPairKey(this.protocol, left, right), blocks,
      complete: blocks.length === this.protocol.seeds.length,
      centeredPayoff: payoff(blocks), matches: (old?.matches ?? 0) + result.matches, telemetry
    });
  }

  private async fillPending(pending: readonly PendingCell[], deadline?: number): Promise<void> {
    if (!pending.length) return;
    const batch = await this.runner.run(pending.map((entry) => entry.job), { deadline });
    for (let index = 0; index < pending.length; index += 1) {
      const entry = pending[index]!;
      const result = batch.outcomes[index];
      if (!result) throw new DeadlineInterruptionError('Deadline interrupted a matrix cell.', {
        left: entry.left.id, right: entry.right.id,
        phase: entry.job.options.allowEarlyStop ? 'preliminary-matrix' : 'matrix-top-up'
      });
      this.storeResult(entry, result);
    }
  }

  async fillPair(left: Strategy, right: Strategy, allowEarlyStop: boolean, deadline?: number): Promise<void> {
    const pending = this.pendingCell(left, right, allowEarlyStop);
    await this.fillPending(pending ? [pending] : [], deadline);
  }

  async fillAll(allowEarlyStop: boolean, deadline?: number): Promise<void> {
    const entrants = this.entrants();
    const pending: PendingCell[] = [];
    for (let row = 0; row < entrants.length; row += 1) {
      for (let column = row + 1; column < entrants.length; column += 1) {
        const cell = this.pendingCell(entrants[row]!, entrants[column]!, allowEarlyStop);
        if (cell) pending.push(cell);
      }
    }
    await this.fillPending(pending, deadline);
  }

  async addRow(strategy: Strategy, allowEarlyStop: boolean, deadline?: number): Promise<void> {
    const previous = this.entrants();
    this.addStrategy(strategy);
    const pending = previous.flatMap((opponent) => {
      const cell = this.pendingCell(strategy, opponent, allowEarlyStop);
      return cell ? [cell] : [];
    });
    await this.fillPending(pending, deadline);
  }

  async topUpAll(deadline?: number): Promise<void> { await this.fillAll(false, deadline); }

  snapshot(): MatrixSnapshot {
    const strategies = this.entrants();
    const centeredPayoffs = strategies.map((row) => strategies.map((column) => {
      if (row.id === column.id) return 0;
      const cell = this.cells.get(this.cellId(row, column));
      if (!cell) return Number.NaN;
      return row.id === cell.rowId ? cell.centeredPayoff : -cell.centeredPayoff;
    }));
    const byId = new Map(strategies.map((strategy) => [strategy.id, strategy]));
    const cells = [...this.cells.values()].filter((cell) => {
      const row = byId.get(cell.rowId), column = byId.get(cell.columnId);
      return row && column && cell.key === payoffMatrixPairKey(this.protocol, row, column);
    })
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
