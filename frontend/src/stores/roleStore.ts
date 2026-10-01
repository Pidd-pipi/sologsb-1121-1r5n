import { create } from 'zustand';
import type { Role } from '../types/recon';

const STORAGE_KEY = 'gbforestplot:role';

function readRole(): Role {
  try {
    return (window.localStorage.getItem(STORAGE_KEY) as Role) || 'investigator';
  } catch {
    return 'investigator';
  }
}

interface RoleState {
  role: Role;
  setRole: (role: Role) => void;
  isInspector: () => boolean;
}

/** 角色：调查员（导入/查看）/ 质量员（裁定写回）。调查员不可越过角色权限。 */
export const useRoleStore = create<RoleState>((set, get) => ({
  role: readRole(),
  setRole: (role) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, role);
    } catch {
      /* localStorage 不可用时忽略 */
    }
    set({ role });
  },
  isInspector: () => get().role === 'inspector',
}));
