import { db } from './db';
import { newId } from './id';
import { buildReconMatches, jsonByteSize, packageFingerprint } from './reconCore';
import { buildRecheckDiffs, plotRounds } from './recheck';
import { buildStandSummary } from './standSummary';
import { requireQc } from '../stores/authStore';
import type { Plot } from '../types/plot';
import type { TreeRecord } from '../types/tree';
import type { RegenShrub } from '../types/regen';
import {
  ReconError,
  type CountyPackage,
  type CountyParcel,
  type PlotRevision,
  type ReconBatch,
  type ReconDecision,
  type ReconMatch,
  type StandSummaryRecord,
  type UserRole,
} from '../types/reconcile';

/** 容量安全系数：预估占用需低于剩余空间的该比例，否则整批拒绝 */
const QUOTA_SAFETY = 0.5;

export interface ImportResult {
  batch: ReconBatch;
  matches: ReconMatch[];
  duplicated: boolean;
}

/** 解析并校验回传包 JSON */
export function parsePackage(raw: string): CountyPackage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('回传包不是合法 JSON，请检查文件内容');
  }
  const pkg = data as Partial<CountyPackage>;
  if (!pkg || typeof pkg !== 'object') throw new Error('回传包结构为空');
  const year = Number(pkg.year);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) throw new Error('回传包年度（year）缺失或不合法');
  if (!Array.isArray(pkg.parcels) || pkg.parcels.length === 0) {
    throw new Error('回传包没有任何图斑（parcels）');
  }
  pkg.parcels.forEach((p, i) => validateParcel(p, i));
  return {
    year,
    batchNo: typeof pkg.batchNo === 'string' ? pkg.batchNo : undefined,
    source: typeof pkg.source === 'string' ? pkg.source : '县里年度回传',
    parcels: pkg.parcels as CountyParcel[],
  };
}

function validateParcel(p: Partial<CountyParcel> | undefined, index: number): void {
  const where = `第 ${index + 1} 个图斑`;
  if (!p || typeof p !== 'object') throw new Error(`${where} 不是对象`);
  if (!p.parcelNo || typeof p.parcelNo !== 'string') throw new Error(`${where} 缺少图斑编号 parcelNo`);
  if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) throw new Error(`${where}（${p.parcelNo}）坐标缺失`);
  if (!Number.isFinite(p.area) || (p.area as number) <= 0) throw new Error(`${where}（${p.parcelNo}）面积不合法`);
  if (!p.dominantSpecies || typeof p.dominantSpecies !== 'string') {
    throw new Error(`${where}（${p.parcelNo}）缺少优势树种`);
  }
}

/** 容量预检：空间不足时整批拒绝（不写任何数据，原档保留） */
async function ensureCapacity(requiredBytes: number): Promise<void> {
  let estimate: StorageEstate | undefined;
  try {
    estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : undefined;
  } catch {
    estimate = undefined;
  }
  if (estimate && typeof estimate.quota === 'number' && typeof estimate.usage === 'number') {
    const free = estimate.quota - estimate.usage;
    if (requiredBytes / QUOTA_SAFETY > free) {
      throw new ReconError(
        `本地档案库剩余空间约 ${(free / 1024 / 1024).toFixed(1)} MB，本批预估需 ${(
          requiredBytes /
          1024 /
          1024
        ).toFixed(1)} MB，容量不足，整批拒绝导入（原有档案原样保留）`,
        true,
      );
    }
  }
}

type StorageEstate = { quota?: number; usage?: number };

function batchIdOf(pkg: CountyPackage, fingerprint: string): string {
  const slug = (pkg.batchNo ?? '')
    .trim()
    .replace(/[^\w一-龥-]+/g, '_')
    .slice(0, 40);
  return `batch:${pkg.year}:${slug || 'annual'}:${fingerprint}`;
}

/**
 * 导入一个年度回传包：
 * - 先编号/改号/坐标面积配对，冲突列待裁定；
 * - 同一包（年度+内容指纹）重复导入直接返回既有批次，不重复生成；
 * - 容量不足整批拒绝，原档保留。
 */
export async function importPackage(raw: string): Promise<ImportResult> {
  const pkg = parsePackage(raw);
  const rawBytes = jsonByteSize(raw);
  // 整包留档 + 配对项/索引的预估开销
  await ensureCapacity(rawBytes * 2 + pkg.parcels.length * 2048);

  const fingerprint = packageFingerprint(pkg.year, pkg.parcels);
  const id = batchIdOf(pkg, fingerprint);

  return db.transaction('rw', db.reconBatches, db.reconMatches, db.plots, async () => {
    const existing = await db.reconBatches.get(id);
    if (existing) {
      const matches = await db.reconMatches.where('batchId').equals(id).toArray();
      return { batch: existing, matches, duplicated: true };
    }

    const ledger = await db.plots.toArray();
    const { matches, autoCount, pendingCount } = buildReconMatches({
      batch: { id },
      parcels: pkg.parcels,
      ledger: ledger.map((p) => ({
        id: p.id,
        plotNo: p.plotNo,
        formerPlotNo: p.formerPlotNo,
        lng: p.lng,
        lat: p.lat,
        area: p.area,
        dominantSpecies: p.dominantSpecies,
      })),
    });

    const now = Date.now();
    const batch: ReconBatch = {
      id,
      year: pkg.year,
      batchNo: pkg.batchNo || `${pkg.year} 年度回传`,
      source: pkg.source,
      parcelCount: pkg.parcels.length,
      rawJson: raw,
      rawBytes,
      importedAt: now,
      autoCount,
      pendingCount,
      confirmedCount: 0,
      dismissedCount: 0,
    };

    await db.reconBatches.put(batch);
    await db.reconMatches.bulkPut(matches);
    return { batch, matches, duplicated: false };
  });
}

export async function listBatches(): Promise<ReconBatch[]> {
  const rows = await db.reconBatches.orderBy('importedAt').reverse().toArray();
  return rows;
}

export async function listMatches(batchId?: string): Promise<ReconMatch[]> {
  const rows = batchId
    ? await db.reconMatches.where('batchId').equals(batchId).toArray()
    : await db.reconMatches.toArray();
  return rows.sort((a, b) => a.createdAt - b.createdAt || a.parcelNo.localeCompare(b.parcelNo));
}

export async function getMatch(id: string): Promise<ReconMatch | undefined> {
  return db.reconMatches.get(id);
}

async function nextRevisionNo(plotId: string): Promise<number> {
  const rows = await db.plotRevisions.where('plotId').equals(plotId).toArray();
  return rows.length === 0 ? 1 : Math.max(...rows.map((r) => r.revisionNo)) + 1;
}

function changedFieldsOf(before: Plot, after: Plot): string[] {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  return keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
}

/** 写回后：官方面积/树种变化 → 立即重算最近两期复查比对与林分汇总 */
async function recomputeAfterWrite(
  plot: Plot,
  revisionNo: number,
  batchId: string,
  trigger: StandSummaryRecord['trigger'],
): Promise<{ revisionId: string; standSummaryId: string }> {
  const allTrees = await db.trees.toArray();
  const allRegens = await db.regens.toArray();

  // 林分汇总立即重算并存新快照（旧版保留）
  const summary = buildStandSummary({ plot, trees: allTrees, regens: allRegens, revisionNo, batchId, trigger });
  await db.standSummaries.put(summary);

  // 复查比对：最近两期立即重算并覆盖保存
  const rounds = plotRounds(allTrees, plot.id);
  if (rounds.length >= 2) {
    const baseRound = rounds[rounds.length - 2];
    const targetRound = rounds[rounds.length - 1];
    const diffs = buildRecheckDiffs({ plotId: plot.id, trees: allTrees, baseRound, targetRound });
    await db.rechecks.where('plotId').equals(plot.id).delete();
    await db.rechecks.bulkPut(diffs);
  }

  return { revisionId: `rev:${plot.id}:r${revisionNo}`, standSummaryId: summary.id };
}

export interface AdoptInput {
  match: ReconMatch;
  role: UserRole;
  operator: string;
  /** 多个候选样地时质量员选定的样地 id；唯一候选可省略 */
  targetPlotId?: string;
  note?: string;
}

/** 采用官方图斑数据写回正式台账（质量员限定） */
export async function adoptOfficial(input: AdoptInput): Promise<ReconMatch> {
  requireQc(input.role);
  const { match } = input;
  if (match.status === 'confirmed') return match; // 重复提交不重复生成
  if (match.reason === 'unreferenced') throw new Error('该样地无图斑对应，无需采用官方数据');

  const candidateIds = match.candidates.map((c) => c.plotId);
  const targetId = input.targetPlotId ?? match.plotId;
  if (!targetId || !candidateIds.includes(targetId)) {
    throw new Error('请先在候选样地中指定要写回的样地');
  }

  return db.transaction(
    'rw',
    [
      db.reconMatches,
      db.plots,
      db.plotRevisions,
      db.standSummaries,
      db.rechecks,
      db.trees,
      db.regens,
      db.reconBatches,
    ],
    async () => {
      const before = await db.plots.get(targetId);
      if (!before) throw new Error('目标样地已不存在，无法写回');

      const parcel = match.parcel;
      const declaredNo = parcel.plotNo?.trim();
      const willRenumber = Boolean(declaredNo && declaredNo !== before.plotNo);
      if (willRenumber) {
        const occupied = await db.plots.where('plotNo').equals(declaredNo!).first();
        if (occupied && occupied.id !== targetId) {
          throw new Error(`样地号 ${declaredNo} 已被其他样地占用，不能改号，请保留台账或人工核对`);
        }
      }
      const after: Plot = {
        ...before,
        // 改号：图斑标注了新样地号且与现号不同，记录 formerPlotNo
        plotNo: willRenumber ? declaredNo! : before.plotNo,
        formerPlotNo: willRenumber ? before.plotNo : before.formerPlotNo,
        lng: parcel.lng,
        lat: parcel.lat,
        area: parcel.area,
        dominantSpecies: parcel.dominantSpecies,
        ...(parcel.forestType ? { forestType: parcel.forestType } : {}),
        ...(parcel.locality ? { locality: parcel.locality } : {}),
      };

      const revisionNo = await nextRevisionNo(targetId);
      const changedFields = changedFieldsOf(before, after);
      const decidedAt = Date.now();
      const revision: PlotRevision = {
        id: `rev:${targetId}:r${revisionNo}`,
        plotId: targetId,
        plotNo: after.plotNo,
        revisionNo,
        batchId: match.batchId,
        parcelNo: match.parcelNo,
        before,
        after,
        changedFields,
        decidedBy: input.operator,
        decidedAt,
      };
      await db.plots.put(after);
      await db.plotRevisions.put(revision);

      const ids = await recomputeAfterWrite(
        after,
        revisionNo,
        match.batchId,
        'recon_adopt',
      );

      const decision: ReconDecision = {
        kind: 'adopt',
        targetPlotId: targetId,
        note: input.note,
        decidedBy: input.operator,
        decidedAt,
      };
      const updated: ReconMatch = {
        ...match,
        plotId: targetId,
        status: 'confirmed',
        decision,
        revisionId: ids.revisionId,
        standSummaryId: ids.standSummaryId,
        decidedAt,
      };
      await db.reconMatches.put(updated);
      await refreshBatchCounts(match.batchId);
      return updated;
    },
  );
}

export interface KeepInput {
  match: ReconMatch;
  role: UserRole;
  operator: string;
  note?: string;
}

/** 质量员裁定保留台账不改（树种/面积以台账为准） */
export async function keepLedger(input: KeepInput): Promise<ReconMatch> {
  requireQc(input.role);
  const { match } = input;
  if (match.status === 'dismissed') return match;

  return db.transaction('rw', db.reconMatches, db.reconBatches, async () => {
    const decidedAt = Date.now();
    const updated: ReconMatch = {
      ...match,
      status: 'dismissed',
      decision: { kind: 'keep_ledger', note: input.note, decidedBy: input.operator, decidedAt },
      decidedAt,
    };
    await db.reconMatches.put(updated);
    await refreshBatchCounts(match.batchId);
    return updated;
  });
}

export interface CreateInput {
  match: ReconMatch;
  role: UserRole;
  operator: string;
  newPlotNo: string;
  note?: string;
}

/** 台账无对应样地：质量员确认后按图斑新建样地 */
export async function createPlotFromParcel(input: CreateInput): Promise<ReconMatch> {
  requireQc(input.role);
  const { match } = input;
  if (match.status === 'confirmed') return match;
  if (match.reason !== 'unmatched') throw new Error('只有“台账无对应样地”的图斑才能新建样地');
  const plotNo = input.newPlotNo.trim();
  if (!plotNo) throw new Error('请填写新样地号');

  return db.transaction(
    'rw',
    db.reconMatches,
    db.plots,
    db.plotRevisions,
    db.standSummaries,
    db.reconBatches,
    async () => {
      const dup = await db.plots.where('plotNo').equals(plotNo).first();
      if (dup) throw new Error(`样地号 ${plotNo} 已存在，无法新建`);

      const parcel = match.parcel;
      const now = Date.now();
      const plot: Plot = {
        id: newId('plot'),
        plotNo,
        locality: parcel.locality ?? `${match.parcelNo} 图斑新建`,
        lng: parcel.lng,
        lat: parcel.lat,
        shape: '方形',
        area: parcel.area,
        elevation: 0,
        slope: 0,
        aspect: '—',
        forestType: parcel.forestType ?? '阔叶林',
        canopyDensity: 0,
        dominantSpecies: parcel.dominantSpecies,
        surveyRound: 1,
        surveyedAt: now,
        crew: `县图斑 ${match.parcelNo} 转建`,
        locked: false,
        createdAt: now,
      };
      await db.plots.put(plot);

      const revisionNo = 1;
      const decidedAt = now;
      const revision: PlotRevision = {
        id: `rev:${plot.id}:r${revisionNo}`,
        plotId: plot.id,
        plotNo,
        revisionNo,
        batchId: match.batchId,
        parcelNo: match.parcelNo,
        after: plot,
        changedFields: ['__create__'],
        decidedBy: input.operator,
        decidedAt,
      };
      await db.plotRevisions.put(revision);

      const allTrees: TreeRecord[] = await db.trees.toArray();
      const allRegens: RegenShrub[] = await db.regens.toArray();
      const summary = buildStandSummary({
        plot,
        trees: allTrees,
        regens: allRegens,
        revisionNo,
        batchId: match.batchId,
        trigger: 'recon_create',
      });
      await db.standSummaries.put(summary);

      const updated: ReconMatch = {
        ...match,
        plotId: plot.id,
        status: 'confirmed',
        decision: { kind: 'create_plot', newPlotNo: plotNo, note: input.note, decidedBy: input.operator, decidedAt },
        revisionId: revision.id,
        standSummaryId: summary.id,
        decidedAt,
      };
      await db.reconMatches.put(updated);
      await refreshBatchCounts(match.batchId);
      return updated;
    },
  );
}

async function refreshBatchCounts(batchId: string): Promise<void> {
  const batch = await db.reconBatches.get(batchId);
  if (!batch) return;
  const matches = await db.reconMatches.where('batchId').equals(batchId).toArray();
  const countable = matches.filter((m) => m.reason !== 'unreferenced');
  await db.reconBatches.put({
    ...batch,
    autoCount: countable.filter((m) => m.status === 'auto').length,
    pendingCount: countable.filter((m) => m.status === 'pending').length,
    confirmedCount: countable.filter((m) => m.status === 'confirmed').length,
    dismissedCount: countable.filter((m) => m.status === 'dismissed').length,
  });
}

export async function listRevisions(plotId?: string): Promise<PlotRevision[]> {
  const rows = plotId
    ? await db.plotRevisions.where('plotId').equals(plotId).toArray()
    : await db.plotRevisions.toArray();
  return rows.sort((a, b) => b.decidedAt - a.decidedAt || b.revisionNo - a.revisionNo);
}

export async function listStandSummaries(plotId?: string): Promise<StandSummaryRecord[]> {
  const rows = plotId
    ? await db.standSummaries.where('plotId').equals(plotId).toArray()
    : await db.standSummaries.toArray();
  return rows.sort((a, b) => b.generatedAt - a.generatedAt || b.revisionNo - a.revisionNo);
}
