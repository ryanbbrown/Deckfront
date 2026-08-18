/**
 * The five curated kingdoms the balance search runs, in the order `.plans/10-5-kingdoms.md` states
 * them. `distance-duel` is the browser default and is deliberately absent: it is a shipped market,
 * not an experiment kingdom. The data itself lives in `src/game-data/kingdoms.json`, so every one of
 * these ids is registered before this module loads.
 */
export const CURATED_KINGDOM_IDS: readonly string[] = Object.freeze([
  'current-duel', 'three-way-open', 'three-way-engine', 'range-rich-mixed', 'rigged-melee'
]);

/** The one calibration fixture. Its Heavy Blow override is not a proposed card value. */
export const CALIBRATION_KINGDOM_ID = 'rigged-melee';
