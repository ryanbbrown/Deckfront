import { describe, expect, it } from 'vitest';
import { chooseTrainedVariableCards } from '../src/client/setupMarket';

const first = ['a','b','c','d','e','f','g','h','i','j'];
const second = ['k','l','m','n','o','p','q','r','s','t'];

describe('trained setup market selection', () => {
  it('chooses a complete trained set and excludes the current set independent of order', () => {
    const random = { nextInt: () => 0 };

    expect(chooseTrainedVariableCards(random, [first, second])).toEqual(first);
    expect(chooseTrainedVariableCards(random, [first, second], [...first].reverse())).toEqual(second);
  });
});
