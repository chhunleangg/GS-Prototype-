import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import {
  clientPortalAccountInputSchema,
  PORTALS,
  portalOf,
  type ClientPortalAccount,
  type ClientPortalAccountInput,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useApiMutation } from '../../features/admin';
import { ErrorBanner, FieldError, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { formResolver } from '../../lib/zodForm';
import s from './LicencesCard.module.css';

const key = (clientId: string) => [...queryKeys.client(clientId), 'portal-accounts'];

/** Only http(s) links are made clickable. */
const safeUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

/**
 * Client Details → Portal accounts: who logs into which government portal (NSW, ASYCUDA,
 * GDT e-Tax…) for this client. No passwords here: "Password kept in" says where it is.
 */
export function PortalAccountsCard({ clientId }: { clientId: string }) {
  const { can } = useAuth();
  const editable = can('clients:write');
  const list = useQuery({
    queryKey: key(clientId),
    queryFn: () => api<ClientPortalAccount[]>(`/clients/${clientId}/portal-accounts`),
  });
  const [open, setOpen] = useState<ClientPortalAccount | 'new' | null>(null);

  return (
    <div className="card">
      <div className="card-header-row">
        <h3>Portal accounts</h3>
        {editable && (
          <button type="button" className="filter-btn" onClick={() => setOpen('new')}>
            + Add account
          </button>
        )}
      </div>
      <ErrorBanner error={list.error} />
      {list.isLoading ? (
        <span className={s.muted}>Loading…</span>
      ) : list.data?.length ? (
        list.data.map((a) => {
          const url = safeUrl(a.url ?? portalOf(a.portal)?.url ?? null);
          return (
            <div key={a.id} className={s.portal}>
              <div className={s.portalHead}>
                <b>{portalOf(a.portal)?.label ?? a.portal}</b>
                {editable && (
                  <button
                    type="button"
                    className={s.icon}
                    onClick={() => setOpen(a)}
                    aria-label={`Edit ${a.portal} account ${a.username}`}
                    title="Edit"
                  >
                    {icons.edit({ width: 14, height: 14 })}
                  </button>
                )}
              </div>
              <div className={s.portalBody}>
                <div>
                  User: <b>{a.username}</b>
                  {a.role ? ` · ${a.role}` : ''}
                </div>
                {(a.holderName || a.email || a.phone) && (
                  <div>{[a.holderName, a.email, a.phone].filter(Boolean).join(' · ')}</div>
                )}
                {url && (
                  <div>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {url}
                    </a>
                  </div>
                )}
                {a.vaultRef && <div>Password kept in: {a.vaultRef}</div>}
                {a.notes && <div className={s.sub}>{a.notes}</div>}
              </div>
            </div>
          );
        })
      ) : (
        <span className={s.muted}>
          No portal accounts recorded.
          {editable ? ' Add who logs into NSW, ASYCUDA, GDT e-Tax… for this client.' : ''}
        </span>
      )}
      {open && (
        <AccountModal
          clientId={clientId}
          account={open === 'new' ? null : open}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function AccountModal({
  clientId,
  account,
  onClose,
}: {
  clientId: string;
  account: ClientPortalAccount | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const save = useApiMutation(
    (body: ClientPortalAccountInput) =>
      account
        ? api(`/clients/${clientId}/portal-accounts/${account.id}`, { method: 'PUT', json: body })
        : api(`/clients/${clientId}/portal-accounts`, { method: 'POST', json: body }),
    [key(clientId)],
  );
  const del = useApiMutation(
    () => api(`/clients/${clientId}/portal-accounts/${account!.id}`, { method: 'DELETE' }),
    [key(clientId)],
  );
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ClientPortalAccountInput>({
    resolver: formResolver(clientPortalAccountInputSchema),
    defaultValues: {
      portal: account?.portal ?? 'NSW',
      url: account?.url ?? '',
      username: account?.username ?? '',
      holderName: account?.holderName ?? '',
      email: account?.email ?? '',
      phone: account?.phone ?? '',
      role: account?.role ?? '',
      vaultRef: account?.vaultRef ?? '',
      notes: account?.notes ?? '',
    },
  });
  const portal = useWatch({ control, name: 'portal' });

  const onSubmit = handleSubmit(async (v) => {
    await save.mutateAsync(v);
    toast(account ? 'Account saved.' : 'Account added.');
    onClose();
  });
  const remove = async () => {
    if (!account || !window.confirm(`Delete the ${account.portal} account ${account.username}?`))
      return;
    await del.mutateAsync(undefined);
    toast('Account deleted.');
    onClose();
  };
  const text = (
    name: keyof ClientPortalAccountInput,
    label: string,
    placeholder = '',
    full = false,
  ) => (
    <div className="form-field-group" style={full ? { gridColumn: '1 / -1' } : undefined}>
      <label htmlFor={`pa-${name}`}>{label}</label>
      <input
        id={`pa-${name}`}
        className="form-field-box"
        placeholder={placeholder}
        {...register(name)}
        aria-invalid={!!errors[name]}
      />
      <FieldError message={errors[name]?.message} />
    </div>
  );

  return (
    <Modal
      title={account ? 'Edit portal account' : 'Add portal account'}
      sub="Who logs into the portal for this client. Don't type passwords here: say where they are kept."
      onClose={onClose}
      width={640}
    >
      <ErrorBanner error={save.error ?? del.error} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="form-fields-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="form-field-group" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="pa-portal">Portal</label>
            <select id="pa-portal" className="form-select-box" {...register('portal')}>
              {PORTALS.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {text('url', 'Link (if different)', portalOf(portal)?.url || 'https://…', true)}
          {text('username', 'Username / login email', 'e.g. liyan')}
          {text('role', 'Role on the portal', 'e.g. COMPANY, Owner')}
          {text('holderName', 'Account holder', 'e.g. LI YAN')}
          {text('phone', 'Phone', 'e.g. 060 411 911')}
          {text('email', 'Email', 'e.g. name@company.com', true)}
          {text(
            'vaultRef',
            'Password kept in',
            'e.g. Bitwarden → Clients → JYX NSW, or Remarks',
            true,
          )}
          {text('notes', 'Notes', '', true)}
        </div>
        <div className={ui.actions}>
          {account && (
            <button type="button" className="btn-delete-shipment" onClick={() => void remove()}>
              Delete account
            </button>
          )}
          <button type="button" className="btn-cancel-shipment" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-create-submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : account ? 'Save' : 'Add account'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
