import { describe, expect, it } from 'vitest';
import type { SetupBattlefield } from '../src/shared/api';
import {
  barePlayUrl, battlefieldRangeError, battlefieldUrl, chooseBattlefield, findBattlefieldByCards,
  findBattlefieldByNumber, parsePlayRoute
} from '../src/client/setupMarket';

const first = { number: 1, variableCardIds: ['a','b','c','d','e','f','g','h','i','j'] };
const second = { number: 42, variableCardIds: ['k','l','m','n','o','p','q','r','s','t'] };
const battlefields: SetupBattlefield[] = [first, second];

describe('battlefield selection', () => {
  it('chooses a battlefield and excludes the current number', () => {
    const random = { nextInt: () => 0 };
    expect(chooseBattlefield(random, battlefields)).toBe(first);
    expect(chooseBattlefield(random, battlefields, 1)).toBe(second);
    expect(chooseBattlefield(random, [first], 1)).toBe(first);
    expect(() => chooseBattlefield(random, [])).toThrow('Setup has no battlefields.');
  });

  it('looks up exact numbers and order-independent card signatures', () => {
    expect(findBattlefieldByNumber(battlefields, 42)).toBe(second);
    expect(findBattlefieldByNumber(battlefields, 2)).toBeNull();
    expect(findBattlefieldByCards(battlefields, [...first.variableCardIds].reverse())).toBe(first);
    expect(findBattlefieldByCards(battlefields, ['a', 'a'])).toBeNull();
    expect(findBattlefieldByCards(battlefields, ['not', 'a', 'battlefield'])).toBeNull();
  });

  it.each(['/play', '/play/'])('parses %s as bare play', (pathname) => {
    expect(parsePlayRoute(pathname, battlefields)).toEqual({ kind: 'bare' });
  });

  it.each([
    ['/play/42', true],
    ['/play/042', false],
    ['/play/42/', false],
    ['/play/042/', false]
  ])('accepts and reports canonicalization for %s', (pathname, canonical) => {
    expect(parsePlayRoute(pathname, battlefields)).toEqual({ kind: 'battlefield', battlefield: second, canonical });
  });

  it.each([
    '/play/0', '/play/2', '/play/999', '/play/+42', '/play/-42', '/play/42.0', '/play//',
    '/play/42/more', '/play/999999999999999999999999999999999999'
  ])('rejects malformed or unavailable play route %s', (pathname) => {
    expect(parsePlayRoute(pathname, battlefields)).toEqual({ kind: 'invalid' });
  });

  it.each(['/somewhere', '/playground', '/rules/more'])('treats %s as a fallback path', (pathname) => {
    expect(parsePlayRoute(pathname, battlefields)).toEqual({ kind: 'fallback' });
  });

  it('builds canonical URLs without losing the query string or hash', () => {
    const location = { pathname: '/play/042/', search: '?showInstructions=1', hash: '#market' };
    expect(battlefieldUrl(42, location)).toBe('/play/42?showInstructions=1#market');
    expect(barePlayUrl(location)).toBe('/play?showInstructions=1#market');
    expect(battlefieldRangeError(160)).toBe('Battlefield number must be from 1 to 160.');
  });
});
