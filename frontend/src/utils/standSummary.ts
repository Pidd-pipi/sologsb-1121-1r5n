import type { Plot } from '../types/plot';
import type { RegenShrub } from '../types/regen';
import type { TreeRecord } from '../types/tree';
import type { StandSummaryRecord } from '../types/reconcile';
import {
  avgDbh,
  avgHeight,
  basalAreaPerHectare,
  perHectareCount,
  regenDensity,
  totalBasalArea,
} from './forestCalc';

export interface StandSummaryInput {
  plot: Plot;
  trees: TreeRecord[];
  regens: RegenShrub[];
  revisionNo: number;
  batchId?: string;
  trigger: StandSummaryRecord['trigger'];
  now?: number;
}

/**
 * 计算并固化一版林分汇总。
 * 官方面积或优势树种一变（recon_adopt / recon_create）即调用，旧版汇总仍保留可查。
 */
export function buildStandSummary(input: StandSummaryInput): StandSummaryRecord {
  const { plot, trees, regens, revisionNo, batchId, trigger } = input;
  const round = plot.surveyRound;
  const roundTrees = trees.filter((t) => t.plotId === plot.id && t.round === round);
  const roundRegens = regens.filter((r) => r.plotId === plot.id && r.round === round);
  const alive = roundTrees.filter((t) => t.status === '活立木');

  return {
    id: `stand:${plot.id}:r${revisionNo}`,
    plotId: plot.id,
    plotNo: plot.plotNo,
    revisionNo,
    batchId,
    trigger,
    area: plot.area,
    dominantSpecies: plot.dominantSpecies,
    surveyRound: round,
    perHaCount: perHectareCount(alive.length, plot.area),
    aliveCount: alive.length,
    meanDbh: avgDbh(roundTrees),
    meanHeight: avgHeight(roundTrees),
    totalBasalArea: totalBasalArea(roundTrees),
    basalAreaPerHa: basalAreaPerHectare(roundTrees, plot.area),
    regenPerHa: regenDensity(roundRegens, plot, '更新苗'),
    shrubPerHa: regenDensity(roundRegens, plot, '灌木'),
    generatedAt: input.now ?? Date.now(),
  };
}
