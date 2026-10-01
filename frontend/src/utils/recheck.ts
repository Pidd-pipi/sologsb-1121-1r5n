import type { TreeRecord } from '../types/tree';
import type { RecheckDiff } from '../types/recheck';
import { newId } from './id';

export function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface BuildDiffsInput {
  plotId: string;
  trees: TreeRecord[];
  baseRound: number;
  targetRound: number;
  now?: number;
}

/** 由两期样木生成逐株比对（复查页与裁定写回后立即重算共用） */
export function buildRecheckDiffs(input: BuildDiffsInput): RecheckDiff[] {
  const { plotId, trees, baseRound, targetRound } = input;
  const now = input.now ?? Date.now();
  const baseList = trees.filter((t) => t.plotId === plotId && t.round === baseRound);
  const targetList = trees.filter((t) => t.plotId === plotId && t.round === targetRound);
  const baseMap = new Map<string, TreeRecord>();
  baseList.forEach((t) => baseMap.set(t.treeNo, t));
  const targetMap = new Map<string, TreeRecord>();
  targetList.forEach((t) => targetMap.set(t.treeNo, t));
  const allNos = Array.from(new Set([...baseMap.keys(), ...targetMap.keys()])).sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN', { numeric: true }),
  );

  return allNos.map((treeNo) => {
    const b = baseMap.get(treeNo);
    const t = targetMap.get(treeNo);
    const baseDbh = b?.dbhCm;
    const targetDbh = t?.dbhCm;
    return {
      id: newId('diff'),
      plotId,
      baseRound,
      targetRound,
      treeNo,
      species: t?.species ?? b?.species ?? '',
      baseDbhCm: baseDbh,
      targetDbhCm: targetDbh,
      baseHeightM: b?.heightM,
      targetHeightM: t?.heightM,
      dbhGrowth: baseDbh !== undefined && targetDbh !== undefined ? r2(targetDbh - baseDbh) : 0,
      heightGrowth: b && t ? r2(t.heightM - b.heightM) : 0,
      statusChange: b && t && b.status !== t.status ? `${b.status} → ${t.status}` : '',
      missingReason: !t ? '本期未复测（疑似采伐或倒伏）' : !b ? '本期新增进界木' : '',
      generatedAt: now,
    };
  });
}

/** 样地现有复查期次 */
export function plotRounds(trees: TreeRecord[], plotId: string): number[] {
  return Array.from(new Set(trees.filter((t) => t.plotId === plotId).map((t) => t.round))).sort(
    (a, b) => a - b,
  );
}
