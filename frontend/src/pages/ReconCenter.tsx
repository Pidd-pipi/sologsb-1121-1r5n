import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
  message,
  type TableProps,
} from 'antd';
import {
  FileSearchOutlined,
  HistoryOutlined,
  InboxOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { useAuthStore } from '../stores/authStore';
import { usePlotStore } from '../stores/plotStore';
import { useReconStore } from '../stores/reconStore';
import { type ReconMatch } from '../types/reconcile';
import {
  INFO_FLAG_LABEL,
  MATCH_REASON_LABEL,
  RECON_STATUS_LABEL,
} from '../types/reconcile';
import DecisionModal, { type DecisionValue } from '../components/reconcile/DecisionModal';

type StatusFilter = 'pending' | 'auto' | 'confirmed' | 'dismissed' | 'all';

const STATUS_COLOR: Record<string, string> = {
  auto: 'green',
  pending: 'volcano',
  confirmed: 'blue',
  dismissed: 'default',
};

/** /reconcile 县里林草图斑年度对账中心：导入 → 自动配对 → 质量员裁定写回 */
export default function ReconCenter() {
  const role = useAuthStore((s) => s.role);
  const setRole = useAuthStore((s) => s.setRole);
  const { batches, matches, revisions, summaries, activeBatchId, loadAll, importRaw, selectBatch, adopt, keep, create } =
    useReconStore();
  const loadPlots = usePlotStore((s) => s.load);
  const plots = usePlotStore((s) => s.items);

  const [raw, setRaw] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [deciding, setDeciding] = useState<ReconMatch | undefined>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<'revision' | 'summary'>('revision');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [operator, setOperator] = useState('质量员·王敏');

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const activeBatch = batches.find((b) => b.id === activeBatchId);
  const batchMatches = useMemo(
    () =>
      matches
        .filter((m) => m.batchId === activeBatchId)
        .filter((m) => m.reason !== 'unreferenced'),
    [matches, activeBatchId],
  );
  const unrefMatches = useMemo(
    () => matches.filter((m) => m.batchId === activeBatchId && m.reason === 'unreferenced'),
    [matches, activeBatchId],
  );

  const filtered = useMemo(() => {
    const list = statusFilter === 'all' ? batchMatches : batchMatches.filter((m) => m.status === statusFilter);
    return [...list].sort((a, b) => a.parcelNo.localeCompare(b.parcelNo, 'zh-Hans-CN', { numeric: true }));
  }, [batchMatches, statusFilter]);

  const plotNoById = useMemo(() => new Map(plots.map((p) => [p.id, p.plotNo])), [plots]);

  const doImport = async (text: string) => {
    if (!text.trim()) {
      setNotice({ type: 'warning', text: '请先选择回传包文件或粘贴 JSON 内容' });
      return;
    }
    setBusy(true);
    try {
      const { duplicated, batch } = await importRaw(text);
      setNotice(
        duplicated
          ? { type: 'warning', text: `该回传包此前已导入（${batch.batchNo}），未重复生成配对项` }
          : { type: 'success', text: `回传包已整包留档并完成对账：自动 ${batch.autoCount} 项，待裁定 ${batch.pendingCount} 项` },
      );
      setRaw('');
      setStatusFilter('pending');
    } catch (e) {
      setNotice({ type: 'error', text: e instanceof Error ? e.message : '导入失败' });
    } finally {
      setBusy(false);
    }
  };

  const uploadProps: UploadProps = {
    accept: '.json,application/json',
    showUploadList: false,
    beforeUpload: async (file) => {
      const text = await file.text();
      setRaw(text);
      message.success(`已读取 ${file.name}，点击「导入并对账」`);
      return false;
    },
  };

  const loadSample = async () => {
    setBusy(true);
    try {
      const resp = await fetch('/sample-county-parcels.json');
      const text = await resp.text();
      setRaw(text);
      setNotice({ type: 'success', text: '已载入示范回传包，可直接「导入并对账」' });
    } catch {
      setNotice({ type: 'error', text: '示范包加载失败' });
    } finally {
      setBusy(false);
    }
  };

  const onDecision = async (value: DecisionValue) => {
    if (!deciding) return;
    const base = { matchId: deciding.id, role, operator };
    try {
      if (value.kind === 'adopt') {
        await adopt({ ...base, targetPlotId: value.targetPlotId, note: value.note });
      } else if (value.kind === 'keep_ledger') {
        await keep({ ...base, note: value.note });
      } else {
        await create({ ...base, newPlotNo: value.newPlotNo ?? '', note: value.note });
      }
      await loadPlots();
      await loadAll();
      setDeciding(undefined);
      setNotice({
        type: 'success',
        text:
          value.kind === 'keep_ledger'
            ? '已裁定保留台账，该图斑标记为“已裁定保留台账”'
            : '裁定已写回正式台账，修订履历已留存，复查比对与林分汇总已重算',
      });
    } catch (e) {
      setNotice({ type: 'error', text: e instanceof Error ? e.message : '裁定失败' });
    }
  };

  const columns: TableProps<ReconMatch>['columns'] = [
    {
      title: '图斑编号',
      dataIndex: 'parcelNo',
      width: 130,
      fixed: 'left',
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 130,
      render: (v: ReconMatch['status']) => <Tag color={STATUS_COLOR[v]}>{RECON_STATUS_LABEL[v]}</Tag>,
    },
    { title: '配对方式', dataIndex: 'reason', width: 120, render: (v: ReconMatch['reason']) => MATCH_REASON_LABEL[v] },
    {
      title: '台账样地',
      width: 130,
      render: (_, row) =>
        row.plotId ? (
          <Space size={4} direction="vertical">
            <Typography.Text>{plotNoById.get(row.plotId) ?? row.plotId}</Typography.Text>
            {row.candidates.length > 1 ? <Tag color="purple">候选 {row.candidates.length} 个</Tag> : null}
          </Space>
        ) : (
          <Tag color="red">无</Tag>
        ),
    },
    {
      title: '坐标偏差',
      dataIndex: 'coordDeltaM',
      width: 100,
      render: (v?: number) => (v === undefined ? '—' : `${v} m`),
    },
    {
      title: '面积偏差',
      dataIndex: 'areaDeltaRatio',
      width: 100,
      render: (v: number | undefined, row: ReconMatch) =>
        v === undefined ? '—' : (
          <Typography.Text type={v > 0.1 ? 'danger' : undefined}>
            {Math.round(v * 100)}%
            {row.parcel.area !== undefined ? `（官 ${row.parcel.area} m²）` : ''}
          </Typography.Text>
        ),
    },
    {
      title: '优势树种（官方 / 台账）',
      width: 220,
      render: (_, row) => (
        <Space size={4} wrap>
          <Tag color="blue">{row.parcel.dominantSpecies}</Tag>
          <span>/</span>
          <Typography.Text type={row.flags.includes('species_mismatch') ? 'danger' : undefined}>
            {row.ledgerSpecies || '—'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '待裁定标记',
      width: 260,
      render: (_, row) =>
        row.flags.length === 0 ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Space size={4} wrap>
            {row.flags.map((f) => (
              <Tag key={f} color="orange">
                {INFO_FLAG_LABEL[f]}
              </Tag>
            ))}
          </Space>
        ),
    },
    {
      title: '裁定结果',
      width: 180,
      render: (_, row) =>
        row.decision ? (
          <Space direction="vertical" size={0}>
            <Tag color={row.status === 'confirmed' ? 'blue' : 'default'}>
              {row.status === 'confirmed'
                ? row.decision.kind === 'create_plot'
                  ? `新建 ${row.decision.newPlotNo ?? ''}`
                  : '已采用官方写回'
                : '保留台账'}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.decision.decidedBy} · {new Date(row.decision.decidedAt).toLocaleString('zh-CN')}
            </Typography.Text>
          </Space>
        ) : (
          <Typography.Text type="secondary">未裁定</Typography.Text>
        ),
    },
    {
      title: '操作',
      width: 150,
      fixed: 'right',
      render: (_, row) => {
        if (role !== 'qc') {
          return (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              调查员不可裁定
            </Typography.Text>
          );
        }
        if (row.status === 'confirmed' || row.status === 'dismissed') {
          return (
            <Button size="small" type="link" onClick={() => setDeciding(row)}>
              查看/改判
            </Button>
          );
        }
        return (
          <Button size="small" type="primary" danger={row.status === 'pending'} onClick={() => setDeciding(row)}>
            去裁定
          </Button>
        );
      },
    },
  ];

  const pendingCount = activeBatch?.pendingCount ?? 0;

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Space wrap align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          县林草图斑年度对账中心
        </Typography.Title>
        <Tag icon={<SafetyCertificateOutlined />} color="gold">
          回传年份 {activeBatch?.year ?? '—'}
        </Tag>
        <div style={{ flex: 1 }} />
        <Space>
          <Typography.Text type="secondary">当前角色</Typography.Text>
          <Segmented
            value={role}
            onChange={(v) => {
              setRole(v as typeof role);
              setOperator(v === 'qc' ? '质量员·王敏' : '调查员·李调查');
            }}
            options={[
              { value: 'surveyor', label: '调查员' },
              { value: 'qc', label: '质量员' },
            ]}
          />
          <Input
            size="small"
            style={{ width: 150 }}
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
          />
          <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>
            修订与汇总档案
          </Button>
        </Space>
      </Space>

      {role === 'surveyor' ? (
        <Alert
          type="warning"
          showIcon
          message="调查员视图：可导入回传包、查看自动配对与待裁定清单，但不能裁定或写回正式台账；请切换到质量员完成裁定。"
        />
      ) : (
        <Alert
          type="success"
          showIcon
          message="质量员视图：可对全部「待裁定」项作出采用官方 / 保留台账 / 新建样地的裁定，确认后写回正式台账并留痕。"
        />
      )}

      {notice ? <Alert type={notice.type} showIcon message={notice.text} closable onClose={() => setNotice(null)} /> : null}

      {/* 导入区 */}
      <Card size="small" title="① 导入县里年度回传包（整包留档）">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space wrap>
            <Upload {...uploadProps}>
              <Button icon={<UploadOutlined />} loading={busy}>
                选择回传包 JSON
              </Button>
            </Upload>
            <Button icon={<FileSearchOutlined />} onClick={loadSample}>
              载入示范回传包
            </Button>
            <Button type="primary" loading={busy} onClick={() => void doImport(raw)}>
              导入并对账
            </Button>
            <Typography.Text type="secondary">
              同一回传包重复导入不会重复生成；容量不足整批拒绝、原档保留。
            </Typography.Text>
          </Space>
          <Input.TextArea
            rows={3}
            placeholder="也可直接粘贴回传包 JSON（含 year / parcels[].parcelNo,lng,lat,area,dominantSpecies）"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </Space>
      </Card>

      {/* 批次与统计 */}
      <Card size="small" title="② 回传批次与配对结果">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap>
            <Select
              style={{ width: 320 }}
              placeholder="选择回传批次"
              value={activeBatchId}
              onChange={selectBatch}
              options={batches.map((b) => ({
                value: b.id,
                label: `${b.year} · ${b.batchNo}（${b.parcelCount} 图斑，待裁定 ${b.pendingCount}）`,
              }))}
            />
            {activeBatch ? (
              <Typography.Text type="secondary">
                来源：{activeBatch.source} · 导入时间 {new Date(activeBatch.importedAt).toLocaleString('zh-CN')}
              </Typography.Text>
            ) : null}
          </Space>

          <Row gutter={12}>
            <Col span={4}>
              <Card size="small">
                <Statistic title="图斑总数" value={activeBatch?.parcelCount ?? 0} suffix="个" />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="自动配对" value={activeBatch?.autoCount ?? 0} valueStyle={{ color: '#3f8600' }} suffix="项" />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="待裁定" value={pendingCount} valueStyle={{ color: pendingCount ? '#cf1322' : undefined }} suffix="项" />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="已写回" value={activeBatch?.confirmedCount ?? 0} suffix="项" />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="保留台账" value={activeBatch?.dismissedCount ?? 0} suffix="项" />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="无图斑台账样地" value={unrefMatches.length} suffix="个" />
              </Card>
            </Col>
          </Row>
        </Space>
      </Card>

      {/* 配对清单 */}
      <Card
        size="small"
        title={
          <Space wrap>
            <span>③ 配对清单</span>
            <Segmented
              size="small"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
              options={[
                { value: 'pending', label: `待裁定 ${pendingCount}` },
                { value: 'auto', label: '自动配对' },
                { value: 'confirmed', label: '已写回' },
                { value: 'dismissed', label: '保留台账' },
                { value: 'all', label: '全部' },
              ]}
            />
          </Space>
        }
      >
        {!activeBatch ? (
          <Empty description="尚未导入任何回传包" />
        ) : (
          <Table<ReconMatch>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={filtered}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 1600 }}
            locale={{ emptyText: '当前筛选下没有配对项' }}
          />
        )}
        {unrefMatches.length > 0 ? (
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message={`另有 ${unrefMatches.length} 个台账样地在本批回传中没有任何图斑对应（不阻塞，仅提示）：${unrefMatches
              .map((m) => plotNoById.get(m.plotId ?? '') ?? m.plotId)
              .filter(Boolean)
              .join('、')}`}
          />
        ) : null}
      </Card>

      {/* 空状态拖拽提示 */}
      {batches.length === 0 ? (
        <Card size="small">
          <Empty
            image={<InboxOutlined style={{ fontSize: 40, color: '#b7c7bd' }} />}
            description="选择县里年度回传 JSON，或载入示范包开始对账"
          />
        </Card>
      ) : null}

      <DecisionModal
        open={Boolean(deciding)}
        match={deciding}
        operator={operator}
        onCancel={() => setDeciding(undefined)}
        onSubmit={onDecision}
      />

      <ReconHistoryDrawer
        open={historyOpen}
        tab={historyTab}
        setTab={setHistoryTab}
        onClose={() => setHistoryOpen(false)}
        revisions={revisions}
        summaries={summaries}
        plotNoById={plotNoById}
      />
    </Space>
  );
}

interface HistoryDrawerProps {
  open: boolean;
  tab: 'revision' | 'summary';
  setTab: (t: 'revision' | 'summary') => void;
  onClose: () => void;
  revisions: ReturnType<typeof useReconStore.getState>['revisions'];
  summaries: ReturnType<typeof useReconStore.getState>['summaries'];
  plotNoById: Map<string, string>;
}

/** 旧档案仍可查：修订履历（写回前/后快照）与历版林分汇总 */
function ReconHistoryDrawer({ open, tab, setTab, onClose, revisions, summaries, plotNoById }: HistoryDrawerProps) {
  return (
    <Drawer
      title="修订履历与林分汇总档案（旧版可查）"
      width={960}
      open={open}
      onClose={onClose}
      extra={
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as 'revision' | 'summary')}
          options={[
            { value: 'revision', label: `样地修订履历 ${revisions.length}` },
            { value: 'summary', label: `林分汇总版本 ${summaries.length}` },
          ]}
        />
      }
    >
      {tab === 'revision' ? (
        <Table
          rowKey="id"
          size="small"
          pagination={{ pageSize: 12 }}
          dataSource={revisions}
          columns={[
            {
              title: '样地',
              width: 120,
              render: (_, r) => plotNoById.get(r.plotId) ?? r.plotNo,
            },
            { title: '版本', dataIndex: 'revisionNo', width: 70, render: (v: number) => `v${v}` },
            { title: '图斑', dataIndex: 'parcelNo', width: 130 },
            {
              title: '变更字段',
              render: (_, r) =>
                r.changedFields.includes('__create__') ? (
                  <Tag color="blue">按图斑新建</Tag>
                ) : (
                  <Space wrap size={4}>
                    {r.changedFields.map((f) => (
                      <Tag key={f}>{f}</Tag>
                    ))}
                  </Space>
                ),
            },
            {
              title: '前 → 后',
              width: 320,
              render: (_, r) => (
                <Descriptions size="small" column={1} style={{ marginBottom: 0 }}>
                  {r.before ? (
                    <>
                      <Descriptions.Item label="旧面积/树种">
                        {r.before.area} m² · {r.before.dominantSpecies}
                      </Descriptions.Item>
                      <Descriptions.Item label="新面积/树种">
                        <Typography.Text strong>
                          {r.after.area} m² · {r.after.dominantSpecies}
                        </Typography.Text>
                      </Descriptions.Item>
                      {r.before.plotNo !== r.after.plotNo ? (
                        <Descriptions.Item label="改号">
                          {r.before.plotNo} → {r.after.plotNo}
                        </Descriptions.Item>
                      ) : null}
                    </>
                  ) : (
                    <Descriptions.Item label="新建">
                      {r.after.plotNo} · {r.after.area} m² · {r.after.dominantSpecies}
                    </Descriptions.Item>
                  )}
                </Descriptions>
              ),
            },
            { title: '裁定人', dataIndex: 'decidedBy', width: 110 },
            {
              title: '时间',
              width: 160,
              render: (_, r) => new Date(r.decidedAt).toLocaleString('zh-CN'),
            },
          ]}
        />
      ) : (
        <Table
          rowKey="id"
          size="small"
          pagination={{ pageSize: 12 }}
          dataSource={summaries}
          columns={[
            {
              title: '样地',
              width: 120,
              render: (_, r) => plotNoById.get(r.plotId) ?? r.plotNo,
            },
            { title: '版本', dataIndex: 'revisionNo', width: 70, render: (v: number) => `v${v}` },
            {
              title: '触发',
              width: 120,
              render: (_, r) => (
                <Badge
                  status={r.trigger === 'recon_create' ? 'processing' : 'success'}
                  text={r.trigger === 'recon_create' ? '新建重算' : '官方变更重算'}
                />
              ),
            },
            { title: '面积 m²', dataIndex: 'area', width: 90 },
            { title: '优势树种', dataIndex: 'dominantSpecies', width: 140 },
            { title: '每公顷株数', dataIndex: 'perHaCount', width: 100 },
            { title: '平均胸径', dataIndex: 'meanDbh', width: 90 },
            { title: '断面积/hm²', dataIndex: 'basalAreaPerHa', width: 100 },
            { title: '更新苗/hm²', dataIndex: 'regenPerHa', width: 100 },
            { title: '灌木/hm²', dataIndex: 'shrubPerHa', width: 90 },
            {
              title: '重算时间',
              width: 160,
              render: (_, r) => new Date(r.generatedAt).toLocaleString('zh-CN'),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
