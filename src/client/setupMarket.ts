import type { RandomIndexSource } from '../game';
import type { SetupBattlefield } from '../shared/api';

export type PlayRoute =
  | { kind: 'bare' }
  | { kind: 'battlefield'; battlefield: SetupBattlefield; canonical: boolean }
  | { kind: 'invalid' }
  | { kind: 'fallback' };

interface LocationParts { pathname: string; search: string; hash: string }

function signature(cardIds: readonly string[]): string { return [...cardIds].sort().join('|'); }

export function findBattlefieldByNumber(
  battlefields: readonly SetupBattlefield[], number: number
): SetupBattlefield | null {
  return battlefields.find((battlefield) => battlefield.number === number) ?? null;
}

export function findBattlefieldByCards(
  battlefields: readonly SetupBattlefield[], cardIds: readonly string[]
): SetupBattlefield | null {
  if (!cardIds.length || new Set(cardIds).size !== cardIds.length) return null;
  const heldSignature = signature(cardIds);
  return battlefields.find((battlefield) => signature(battlefield.variableCardIds) === heldSignature) ?? null;
}

export function chooseBattlefield(
  random: RandomIndexSource, battlefields: readonly SetupBattlefield[], currentNumber: number | null = null
): SetupBattlefield {
  if (!battlefields.length) throw new Error('Setup has no battlefields.');
  const choices = battlefields.filter((battlefield) => battlefield.number !== currentNumber);
  const selectable = choices.length ? choices : battlefields;
  return selectable[random.nextInt(selectable.length)]!;
}

export function parsePlayRoute(pathname: string, battlefields: readonly SetupBattlefield[]): PlayRoute {
  if (pathname === '/play' || pathname === '/play/') return { kind: 'bare' };
  const match = /^\/play\/(\d+)\/?$/u.exec(pathname);
  if (match) {
    const number = Number(match[1]);
    const battlefield = Number.isSafeInteger(number) ? findBattlefieldByNumber(battlefields, number) : null;
    return battlefield ? { kind: 'battlefield', battlefield, canonical: pathname === `/play/${number}` } : { kind: 'invalid' };
  }
  return pathname.startsWith('/play/') ? { kind: 'invalid' } : { kind: 'fallback' };
}

export function battlefieldUrl(number: number, location: Pick<LocationParts, 'search' | 'hash'>): string {
  return `/play/${number}${location.search}${location.hash}`;
}

export function barePlayUrl(location: Pick<LocationParts, 'search' | 'hash'>): string {
  return `/play${location.search}${location.hash}`;
}

export function battlefieldRangeError(count: number): string {
  return `Battlefield number must be from 1 to ${count}.`;
}
