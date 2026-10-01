import { useEffect, useState } from 'react';
import { Alert, Descriptions, Form, Input, Modal, Radio, Select, Space, Tag, Typography } from 'antd';
import { usePlotStore } from '../../stores/plotStore';
import type { InfoFlag, ReconMatch } from '../../types/reconcile';
import { DECISION_KIND_LABEL, INFO_FLAG_LABEL } from '../../types/reconcile';

export interface DecisionValue {
  kind: 'adopt' | 'keep_ledger' | 'create_plot';
  targetPlotId?: string;
  newPlotNo?: string;
  note?: string;
}

export interface DecisionModalProps {
  open: boolean;
  match?: ReconMatch;
  operator: string;
  onCancel: () => void;
  onSubmit: (value: DecisionValue) => Promise<void> | void;
}

/** 质量员裁定弹窗：采用官方 / 保留台账 / 新建样地（三选一），候选样地可切换 */
export default function DecisionModal({ open, match, operator, onCancel, onSubmit }: DecisionModalProps) {
  const plots = usePlotStore((s) => s.items);
  const [form] = Form.useForm<DecisionValue>();
  const [submitting, setSubmitting] = useState(false);

  const candidateIds = match?.candidates.map((c) => c.plotId) ?? [];
  const candidatePlots = candidateIds
    .map((id) => plots.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const defaultKind = match?.reason === 'unmatched' ? 'create_plot' : 'adopt';

  useEffect(() => {
    if (open && match) {
      form.setFieldsValue({
        kind: defaultKind,
        targetPlotId: match.plotId ?? candidateIds[0],
        newPlotNo: match.parcel.plotNo && match.plotId ? '' : match.parcel.plotNo ?? `FP-NEW-${match.parcelNo.slice(-4)}`,
        note: '',
      });
    }
  }, [open, match?.id]);

  const kind = Form.useWatch('kind', form) as DecisionValue['kind'] | undefined;

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`质量裁定 · 图斑 ${match?.parcelNo ?? ''}`}
      onCancel={onCancel}
      onOk={submit}
      confirmLoading={submitting}
      okText="确认裁定并写回"
      cancelText="取消"
      width={680}
    >
      {match ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message={`当前操作人：${operator}（质量员）`}
            description="裁定一经确认即写入正式台账，并自动留存修订履历、重算复查比对与林分汇总；调查员无此权限。"
          />
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="图斑编号">{match.parcelNo}</Descriptions.Item>
            <Descriptions.Item label="标注样地号">{match.parcel.plotNo || '—'}</Descriptions.Item>
            <Descriptions.Item label="官方坐标">
              {match.parcel.lng.toFixed(4)}, {match.parcel.lat.toFixed(4)}
            </Descriptions.Item>
            <Descriptions.Item label="官方面积">{match.parcel.area} m²</Descriptions.Item>
            <Descriptions.Item label="官方优势树种" span={2}>
              {match.parcel.dominantSpecies}
            </Descriptions.Item>
            <Descriptions.Item label="台账树种" span={2}>
              {match.ledgerSpecies || '—'}
            </Descriptions.Item>
          </Descriptions>

          <Form form={form} layout="vertical">
            <Form.Item name="kind" label="裁定方式" rules={[{ required: true }]}>
              <Radio.Group
                options={[
                  {
                    value: 'adopt',
                    label: DECISION_KIND_LABEL.adopt,
                    disabled: match.reason === 'unmatched',
                  },
                  { value: 'keep_ledger', label: DECISION_KIND_LABEL.keep_ledger },
                  {
                    value: 'create_plot',
                    label: DECISION_KIND_LABEL.create_plot,
                    disabled: match.reason !== 'unmatched',
                  },
                ]}
              />
            </Form.Item>

            {kind === 'adopt' ? (
              <Form.Item
                name="targetPlotId"
                label="写回目标样地（一个图斑多个候选时请指定）"
                rules={[{ required: true, message: '请选择目标样地' }]}
              >
                <Select
                  style={{ width: '100%' }}
                  placeholder="选择候选样地"
                  options={candidatePlots.map((p) => ({
                    value: p.id,
                    label: `${p.plotNo} · ${p.locality} · ${p.area} m² · ${p.dominantSpecies}`,
                  }))}
                />
              </Form.Item>
            ) : null}

            {kind === 'create_plot' ? (
              <Form.Item
                name="newPlotNo"
                label="新建样地编号"
                rules={[{ required: true, message: '请填写新样地编号' }]}
              >
                <Input placeholder="如 FP-9001" />
              </Form.Item>
            ) : null}

            <Form.Item name="note" label="裁定说明（留档）">
              <Input.TextArea rows={2} placeholder="可记录裁定依据，如经外业复核以官方树种为准" />
            </Form.Item>
          </Form>

          <div>
            {match.flags.map((f) => (
              <Tag key={f} color="orange" style={{ marginBottom: 4 }}>
                {INFO_FLAG_LABEL[f as InfoFlag]}
              </Tag>
            ))}
          </div>
        </Space>
      ) : null}
    </Modal>
  );
}
