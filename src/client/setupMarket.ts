import type { RandomIndexSource } from '../game';

function signature(cardIds: readonly string[]): string { return [...cardIds].sort().join('|'); }

export function chooseTrainedVariableCards(
  random: RandomIndexSource, cardSets: readonly (readonly string[])[], current: readonly string[] = []
): string[] {
  if (!cardSets.length) throw new Error('Setup has no trained kingdoms.');
  const currentSignature = signature(current);
  const choices = cardSets.filter((cardIds) => signature(cardIds) !== currentSignature);
  const selectable = choices.length ? choices : cardSets;
  return [...selectable[random.nextInt(selectable.length)]!];
}
