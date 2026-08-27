import fs from 'node:fs';
import {
  bindCampaignStageCall, claimCampaignController, mutateCampaignState,
  recordCampaignStageLaunchIntent, recordCampaignStageOutcome,
  transitionCampaignStage, validateCampaignState
} from '../src/sim/strategySearchCampaign';
import type {
  CampaignStageState, CampaignStageStatus, CampaignState, RuntimeCeilings
} from '../src/sim/strategySearchCampaign';

function readInput(): Record<string, unknown> {
  const value = JSON.parse(fs.readFileSync(0, 'utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Campaign state request is invalid.');
  return value as Record<string, unknown>;
}
function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${name} is invalid.`);
  return Number(value);
}
const operation = process.argv[2], input = readInput(), state = input.state as CampaignState;
let result: CampaignState;
if (operation === 'validate' || operation === 'assert-fence') {
  if (!validateCampaignState(state)) throw new Error('Campaign state is invalid.');
  if (operation === 'assert-fence' && (state.controller?.ownerId !== input.ownerId
    || state.controller?.fencingToken !== input.fencingToken || state.fencingToken !== input.fencingToken)) {
    throw new Error('Campaign controller is stale or fenced out.');
  }
  result = state;
} else if (operation === 'claim') {
  const authorization = input.authorization as { token: string; ceilings: RuntimeCeilings } | undefined;
  result = claimCampaignController({ state, expectedRevision: integer(input.expectedRevision, 'expectedRevision'),
    ownerId: String(input.ownerId ?? ''), nowMs: integer(input.nowMs, 'nowMs'),
    leaseMs: integer(input.leaseMs, 'leaseMs'), ...(authorization ? { authorization } : {}) });
} else if (operation === 'launch-intent') {
  result = recordCampaignStageLaunchIntent({ state,
    expectedRevision: integer(input.expectedRevision, 'expectedRevision'), ownerId: String(input.ownerId ?? ''),
    fencingToken: integer(input.fencingToken, 'fencingToken'), stageKey: String(input.stageKey ?? ''),
    launchIntentId: String(input.launchIntentId ?? ''), nowMs: integer(input.nowMs, 'nowMs'),
    resources: input.resources as { containers: number; cpus: number } });
} else if (operation === 'bind-call') {
  result = bindCampaignStageCall({ state, expectedRevision: integer(input.expectedRevision, 'expectedRevision'),
    ownerId: String(input.ownerId ?? ''), fencingToken: integer(input.fencingToken, 'fencingToken'),
    stageKey: String(input.stageKey ?? ''), launchIntentId: String(input.launchIntentId ?? ''),
    callId: String(input.callId ?? ''), nowMs: integer(input.nowMs, 'nowMs') });
} else if (operation === 'stage-outcome') {
  result = recordCampaignStageOutcome({ state,
    expectedRevision: integer(input.expectedRevision, 'expectedRevision'), ownerId: String(input.ownerId ?? ''),
    fencingToken: integer(input.fencingToken, 'fencingToken'), stageKey: String(input.stageKey ?? ''),
    status: input.status as 'complete' | 'incomplete' | 'terminal-incomplete',
    ...(input.reason === undefined ? {} : { reason: String(input.reason) }),
    artifactPaths: input.artifactPaths as string[], artifactHashes: input.artifactHashes as Record<string, string> });
} else if (operation === 'transition') {
  const key = String(input.stageKey ?? ''), status = String(input.status ?? '') as CampaignStageStatus;
  result = mutateCampaignState({ state, expectedRevision: integer(input.expectedRevision, 'expectedRevision'),
    ownerId: String(input.ownerId ?? ''), fencingToken: integer(input.fencingToken, 'fencingToken'),
    mutate(draft) {
      const stage = draft.stages[key];
      if (!stage) throw new Error(`Unknown campaign stage ${key}.`);
      draft.stages[key] = transitionCampaignStage(stage, status,
        (input.details ?? {}) as Omit<CampaignStageState, 'id' | 'status'>);
    } });
} else throw new Error(`Unknown campaign state operation ${operation}.`);
process.stdout.write(`${JSON.stringify(result)}\n`);
