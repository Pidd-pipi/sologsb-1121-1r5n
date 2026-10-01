import Dexie, { type Table } from 'dexie';
import type { Plot } from '../types/plot';
import type { TreeRecord } from '../types/tree';
import type { RegenShrub } from '../types/regen';
import type { RecheckDiff } from '../types/recheck';
import type { PlotRevision, ReconBatch, ReconMatch, StandSummaryRecord } from '../types/reconcile';
import { newId } from './id';

export const DB_NAME = 'gbforestplot';
export const DB_VERSION = 3;
export const LS_VERSION_KEY = 'gbforestplot:db-version';

class ForestPlotDB extends Dexie {
  plots!: Table<Plot, string>;
  trees!: Table<TreeRecord, string>;
  regens!: Table<RegenShrub, string>;
  rechecks!: Table<RecheckDiff, string>;
  reconBatches!: Table<ReconBatch, string>;
  reconMatches!: Table<ReconMatch, string>;
  plotRevisions!: Table<PlotRevision, string>;
  standSummaries!: Table<StandSummaryRecord, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      plots: 'id, plotNo, locality, forestType, surveyRound, createdAt',
      trees: 'id, plotId, treeNo, species, round, status',
      regens: 'id, plotId, layer, species, round',
      rechecks: 'id, plotId, baseRound, targetRound, treeNo',
    });
    this.version(2)
      .stores({
        plots: 'id, plotNo, locality, forestType, surveyRound, locked, createdAt',
        trees: 'id, plotId, treeNo, species, round, status, measuredAt',
        regens: 'id, plotId, layer, species, round, heightCm',
        rechecks: 'id, plotId, baseRound, targetRound, treeNo, generatedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('plots')
          .toCollection()
          .modify((row: any) => {
            if (row.locked === undefined) row.locked = false;
            if (row.surveyRound === undefined) row.surveyRound = 1;
          });
        await tx
          .table('trees')
          .toCollection()
          .modify((row: any) => {
            if (row.round === undefined) row.round = 1;
            if (row.measuredAt === undefined) row.measuredAt = Date.now();
          });
      });
    // v3：接入县里林草图斑年度对账回传包（批次留档、配对裁定、修订履历、林分汇总快照）
    this.version(3).stores({
      plots: 'id, plotNo, formerPlotNo, locality, forestType, surveyRound, locked, createdAt',
      trees: 'id, plotId, treeNo, species, round, status, measuredAt',
      regens: 'id, plotId, layer, species, round, heightCm',
      rechecks: 'id, plotId, baseRound, targetRound, treeNo, generatedAt',
      reconBatches: 'id, year, batchNo, importedAt',
      reconMatches: 'id, batchId, parcelNo, plotId, status, reason',
      plotRevisions: 'id, plotId, plotNo, revisionNo, decidedAt',
      standSummaries: 'id, plotId, plotNo, revisionNo, generatedAt',
    });
  }
}

export const db = new ForestPlotDB();

export function markDbVersion(): void {
  try {
    window.localStorage.setItem(LS_VERSION_KEY, String(DB_VERSION));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

export function readDbVersion(): number {
  try {
    const raw = window.localStorage.getItem(LS_VERSION_KEY);
    return raw ? Number(raw) : DB_VERSION;
  } catch {
    return DB_VERSION;
  }
}

export async function saveRecheckDiffs(diffs: RecheckDiff[]): Promise<void> {
  await db.rechecks.bulkPut(diffs);
}

export async function loadRecheckDiffs(plotId: string): Promise<RecheckDiff[]> {
  const rows = await db.rechecks.where('plotId').equals(plotId).toArray();
  return rows.sort((a, b) => a.treeNo.localeCompare(b.treeNo));
}

/** 首次进入灌入示范样地与两期样木数据 */
export async function ensureSeedData(): Promise<void> {
  const count = await db.plots.count();
  if (count > 0) return;

  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const plotId = newId('plot');
  const plot2Id = newId('plot');
  const plot3Id = newId('plot');
  // 对账回传演示样地（编号、坐标、面积、树种各类差异）
  const plotRenId = newId('plot');
  const plotCoordAId = newId('plot');
  const plotMultiAId = newId('plot');
  const plotMultiBId = newId('plot');
  const plotSpeciesId = newId('plot');
  const plotAreaAId = newId('plot');
  const plotAreaBId = newId('plot');
  const mkDemoPlot = (
    id: string,
    plotNo: string,
    formerPlotNo: string | undefined,
    lng: number,
    lat: number,
    area: number,
    dominantSpecies: string,
    forestType = '阔叶林',
  ): Plot => ({
    id,
    plotNo,
    formerPlotNo,
    locality: `黑龙江凉水林场对账样地 ${plotNo}`,
    lng,
    lat,
    shape: '方形',
    area,
    elevation: 400,
    slope: 8,
    aspect: '东南',
    forestType,
    canopyDensity: 0.6,
    dominantSpecies,
    surveyRound: 1,
    surveyedAt: now - 5 * day,
    crew: '调查二组（周砚）',
    locked: false,
    createdAt: now - 100 * day,
  });

  const plots: Plot[] = [
    {
      id: plotId,
      plotNo: 'FP-4102',
      locality: '黑龙江凉水林场 12 林班',
      lng: 128.8934,
      lat: 47.1832,
      shape: '方形',
      area: 600,
      elevation: 412,
      slope: 8,
      aspect: '东南',
      forestType: '针阔混交林',
      canopyDensity: 0.72,
      dominantSpecies: '红松 + 紫椴',
      surveyRound: 2,
      surveyedAt: now - 6 * day,
      crew: '调查一组（顾青、李慕）',
      locked: true,
      createdAt: now - 400 * day,
    },
    {
      id: plot2Id,
      plotNo: 'FP-4115',
      locality: '黑龙江凉水林场 15 林班',
      lng: 128.9012,
      lat: 47.1901,
      shape: '圆形',
      area: 500,
      elevation: 388,
      slope: 14,
      aspect: '西南',
      forestType: '阔叶林',
      canopyDensity: 0.65,
      dominantSpecies: '蒙古栎',
      surveyRound: 1,
      surveyedAt: now - 3 * day,
      crew: '调查二组（周砚）',
      locked: false,
      createdAt: now - 120 * day,
    },
    {
      id: plot3Id,
      plotNo: 'FP-4130',
      locality: '黑龙江凉水林场 12 林班（邻近对照样地）',
      lng: 128.8946,
      lat: 47.1844,
      shape: '方形',
      area: 600,
      elevation: 405,
      slope: 10,
      aspect: '东',
      forestType: '针阔混交林',
      canopyDensity: 0.68,
      dominantSpecies: '红松',
      surveyRound: 1,
      surveyedAt: now - 2 * day,
      crew: '调查一组（顾青）',
      locked: false,
      createdAt: now - 90 * day,
    },
    mkDemoPlot(plotRenId, 'FP-7003', 'FP-6003', 128.95, 47.25, 600, '兴安落叶松', '针叶林'),
    // 坐标兜底（单候选）
    mkDemoPlot(plotCoordAId, 'FP-7101', undefined, 129.0, 47.28, 600, '白桦'),
    // 多个样地对到同一图斑（两个邻近样地）
    mkDemoPlot(plotMultiAId, 'FP-7201', undefined, 129.01, 47.29, 600, '山杨'),
    mkDemoPlot(plotMultiBId, 'FP-7202', undefined, 129.0108, 47.2906, 600, '白桦'),
    // 树种不一致
    mkDemoPlot(plotSpeciesId, 'FP-7301', undefined, 129.02, 47.3, 600, '红松', '针阔混交林'),
    // 一个样地落到多个图斑（两个同编号图斑）
    mkDemoPlot(plotAreaAId, 'FP-7401', undefined, 129.03, 47.31, 600, '蒙古栎'),
    mkDemoPlot(plotAreaBId, 'FP-7402', undefined, 129.04, 47.32, 500, '黄菠萝'),
  ];

  type Seed = [string, string, number, number, number, number, TreeRecord['status']];
  const seeds: Seed[] = [
    ['1', '红松', 34.2, 18.6, 7.4, 5.2, '活立木'],
    ['2', '紫椴', 26.8, 15.2, 5.1, 4.4, '活立木'],
    ['3', '红松', 41.5, 21.3, 9.2, 6.1, '活立木'],
    ['4', '蒙古栎', 18.4, 11.5, 3.6, 3.2, '活立木'],
    ['5', '色木槭', 12.6, 9.4, 2.8, 2.6, '活立木'],
  ];

  const trees: TreeRecord[] = [];
  seeds.forEach(([treeNo, species, dbh, h, ubh, cw, status]) => {
    trees.push({
      id: newId('tree'),
      plotId,
      treeNo,
      species,
      dbhCm: dbh,
      heightM: h,
      underBranchH: ubh,
      crownWidth: cw,
      status,
      origin: '天然',
      healthClass: '健康',
      tiltDeg: 2,
      remark: `样地中部 ${treeNo} 号桩`,
      round: 1,
      measuredAt: now - 370 * day,
    });
  });
  // 第 2 期：树号 1/2/3/5 复测（胸径增大），树号 4 被采伐 → 复查比对可标记缺失
  seeds.forEach(([treeNo, species, dbh, h, ubh, cw], index) => {
    if (treeNo === '4') return;
    const growth = [1.8, 1.4, 2.2, 0.9][index > 3 ? 3 : index];
    trees.push({
      id: newId('tree'),
      plotId,
      treeNo,
      species,
      dbhCm: Math.round((dbh + growth) * 10) / 10,
      heightM: Math.round((h + growth * 0.6) * 10) / 10,
      underBranchH: ubh,
      crownWidth: cw,
      status: '活立木',
      origin: '天然',
      healthClass: '健康',
      tiltDeg: 2,
      remark: `样地中部 ${treeNo} 号桩`,
      round: 2,
      measuredAt: now - 6 * day,
    });
  });
  // 第 2 期新增进界木
  trees.push({
    id: newId('tree'),
    plotId,
    treeNo: '6',
    species: '色木槭',
    dbhCm: 6.2,
    heightM: 6.1,
    underBranchH: 1.8,
    crownWidth: 1.9,
    status: '活立木',
    origin: '天然',
    healthClass: '健康',
    tiltDeg: 1,
    remark: '样地东南 3m 进界木',
    round: 2,
    measuredAt: now - 6 * day,
  });
  trees.push({
    id: newId('tree'),
    plotId: plot2Id,
    treeNo: '1',
    species: '蒙古栎',
    dbhCm: 22.4,
    heightM: 13.2,
    underBranchH: 4.2,
    crownWidth: 4.1,
    status: '活立木',
    origin: '天然',
    healthClass: '亚健康',
    tiltDeg: 6,
    remark: '样地西侧',
    round: 1,
    measuredAt: now - 3 * day,
  });

  const regens: RegenShrub[] = [
    {
      id: newId('regen'),
      plotId,
      layer: '更新苗',
      species: '红松',
      heightCm: 32,
      count: 18,
      ageGroup: '3 年生',
      distribution: '团状',
      browseDamage: '轻度',
      round: 2,
    },
    {
      id: newId('regen'),
      plotId,
      layer: '更新苗',
      species: '紫椴',
      heightCm: 55,
      count: 9,
      ageGroup: '多年生',
      distribution: '均匀',
      browseDamage: '无',
      round: 2,
    },
    {
      id: newId('regen'),
      plotId,
      layer: '灌木',
      species: '毛榛子',
      heightCm: 120,
      count: 26,
      ageGroup: '多年生',
      distribution: '团状',
      browseDamage: '中度',
      round: 2,
    },
    {
      id: newId('regen'),
      plotId,
      layer: '草本',
      species: '苔草',
      heightCm: 22,
      count: 140,
      ageGroup: '多年生',
      distribution: '均匀',
      browseDamage: '无',
      round: 2,
    },
  ];

  await db.transaction('rw', db.plots, db.trees, db.regens, db.rechecks, async () => {
    await db.plots.bulkPut(plots);
    await db.trees.bulkPut(trees);
    await db.regens.bulkPut(regens);
  });
}
