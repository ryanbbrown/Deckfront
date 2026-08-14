export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error('Maximum must be a positive integer.');
    }
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return Math.floor((this.state / 0x100000000) * maxExclusive);
  }

  snapshot(): number {
    return this.state;
  }
}

export function shuffle<T>(items: readonly T[], random: SeededRandom): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = random.nextInt(index + 1);
    const current = shuffled[index];
    const replacement = shuffled[swapIndex];
    if (current === undefined || replacement === undefined) throw new Error('Invalid shuffle index.');
    shuffled[index] = replacement;
    shuffled[swapIndex] = current;
  }
  return shuffled;
}
