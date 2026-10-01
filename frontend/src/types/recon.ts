/** 角色：调查员（导入/查看）与质量员（裁定/写回正式台账） */
export type Role = 'investigator' | 'inspector';

export const ROLE_LABELS: Record<Role, string> = {
  investigator: '调查员',
  inspector: '质量员',
};

/** 林草资源图斑（县里年度回传的对账数据） */
export interface ResourcePatch {
  /** 主键，幂等键 `${batchNo}::${patchNo}`，重复导入不重复生成 */
  id: string;
  /** 回传批次号 */
  batchNo: string;
  /** 图斑编号 */
  patchNo: string;
  /** 图斑记载的样地编号（可能与地方台账不同 → 改号） */
  plotNo: string;
  lng: number;
  lat: number;
  /** 官方面积 m² */
  area: number;
  /** 官方优势树种 */
  dominantSpecies: string;
  forestType?: string;
  township?: string;
  village?: string;
  importedAt: number;
}

/** 回传批次 */
export interface ReconBatch {
  batchNo: string;
  source: string;
  year: number;
  importedAt: number;
  /** 导入人（调查员） */
  importedBy: string;
  totalCount: number;
  status: 'pending' | 'adjudicating' | 'applied' | 'rejected';
  note: string;
}

/** 配对方式 */
export type MatchBy = 'plotNo' | 'coordinate-area' | 'manual';

/** 裁定状态 */
export type AdjudicationStatus =
  | 'auto' // 编号/坐标/面积/树种全部一致，自动通过，待质量员确认写回
  | 'pending' // 存在冲突或不一致，待质量员裁定
  | 'confirmed' // 质量员已确认并写回
  | 'rejected'; // 质量员驳回，不写回

/** 问题类型 */
export type AdjudicationIssue =
  | 'one-plot-multi-patch' // 一个样地落到多个图斑
  | 'multi-plot-one-patch' // 多个样地对到同一图斑
  | 'species-mismatch' // 树种不一致
  | 'area-mismatch' // 面积不一致（超阈值）
  | 'coordinate-mismatch' // 坐标不一致（超阈值）
  | 'renamed' // 改号（编号不一致但坐标面积吻合，已确认）
  | 'unmatched'; // 无法配对

export const ISSUE_LABELS: Record<AdjudicationIssue, string> = {
  'one-plot-multi-patch': '一个样地落到多个图斑',
  'multi-plot-one-patch': '多个样地对到同一图斑',
  'species-mismatch': '树种不一致',
  'area-mismatch': '面积不一致',
  'coordinate-mismatch': '坐标不一致',
  renamed: '改号确认',
  unmatched: '无法配对',
};

/** 阻断性问题（出现即待裁定） */
export const BLOCKING_ISSUES: AdjudicationIssue[] = [
  'one-plot-multi-patch',
  'multi-plot-one-patch',
  'species-mismatch',
  'area-mismatch',
  'coordinate-mismatch',
  'unmatched',
];

/** 配对/裁定结果 */
export interface Adjudication {
  /** 与图斑一致的幂等键 */
  id: string;
  batchNo: string;
  patchNo: string;
  /** 配对到的地方样地 id（unmatched 时为空） */
  plotId: string;
  /** 地方样地号（快照） */
  plotNo: string;
  matchBy: MatchBy;
  status: AdjudicationStatus;
  issues: AdjudicationIssue[];
  /** 官方值（写回用） */
  officialArea: number;
  officialSpecies: string;
  officialLng: number;
  officialLat: number;
  /** 地方现值（比对快照） */
  localArea: number;
  localSpecies: string;
  areaDiffPct: number;
  coordDiffM: number;
  decidedBy?: string;
  decidedAt?: number;
  appliedAt?: number;
  createdAt: number;
}

/** 档案变更历史（旧档案仍可查） */
export interface ArchiveChange {
  id: string;
  plotId: string;
  plotNo: string;
  field: 'area' | 'dominantSpecies' | 'coords';
  fieldLabel: string;
  oldValue: string;
  newValue: string;
  batchNo: string;
  patchNo: string;
  changedBy: string;
  changedAt: number;
}

/** 回传包（县里年度回传格式） */
export interface ReconPackage {
  batchNo: string;
  source?: string;
  year?: number;
  note?: string;
  patches: Array<{
    patchNo: string;
    plotNo: string;
    lng: number;
    lat: number;
    area: number;
    dominantSpecies: string;
    forestType?: string;
    township?: string;
    village?: string;
  }>;
}

/** 档案库容量（图斑份数上限），超出即整批拒绝 */
export const ARCHIVE_CAPACITY = 200;

/** 改号确认阈值：坐标差 ≤ 100m 且面积差 ≤ 10% 视为同一图斑 */
export const COORD_CONFIRM_M = 100;
export const AREA_CONFIRM_PCT = 0.1;
/** 坐标不一致阈值：编号配对时坐标差 > 300m 标记不一致 */
export const COORD_MISMATCH_M = 300;
/** 面积不一致阈值：面积差 > 15% 标记不一致 */
export const AREA_MISMATCH_PCT = 0.15;

/** 哈弗辛距离 m */
export function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** 树种归一化：去空格、统一分隔符、排序，便于顺序无关比对 */
export function normSpecies(s: string): string {
  return (s ?? '')
    .replace(/[＋、，,；;\s]/g, '+')
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean)
    .sort()
    .join('+');
}

/** 面积差百分比（相对地方值） */
export function areaDiffPct(official: number, local: number): number {
  if (!local || local <= 0) return 0;
  return Math.abs(official - local) / local;
}
