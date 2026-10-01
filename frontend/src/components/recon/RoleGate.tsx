import React from 'react';
import { Tooltip } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useRoleStore } from '../../stores/roleStore';
import type { Role } from '../../types/recon';

interface RoleGateProps {
  /** 允许执行该操作的角色 */
  allow: Role;
  /** 无权限时的提示文案 */
  label?: string;
  children: React.ReactElement;
}

/** 角色权限门：调查员不可越过角色权限执行质量员操作 */
export default function RoleGate({ allow, label, children }: RoleGateProps) {
  const role = useRoleStore((s) => s.role);
  if (role === allow) return children;
  return (
    <Tooltip title={label ?? `仅质量员可执行该操作，当前角色为调查员，无权限`}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          opacity: 0.55,
          cursor: 'not-allowed',
        }}
      >
        <LockOutlined />
        {React.cloneElement(children, { disabled: true })}
      </span>
    </Tooltip>
  );
}
