import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ShipmentHistoryEntry } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useApiMutation, useFollowUps } from '../../features/admin';
import { useToast } from '../../components/Toast';
import { ErrorBanner } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Phnom_Penh',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** "thcHblDate" → "Thc Hbl Date"; the few that read badly are named outright. */
const FIELD_NAMES: Record<string, string> = {
  hblNo: 'HBL / AWB No.',
  blDate: 'BL Date',
  incoterm: 'Incoterm',
  currency: 'Currency',
  exchangeRate: 'Exchange Rate',
  thcHblNo: 'Invoice / THC No.',
  thcHblDate: 'Invoice / THC Date',
  thcHblAmount: 'Invoice / THC Amount',
  doDate: 'DO Date',
  doNo: 'DO No.',
  eta: 'ETA',
  etd: 'ETD',
  atd: 'ATD',
  ata: 'ATA',
  crd: 'CRD',
  coNumber: 'CO Number',
  coForm: 'CO Form',
  coStatus: 'CO Status',
  arriveFty: 'Arrive Factory',
  podReceived: 'POD',
  clientId: 'Client',
  consigneeId: 'Consignee',
  forwarderId: 'Forwarder',
  assignedToId: 'Assigned Staff',
  clearancePortId: 'Clearance Port',
  originCountryIso2: 'Origin Country',
  destinationCountryIso2: 'Destination Country',
  loadType: 'Terms',
  transportMode: 'Freight',
};
const fieldName = (k: string) =>
  FIELD_NAMES[k] ??
  k
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

const ACTION: Record<string, string> = {
  CREATE: 'Created',
  UPDATE: 'Saved',
  DELETE: 'Deleted',
};

function Head({ km, en, sub }: { km: string; en: string; sub?: string }) {
  return (
    <div className="cx-card-head">
      <div className="cx-title">
        <div>
          <h3>
            {km} <span style={{ fontWeight: 500, color: 'var(--text-tertiary)' }}>/ {en}</span>
          </h3>
          {sub && <p className="create-header-desc">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

const cell = { padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' } as const;

/** សវនកម្ម / Audit: who created and saved the shipment, and which fields each save changed. */
export function AuditTab({ shipmentId }: { shipmentId: string | undefined }) {
  const history = useQuery({
    queryKey: [...queryKeys.shipment(shipmentId ?? 'new'), 'history'],
    queryFn: () => api<ShipmentHistoryEntry[]>(`/shipments/${shipmentId}/history`),
    enabled: !!shipmentId,
  });
  return (
    <div className="cx-card">
      <Head km="សវនកម្ម" en="Audit" sub="Every save of this shipment, newest first." />
      {!shipmentId ? (
        <p className="create-header-desc">The history starts once the shipment is created.</p>
      ) : history.isLoading ? (
        <p className="create-header-desc">Loading…</p>
      ) : history.error ? (
        <ErrorBanner error={history.error} />
      ) : !history.data?.length ? (
        <p className="create-header-desc">No changes recorded yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)' }}>
                <th style={cell}>កាលបរិច្ឆេទ / When</th>
                <th style={cell}>អ្នកប្រើប្រាស់ / By</th>
                <th style={cell}>សកម្មភាព / Action</th>
                <th style={cell}>ការផ្លាស់ប្ដូរ / Changes</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((h) => (
                <tr key={h.id}>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{when(h.at)}</td>
                  <td style={cell}>{h.userName ?? 'System'}</td>
                  <td style={cell}>{ACTION[h.action] ?? h.action}</td>
                  <td style={{ ...cell, color: 'var(--text-secondary)' }}>
                    {h.action === 'UPDATE'
                      ? h.changed.length
                        ? h.changed.map(fieldName).join(', ')
                        : 'No field changes'
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const PRIORITY: Record<string, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };
const STATUS: Record<string, string> = {
  OPEN: 'Open',
  AWAITING_REPLY: 'Awaiting reply',
  IN_REVIEW: 'In review',
  DONE: 'Done',
};

/** Today + 2 days, as the date input wants it. */
const inTwoDays = () => {
  const d = new Date(Date.now() + 2 * 86_400_000);
  return d.toISOString().slice(0, 10);
};

/**
 * សំណួរ / Queries: the follow-ups raised for this shipment (by hand or by the automatic
 * checks), and a quick way to raise one. Not a nested form: the page is already one.
 */
export function QueriesTab({
  shipmentId,
  clientId,
}: {
  shipmentId: string | undefined;
  clientId: string | undefined;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const list = useFollowUps({ shipmentId, pageSize: 50 }, !!shipmentId);
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [dueAt, setDueAt] = useState(inTwoDays);
  const [priority, setPriority] = useState('MEDIUM');
  const writable = can('followups:write');
  const add = useApiMutation(
    (v: Record<string, unknown>) => api('/follow-ups', { method: 'POST', json: v }),
    [['follow-ups'], queryKeys.navCounts],
  );
  const done = useApiMutation(
    (id: string) => api(`/follow-ups/${id}`, { method: 'PATCH', json: { status: 'DONE' } }),
    [['follow-ups'], queryKeys.navCounts],
  );

  const submit = async () => {
    if (subject.trim().length < 3) {
      toast('Enter a subject of at least 3 characters.');
      return;
    }
    try {
      await add.mutateAsync({
        subject: subject.trim(),
        notes: notes.trim() || undefined,
        dueAt,
        priority,
        shipmentId,
        clientId: clientId || undefined,
      });
      setSubject('');
      setNotes('');
      toast('Query added.');
    } catch {
      /* shown in banner */
    }
  };

  if (!shipmentId)
    return (
      <div className="cx-card">
        <Head km="សំណួរ" en="Queries" />
        <p className="create-header-desc">Create the shipment first, then raise queries here.</p>
      </div>
    );

  const rows = list.data?.data ?? [];
  return (
    <>
      {writable && (
        <div className="cx-card">
          <Head km="សំណួរថ្មី" en="New query" sub="Shows on the Follow-up page too." />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
            }}
          >
            <div className="form-field-group" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="q-subject">ប្រធានបទ / Subject</label>
              <input
                id="q-subject"
                className="form-field-box"
                value={subject}
                maxLength={200}
                placeholder="e.g. Customs asked for the packing list again"
                onChange={(e) => setSubject(e.target.value)}
                onKeyDown={(e) => {
                  // Enter would submit the shipment form.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            </div>
            <div className="form-field-group" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="q-notes">កំណត់សម្គាល់ / Notes</label>
              <textarea
                id="q-notes"
                className="form-field-box"
                rows={3}
                value={notes}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="form-field-group">
              <label htmlFor="q-due">ថ្ងៃកំណត់ / Due</label>
              <input
                id="q-due"
                type="date"
                className="form-field-box"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <div className="form-field-group">
              <label htmlFor="q-priority">អាទិភាព / Priority</label>
              <select
                id="q-priority"
                className="form-select-box"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {Object.entries(PRIORITY).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ErrorBanner error={add.error} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              type="button"
              className="cargo-btn cargo-btn-primary"
              disabled={add.isPending}
              onClick={() => void submit()}
            >
              {add.isPending ? 'Adding…' : '+ Add query'}
            </button>
          </div>
        </div>
      )}
      <div className="cx-card">
        <Head km="សំណួរ" en="Queries" sub="Follow-ups raised for this shipment." />
        {list.isLoading ? (
          <p className="create-header-desc">Loading…</p>
        ) : list.error ? (
          <ErrorBanner error={list.error} />
        ) : !rows.length ? (
          <p className="create-header-desc">No queries for this shipment.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)' }}>
                  <th style={cell}>លេខ / Ref</th>
                  <th style={cell}>ប្រធានបទ / Subject</th>
                  <th style={cell}>ថ្ងៃកំណត់ / Due</th>
                  <th style={cell}>អាទិភាព / Priority</th>
                  <th style={cell}>ស្ថានភាព / Status</th>
                  <th style={cell} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{r.reference}</td>
                    <td style={cell}>
                      <b>{r.subject}</b>
                      {r.notes && (
                        <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                          {r.notes}
                        </div>
                      )}
                      {r.rule && (
                        <div style={{ color: 'var(--text-tertiary)', fontSize: 11.5 }}>
                          Raised by an automatic check
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        ...cell,
                        whiteSpace: 'nowrap',
                        color: r.overdue ? 'var(--status-exception-fg)' : undefined,
                      }}
                    >
                      {fmtDate(r.dueAt)}
                      {r.overdue ? ' · overdue' : ''}
                    </td>
                    <td style={cell}>{PRIORITY[r.priority] ?? r.priority}</td>
                    <td style={cell}>{STATUS[r.status] ?? r.status}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {writable && r.status !== 'DONE' && (
                        <button
                          type="button"
                          className="filter-mini-link"
                          disabled={done.isPending}
                          onClick={() => done.mutate(r.id)}
                        >
                          Mark done
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
