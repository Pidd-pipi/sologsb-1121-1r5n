/** 角色：调查员（录入、导入回传包）/ 质量员（裁定并写回正式台账） */
export type UserRole = 'surveyor' | 'qc';

export const ROLE_LABEL: Record<UserRole, string> = {
  surveyor: '调查员',
  qc: '质量员',
};

/** 县里年度回传的林草资源图斑 */
export interface CountyParcel {
  /** 图斑编号（官方） */
  parcelNo: string;
  /** 图斑标注的样地号（可能已改号，与台账对不上） */
  plotNo?: string;
  /** 曾用样地号（改号前） */
  formerPlotNo?: string;
  lng: number;
  lat: number;
  /** 官方面积 m² */
  area: number;
  /** 官方优势树种 */
  dominantSpecies: string;
  forestType?: string;
  locality?: string;
  /** 图斑区划时间 */
  mappedAt?: number;
}

/** 对账回传包：一批图斑 + 批次元信息 */
export interface CountyPackage {
  /** 回传年度，如 2025 */
  year: number;
  /** 批次号/批次名，可缺省（缺省用年度+内容指纹） */
  batchNo?: string;
  source: string;
  parcels: CountyParcel[];
}

/** 配对项状态 */
export type ReconStatus = 'auto' | 'pending' | 'confirmed' | 'dismissed';

export const RECON_STATUS_LABEL: Record<ReconStatus, string> = {
  auto: '自动配对',
  pending: '待裁定',
  confirmed: '已裁定写回',
  dismissed: '已裁定保留台账',
};

/** 自动配对/待裁定原因 */
export type MatchReason =
  | 'plot_no_exact'
  | 'former_plot_no'
  | 'coord_area_fallback'
  | 'unmatched'
  | 'unreferenced';

export const MATCH_REASON_LABEL: Record<MatchReason, string> = {
  plot_no_exact: '样地号一致',
  former_plot_no: '曾用号改号',
  coord_area_fallback: '坐标面积兜底',
  unmatched: '台账无对应样地',
  unreferenced: '无图斑对应',
};

/** 待裁定标记（可叠加） */
export type InfoFlag =
  | 'renumbered'
  | 'coord_diff'
  | 'area_diff'
  | 'species_mismatch'
  | 'one_plot_many_parcels'
  | 'many_plots_one_parcel';

export const INFO_FLAG_LABEL: Record<InfoFlag, string> = {
  renumbered: '疑似改号',
  coord_diff: '坐标偏差',
  area_diff: '面积偏差',
  species_mismatch: '优势树种不一致',
  one_plot_many_parcels: '一个样地落到多个图斑',
  many_plots_one_parcel: '多个样地对到同一图斑',
};

/** 一个候选对应样地（坐标面积兜底阶段可能有多个候选） */
export interface ParcelCandidate {
  plotId: string;
  plotNo: string;
  /** 图斑点到样地坐标距离 m */
  distanceM: number;
  /** 面积相对偏差（绝对值，0~1） */
  areaDeltaRatio: number;
  /** 命中方式 */
  via: 'plot_no' | 'former_no' | 'coord';
}

/** 单条对账配对项（每个图斑一条；多余样地另补 unreferenced 记录） */
export interface ReconMatch {
  /** 确定性 id：batchId + parcelNo（unreferenced 用 plotId），保证重复导入不重复生成 */
  id: string;
  batchId: string;
  parcelNo: string;
  parcel: CountyParcel;
  status: ReconStatus;
  reason: MatchReason;
  flags: InfoFlag[];
  /** 目标样地 id；auto/pending 时为首选候选，unmatched/unreferenced 见 candidates */
  plotId?: string;
  /** 参与比较的候选样地（含首选） */
  candidates: ParcelCandidate[];
  /** 图斑与首选样地的坐标/面积/树种差异摘要 */
  coordDeltaM?: number;
  areaDeltaRatio?: number;
  ledgerSpecies?: string;
  /** 裁定结果 */
  decision?: ReconDecision;
  /** 写回时生成的修订/汇总记录 id（便于追溯） */
  revisionId?: string;
  standSummaryId?: string;
  createdAt: number;
  decidedAt?: number;
}

/** 回传包批次（原始回传包整包留档，容量不足整批拒绝、原档保留） */
export interface ReconBatch {
  id: string;
  year: number;
  batchNo: string;
  source: string;
  parcelCount: number;
  rawJson: string;
  /** 原始包字节大小（用于容量预检） */
  rawBytes: number;
  importedAt: number;
  /** 汇总计数，导入后一次性算好 */
  autoCount: number;
  pendingCount: number;
  confirmedCount: number;
  dismissedCount: number;
}

/** 裁定动作 */
export type DecisionKind = 'adopt' | 'keep_ledger' | 'create_plot';

export const DECISION_KIND_LABEL: Record<DecisionKind, string> = {
  adopt: '采用官方数据写回',
  keep_ledger: '保留台账不改',
  create_plot: '按图斑新建样地',
};

/** 质量员对单条待裁定项的裁定结果 */
export interface ReconDecision {
  kind: DecisionKind;
  /** adopt 时实际选定的样地（一个图斑多个候选时由质量员选择） */
  targetPlotId?: string;
  /** create_plot 时新建样地的样地号 */
  newPlotNo?: string;
  note?: string;
  decidedBy: string;
  decidedAt: number;
}

/** 样地修订履历：每次写回前保存旧档快照，旧档案仍可查 */
export interface PlotRevision {
  /** 确定性 id：plotId + revisionNo */
  id: string;
  plotId: string;
  plotNo: string;
  revisionNo: number;
  batchId?: string;
  parcelNo?: string;
  /** 写回前完整样地快照；create_plot 时为空 */
  before?: import('./plot').Plot;
  /** 写回后完整样地快照 */
  after: import('./plot').Plot;
  changedFields: string[];
  decidedBy: string;
  decidedAt: number;
}

/** 林分汇总快照：官方面积/优势树种一变立即重算并存档 */
export interface StandSummaryRecord {
  /** 确定性 id：plotId + revisionNo（或 create 时的新 id） */
  id: string;
  plotId: string;
  plotNo: string;
  /** 对应修订版本号（0 表示建样地初版） */
  revisionNo: number;
  batchId?: string;
  trigger: 'recon_adopt' | 'recon_create';
  /** 当时样地关键字段快照（面积/优势树种一变，汇总随之重算） */
  area: number;
  dominantSpecies: string;
  surveyRound: number;
  perHaCount: number;
  aliveCount: number;
  meanDbh: number;
  meanHeight: number;
  totalBasalArea: number;
  basalAreaPerHa: number;
  regenPerHa: number;
  shrubPerHa: number;
  generatedAt: number;
}

/** 服务层抛出的业务错误 */
export class ReconError extends Error {
  constructor(
    message: string,
    /** 容量不足时为 true，调用方据此提示“整批拒绝、原档保留” */
    public capacity = false,
  ) {
    super(message);
    this.name = 'ReconError';
  }
}
