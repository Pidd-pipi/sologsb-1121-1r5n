import { Button, Space, Table, Tag, Tooltip, Typography, type TableProps } from 'antd';
import { CheckOutlined, CloseOutlined, EyeOutlined } from '@ant-design/icons';
import type { Adjudication, AdjudicationIssue, ResourcePatch } from '../../types/recon';
import { ISSUE_LABELS } from '../../types/recon';
import RoleGate from './RoleGate';

interface PatchTableProps {
  adjudications: Adjudication[];
  patches: ResourcePatch[];
  onConfirm: (adj: Adjudication) => void;
  onReject: (adj: Adjudication) => void;
  onDetail: (adj: Adjudication) => void;
}

const STATUS_META: Record<Adjudication['status'], { color: string; text: string }> = {
  auto: { color: 'green', text: '自动通过' },
  pending: { color: 'orange', text: '待裁定' },
  confirmed: { color: 'blue', text: '已写回台账' },
  rejected: { color: 'default', text: '已驳回' },
};

const ISSUE_COLOR: Record<AdjudicationIssue, string> = {
  'one-plot-multi-patch': 'red',
  'multi-plot-one-patch': 'red',
  'species-mismatch': 'orange',
  'area-mismatch': 'orange',
  'coordinate-mismatch': 'orange',
  renamed: 'blue',
  unmatched: 'red',
};

const MATCH_BY_TEXT: Record<Adjudication['matchBy'], string> = {
  plotNo: '编号配对',
  'coordinate-area': '坐标面积确认',
  manual: '人工指定',
};

/** 图斑对账表：列出配对结果、问题标签与状态，质量员可确认写回或驳回 */
export default function PatchTable({ adjudications, patches, onConfirm, onReject, onDetail }: PatchTableProps) {
  const patchById = new Map(patches.map((p) => [p.id, p]));

  const columns: TableProps<Adjudication>['columns'] = [
    {
      title: '图斑编号',
      dataIndex: 'patchNo',
      width: 110,
      fixed: 'left',
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: '图斑记载样地号',
      dataIndex: 'plotNo',
      width: 130,
      render: (v: string) => v || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '坐标 (经, 纬)',
      key: 'coords',
      width: 170,
      render: (_: unknown, adj) => {
        const p = patchById.get(adj.id);
        return p ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {p.lng.toFixed(4)}, {p.lat.toFixed(4)}
          </Typography.Text>
        ) : (
          '—'
        );
      },
    },
    {
      title: '官方面积',
      dataIndex: 'officialArea',
      width: 100,
      render: (v: number) => `${v} m²`,
    },
    {
      title: '官方优势树种',
      dataIndex: 'officialSpecies',
      width: 140,
      ellipsis: true,
    },
    {
      title: '配对样地',
      dataIndex: 'plotNo',
      width: 120,
      render: (v: string, adj) =>
        v ? (
          <Space size={4}>
            <Typography.Text>{v}</Typography.Text>
            {adj.matchBy === 'coordinate-area' ? <Tag color="cyan">改号</Tag> : null}
          </Space>
        ) : (
          <Tag color="red">未配对</Tag>
        ),
    },
    {
      title: '配对方式',
      dataIndex: 'matchBy',
      width: 120,
      render: (v: Adjudication['matchBy']) => <Tag>{MATCH_BY_TEXT[v]}</Tag>,
    },
    {
      title: '面积差',
      dataIndex: 'areaDiffPct',
      width: 90,
      render: (v: number) =>
        v > 0 ? (
          <Typography.Text type={v > 0.15 ? 'danger' : 'secondary'}>{(v * 100).toFixed(1)}%</Typography.Text>
        ) : (
          '—'
        ),
    },
    {
      title: '坐标差',
      dataIndex: 'coordDiffM',
      width: 90,
      render: (v: number) =>
        v > 0 ? (
          <Typography.Text type={v > 300 ? 'danger' : 'secondary'}>{v} m</Typography.Text>
        ) : (
          '—'
        ),
    },
    {
      title: '问题',
      dataIndex: 'issues',
      width: 260,
      render: (issues: AdjudicationIssue[]) =>
        issues.length === 0 ? (
          <Tag color="green">一致</Tag>
        ) : (
          <Space size={2} wrap>
            {issues.map((i) => (
              <Tag key={i} color={ISSUE_COLOR[i]}>
                {ISSUE_LABELS[i]}
              </Tag>
            ))}
          </Space>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      fixed: 'right',
      render: (s: Adjudication['status']) => <Tag color={STATUS_META[s].color}>{STATUS_META[s].text}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 230,
      fixed: 'right',
      render: (_: unknown, adj) => {
        const decided = adj.status === 'confirmed' || adj.status === 'rejected';
        return (
          <Space size={4}>
            <Button size="small" icon={<EyeOutlined />} onClick={() => onDetail(adj)}>
              详情
            </Button>
            {decided ? (
              <Tooltip title={adj.status === 'confirmed' ? `已于 ${new Date(adj.appliedAt ?? 0).toLocaleString('zh-CN')} 写回` : '已驳回'}>
                <Tag color={adj.status === 'confirmed' ? 'blue' : 'default'}>
                  {adj.status === 'confirmed' ? '已写回' : '已驳回'}
                </Tag>
              </Tooltip>
            ) : (
              <>
                <RoleGate allow="inspector" label="仅质量员可确认写回正式台账">
                  <span>
                    <Tooltip title={!adj.plotId ? '该图斑未配对到唯一样地，无法写回；请驳回或人工处理' : ''}>
                      <Button
                        size="small"
                        type="primary"
                        icon={<CheckOutlined />}
                        onClick={() => onConfirm(adj)}
                        disabled={!adj.plotId}
                      >
                        确认写回
                      </Button>
                    </Tooltip>
                  </span>
                </RoleGate>
                <RoleGate allow="inspector" label="仅质量员可驳回裁定">
                  <Button size="small" danger icon={<CloseOutlined />} onClick={() => onReject(adj)}>
                    驳回
                  </Button>
                </RoleGate>
              </>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <Table<Adjudication>
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={adjudications}
      scroll={{ x: 1500 }}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      locale={{ emptyText: '暂无对账数据，请先导入回传包' }}
    />
  );
}
