import { create } from 'zustand';
import type { UserRole } from '../types/reconcile';

const ROLE_KEY = 'gbforestplot:role';

interface AuthState {
  role: UserRole;
  setRole: (role: UserRole) => void;
  isQc: () => boolean;
}

function readInitialRole(): UserRole {
  try {
    const raw = window.localStorage.getItem(ROLE_KEY);
    return raw === 'qc' ? 'qc' : 'surveyor';
  } catch {
    return 'surveyor';
  }
}

/** 当前登录角色：调查员只能导入/提交，质量员才能裁定写回 */
export const useAuthStore = create<AuthState>((set, get) => ({
  role: readInitialRole(),
  setRole(role) {
    try {
      window.localStorage.setItem(ROLE_KEY, role);
    } catch {
      /* localStorage 不可用时忽略 */
    }
    set({ role });
  },
  isQc() {
    return get().role === 'qc';
  },
}));

/** 质量员专属操作的统一守卫：调查员调用直接抛错，不可越过角色权限 */
export function requireQc(role: UserRole): void {
  if (role !== 'qc') {
    throw new Error('越权操作：待裁定结果须由质量员确认后才能写回正式台账，调查员无权裁定');
  }
}
