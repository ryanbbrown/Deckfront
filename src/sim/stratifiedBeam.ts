export type BeamLaneId = 'unrestricted' | 'mage' | 'melee' | 'ranged';
export interface BeamLaneConfig { id: BeamLaneId; width: number; finalists: number }
export const STRATIFIED_ADMISSIONS_PER_LANE = 1;

/** The total retained width is 72, compared with 128 for four copies of the old width-32 beam. */
export const STRATIFIED_BEAM_LANES: readonly BeamLaneConfig[] = Object.freeze([
  Object.freeze({ id: 'unrestricted' as const, width: 24, finalists: 4 }),
  Object.freeze({ id: 'mage' as const, width: 16, finalists: 2 }),
  Object.freeze({ id: 'melee' as const, width: 16, finalists: 2 }),
  Object.freeze({ id: 'ranged' as const, width: 16, finalists: 2 })
]);
