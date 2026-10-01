import { create } from 'zustand';
import { db } from '../utils/db';
import {
  applyAdjudication,
  batchConfirmAuto,
  buildOverCapacityPackage,
  buildSamplePackage,
  importReconPackage,
  rejectAdjudication,
  removeBatch,
  type ImportResult,
} from '../utils/reconcile';
import type { Plot } from '../types/plot';
import type {
  Adjudication,
  ArchiveChange,
  ReconBatch,
  ReconPackage,
  ResourcePatch,
} from '../types/recon';
import { usePlotStore } from './plotStore';

interface ReconState {
  batches: ReconBatch[];
  patches: ResourcePatch[];
  adjudications: Adjudication[];
  changes: ArchiveChange[];
  loaded: boolean;
  load: () => Promise<void>;
  importPackage: (pkg: ReconPackage, operator: string) => Promise<ImportResult>;
  loadSample: (operator: string) => Promise<ImportResult>;
  runOverCapacityDemo: (operator: string) => Promise<ImportResult>;
  confirm: (adj: Adjudication, operator: string) => Promise<void>;
  reject: (adj: Adjudication, operator: string) => Promise<void>;
  batchConfirm: (batchNo: string, operator: string) => Promise<number>;
  removeBatch: (batchNo: string) => Promise<void>;
}

async function reloadPlots() {
  await usePlotStore.getState().load();
}

export const useReconStore = create<ReconState>((set, get) => ({
  batches: [],
  patches: [],
  adjudications: [],
  changes: [],
  loaded: false,

  async load() {
    const [batches, patches, adjudications, changes] = await Promise.all([
      db.reconBatches.toArray(),
      db.patches.toArray(),
      db.adjudications.toArray(),
      db.archiveChanges.orderBy('changedAt').reverse().toArray(),
    ]);
    batches.sort((a, b) => b.importedAt - a.importedAt);
    set({ batches, patches, adjudications, changes, loaded: true });
  },

  async importPackage(pkg, operator) {
    const result = await importReconPackage(pkg, operator);
    if (result.ok) {
      await Promise.all([get().load(), reloadPlots()]);
    }
    return result;
  },

  async loadSample(operator) {
    const plots: Plot[] = usePlotStore.getState().items;
    const pkg = buildSamplePackage(plots);
    return get().importPackage(pkg, operator);
  },

  async runOverCapacityDemo(operator) {
    const currentCount = await db.patches.count();
    const pkg = buildOverCapacityPackage(currentCount);
    return get().importPackage(pkg, operator);
  },

  async confirm(adj, operator) {
    await applyAdjudication(adj, operator);
    await Promise.all([get().load(), reloadPlots()]);
  },

  async reject(adj, operator) {
    await rejectAdjudication(adj, operator);
    await get().load();
  },

  async batchConfirm(batchNo, operator) {
    const count = await batchConfirmAuto(batchNo, operator);
    await Promise.all([get().load(), reloadPlots()]);
    return count;
  },

  async removeBatch(batchNo) {
    await removeBatch(batchNo);
    await get().load();
  },
}));
