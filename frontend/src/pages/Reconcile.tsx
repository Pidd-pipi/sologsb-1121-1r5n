import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tabs,
  Tooltip,
  Typography,
  Upload,
  type UploadProps,
} from 'antd';
import {
  CheckOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useReconStore } from '../stores/reconStore';
import { useRoleStore } from '../stores/roleStore';
import { usePlotStore } from '../stores/plotStore';
import {
  ARCHIVE_CAPACITY,
  ISSUE_LABELS,
  ROLE_LABELS,
  type Adjudication,
  type AdjudicationStatus,
  type ReconBatch,
  type ReconPackage,
} from '../types/recon';
import PatchTable from '../components/recon/PatchTable';
import HistoryTable from '../components/recon/HistoryTable';
import RoleGate from '../components/recon/RoleGate';

const { TextArea } = Input;

/** /reconcile 林草资源图斑对账回传包接入档案库 */
export default function Reconcile() {
  const role = useRoleStore((s) => s.role);
  const operator = ROLE_LABELS[role];
  const plots = usePlotStore((s) => s.items);
  const {
    batches,
    patches,
    adjudications,
    changes,
    loaded,
    load,
    importPackage,
    loadSample,
    runOverCapacityDemo,
    confirm,
    reject,
    batchConfirm,
    removeBatch,
  } = useReconStore();

  const [tab, setTab] = useState('patches');
  const [importOpen, setImportOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [importError, setImportError] = useState('');
  const [toast, setToast] = useState('');
  const [detail, setDetail] = useState<Adjudication | null>(null);
  const [statusFilter, setStatusFilter] = useState<AdjudicationStatus | 'all'>('all');
  const [batchFilter, setBatchFilter] = useState<string>('all');

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const pendingCount = adjudications.filter((a) => a.status === 'pending').length;
  const confirmedCount = adjudications.filter((a) => a.status === 'confirmed').length;
  const rejectedCount = adjudications.filter((a) => a.status === 'rejected').length;
  const autoCount = adjudications.filter((a) => a.status === 'auto').length;

  const filteredAdjs = useMemo(() => {
    return adjudications.filter((a) => {
      if (batchFilter !== 'all' && a.batchNo !== batchFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      return true;
    });
  }, [adjudications, batchFilter, statusFilter]);

  const runImport = async (pkg: ReconPackage) => {
    const result = await importPackage(pkg, operator);
    if (result.ok) {
      setToast(`回传包「${result.batchNo}」已接入：${result.imported} 个图斑，自动配对完成，等待质量员裁定写回`);
      setImportOpen(false);
      setJsonText('');
      setImportError('');
      setTab('patches');
      setBatchFilter(result.batchNo ?? 'all');
      setStatusFilter('all');
    } else {
      setImportError(result.rejected ? `整批拒绝：${result.reason}` : result.reason ?? '导入失败');
    }
  };

  const parseAndImport = () => {
    setImportError('');
    let pkg: ReconPackage;
    try {
      pkg = JSON.parse(jsonText) as ReconPackage;
    } catch {
      setImportError('JSON 解析失败，请检查回传包格式');
      return;
    }
    if (!pkg.batchNo || !Array.isArray(pkg.patches)) {
      setImportError('回传包需包含 batchNo 批次号与 patches 图斑数组');
      return;
    }
    void runImport(pkg);
  };

  const fileProps: UploadProps = {
    accept: '.json,application/json',
    showUploadList: false,
    beforeUpload: (file) => {
      const reader = new FileReader();
      reader.onload = () => setJsonText(String(reader.result ?? ''));
      reader.readAsText(file);
      return false;
    },
  };

  const onConfirm = async (adj: Adjudication) => {
    if (!adj.plotId) {
      setImportError('该图斑未配对到唯一样地，无法写回正式台账');
      return;
    }
    await confirm(adj, operator);
    setToast(`已写回正式台账：${adj.plotNo} 的面积/优势树种已按官方值更新，复查比对与林分汇总立即重算`);
  };
  const onReject = async (adj: Adjudication) => {
    await reject(adj, operator);
    setToast(`已驳回：${adj.patchNo} 不写回正式台账`);
  };
  const onBatchConfirm = async () => {
    const target = batchFilter === 'all' ? null : batchFilter;
    if (!target) {
      setImportError('请先选择一个批次再批量确认');
      return;
    }
    const n = await batchConfirm(target, operator);
    setToast(`已批量确认 ${n} 条自动通过项并写回正式台账`);
  };

  const detailPatch = detail ? patches.find((p) => p.id === detail.id) : null;
  const detailPlot = detail?.plotId ? plots.find((p) => p.id === detail.plotId) : null;

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Space wrap align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          林草资源图斑对账
        </Typography.Title>
        <Tag icon={<DatabaseOutlined />} color="blue">
          当前角色：{ROLE_LABELS[role]}
        </Tag>
        {pendingCount > 0 ? <Tag color="orange">{pendingCount} 项待裁定</Tag> : null}
        <div style={{ flex: 1 }} />
        <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
          导入回传包
        </Button>
      </Space>

      {toast ? <Alert type="success" showIcon message={toast} closable onClose={() => setToast('')} /> : null}
      {importError && !importOpen ? (
        <Alert type="error" showIcon message={importError} closable onClose={() => setImportError('')} />
      ) : null}

      <Row gutter={12}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="回传批次" value={batches.length} suffix="批" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="图斑总数" value={patches.length} suffix="份" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="待裁定" value={pendingCount} suffix="项" valueStyle={{ color: pendingCount ? '#d48806' : undefined }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="已写回台账" value={confirmedCount} suffix="项" />
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Space wrap align="center" style={{ width: '100%' }}>
          <Typography.Text type="secondary">档案库容量</Typography.Text>
          <Progress
            percent={Math.round((patches.length / ARCHIVE_CAPACITY) * 100)}
            size="small"
            style={{ width: 260, margin: 0 }}
            status={patches.length >= ARCHIVE_CAPACITY ? 'exception' : 'normal'}
          />
          <Typography.Text type="secondary">
            {patches.length} / {ARCHIVE_CAPACITY} 份
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            容量不足时整批拒绝并保留原档
          </Typography.Text>
        </Space>
      </Card>

      <Card size="small" styles={{ body: { paddingTop: 8 } }}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'patches',
              label: (
                <span>
                  <FileSearchOutlined /> 图斑对账
                </span>
              ),
              children: (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Space wrap>
                    <Select
                      style={{ width: 200 }}
                      value={batchFilter}
                      onChange={setBatchFilter}
                      options={[
                        { value: 'all', label: '全部批次' },
                        ...batches.map((b) => ({ value: b.batchNo, label: b.batchNo })),
                      ]}
                    />
                    <Select
                      style={{ width: 160 }}
                      value={statusFilter}
                      onChange={(v) => setStatusFilter(v)}
                      options={[
                        { value: 'all', label: '全部状态' },
                        { value: 'auto', label: '自动通过' },
                        { value: 'pending', label: '待裁定' },
                        { value: 'confirmed', label: '已写回台账' },
                        { value: 'rejected', label: '已驳回' },
                      ]}
                    />
                    <Tag color="green">自动通过 {autoCount}</Tag>
                    <Tag color="orange">待裁定 {pendingCount}</Tag>
                    <div style={{ flex: 1 }} />
                    <RoleGate allow="inspector" label="仅质量员可批量确认写回">
                      <Button
                        type="primary"
                        icon={<CheckOutlined />}
                        onClick={onBatchConfirm}
                        disabled={autoCount === 0}
                      >
                        一键确认自动通过项并写回
                      </Button>
                    </RoleGate>
                  </Space>
                  <PatchTable
                    adjudications={filteredAdjs}
                    patches={patches}
                    onConfirm={(a) => void onConfirm(a)}
                    onReject={(a) => void onReject(a)}
                    onDetail={setDetail}
                  />
                </Space>
              ),
            },
            {
              key: 'batches',
              label: (
                <span>
                  <CloudUploadOutlined /> 回传批次
                </span>
              ),
              children: (
                <Table<ReconBatch>
                  rowKey="batchNo"
                  size="small"
                  dataSource={batches}
                  pagination={false}
                  locale={{ emptyText: '暂无回传批次' }}
                  columns={[
                    { title: '批次号', dataIndex: 'batchNo', width: 170 },
                    { title: '来源', dataIndex: 'source', width: 200, ellipsis: true },
                    { title: '年份', dataIndex: 'year', width: 80 },
                    { title: '图斑数', dataIndex: 'totalCount', width: 90 },
                    { title: '导入人', dataIndex: 'importedBy', width: 120 },
                    {
                      title: '导入时间',
                      dataIndex: 'importedAt',
                      width: 170,
                      render: (v: number) => new Date(v).toLocaleString('zh-CN'),
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 110,
                      render: (s: string) => {
                        const map: Record<string, { color: string; text: string }> = {
                          pending: { color: 'orange', text: '待裁定' },
                          adjudicating: { color: 'blue', text: '裁定中' },
                          applied: { color: 'green', text: '已写回' },
                          rejected: { color: 'default', text: '已拒绝' },
                        };
                        const m = map[s] ?? { color: 'default', text: s };
                        return <Tag color={m.color}>{m.text}</Tag>;
                      },
                    },
                    {
                      title: '操作',
                      key: 'op',
                      width: 160,
                      render: (_: unknown, b) => (
                        <Space size={4}>
                          <Button
                            size="small"
                            type="link"
                            onClick={() => {
                              setBatchFilter(b.batchNo);
                              setStatusFilter('all');
                              setTab('patches');
                            }}
                          >
                            查看图斑
                          </Button>
                          <RoleGate allow="inspector" label="仅质量员可删除批次（变更历史保留）">
                            <Button
                              size="small"
                              danger
                              type="link"
                              icon={<DeleteOutlined />}
                              onClick={() => {
                                Modal.confirm({
                                  title: `删除批次 ${b.batchNo}？`,
                                  content: '将删除该批次的图斑与裁定结果，已写回的档案变更历史仍保留可查。',
                                  okText: '删除',
                                  okType: 'danger',
                                  cancelText: '取消',
                                  onOk: () => removeBatch(b.batchNo),
                                });
                              }}
                            >
                              删除
                            </Button>
                          </RoleGate>
                        </Space>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'history',
              label: (
                <span>
                  <HistoryOutlined /> 档案变更历史
                </span>
              ),
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Typography.Text type="secondary">
                    写回正式台账前的面积/优势树种/坐标旧值均留档，旧档案仍可查；官方值一变，复查比对与林分汇总立即按新值重算。
                  </Typography.Text>
                  <HistoryTable changes={changes} />
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="导入林草资源图斑回传包"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={parseAndImport}
        okText="接入档案库"
        cancelText="取消"
        width={720}
      >
        <Space direction="vertical" size={10} style={{ width: '100%', marginTop: 8 }}>
          {importError ? <Alert type="error" showIcon message={importError} /> : null}
          <Space wrap>
            <Upload {...fileProps}>
              <Button icon={<UploadOutlined />}>选择 JSON 文件</Button>
            </Upload>
            <Button
              icon={<ExperimentOutlined />}
              onClick={() => {
                void loadSample(operator).then((r) => {
                  if (!r.ok) setImportError(r.reason ?? '示例包导入失败');
                });
              }}
            >
              载入示例回传包
            </Button>
            <Button
              icon={<ThunderboltOutlined />}
              onClick={() => {
                Modal.confirm({
                  title: '模拟超容导入？',
                  content: '将构造一个超出档案库容量的回传包，整批拒绝且不写入任何数据，用于验证容量保护。',
                  okText: '模拟拒绝',
                  cancelText: '取消',
                  onOk: async () => {
                    const r = await runOverCapacityDemo(operator);
                    if (!r.ok) {
                      setImportError(r.reason ?? '已拒绝');
                    }
                  },
                });
              }}
            >
              模拟超容拒绝
            </Button>
          </Space>
          <Typography.Text type="secondary">
            回传包格式：批次号 batchNo + 图斑 patches（图斑号、记载样地号、经纬度、官方面积、官方优势树种）。重复导入按图斑号去重，不重复生成。
          </Typography.Text>
          <TextArea
            rows={12}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder='{"batchNo":"LC-2026-001","source":"林草局年度回传","year":2026,"patches":[{"patchNo":"TB-001","plotNo":"FP-4102","lng":128.8934,"lat":47.1832,"area":612,"dominantSpecies":"红松 + 紫椴"}]}'
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </Space>
      </Modal>

      <Modal
        title="图斑配对详情"
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={
          detail && detail.status !== 'confirmed' && detail.status !== 'rejected' ? (
            <Space>
              <Button onClick={() => setDetail(null)}>关闭</Button>
              <RoleGate allow="inspector" label="仅质量员可确认写回">
                <Tooltip title={!detail.plotId ? '该图斑未配对到唯一样地，无法写回；请驳回或人工处理' : ''}>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    disabled={!detail.plotId}
                    onClick={() => {
                      if (detail) void onConfirm(detail).then(() => setDetail(null));
                    }}
                  >
                    确认写回正式台账
                  </Button>
                </Tooltip>
              </RoleGate>
            </Space>
          ) : (
            <Button onClick={() => setDetail(null)}>关闭</Button>
          )
        }
      >
        {detail && detailPatch ? (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="图斑编号">{detailPatch.patchNo}</Descriptions.Item>
              <Descriptions.Item label="记载样地号">{detailPatch.plotNo}</Descriptions.Item>
              <Descriptions.Item label="官方坐标">
                {detailPatch.lng.toFixed(5)}, {detailPatch.lat.toFixed(5)}
              </Descriptions.Item>
              <Descriptions.Item label="配对方式">
                {detail.matchBy === 'plotNo' ? '编号配对' : detail.matchBy === 'coordinate-area' ? '坐标面积确认（改号）' : '人工指定'}
              </Descriptions.Item>
              <Descriptions.Item label="官方面积">{detailPatch.area} m²</Descriptions.Item>
              <Descriptions.Item label="地方面积">{detail.localArea} m²</Descriptions.Item>
              <Descriptions.Item label="官方优势树种" span={2}>
                {detailPatch.dominantSpecies}
              </Descriptions.Item>
              <Descriptions.Item label="地方优势树种" span={2}>
                {detail.localSpecies || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="面积差">{(detail.areaDiffPct * 100).toFixed(1)}%</Descriptions.Item>
              <Descriptions.Item label="坐标差">{detail.coordDiffM} m</Descriptions.Item>
              <Descriptions.Item label="问题" span={2}>
                <Space size={2} wrap>
                  {detail.issues.length === 0
                    ? '一致'
                    : detail.issues.map((i) => <Tag key={i}>{ISSUE_LABELS[i]}</Tag>)}
                </Space>
              </Descriptions.Item>
            </Descriptions>
            {detailPlot ? (
              <Alert
                type="info"
                showIcon
                message={`将写回样地「${detailPlot.plotNo}」：面积 ${detailPlot.area} → ${detailPatch.area} m²，优势树种 ${detailPlot.dominantSpecies} → ${detailPatch.dominantSpecies}`}
              />
            ) : (
              <Alert type="warning" showIcon message="该图斑未配对到地方样地，需质量员人工裁定后再写回" />
            )}
          </Space>
        ) : null}
      </Modal>
    </Space>
  );
}
