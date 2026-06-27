export interface Rng {
  nextInt(maxExclusive: number): number;
}

export class SeededRng implements Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  static fromState(state: number): SeededRng {
    return new SeededRng(state);
  }

  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0) {
      throw new Error('maxExclusive must be positive');
    }
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return Math.floor((this.state / 0x100000000) * maxExclusive);
  }

  snapshot(): number {
    return this.state;
  }
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.nextInt(index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex] as T, next[index] as T];
  }
  return next;
}
