import { create } from 'zustand';
import type { PlotRevision, ReconBatch, ReconMatch, StandSummaryRecord } from '../types/reconcile';
import {
  adoptOfficial,
  createPlotFromParcel,
  getMatch,
  importPackage,
  keepLedger,
  listBatches,
  listMatches,
  listRevisions,
  listStandSummaries,
  type AdoptInput,
  type CreateInput,
  type KeepInput,
} from '../utils/reconcileService';

interface ReconState {
  batches: ReconBatch[];
  matches: ReconMatch[];
  revisions: PlotRevision[];
  summaries: StandSummaryRecord[];
  activeBatchId?: string;
  loaded: boolean;
  loadAll: () => Promise<void>;
  importRaw: (raw: string) => Promise<{ duplicated: boolean; batch: ReconBatch }>;
  selectBatch: (batchId: string) => Promise<void>;
  adopt: (input: Omit<AdoptInput, 'match'> & { matchId: string }) => Promise<void>;
  keep: (input: Omit<KeepInput, 'match'> & { matchId: string }) => Promise<void>;
  create: (input: Omit<CreateInput, 'match'> & { matchId: string }) => Promise<void>;
}

export const useReconStore = create<ReconState>((set, get) => ({
  batches: [],
  matches: [],
  revisions: [],
  summaries: [],
  loaded: false,

  async loadAll() {
    const [batches, matches, revisions, summaries] = await Promise.all([
      listBatches(),
      listMatches(),
      listRevisions(),
      listStandSummaries(),
    ]);
    set({
      batches,
      matches,
      revisions,
      summaries,
      activeBatchId: get().activeBatchId ?? batches[0]?.id,
      loaded: true,
    });
  },

  async importRaw(raw) {
    const result = await importPackage(raw);
    await get().loadAll();
    set({ activeBatchId: result.batch.id });
    return { duplicated: result.duplicated, batch: result.batch };
  },

  async selectBatch(batchId) {
    set({ activeBatchId: batchId });
  },

  async adopt(input) {
    const match = await getMatch(input.matchId);
    if (!match) throw new Error('配对项不存在或已被移除');
    const { matchId, ...rest } = input;
    void matchId;
    const updated = await adoptOfficial({ ...rest, match });
    set({ matches: get().matches.map((m) => (m.id === updated.id ? updated : m)) });
    await get().loadAll();
  },

  async keep(input) {
    const match = await getMatch(input.matchId);
    if (!match) throw new Error('配对项不存在或已被移除');
    const { matchId, ...rest } = input;
    void matchId;
    const updated = await keepLedger({ ...rest, match });
    set({ matches: get().matches.map((m) => (m.id === updated.id ? updated : m)) });
    await get().loadAll();
  },

  async create(input) {
    const match = await getMatch(input.matchId);
    if (!match) throw new Error('配对项不存在或已被移除');
    const { matchId, ...rest } = input;
    void matchId;
    const updated = await createPlotFromParcel({ ...rest, match });
    set({ matches: get().matches.map((m) => (m.id === updated.id ? updated : m)) });
    await get().loadAll();
  },
}));
