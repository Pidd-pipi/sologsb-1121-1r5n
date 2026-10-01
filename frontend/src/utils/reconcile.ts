import { db } from './db';
import { newId } from './id';
import type { Plot } from '../types/plot';
import {
  ARCHIVE_CAPACITY,
  AREA_CONFIRM_PCT,
  AREA_MISMATCH_PCT,
  BLOCKING_ISSUES,
  COORD_CONFIRM_M,
  COORD_MISMATCH_M,
  areaDiffPct,
  haversineM,
  normSpecies,
  type Adjudication,
  type AdjudicationIssue,
  type AdjudicationStatus,
  type ArchiveChange,
  type MatchBy,
  type ReconBatch,
  type ReconPackage,
  type ResourcePatch,
} from '../types/recon';

/** 容量不足：整批拒绝，原档保留 */
export class CapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapacityError';
  }
}

export interface MatchResult {
  patch: ResourcePatch;
  plot?: Plot;
  matchBy: MatchBy;
  issues: AdjudicationIssue[];
  areaDiffPct: number;
  coordDiffM: number;
}

/** 配对：先用样地编号配对，改号后再按坐标和面积确认；识别一对多/多对一/不一致 */
export function matchPatches(patches: ResourcePatch[], plots: Plot[]): Map<string, MatchResult> {
  const results = new Map<string, MatchResult>();
  const byPlotNo = new Map<string, Plot[]>();
  plots.forEach((p) => {
    const key = p.plotNo.trim();
    if (!byPlotNo.has(key)) byPlotNo.set(key, []);
    byPlotNo.get(key)!.push(p);
  });

  for (const patch of patches) {
    const issues: AdjudicationIssue[] = [];
    let plot: Plot | undefined;
    let matchBy: MatchBy = 'plotNo';
    let areaDiff = 0;
    let coordDiff = 0;

    const direct = byPlotNo.get(patch.plotNo.trim()) ?? [];
    if (direct.length === 1) {
      plot = direct[0];
      matchBy = 'plotNo';
    } else if (direct.length > 1) {
      // 同号多样地（编号应唯一）→ 多个样地对到同一图斑
      issues.push('multi-plot-one-patch');
    } else {
      // 改号：按坐标 + 面积确认
      const near = plots
        .map((p) => ({ p, d: haversineM(patch.lng, patch.lat, p.lng, p.lat) }))
        .filter((x) => x.d <= COORD_CONFIRM_M)
        .map((x) => ({ p: x.p, d: x.d, areaPct: areaDiffPct(patch.area, x.p.area) }))
        .filter((x) => x.areaPct <= AREA_CONFIRM_PCT)
        .sort((a, b) => a.d - b.d);
      if (near.length === 1) {
        plot = near[0].p;
        matchBy = 'coordinate-area';
        issues.push('renamed');
        areaDiff = near[0].areaPct;
        coordDiff = near[0].d;
      } else if (near.length > 1) {
        issues.push('multi-plot-one-patch');
      }
      // near.length === 0 → 无配对
    }

    if (plot) {
      if (matchBy === 'plotNo') {
        coordDiff = haversineM(patch.lng, patch.lat, plot.lng, plot.lat);
        areaDiff = areaDiffPct(patch.area, plot.area);
      }
      if (coordDiff > COORD_MISMATCH_M) issues.push('coordinate-mismatch');
      if (areaDiff > AREA_MISMATCH_PCT) issues.push('area-mismatch');
      if (normSpecies(patch.dominantSpecies) !== normSpecies(plot.dominantSpecies)) {
        issues.push('species-mismatch');
      }
    } else {
      issues.push('unmatched');
    }

    results.set(patch.id, { patch, plot, matchBy, issues, areaDiffPct: areaDiff, coordDiffM: coordDiff });
  }

  // 检测「一个样地落到多个图斑」：同一 plotId 被多个 patch 配对
  const plotToPatches = new Map<string, string[]>();
  results.forEach((r, patchId) => {
    if (r.plot) {
      if (!plotToPatches.has(r.plot.id)) plotToPatches.set(r.plot.id, []);
      plotToPatches.get(r.plot.id)!.push(patchId);
    }
  });
  plotToPatches.forEach((patchIds) => {
    if (patchIds.length > 1) {
      patchIds.forEach((pid) => {
        const r = results.get(pid)!;
        if (!r.issues.includes('one-plot-multi-patch')) r.issues.push('one-plot-multi-patch');
      });
    }
  });

  return results;
}

function statusFromIssues(issues: AdjudicationIssue[]): AdjudicationStatus {
  return issues.some((i) => BLOCKING_ISSUES.includes(i)) ? 'pending' : 'auto';
}

function buildAdjudication(r: MatchResult): Adjudication {
  return {
    id: r.patch.id,
    batchNo: r.patch.batchNo,
    patchNo: r.patch.patchNo,
    plotId: r.plot?.id ?? '',
    plotNo: r.plot?.plotNo ?? '',
    matchBy: r.matchBy,
    status: statusFromIssues(r.issues),
    issues: r.issues,
    officialArea: r.patch.area,
    officialSpecies: r.patch.dominantSpecies,
    officialLng: r.patch.lng,
    officialLat: r.patch.lat,
    localArea: r.plot?.area ?? 0,
    localSpecies: r.plot?.dominantSpecies ?? '',
    areaDiffPct: r.areaDiffPct,
    coordDiffM: r.coordDiffM,
    createdAt: Date.now(),
  };
}

export interface ImportResult {
  ok: boolean;
  batchNo?: string;
  imported?: number;
  rejected?: boolean;
  reason?: string;
}

/**
 * 导入回传包（整批事务）：
 * - 容量不足 → 整批拒绝，原档保留（事务回滚）
 * - 图斑以 `${batchNo}::${patchNo}` 为主键 upsert，重复导入不重复生成
 * - 已裁定（confirmed/rejected）的结果保留，不覆盖
 */
export async function importReconPackage(pkg: ReconPackage, operator: string): Promise<ImportResult> {
  if (!pkg.batchNo || !Array.isArray(pkg.patches) || pkg.patches.length === 0) {
    return { ok: false, reason: '回传包缺少批次号或图斑数据' };
  }

  const seen = new Set<string>();
  const patches: ResourcePatch[] = [];
  for (const p of pkg.patches) {
    if (!p.patchNo || !p.plotNo) continue;
    const key = `${pkg.batchNo}::${p.patchNo}`;
    if (seen.has(key)) continue; // 包内去重
    seen.add(key);
    patches.push({
      id: key,
      batchNo: pkg.batchNo,
      patchNo: p.patchNo,
      plotNo: p.plotNo.trim(),
      lng: Number(p.lng) || 0,
      lat: Number(p.lat) || 0,
      area: Number(p.area) || 0,
      dominantSpecies: p.dominantSpecies ?? '',
      forestType: p.forestType,
      township: p.township,
      village: p.village,
      importedAt: Date.now(),
    });
  }
  if (patches.length === 0) return { ok: false, reason: '回传包没有可导入的有效图斑' };

  try {
    await db.transaction(
      'rw',
      db.patches,
      db.adjudications,
      db.reconBatches,
      db.archiveChanges,
      db.plots,
      async () => {
        const existingCount = await db.patches.count();
        if (existingCount + patches.length > ARCHIVE_CAPACITY) {
          throw new CapacityError(
            `容量不足：档案库现有 ${existingCount} 份 + 本批 ${patches.length} 份 > 上限 ${ARCHIVE_CAPACITY}，整批拒绝，原档未改动`,
          );
        }

        const batch: ReconBatch = {
          batchNo: pkg.batchNo,
          source: pkg.source ?? '林草局年度回传',
          year: pkg.year ?? new Date().getFullYear(),
          importedAt: Date.now(),
          importedBy: operator,
          totalCount: patches.length,
          status: 'pending',
          note: pkg.note ?? '',
        };
        await db.reconBatches.put(batch);
        await db.patches.bulkPut(patches);

        const plots = await db.plots.toArray();
        const results = matchPatches(patches, plots);
        const adjs: Adjudication[] = [];
        for (const r of results.values()) {
          const existing = await db.adjudications.get(r.patch.id);
          if (existing && (existing.status === 'confirmed' || existing.status === 'rejected')) {
            adjs.push(existing); // 已裁定结果保留，重复导入不覆盖
            continue;
          }
          adjs.push(buildAdjudication(r));
        }
        await db.adjudications.bulkPut(adjs);
      },
    );
  } catch (err) {
    if (err instanceof CapacityError) {
      return { ok: false, rejected: true, reason: err.message };
    }
    throw err;
  }

  return { ok: true, batchNo: pkg.batchNo, imported: patches.length };
}

/** 质量员确认写回正式台账：官方面积/优势树种/坐标写入样地，旧值入档案历史 */
export async function applyAdjudication(adj: Adjudication, operator: string): Promise<void> {
  if (adj.status !== 'auto' && adj.status !== 'pending') return;
  await db.transaction('rw', db.adjudications, db.plots, db.archiveChanges, async () => {
    const plot = await db.plots.get(adj.plotId);
    if (!plot) throw new Error('配对样地不存在，无法写回');
    const changes: ArchiveChange[] = [];
    const now = Date.now();

    if (plot.area !== adj.officialArea) {
      changes.push({
        id: newId('ch'),
        plotId: plot.id,
        plotNo: plot.plotNo,
        field: 'area',
        fieldLabel: '面积',
        oldValue: `${plot.area} m²`,
        newValue: `${adj.officialArea} m²`,
        batchNo: adj.batchNo,
        patchNo: adj.patchNo,
        changedBy: operator,
        changedAt: now,
      });
      plot.area = adj.officialArea;
    }
    if (normSpecies(plot.dominantSpecies) !== normSpecies(adj.officialSpecies)) {
      changes.push({
        id: newId('ch'),
        plotId: plot.id,
        plotNo: plot.plotNo,
        field: 'dominantSpecies',
        fieldLabel: '优势树种',
        oldValue: plot.dominantSpecies,
        newValue: adj.officialSpecies,
        batchNo: adj.batchNo,
        patchNo: adj.patchNo,
        changedBy: operator,
        changedAt: now,
      });
      plot.dominantSpecies = adj.officialSpecies;
    }
    const coordDiff = haversineM(plot.lng, plot.lat, adj.officialLng, adj.officialLat);
    if (coordDiff > 1) {
      changes.push({
        id: newId('ch'),
        plotId: plot.id,
        plotNo: plot.plotNo,
        field: 'coords',
        fieldLabel: '坐标',
        oldValue: `${plot.lng}, ${plot.lat}`,
        newValue: `${adj.officialLng}, ${adj.officialLat}`,
        batchNo: adj.batchNo,
        patchNo: adj.patchNo,
        changedBy: operator,
        changedAt: now,
      });
      plot.lng = adj.officialLng;
      plot.lat = adj.officialLat;
    }

    if (changes.length > 0) await db.archiveChanges.bulkPut(changes);
    await db.plots.put(plot);
    await db.adjudications.update(adj.id, {
      status: 'confirmed',
      decidedBy: operator,
      decidedAt: now,
      appliedAt: now,
    });
  });
}

/** 质量员驳回：不写回正式台账 */
export async function rejectAdjudication(adj: Adjudication, operator: string): Promise<void> {
  if (adj.status !== 'auto' && adj.status !== 'pending') return;
  await db.adjudications.update(adj.id, {
    status: 'rejected',
    decidedBy: operator,
    decidedAt: Date.now(),
  });
}

/** 批量确认某批次全部自动通过项，返回确认条数 */
export async function batchConfirmAuto(batchNo: string, operator: string): Promise<number> {
  const rows = await db.adjudications
    .where('batchNo')
    .equals(batchNo)
    .filter((a) => a.status === 'auto')
    .toArray();
  let count = 0;
  for (const adj of rows) {
    await applyAdjudication(adj, operator);
    count += 1;
  }
  return count;
}

/** 删除批次及其图斑/裁定（已写回的变更历史保留） */
export async function removeBatch(batchNo: string): Promise<void> {
  await db.transaction('rw', db.reconBatches, db.patches, db.adjudications, async () => {
    await db.reconBatches.delete(batchNo);
    await db.patches.where('batchNo').equals(batchNo).delete();
    await db.adjudications.where('batchNo').equals(batchNo).delete();
  });
}

/** 生成示例回传包（基于当前台账样地，覆盖干净配对/改号/不一致/一对多/多对一） */
export function buildSamplePackage(plots: Plot[]): ReconPackage {
  const find = (no: string) => plots.find((p) => p.plotNo === no);
  const p4102 = find('FP-4102');
  const p4115 = find('FP-4115');
  const p4120 = find('FP-4120');
  const p4121 = find('FP-4121');
  const p4122 = find('FP-4122');
  const p4123 = find('FP-4123');
  const mid = (a: Plot, b: Plot) => ({ lng: (a.lng + b.lng) / 2, lat: (a.lat + b.lat) / 2 });

  const patches: ReconPackage['patches'] = [];
  const push = (
    patchNo: string,
    plotNo: string,
    ref: Plot | undefined,
    overrides: Partial<ReconPackage['patches'][number]> = {},
  ) => {
    if (!ref) return;
    patches.push({
      patchNo,
      plotNo,
      lng: ref.lng,
      lat: ref.lat,
      area: ref.area,
      dominantSpecies: ref.dominantSpecies,
      forestType: ref.forestType,
      ...overrides,
    });
  };

  push('TB-001', 'FP-4102', p4102, { area: Math.round((p4102?.area ?? 600) * 1.02) });
  push('TB-002', 'FP-4115', p4115);
  push('TB-003', 'FP-4122', p4122);
  push('TB-004', 'FP-4120', p4120); // 与 TB-007/TB-008 共同落到 FP-4120 → 一个样地多个图斑
  push('TB-005', 'FP-4121-改', p4121); // 改号：坐标面积吻合 → 改号确认
  push('TB-006', 'FP-4123', p4123, { dominantSpecies: '落叶松' }); // 树种不一致
  push('TB-007', 'FP-4120', p4120, { area: Math.round((p4120?.area ?? 400) * 1.2) }); // 面积不一致
  if (p4120 && p4121) {
    const m = mid(p4120, p4121);
    patches.push({
      patchNo: 'TB-008',
      plotNo: 'FP-UNKNOWN-8',
      lng: m.lng,
      lat: m.lat,
      area: p4120.area,
      dominantSpecies: p4120.dominantSpecies,
      forestType: p4120.forestType,
    }); // 坐标同时落在 FP-4120/FP-4121 → 多个样地对到同一图斑
  }

  return {
    batchNo: 'LC-2026-DEMO',
    source: '林草局年度回传（示例）',
    year: 2026,
    note: '示例回传包：含干净配对、改号确认、面积/树种不一致、一个样地多个图斑、多个样地对到同一图斑',
    patches,
  };
}

/** 构造一个必然超容的回传包（用于演示整批拒绝） */
export function buildOverCapacityPackage(currentCount: number): ReconPackage {
  const need = ARCHIVE_CAPACITY - currentCount + 1;
  const patches: ReconPackage['patches'] = Array.from({ length: need }, (_, i) => ({
    patchNo: `OVER-${String(i + 1).padStart(4, '0')}`,
    plotNo: `OVER-PLOT-${i + 1}`,
    lng: 128.9 + i * 0.0001,
    lat: 47.18 + i * 0.0001,
    area: 400,
    dominantSpecies: '红松',
  }));
  return {
    batchNo: 'LC-2026-OVER',
    source: '容量测试（不会写入）',
    year: 2026,
    patches,
  };
}
