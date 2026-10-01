import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Badge, Layout, Menu, Segmented, Space, Spin, Typography } from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';
import { usePlotStore } from '../stores/plotStore';
import { useTreeStore } from '../stores/treeStore';
import { useRegenStore } from '../stores/regenStore';
import { useReconStore } from '../stores/reconStore';
import { useRoleStore } from '../stores/roleStore';
import { ensureSeedData, markDbVersion, readDbVersion } from '../utils/db';
import { ROLE_LABELS, type Role } from '../types/recon';
import PlotList from '../pages/PlotList';
import TreeEntry from '../pages/TreeEntry';
import RegenView from '../pages/RegenView';
import RecheckView from '../pages/RecheckView';
import PlotSummary from '../pages/PlotSummary';
import Reconcile from '../pages/Reconcile';

const { Header, Content } = Layout;

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const plots = usePlotStore((s) => s.items);
  const role = useRoleStore((s) => s.role);
  const setRole = useRoleStore((s) => s.setRole);
  const adjudications = useReconStore((s) => s.adjudications);
  const version = readDbVersion();

  const firstPlotId = plots[0]?.id;
  const pendingCount = adjudications.filter((a) => a.status === 'pending').length;

  const items = useMemo(
    () => [
      { key: '/plots', label: '样地台账' },
      { key: firstPlotId ? `/plots/${firstPlotId}/trees` : '/plots', label: '样木录入' },
      { key: firstPlotId ? `/plots/${firstPlotId}/regen` : '/plots', label: '更新与灌木' },
      { key: firstPlotId ? `/plots/${firstPlotId}/recheck` : '/plots', label: '复查比对' },
      { key: firstPlotId ? `/summary/${firstPlotId}` : '/plots', label: '林分汇总' },
      {
        key: '/reconcile',
        label: pendingCount > 0 ? <Badge count={pendingCount} size="small" offset={[6, -2]}>林草对账</Badge> : '林草对账',
      },
    ],
    [firstPlotId, pendingCount],
  );

  const selected = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/summary')) return items[4].key;
    if (path.startsWith('/reconcile')) return '/reconcile';
    if (path.endsWith('/trees')) return items[1].key;
    if (path.endsWith('/regen')) return items[2].key;
    if (path.endsWith('/recheck')) return items[3].key;
    return '/plots';
  }, [location.pathname, items]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#1f4032', paddingInline: 20 }}>
        <Space align="center">
          <ExperimentOutlined style={{ color: '#9fd8b4', fontSize: 20 }} />
          <Typography.Title level={5} style={{ color: '#f2f7f3', margin: 0, whiteSpace: 'nowrap' }}>
            森林样地调查记录台
          </Typography.Title>
        </Space>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[selected]}
          onClick={({ key }) => navigate(key)}
          items={items}
          style={{ flex: 1, minWidth: 0, background: 'transparent' }}
        />
        <Segmented
          value={role}
          onChange={(v) => setRole(v as Role)}
          options={[
            { value: 'investigator', label: ROLE_LABELS.investigator },
            { value: 'inspector', label: ROLE_LABELS.inspector },
          ]}
        />
        <Badge color="#9fd8b4" text={<span style={{ color: '#d7e8dc' }}>本地结构版本 v{version}</span>} />
      </Header>
      <Content className="app-content">
        <Routes>
          <Route path="/" element={<Navigate to="/plots" replace />} />
          <Route path="/plots" element={<PlotList />} />
          <Route path="/plots/:id/trees" element={<TreeEntry />} />
          <Route path="/plots/:id/regen" element={<RegenView />} />
          <Route path="/plots/:id/recheck" element={<RecheckView />} />
          <Route path="/summary/:plotId" element={<PlotSummary />} />
          <Route path="/reconcile" element={<Reconcile />} />
          <Route path="*" element={<Navigate to="/plots" replace />} />
        </Routes>
      </Content>
    </Layout>
  );
}

/** 应用路由 + 本地数据引导（IndexedDB 迁移 + 示范数据） */
export default function AppRouter() {
  const [ready, setReady] = useState(false);
  const loadPlots = usePlotStore((s) => s.load);
  const loadTrees = useTreeStore((s) => s.load);
  const loadRegens = useRegenStore((s) => s.load);
  const loadRecon = useReconStore((s) => s.load);

  useEffect(() => {
    let alive = true;
    (async () => {
      await ensureSeedData();
      markDbVersion();
      await Promise.all([loadPlots(), loadTrees(), loadRegens(), loadRecon()]);
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [loadPlots, loadTrees, loadRegens, loadRecon]);

  if (!ready) {
    return (
      <Space direction="vertical" align="center" style={{ width: '100%', paddingTop: 160 }}>
        <Spin size="large" />
        <Typography.Text type="secondary">正在打开本地样地档案库（IndexedDB）…</Typography.Text>
      </Space>
    );
  }

  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
