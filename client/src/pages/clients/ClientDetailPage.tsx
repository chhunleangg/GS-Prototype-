import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CLIENT_BUSINESS_TYPE_LABEL, licenceTypeOf, type ClientDetail } from '@gs/shared';
import { BackLink, backRow } from '../../components/BackLink';
import { useAuth } from '../../auth/AuthProvider';
import { useClient, useDeleteClient, useLookups, useSaveClient } from '../../features/hooks';
import { Pill, ShipmentStatusPill } from '../../components/StatusPill';
import { ErrorBanner, TableState, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { fmtDate, fmtMoney } from '../../lib/format';
import { CLIENT_STATUS_PILL } from '../ClientsPage';
import { ClientFormModal } from './ClientFormModal';
import { PartiesCard } from './PartiesCard';
import { RemarksCard } from './RemarksCard';
import { LicencesCard, licenceProblems } from './LicencesCard';
import { PortalAccountsCard } from './PortalAccountsCard';
import s from './ClientDetailPage.module.css';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'licences', label: 'Licences & Documents' },
  { key: 'portals', label: 'Portal Accounts' },
  { key: 'parties', label: 'Suppliers & Consignees' },
  { key: 'shipments', label: 'Shipments' },
  { key: 'remarks', label: 'Remarks' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/**
 * Client Details: who the client is at a glance (name, tax numbers, licence health), then one
 * tab per subject so each screen shows one kind of information.
 */
export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const client = useClient(id);
  const lookups = useLookups();
  const save = useSaveClient();
  const del = useDeleteClient();
  const [editing, setEditing] = useState(false);
  // "?tab=licences" opens a tab directly (and survives a refresh).
  const [search, setSearch] = useSearchParams();
  const tab: TabKey = TABS.some((t) => t.key === search.get('tab'))
    ? (search.get('tab') as TabKey)
    : 'overview';
  const openTab = (k: TabKey) =>
    setSearch(
      (p) => {
        const next = new URLSearchParams(p);
        if (k === 'overview') next.delete('tab');
        else next.set('tab', k);
        return next;
      },
      { replace: true },
    );
  const c = client.data;

  if (client.isLoading)
    return (
      <section className="view active">
        <div className="card">Loading client…</div>
      </section>
    );
  if (client.error || !c)
    return (
      <section className="view active">
        <ErrorBanner error={client.error} />
        <BackLink to="/clients" label="Back to clients" />
      </section>
    );

  const toggleActive = async () => {
    const next = c.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
    if (
      next === 'INACTIVE' &&
      !window.confirm(
        `Deactivate ${c.name}? Existing shipments stay; new shipments can't be created for this client.`,
      )
    )
      return;
    await save.mutateAsync({ id: c.id, body: { status: next } });
    await client.refetch();
    toast(next === 'INACTIVE' ? 'Client deactivated.' : 'Client reactivated.');
  };
  const remove = async () => {
    if (
      !window.confirm(
        `Delete ${c.name}? This only works for clients without shipments or cut-stock items.`,
      )
    )
      return;
    await del.mutateAsync(c.id);
    toast('Client deleted.');
    navigate('/clients');
  };

  const country =
    lookups.data?.countries.find((x) => x.iso2 === c.countryIso2)?.name ?? c.countryIso2;
  const problems = licenceProblems(c.licences);
  const current = c.licences.filter((l) => !l.superseded);
  const counts: Partial<Record<TabKey, number>> = {
    licences: current.length,
    parties: c.suppliers.length + c.consignees.length,
    shipments: c.shipmentCount,
  };

  return (
    <section className="view active">
      {/* ---------- Header ---------- */}
      <div className={s.head}>
        <div className={backRow}>
          <BackLink to="/clients" label="Clients" />
          <div className={s.titleRow}>
            <span className={s.code}>{c.code}</span>
            <h2 className={s.title}>{c.name}</h2>
            <Pill tone={CLIENT_STATUS_PILL[c.status].tone}>
              {CLIENT_STATUS_PILL[c.status].label}
            </Pill>
          </div>
          <div className={s.sub}>
            {[c.legalName && c.legalName !== c.name ? c.legalName : null, country]
              .filter(Boolean)
              .join(' · ')}
            {c.legalNameKm && <span className={s.khmer}> · {c.legalNameKm}</span>}
          </div>
        </div>
        {can('clients:write') && (
          <div className={ui.toolbar}>
            <button
              type="button"
              className={ui.ghostBtn}
              onClick={() => void toggleActive()}
              disabled={save.isPending}
            >
              {c.status === 'INACTIVE' ? 'Reactivate' : 'Deactivate'}
            </button>
            {c.shipmentCount === 0 && c.cutStockItems === 0 && (
              <button
                type="button"
                className={ui.dangerBtn}
                onClick={() => void remove()}
                disabled={del.isPending}
              >
                Delete
              </button>
            )}
            <button type="button" className="new-shipment-btn" onClick={() => setEditing(true)}>
              Edit client
            </button>
          </div>
        )}
      </div>
      <ErrorBanner error={save.error ?? del.error} />

      {/* ---------- Identity strip: the numbers asked for on every form ---------- */}
      <div className={s.idStrip}>
        <IdBox label="VAT-TIN · លេខ អតប" value={c.vattin} mono />
        <IdBox label="CIN · MOC registration" value={c.cin} mono />
        <IdBox
          label="Business type"
          value={c.businessType ? CLIENT_BUSINESS_TYPE_LABEL[c.businessType] : null}
        />
        <button
          type="button"
          className={s.idBox}
          data-tone={problems.length ? 'bad' : current.length ? 'good' : 'none'}
          onClick={() => openTab('licences')}
          title="Open Licences & Documents"
        >
          <span className={s.idLabel}>Licences</span>
          <span className={s.idValue}>
            {problems.length
              ? `${problems.length} to renew`
              : current.length
                ? `${current.length} valid`
                : 'None recorded'}
          </span>
        </button>
      </div>

      {problems.length > 0 && (
        <div role="alert" className={s.alert}>
          <span>
            <b>Renew soon:</b>{' '}
            {problems
              .map(
                (l) =>
                  `${licenceTypeOf(l.type)?.label ?? l.type} (${
                    l.state === 'EXPIRED' ? 'expired' : 'expires'
                  } ${fmtDate(l.expiryDate)})`,
              )
              .join(' · ')}
          </span>
          {tab !== 'licences' && (
            <button type="button" className={s.alertLink} onClick={() => openTab('licences')}>
              View licences →
            </button>
          )}
        </div>
      )}

      {/* ---------- Tabs ---------- */}
      <div className={s.tabs} role="tablist" aria-label="Client sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className={s.tab}
            aria-selected={tab === t.key}
            onClick={() => openTab(t.key)}
          >
            {t.label}
            {counts[t.key] !== undefined && <span className={s.count}>{counts[t.key]}</span>}
            {t.key === 'licences' && problems.length > 0 && (
              <span className={s.dot} aria-label={`${problems.length} to renew`} />
            )}
          </button>
        ))}
      </div>

      <div className={s.panel}>
        {tab === 'overview' && <Overview c={c} country={country} onTab={openTab} />}
        {tab === 'licences' && <LicencesCard clientId={c.id} licences={c.licences} />}
        {tab === 'portals' && <PortalAccountsCard clientId={c.id} />}
        {tab === 'parties' && <PartiesCard client={c} />}
        {tab === 'shipments' && <ShipmentsCard c={c} limit={null} />}
        {tab === 'remarks' && <RemarksCard clientId={c.id} />}
      </div>

      {editing && (
        <ClientFormModal
          client={c}
          onClose={() => {
            setEditing(false);
            void client.refetch();
          }}
        />
      )}
    </section>
  );
}

function IdBox({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className={s.idBox}>
      <span className={s.idLabel}>{label}</span>
      <span className={`${s.idValue}${mono ? ` ${s.mono}` : ''}`} data-empty={!value}>
        {value ?? 'Not set'}
      </span>
    </div>
  );
}

/** A titled group of label/value rows; empty values show a dash so gaps are easy to spot. */
function Facts({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <section className={s.group}>
      <h4 className={s.groupTitle}>{title}</h4>
      <dl className={s.facts}>
        {rows.map(([k, v]) => (
          <div key={k} className={s.fact}>
            <dt>{k}</dt>
            <dd data-empty={v === null || v === undefined || v === ''}>
              {v === null || v === undefined || v === '' ? '—' : v}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Overview({
  c,
  country,
  onTab,
}: {
  c: ClientDetail;
  country: string;
  onTab: (k: TabKey) => void;
}) {
  return (
    <div className={s.layout}>
      <div className="card">
        <div className="card-header-row">
          <h3>Company profile</h3>
          <span className={s.muted}>
            Checked on the portal: {c.lastVerifiedOn ? fmtDate(c.lastVerifiedOn) : 'never'}
          </span>
        </div>
        <div className={s.groups}>
          <Facts
            title="Company"
            rows={[
              ['Legal name', c.legalName],
              ['Khmer name', c.legalNameKm && <span className={s.khmer}>{c.legalNameKm}</span>],
              ['Country', country],
              ['Client since', fmtDate(c.createdAt)],
            ]}
          />
          <Facts
            title="Business"
            rows={[
              ['Business type', c.businessType && CLIENT_BUSINESS_TYPE_LABEL[c.businessType]],
              ['Main activity', c.mainActivity],
              ['Commission (CM)', `${fmtMoney(c.commissionUsd)} per declaration`],
            ]}
          />
          <Facts
            title="Address & contact"
            rows={[
              ['Address', c.address],
              ['Khmer address', c.addressKm && <span className={s.khmer}>{c.addressKm}</span>],
              ['Contact person', c.contactName],
              ['Email', c.contactEmail],
              ['Phone', c.contactPhone],
            ]}
          />
          <Facts
            title="CDC & letters"
            rows={[
              ['CDC no.', c.cdcNo],
              ['CDC issue date', c.cdcIssueDate && fmtDate(c.cdcIssueDate)],
              ['Extension letter', c.cdcExtensionLetterNo],
              ['Signatory', [c.signatoryName, c.signatoryTitle].filter(Boolean).join(' · ')],
              ['Company phone', c.letterPhone],
            ]}
          />
        </div>
      </div>

      <div className={s.side}>
        <div className={s.stats}>
          <Stat label="Active runs" value={c.activeShipments} />
          <Stat label="Imports" value={c.importCount} />
          <Stat label="Exports" value={c.exportCount} />
          {c.netProfitYtd !== undefined ? (
            <Stat label="Net profit this year" value={fmtMoney(c.netProfitYtd)} />
          ) : (
            <Stat label="Total shipments" value={c.shipmentCount} />
          )}
        </div>
        <ShipmentsCard c={c} limit={4} onMore={() => onTab('shipments')} />
        <div className="card">
          <div className="card-header-row">
            <h3>CDC master list</h3>
          </div>
          {c.cutStockItems ? (
            <Link
              to={`/cutstock?clientId=${c.id}`}
              className="filter-btn"
              style={{ display: 'inline-flex' }}
            >
              Open {c.cutStockItems} items
            </Link>
          ) : (
            <span className={s.muted}>
              No master list loaded. Import one from the Cut Stock page.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={s.stat}>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue}>{value}</div>
    </div>
  );
}

function ShipmentsCard({
  c,
  limit,
  onMore,
}: {
  c: ClientDetail;
  /** Rows shown; null = all the recent ones. */
  limit: number | null;
  onMore?: () => void;
}) {
  const navigate = useNavigate();
  const rows = limit ? c.recentShipments.slice(0, limit) : c.recentShipments;
  return (
    <div className="card">
      <div className="card-header-row">
        <h3>{limit ? 'Latest shipments' : 'Recent shipments'}</h3>
        <Link to={`/plans?clientId=${c.id}`} className="filter-btn">
          All in Shipping Plans
        </Link>
      </div>
      <div className="plans-table-scroll">
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Reference</th>
              {!limit && <th>Invoice No.</th>}
              <th>Type</th>
              <th>ETA</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <TableState
              cols={limit ? 4 : 5}
              loading={false}
              error={null}
              empty={!rows.length}
              emptyText="No shipments for this client yet."
            />
            {rows.map((r) => (
              <tr
                key={r.id}
                className="plans-row-clickable"
                onClick={() => navigate(`/plans/${r.id}`)}
              >
                <td className="val-bold">{r.reference}</td>
                {!limit && <td>{r.invoiceNos.join(', ') || '-'}</td>}
                <td>{r.direction === 'IMPORT' ? 'Import' : 'Export'}</td>
                <td>{fmtDate(r.eta)}</td>
                <td>
                  <ShipmentStatusPill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limit && c.recentShipments.length > limit && onMore && (
        <button type="button" className={s.more} onClick={onMore}>
          Show {c.recentShipments.length - limit} more →
        </button>
      )}
    </div>
  );
}
