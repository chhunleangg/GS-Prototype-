import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import {
  clientLicenceInputSchema,
  LICENCE_TYPES,
  LICENCE_WARN_DAYS,
  licenceTypeOf,
  type ClientLicence,
  type ClientLicenceInput,
  type LicenceState,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useApiMutation } from '../../features/admin';
import { DocumentPreview } from '../../components/DocumentPreview';
import { Pill } from '../../components/StatusPill';
import { ErrorBanner, FieldError, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import { formResolver } from '../../lib/zodForm';
import s from './LicencesCard.module.css';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const MAX_BYTES = 20 * 1024 * 1024;

const STATE: Record<
  LicenceState,
  { tone: 'completed' | 'pending' | 'exception' | 'progress'; label: string }
> = {
  VALID: { tone: 'completed', label: 'Valid' },
  EXPIRING: { tone: 'pending', label: 'Expiring' },
  EXPIRED: { tone: 'exception', label: 'Expired' },
  NO_EXPIRY: { tone: 'progress', label: 'No expiry' },
};

const typeName = (code: string) => licenceTypeOf(code)?.label ?? code;

/** "01-JAN-26 – 31-DEC-26", "Until 31-DEC-26", "From 18-JUN-24" or a dash. */
function validText(l: ClientLicence) {
  if (l.startDate && l.expiryDate) return `${fmtDate(l.startDate)} – ${fmtDate(l.expiryDate)}`;
  if (l.expiryDate) return `Until ${fmtDate(l.expiryDate)}`;
  if (l.startDate) return `From ${fmtDate(l.startDate)}`;
  return '—';
}

/** "12 days left", "Expired 3 days ago", "Expires today". */
function daysText(l: ClientLicence) {
  if (l.daysLeft === null) return '';
  if (l.daysLeft === 0) return 'Expires today';
  if (l.daysLeft < 0) return `Expired ${-l.daysLeft} day${l.daysLeft === -1 ? '' : 's'} ago`;
  return `${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'} left`;
}

/** Expired or expiring licences that no renewal replaces yet: what needs doing. */
export const licenceProblems = (licences: ClientLicence[]) =>
  licences.filter((l) => !l.superseded && (l.state === 'EXPIRED' || l.state === 'EXPIRING'));

/**
 * Client Details → Licences & Documents: the client's registrations and licences (VAT/TIN,
 * patent, MOC, QIP…) with their validity and scan. Expiring ones also raise a follow-up.
 */
export function LicencesCard({
  clientId,
  licences,
}: {
  clientId: string;
  licences: ClientLicence[];
}) {
  const { can } = useAuth();
  const editable = can('clients:write');
  const [open, setOpen] = useState<ClientLicence | 'new' | null>(null);
  const [preview, setPreview] = useState<ClientLicence | null>(null);
  const [showOld, setShowOld] = useState(false);
  const current = licences.filter((l) => !l.superseded);
  const old = licences.filter((l) => l.superseded);

  const row = (l: ClientLicence) => (
    <tr key={l.id} className={l.superseded ? s.old : undefined}>
      <td>
        <b>{typeName(l.type)}</b>
        <div className={s.sub}>{l.issuer ?? ''}</div>
      </td>
      <td className={s.ref}>{l.refNo}</td>
      <td className={s.nowrap}>
        {validText(l)}
        {!l.superseded && <div className={s.sub}>{daysText(l)}</div>}
      </td>
      <td>
        {l.superseded ? (
          <span className={s.sub}>Renewed</span>
        ) : (
          <Pill tone={STATE[l.state].tone}>{STATE[l.state].label}</Pill>
        )}
      </td>
      <td className={s.actions}>
        {l.documentId && (
          <button type="button" className={s.tool} onClick={() => setPreview(l)}>
            View file
          </button>
        )}
        {editable && (
          <button
            type="button"
            className={s.icon}
            onClick={() => setOpen(l)}
            aria-label={`Edit ${typeName(l.type)} ${l.refNo}`}
            title="Edit"
          >
            {icons.edit({ width: 14, height: 14 })}
          </button>
        )}
      </td>
    </tr>
  );

  return (
    <div className="card">
      <div className="card-header-row">
        <h3>Licences &amp; Documents</h3>
        {editable && (
          <button type="button" className="filter-btn" onClick={() => setOpen('new')}>
            + Add licence
          </button>
        )}
      </div>
      {current.length ? (
        <div className={s.scroll}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Reference</th>
                <th>Valid</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {current.map(row)}
              {showOld && old.map(row)}
            </tbody>
          </table>
        </div>
      ) : (
        <span className={s.muted}>
          No licences recorded.
          {editable ? ' Add the VAT/TIN certificate, patent, MOC and QIP with their dates.' : ''}
        </span>
      )}
      {old.length > 0 && (
        <button type="button" className={s.toggle} onClick={() => setShowOld((v) => !v)}>
          {showOld ? 'Hide' : 'Show'} {old.length} renewed (older) licence
          {old.length === 1 ? '' : 's'}
        </button>
      )}
      {open && (
        <LicenceModal
          clientId={clientId}
          licence={open === 'new' ? null : open}
          onClose={() => setOpen(null)}
        />
      )}
      {preview?.documentId && (
        <DocumentPreview
          doc={{
            id: preview.documentId,
            title: `${typeName(preview.type)} ${preview.refNo}`,
            originalName: preview.documentName ?? 'file',
            mimeType: preview.documentMime ?? 'application/octet-stream',
            sizeBytes: 0,
            createdAt: preview.updatedAt,
            uploadedBy: null,
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function LicenceModal({
  clientId,
  licence,
  onClose,
}: {
  clientId: string;
  licence: ClientLicence | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const { can } = useAuth();
  const canUpload = can('documents:write');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const keys = [queryKeys.client(clientId), ['documents'], ['follow-ups']];
  const save = useApiMutation(
    (body: ClientLicenceInput) =>
      licence
        ? api(`/clients/${clientId}/licences/${licence.id}`, { method: 'PUT', json: body })
        : api(`/clients/${clientId}/licences`, { method: 'POST', json: body }),
    keys,
  );
  const del = useApiMutation(
    () => api(`/clients/${clientId}/licences/${licence!.id}`, { method: 'DELETE' }),
    keys,
  );
  const upload = useApiMutation(
    (v: { file: File; title: string }) => {
      const fd = new FormData();
      fd.append('file', v.file);
      fd.append('title', v.title);
      fd.append('category', 'OTHER');
      fd.append('clientId', clientId);
      return api<{ id: string }>('/documents', { method: 'POST', body: fd });
    },
    [['documents']],
  );

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<ClientLicenceInput>({
    resolver: formResolver(clientLicenceInputSchema),
    defaultValues: {
      type: licence?.type ?? 'PATENT',
      refNo: licence?.refNo ?? '',
      issuer: licence?.issuer ?? '',
      startDate: licence?.startDate ?? '',
      expiryDate: licence?.expiryDate ?? '',
      documentId: licence?.documentId ?? '',
      notes: licence?.notes ?? '',
    },
  });
  const [type, documentId] = useWatch({ control, name: ['type', 'documentId'] });
  const issuerHint = licenceTypeOf(type)?.issuer;

  const pick = (f: File | undefined) => {
    setFileError(null);
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) return setFileError('The file is larger than 20 MB.');
    setFile(f);
  };

  const onSubmit = handleSubmit(async (v) => {
    let docId = v.documentId;
    if (file) {
      const up = await upload.mutateAsync({ file, title: `${typeName(v.type)} ${v.refNo}` });
      docId = up.id;
    }
    await save.mutateAsync({ ...v, documentId: docId ?? '' });
    toast(licence ? 'Licence saved.' : 'Licence added.');
    onClose();
  });
  const remove = async () => {
    if (!licence || !window.confirm(`Delete ${typeName(licence.type)} ${licence.refNo}?`)) return;
    await del.mutateAsync(undefined);
    toast('Licence deleted.');
    onClose();
  };

  return (
    <Modal
      title={licence ? 'Edit licence' : 'Add licence'}
      sub={`A registration or licence with its validity. A follow-up is raised ${LICENCE_WARN_DAYS} days before it expires, until the renewal is added.`}
      onClose={onClose}
      width={640}
    >
      <ErrorBanner error={upload.error ?? save.error ?? del.error} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="form-fields-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="form-field-group" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="lic-type">Type</label>
            <select id="lic-type" className="form-select-box" {...register('type')}>
              {LICENCE_TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label} · {t.km}
                  {t.issuer ? ` (${t.issuer})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field-group">
            <label htmlFor="lic-ref">Reference No.</label>
            <input
              id="lic-ref"
              className="form-field-box"
              placeholder="e.g. L001902401027-PATENT2026"
              {...register('refNo')}
              aria-invalid={!!errors.refNo}
            />
            <FieldError message={errors.refNo?.message} />
          </div>
          <div className="form-field-group">
            <label htmlFor="lic-issuer">Issued by</label>
            <input
              id="lic-issuer"
              className="form-field-box"
              placeholder={issuerHint || 'e.g. GDT'}
              {...register('issuer')}
            />
          </div>
          <div className="form-field-group">
            <label htmlFor="lic-start">Valid from</label>
            <input
              id="lic-start"
              type="date"
              className="form-field-box"
              {...register('startDate')}
            />
          </div>
          <div className="form-field-group">
            <label htmlFor="lic-expiry">Expires on</label>
            <input
              id="lic-expiry"
              type="date"
              className="form-field-box"
              {...register('expiryDate')}
              aria-invalid={!!errors.expiryDate}
            />
            <FieldError message={errors.expiryDate?.message} />
          </div>
          {canUpload && (
            <div className="form-field-group" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="lic-file">Scan (PDF or image, up to 20 MB)</label>
              {documentId && !file ? (
                <div className={s.fileRow}>
                  <span>{licence?.documentName ?? 'File attached'}</span>
                  <button
                    type="button"
                    className={s.tool}
                    onClick={() => setValue('documentId', '', { shouldDirty: true })}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <input
                  id="lic-file"
                  type="file"
                  accept={ACCEPT}
                  className="form-field-box"
                  onChange={(e) => pick(e.target.files?.[0])}
                />
              )}
              <FieldError message={fileError ?? undefined} />
            </div>
          )}
          <div className="form-field-group" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="lic-notes">Notes</label>
            <textarea id="lic-notes" className="form-field-box" rows={2} {...register('notes')} />
          </div>
        </div>
        <div className={ui.actions}>
          {licence && (
            <button type="button" className="btn-delete-shipment" onClick={() => void remove()}>
              Delete licence
            </button>
          )}
          <button type="button" className="btn-cancel-shipment" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-create-submit"
            disabled={save.isPending || upload.isPending || !!fileError}
          >
            {upload.isPending
              ? 'Uploading…'
              : save.isPending
                ? 'Saving…'
                : licence
                  ? 'Save'
                  : 'Add licence'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
