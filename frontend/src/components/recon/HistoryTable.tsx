import { Table, Tag, Typography, type TableProps } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import type { ArchiveChange } from '../../types/recon';

interface HistoryTableProps {
  changes: ArchiveChange[];
}

/** 档案变更历史：旧档案仍可查（面积/优势树种/坐标的旧值 → 新值） */
export default function HistoryTable({ changes }: HistoryTableProps) {
  const columns: TableProps<ArchiveChange>['columns'] = [
    { title: '样地号', dataIndex: 'plotNo', width: 130, fixed: 'left' },
    { title: '变更字段', dataIndex: 'fieldLabel', width: 110, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: '旧档案值',
      dataIndex: 'oldValue',
      width: 200,
      render: (v: string) => <Typography.Text type="secondary" delete={false}>{v}</Typography.Text>,
    },
    {
      title: '',
      key: 'arrow',
      width: 40,
      render: () => <ArrowRightOutlined />,
    },
    {
      title: '官方新值',
      dataIndex: 'newValue',
      width: 200,
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    { title: '批次号', dataIndex: 'batchNo', width: 150 },
    { title: '图斑号', dataIndex: 'patchNo', width: 120 },
    { title: '裁定（写回）人', dataIndex: 'changedBy', width: 120 },
    {
      title: '写回时间',
      dataIndex: 'changedAt',
      width: 170,
      render: (v: number) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  return (
    <Typography.Paragraph>
      <Table<ArchiveChange>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={changes}
        scroll={{ x: 1200 }}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        locale={{ emptyText: '暂无档案变更历史' }}
      />
    </Typography.Paragraph>
  );
}
