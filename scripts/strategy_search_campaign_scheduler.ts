import fs from 'node:fs';
import {
  applyCampaignSchedulerUpdates, createCampaignSchedulerCheckpoint, planCampaignSchedulerTick,
  recoverCampaignAmbiguousLaunch, reconfigureCampaignSchedulerTasks, refenceCampaignSchedulerCheckpoint,
  repairCampaignSchedulerTask, validateCampaignSchedulerCheckpoint
} from '../src/sim/strategySearchScheduler';
import type {
  CampaignSchedulerCheckpoint, CampaignSchedulerObservation, CampaignSchedulerUpdate
} from '../src/sim/strategySearchScheduler';

const request = JSON.parse(fs.readFileSync(0, 'utf8')) as Record<string, unknown>;
const checkpoint = request.checkpoint as CampaignSchedulerCheckpoint;
if (!validateCampaignSchedulerCheckpoint(checkpoint)) throw new Error('Campaign scheduler checkpoint is invalid.');
let result: unknown;
if (process.argv[2] === 'validate') {
  result = checkpoint;
} else if (process.argv[2] === 'plan') {
  result = planCampaignSchedulerTick({ tasks: checkpoint.tasks,
    observations: (request.observations ?? []) as CampaignSchedulerObservation[],
    limits: request.limits as { maxActiveContainers: number; maxActiveCpus: number },
    controllerFence: checkpoint.controllerFence, stopLaunching: request.stopLaunching === true });
} else if (process.argv[2] === 'apply') {
  result = createCampaignSchedulerCheckpoint({ evidenceHash: checkpoint.evidenceHash,
    controllerFence: checkpoint.controllerFence, revision: checkpoint.revision + 1,
    tasks: applyCampaignSchedulerUpdates(checkpoint.tasks,
      (request.updates ?? []) as CampaignSchedulerUpdate[]) });
} else if (process.argv[2] === 'refence') {
  result = refenceCampaignSchedulerCheckpoint(checkpoint, Number(request.controllerFence));
} else if (process.argv[2] === 'recover') {
  result = createCampaignSchedulerCheckpoint({ evidenceHash: checkpoint.evidenceHash,
    controllerFence: checkpoint.controllerFence, revision: checkpoint.revision + 1,
    tasks: recoverCampaignAmbiguousLaunch(checkpoint.tasks,
      request.recovery as { taskId: string; nowMs: number }) });
} else if (process.argv[2] === 'repair') {
  result = createCampaignSchedulerCheckpoint({ evidenceHash: checkpoint.evidenceHash,
    controllerFence: checkpoint.controllerFence, revision: checkpoint.revision + 1,
    tasks: repairCampaignSchedulerTask(checkpoint.tasks, request.repair as {
      taskId: string; reason: string; artifactPaths: string[]; artifactHashes: Record<string, string>
    }) });
} else if (process.argv[2] === 'runtime') {
  result = createCampaignSchedulerCheckpoint({ evidenceHash: checkpoint.evidenceHash,
    controllerFence: checkpoint.controllerFence, revision: checkpoint.revision + 1,
    tasks: reconfigureCampaignSchedulerTasks(checkpoint.tasks,
      request.resources as Record<string, { containers: number; cpus: number }>) });
} else throw new Error(`Unknown campaign scheduler operation ${process.argv[2]}.`);
process.stdout.write(`${JSON.stringify(result)}\n`);
