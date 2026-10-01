import type {
  CountyParcel,
  InfoFlag,
  MatchReason,
  ParcelCandidate,
  ReconBatch,
  ReconMatch,
  ReconStatus,
} from '../types/reconcile';

/** 坐标匹配半径 m：超出不做坐标面积兜底 */
export const COORD_TOLERANCE_M = 150;
/** 面积相对偏差阈值：超出视为面积不一致（仍可配对但需关注） */
export const AREA_TOLERANCE_RATIO = 0.1;

export interface LedgerPlotLite {
  id: string;
  plotNo: string;
  formerPlotNo?: string;
  lng: number;
  lat: number;
  area: number;
  dominantSpecies: string;
}

/** 内容指纹：对整批图斑编号+关键值做稳定哈希，用于批次去重 */
export function packageFingerprint(year: number, parcels: CountyParcel[]): string {
  const parts = parcels
    .map(
      (p) =>
        [p.parcelNo, p.plotNo ?? '', p.formerPlotNo ?? '', p.lng, p.lat, p.area, p.dominantSpecies].join('|'),
    )
    .sort()
    .join('||');
  let hash = 5381;
  const src = `${year}#${parts}`;
  for (let i = 0; i < src.length; i += 1) {
    hash = (hash * 33 + src.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/** 估算 JSON 字节大小（UTF-8） */
export function jsonByteSize(raw: string): number {
  return new Blob([raw]).size;
}

/** 两点经纬度距离（m，等距正射近似，县域尺度足够） */
export function coordDistanceM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dx = (lng1 - lng2) * mPerDegLng;
  const dy = (lat1 - lat2) * mPerDegLat;
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

export function areaDeltaRatio(parcelArea: number, plotArea: number): number {
  if (!plotArea || plotArea <= 0) return 1;
  return Math.round((Math.abs(parcelArea - plotArea) / plotArea) * 1000) / 1000;
}

function speciesEqual(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .replace(/[\s+＋、,，/／]+/g, '')
      .replace(/林$/g, '')
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // 组合树种（如“红松紫椴” vs “红松”）互为包含视为一致
  return na.includes(nb) || nb.includes(na);
}

function buildCandidate(parcel: CountyParcel, plot: LedgerPlotLite, via: ParcelCandidate['via']): ParcelCandidate {
  return {
    plotId: plot.id,
    plotNo: plot.plotNo,
    distanceM: coordDistanceM(parcel.lng, parcel.lat, plot.lng, plot.lat),
    areaDeltaRatio: areaDeltaRatio(parcel.area, plot.area),
    via,
  };
}

export interface BuildReconInput {
  batch: Pick<ReconBatch, 'id'>;
  parcels: CountyParcel[];
  ledger: LedgerPlotLite[];
  now?: number;
}

export interface BuildReconResult {
  matches: ReconMatch[];
  /** 每个图斑命中的样地（用于多对一冲突标记） */
  autoCount: number;
  pendingCount: number;
}

/**
 * 对账核心：
 * 1) 先用样地编号配对（plotNo）；
 * 2) 对不上再用曾用号（formerPlotNo）识别改号；
 * 3) 仍对不上按坐标+面积兜底；
 * 4) 一对多 / 多对一 / 树种不一致 → 待裁定；
 * 5) 台账中没有任何图斑引用的样地 → unreferenced（仅提示，不阻塞）。
 */
export function buildReconMatches(input: BuildReconInput): BuildReconResult {
  const { batch, parcels, ledger } = input;
  const now = input.now ?? Date.now();

  const byPlotNo = new Map(ledger.map((p) => [p.plotNo.trim(), p]));
  const byFormerNo = new Map<string, LedgerPlotLite>();
  ledger.forEach((p) => {
    if (p.formerPlotNo) byFormerNo.set(p.formerPlotNo.trim(), p);
  });

  // 每个图斑 → 候选集合
  const resolved: Array<{
    parcel: CountyParcel;
    reason: MatchReason;
    primary?: LedgerPlotLite;
    candidates: ParcelCandidate[];
  }> = [];

  parcels.forEach((parcel) => {
    const declared = parcel.plotNo?.trim();
    const former = parcel.formerPlotNo?.trim();

    // 1) 样地号直接配对
    if (declared && byPlotNo.has(declared)) {
      const plot = byPlotNo.get(declared)!;
      resolved.push({ parcel, reason: 'plot_no_exact', primary: plot, candidates: [buildCandidate(parcel, plot, 'plot_no')] });
      return;
    }

    // 2) 曾用号 → 改号（图斑标注的是旧号，或显式给了 formerPlotNo）
    const formerHit =
      (former && byFormerNo.get(former)) || (declared ? byFormerNo.get(declared) : undefined);
    if (formerHit) {
      resolved.push({ parcel, reason: 'former_plot_no', primary: formerHit, candidates: [buildCandidate(parcel, formerHit, 'former_no')] });
      return;
    }

    // 3) 坐标 + 面积兜底：半径内全部作为候选
    const near = ledger
      .map((p) => buildCandidate(parcel, p, 'coord'))
      .filter((c) => c.distanceM <= COORD_TOLERANCE_M)
      .sort((a, b) => a.distanceM - b.distanceM || a.areaDeltaRatio - b.areaDeltaRatio);

    if (near.length > 0) {
      const primary = ledger.find((p) => p.id === near[0].plotId)!;
      resolved.push({ parcel, reason: 'coord_area_fallback', primary, candidates: near });
      return;
    }

    // 无候选
    resolved.push({ parcel, reason: 'unmatched', candidates: [] });
  });

  // —— 冲突标记 ——
  // 一个样地被多个图斑命中
  const parcelCountByPlot = new Map<string, number>();
  resolved.forEach((r) => {
    if (r.primary) parcelCountByPlot.set(r.primary.id, (parcelCountByPlot.get(r.primary.id) ?? 0) + 1);
  });

  const usedPlotIds = new Set<string>();
  resolved.forEach((r) => r.primary && usedPlotIds.add(r.primary.id));

  const matches: ReconMatch[] = resolved.map((r) => {
    const flags: InfoFlag[] = [];
    const { parcel, primary, candidates } = r;
    let status: ReconStatus = 'auto';
    let coordDeltaM: number | undefined;
    let areaDelta: number | undefined;
    let ledgerSpecies: string | undefined;

    if (primary) {
      coordDeltaM = coordDistanceM(parcel.lng, parcel.lat, primary.lng, primary.lat);
      areaDelta = areaDeltaRatio(parcel.area, primary.area);
      ledgerSpecies = primary.dominantSpecies;

      if (r.reason === 'former_plot_no') flags.push('renumbered');
      if (coordDeltaM > 0) flags.push('coord_diff');
      if (areaDelta > AREA_TOLERANCE_RATIO) flags.push('area_diff');
      if (!speciesEqual(parcel.dominantSpecies, primary.dominantSpecies)) flags.push('species_mismatch');

      // 一个样地落到多个图斑
      if ((parcelCountByPlot.get(primary.id) ?? 0) > 1) flags.push('one_plot_many_parcels');
      // 一个图斑对到多个样地候选
      if (candidates.length > 1) flags.push('many_plots_one_parcel');

      // 编号一致且坐标/面积/树种均一致 → 自动配对；其余（含改号、兜底、任何冲突）→ 待裁定
      const hardConflict =
        r.reason !== 'plot_no_exact' ||
        flags.includes('species_mismatch') ||
        flags.includes('one_plot_many_parcels') ||
        flags.includes('many_plots_one_parcel') ||
        areaDelta > AREA_TOLERANCE_RATIO;
      if (hardConflict) status = 'pending';
    } else {
      status = 'pending';
    }

    return {
      id: `${batch.id}:parcel:${parcel.parcelNo}`,
      batchId: batch.id,
      parcelNo: parcel.parcelNo,
      parcel,
      status,
      reason: r.reason,
      flags,
      plotId: primary?.id,
      candidates,
      coordDeltaM,
      areaDeltaRatio: areaDelta,
      ledgerSpecies,
      createdAt: now,
    };
  });

  // 无图斑对应的台账样地 → unreferenced 提示项
  ledger.forEach((plot) => {
    if (usedPlotIds.has(plot.id)) return;
    matches.push({
      id: `${batch.id}:unref:${plot.id}`,
      batchId: batch.id,
      parcelNo: '—',
      parcel: {
        parcelNo: '—',
        lng: plot.lng,
        lat: plot.lat,
        area: plot.area,
        dominantSpecies: plot.dominantSpecies,
      },
      status: 'auto',
      reason: 'unreferenced',
      flags: [],
      plotId: plot.id,
      candidates: [
        { plotId: plot.id, plotNo: plot.plotNo, distanceM: 0, areaDeltaRatio: 0, via: 'plot_no' },
      ],
      ledgerSpecies: plot.dominantSpecies,
      createdAt: now,
    });
  });

  const pendingCount = matches.filter((m) => m.status === 'pending').length;
  return {
    matches,
    autoCount: matches.length - pendingCount,
    pendingCount,
  };
}
