import { useRef, useState, type CSSProperties } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import {
  invoiceHtsCodes,
  type CargoExcelParseResult,
  type ImportCargoExcelParseResult,
} from '@gs/shared';
import { downloadFile, uploadFile } from '../../lib/files';
import { ApiError } from '../../lib/api';
import { fmtNum } from '../../lib/format';
import { FieldError } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { icons } from '../../layout/icons';
import { blankInvoice, blankLine, toNum, type FormValues, type InvoiceValues } from './formModel';
import c from './CargoSection.module.css';
import f from './ShipmentForm.module.css';

const Icon = ({ d }: { d: string }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
);
const ICON_DOWN = 'M12 4v12m0 0-5-5m5 5 5-5M5 20h14';
const ICON_UP = 'M12 20V8m0 0-5 5m5-5 5 5M5 4h14';
const ICON_PLUS = 'M12 5v14M5 12h14';
const ICON_ARROW = 'M5 12h14m-6-6 6 6-6 6';

/** The invoice's HTS codes (one invoice = one code; more than one is flagged). */
export const htsCodesOf = (lines: InvoiceValues['lines'] | undefined) => invoiceHtsCodes(lines ?? []);

/** CDC numbers compare without case, spaces or dashes ("II-125" = "ii 125"), as on the server. */
export const cdcKey = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[\s\-–—_]+/g, '');

export const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A line counts as entered once it has a quantity or something that names the goods. */
export const lineEntered = (l: InvoiceValues['lines'][number]) =>
  !!(toNum(l.pcs) || l.cdcNo || l.poNo || l.styleNo);

type InvErrors =
  | {
      invoiceNo?: { message?: string };
      htsCode?: { message?: string };
      lines?: { message?: string } | Record<number, Record<string, { message?: string }>>;
    }
  | undefined;

export const hasLineErrors = (errors: unknown, gi: number) =>
  Array.isArray(errors) && !!(errors[gi] as { lines?: unknown } | undefined)?.lines;

/**
 * Step "Invoices": one row per cargo invoice (number, date, and for an export its HTS code),
 * with its totals worked out from the items. The items are entered below it, in ItemsSection.
 */
export function InvoicesSection({
  shipmentId,
  active,
  onOpenItems,
}: {
  shipmentId?: string | undefined;
  /** The invoice whose items are open below. */
  active?: number;
  /** Go to the Items step with this invoice open. */
  onOpenItems: (gi: number) => void;
}) {
  const {
    control,
    register,
    getValues,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();
  const invoices = useFieldArray({ control, name: 'invoices' });
  const watched = useWatch({ control, name: 'invoices' });
  // Imports follow the import schedule: CDC items instead of PO / style / HTS.
  const isImport = useWatch({ control, name: 'direction' }) === 'IMPORT';
  const clientId = useWatch({ control, name: 'clientId' });
  const [status, setStatus] = useState<{
    text: string;
    warnings: CargoExcelParseResult['warnings'];
    /** The upload was refused: the list shows why. */
    error?: boolean;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // All invoices of a shipment share one invoice date (prototype rule).
  const setSharedDate = (date: string) =>
    (getValues('invoices') ?? []).forEach((_, i) =>
      setValue(`invoices.${i}.invoiceDate`, date, { shouldDirty: true }),
    );

  const onExcel = async (file: File) => {
    setUploading(true);
    setStatus(null);
    try {
      // Imports use the import schedule layout; each ITEM is matched to the client's master list.
      const res = isImport
        ? await uploadFile<ImportCargoExcelParseResult>(
            '/shipments/parse-import-cargo-excel',
            file,
            { clientId, shipmentId },
          )
        : await uploadFile<CargoExcelParseResult>('/shipments/parse-cargo-excel', file, {
            shipmentId,
          });
      const errs = 'errors' in res ? res.errors : [];
      if (errs.length) {
        // Nothing is filled in until every row matches the CDC master list.
        setStatus({
          text: `Nothing imported from ${file.name}: fix ${errs.length === 1 ? 'this row' : `these ${errs.length} rows`} and upload it again.`,
          warnings: errs,
          error: true,
        });
        return;
      }
      const current = getValues('invoices') ?? [];
      const blank = current.every((i) => !i.invoiceNo && !i.lines.some(lineEntered));
      const imported: InvoiceValues[] = isImport
        ? (res as ImportCargoExcelParseResult).invoices.map((i) => ({
            ...blankInvoice(i.invoiceDate ?? ''),
            invoiceNo: i.invoiceNo,
            lines: i.lines.map((l) => ({
              ...blankLine(),
              cdcNo: l.cdcNo ?? '',
              description: l.description ?? '',
              material: l.material ?? '',
              unit: l.unit ?? '',
              pcs: l.pcs,
              netWeightKg: l.netWeightKg,
              grossWeightKg: l.grossWeightKg,
              fobUnitPrice: l.fobUnitPrice,
            })),
          }))
        : (res as CargoExcelParseResult).invoices.map((i) => ({
            invoiceNo: i.invoiceNo,
            invoiceDate: i.invoiceDate ?? '',
            description: i.description ?? '',
            lines: i.lines.map((l) => ({
              ...l,
              poNo: l.poNo ?? '',
              styleNo: l.styleNo ?? '',
              htsCode: l.htsCode ?? '',
              description: l.description ?? '',
            })),
          }));
      if (blank) invoices.replace(imported);
      else invoices.append(imported);
      const lines = res.invoices.reduce((n, i) => n + i.lines.length, 0);
      const noun = isImport ? 'item' : 'line';
      setStatus({
        text: `Imported ${res.invoices.length} invoice${res.invoices.length === 1 ? '' : 's'}, ${lines} ${noun}${lines === 1 ? '' : 's'} from ${file.name}. Check them under Items below.`,
        warnings: res.warnings,
      });
    } catch (e) {
      setStatus({
        text: e instanceof ApiError ? e.message : 'The file could not be read.',
        warnings: [],
        error: true,
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const totals = (watched ?? []).reduce(
    (t, inv) => {
      inv.lines.forEach((l) => {
        t.ctns += toNum(l.ctns);
        t.pcs += toNum(l.pcs);
        t.nw += toNum(l.netWeightKg);
        t.gw += toNum(l.grossWeightKg);
        t.cbm += toNum(l.cbm);
        t.fob += toNum(l.pcs) * toNum(l.fobUnitPrice);
      });
      return t;
    },
    { ctns: 0, pcs: 0, nw: 0, gw: 0, cbm: 0, fob: 0 },
  );
  const invErr = errors.invoices;
  const itemCount = (watched ?? []).reduce((n, i) => n + i.lines.filter(lineEntered).length, 0);
  const noClient = isImport && !clientId;
  const [currency, exchangeRate] = useWatch({ control, name: ['currency', 'exchangeRate'] });
  const cur = currency || 'USD';
  const khrValue = cur === 'KHR' ? totals.fob : totals.fob * toNum(exchangeRate);
  // An import has one invoice, entered beside its bill of lading; an export lists many.
  const single = isImport && invoices.fields.length <= 1;

  const toolbar = (
    <div className={c.actions}>
      {/* Imports have their own template, listing the client's CDC master list. */}
      <button
        type="button"
        className={c.btn}
        disabled={noClient}
        title={noClient ? 'Choose the client first' : 'Download the Excel template'}
        onClick={() =>
          void (
            isImport
              ? downloadFile('/shipments/import-cargo-template.xlsx', { clientId })
              : downloadFile('/shipments/cargo-template.xlsx')
          ).catch(() =>
            setStatus({
              text: 'The template could not be downloaded.',
              warnings: [],
              error: true,
            }),
          )
        }
      >
        <Icon d={ICON_DOWN} /> Template
      </button>
      <button
        type="button"
        className={`${c.btn} ${c.btnOutline}`}
        onClick={() => fileRef.current?.click()}
        disabled={uploading || noClient}
        title={noClient ? 'Choose the client first' : undefined}
      >
        <Icon d={ICON_UP} /> {uploading ? 'Reading…' : 'Upload Excel'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.csv"
        hidden
        onChange={(e) => e.target.files?.[0] && void onExcel(e.target.files[0])}
      />
    </div>
  );

  return (
    <div className="cx-card">
      <div className={c.head}>
        <h3 className={c.title}>Invoice</h3>
        {toolbar}
      </div>
      {status && (
        <div className={c.notice} data-tone={status.error ? 'error' : 'ok'} role="status">
          {status.text}
          {status.warnings.length ? (
            <ul>
              {status.warnings.slice(0, status.error ? 50 : 8).map((w, i) => (
                <li key={i}>
                  {w.row ? `Row ${w.row}: ` : ''}
                  {w.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {typeof invErr?.message === 'string' && (
        <div className={c.errorBox}>
          <FieldError message={invErr.message} />
        </div>
      )}

      <div className={f.nswCols}>
        <section className={f.formSection}>
          <h4 className={f.formSectionTitle}>
            {icons.documents({})}
            {single ? 'Invoice & Bill of Lading' : 'Terms & Bill of Lading'}
          </h4>
          {single && invoices.fields[0] && (
            <SingleInvoice
              errors={Array.isArray(invErr) ? invErr[0] : undefined}
              itemCount={itemCount}
              itemErrors={hasLineErrors(invErr, 0)}
              onItems={() => onOpenItems(0)}
            />
          )}
          <div className="form-field-group">
            <label htmlFor="f-incoterm">Incoterm</label>
            <select id="f-incoterm" className="form-select-box" {...register('incoterm')}>
              <option value="">Select Incoterm</option>
              {INCOTERMS.map(([code, name]) => (
                <option key={code} value={code}>
                  {code} – {name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field-group">
            <label htmlFor="f-hblNo">BL No. (BL / AWB / Road Bill)</label>
            <input id="f-hblNo" className="form-field-box" {...register('hblNo')} />
          </div>
          <div className="form-field-group">
            <label htmlFor="f-blDate">BL Date</label>
            <input id="f-blDate" type="date" className="form-field-box" {...register('blDate')} />
          </div>
        </section>

        <section className={f.formSection}>
          <h4 className={f.formSectionTitle}>
            {icons.accounting({})}
            Invoice Information
          </h4>
          <div className={f.grid} style={{ '--cols': 2 } as CSSProperties}>
            <div className="form-field-group">
              <label htmlFor="f-currency">Currency</label>
              <select id="f-currency" className="form-select-box" {...register('currency')}>
                {CURRENCIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} – {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field-group">
              <label htmlFor="f-exchangeRate">Exchange Rate (KHR per 1 {cur})</label>
              <NumberInput
                id="f-exchangeRate"
                className="form-field-box"
                decimals={4}
                placeholder={cur === 'KHR' ? '1' : 'e.g. 4,090'}
                disabled={cur === 'KHR'}
                {...register('exchangeRate')}
              />
            </div>
            <ReadOnlyBox label={`Invoice Value (${cur})`} value={money(totals.fob)} />
            <ReadOnlyBox
              label="Invoice Value (KHR)"
              value={khrValue ? money(khrValue) : '—'}
              title={cur !== 'KHR' && !toNum(exchangeRate) ? 'Enter the exchange rate' : undefined}
            />
            <ReadOnlyBox
              label={isImport ? 'Quantity' : 'Quantity (PCS / CTNS)'}
              value={
                isImport
                  ? `${fmtNum(totals.pcs, 2)} · ${fmtNum(itemCount)} item${itemCount === 1 ? '' : 's'}`
                  : `${fmtNum(totals.pcs)} PCS · ${fmtNum(totals.ctns)} CTNS`
              }
            />
            <ReadOnlyBox
              label={isImport ? 'Net / Gross Weight (kg)' : 'Net / Gross Wt (kg) · CBM'}
              value={
                `${fmtNum(totals.nw, 2)} / ${fmtNum(totals.gw, 2)}` +
                (isImport ? '' : ` · ${fmtNum(totals.cbm, 3)}`)
              }
            />
          </div>
        </section>
      </div>

      {!single && (
        <div className={c.listBlock}>
          <div className={c.listHead}>
            <h4 className={f.formSectionTitle}>
              {icons.menu({})}
              Invoice List
            </h4>
            <button
              type="button"
              className={`${c.btn} ${c.btnPrimary}`}
              onClick={() =>
                invoices.append(blankInvoice(getValues('invoices.0.invoiceDate') ?? ''))
              }
            >
              <Icon d={ICON_PLUS} /> Add invoice
            </button>
          </div>
          <table className={c.invTable}>
            <thead>
              <tr>
                <th style={{ width: 48 }}>No.</th>
                <th>Invoice No.</th>
                <th style={{ width: 220 }}>Invoice Date</th>
                <th style={{ width: 1 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {invoices.fields.map((fl, gi) => (
                <InvoiceRow
                  key={fl.id}
                  gi={gi}
                  active={gi === active}
                  isImport={isImport}
                  onDate={setSharedDate}
                  onItems={() => onOpenItems(gi)}
                  onRemove={invoices.fields.length > 1 ? () => invoices.remove(gi) : undefined}
                  errors={Array.isArray(invErr) ? invErr[gi] : undefined}
                  itemErrors={hasLineErrors(invErr, gi)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const INCOTERMS: [string, string][] = [
  ['EXW', 'Ex Works'],
  ['FCA', 'Free Carrier'],
  ['FAS', 'Free Alongside Ship'],
  ['FOB', 'Free On Board'],
  ['CFR', 'Cost and Freight'],
  ['CIF', 'Cost, Insurance and Freight'],
  ['CPT', 'Carriage Paid To'],
  ['CIP', 'Carriage and Insurance Paid To'],
  ['DAP', 'Delivered At Place'],
  ['DPU', 'Delivered at Place Unloaded'],
  ['DDP', 'Delivered Duty Paid'],
];

const CURRENCIES: [string, string][] = [
  ['USD', 'United States Dollar'],
  ['KHR', 'Cambodian Riel'],
  ['CNY', 'Chinese Yuan'],
  ['EUR', 'Euro'],
  ['HKD', 'Hong Kong Dollar'],
  ['JPY', 'Japanese Yen'],
  ['KRW', 'South Korean Won'],
  ['SGD', 'Singapore Dollar'],
  ['THB', 'Thai Baht'],
  ['TWD', 'New Taiwan Dollar'],
  ['VND', 'Vietnamese Dong'],
  ['GBP', 'British Pound'],
];

function ReadOnlyBox({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="form-field-group">
      <label>{label}</label>
      <div className={f.roBox} title={title}>
        {value}
      </div>
    </div>
  );
}

/** An import's one invoice: its number and date sit with the bill of lading. */
function SingleInvoice({
  errors,
  itemCount,
  itemErrors,
  onItems,
}: {
  errors: unknown;
  itemCount: number;
  itemErrors: boolean;
  onItems: () => void;
}) {
  const { register } = useFormContext<FormValues>();
  const e = errors as InvErrors;
  return (
    <>
      <div className="form-field-group">
        <label htmlFor="f-inv-0-no">Invoice No.</label>
        <input
          id="f-inv-0-no"
          className="form-field-box"
          placeholder="e.g. CNQ26044"
          {...register('invoices.0.invoiceNo')}
          aria-invalid={!!e?.invoiceNo}
        />
        <FieldError message={e?.invoiceNo?.message} />
      </div>
      <div className="form-field-group">
        <label htmlFor="f-inv-0-date">Invoice Date</label>
        <div className={c.dateWithItems}>
          <input
            id="f-inv-0-date"
            type="date"
            className="form-field-box"
            {...register('invoices.0.invoiceDate')}
          />
          <button
            type="button"
            className={`${c.btn} ${itemErrors ? c.btnDanger : itemCount ? c.btnOutline : c.btnAdd}`}
            onClick={onItems}
          >
            {itemErrors ? '! Fix items' : itemCount ? `Items (${itemCount})` : 'Enter items'}
            <Icon d={ICON_ARROW} />
          </button>
        </div>
      </div>
    </>
  );
}

function InvoiceRow({
  gi,
  active,
  isImport,
  onDate,
  onItems,
  onRemove,
  errors,
  itemErrors,
}: {
  gi: number;
  active: boolean;
  isImport: boolean;
  onDate: (d: string) => void;
  onItems: () => void;
  onRemove: (() => void) | undefined;
  errors: unknown;
  itemErrors: boolean;
}) {
  const { control, register } = useFormContext<FormValues>();
  const lines = useWatch({ control, name: `invoices.${gi}.lines` }) ?? [];
  const e = errors as InvErrors;
  // One invoice = one HTS code (entered on the items); a mix is flagged here.
  const htsCodes = isImport ? [] : htsCodesOf(lines);
  const entered = lines.filter(lineEntered).length;
  const message =
    e?.invoiceNo?.message ??
    (htsCodes.length > 1
      ? `The items have different HS codes (${htsCodes.join(', ')}). One invoice uses one HS code.`
      : e?.htsCode?.message);
  return (
    <>
      <tr data-active={active}>
        <td>{gi + 1}</td>
        <td>
          <input
            type="text"
            className="form-field-box"
            placeholder="Invoice No."
            {...register(`invoices.${gi}.invoiceNo`)}
            aria-invalid={!!e?.invoiceNo}
          />
        </td>
        <td>
          <input
            type="date"
            className="form-field-box"
            {...register(`invoices.${gi}.invoiceDate`, {
              onChange: (ev: React.ChangeEvent<HTMLInputElement>) => onDate(ev.target.value),
            })}
          />
        </td>
        <td>
          <div className={c.rowActions}>
            <button
              type="button"
              className={`${c.btn} ${itemErrors ? c.btnDanger : entered ? c.btnOutline : c.btnAdd}`}
              onClick={onItems}
              title={itemErrors ? 'Some items need fixing' : undefined}
            >
              {itemErrors ? '! Fix items' : entered ? `Items (${entered})` : 'Enter items'}
              <Icon d={ICON_ARROW} />
            </button>
            <button
              type="button"
              className={c.delSolid}
              title={onRemove ? 'Remove invoice' : 'An invoice list keeps at least one invoice'}
              aria-label="Remove invoice"
              disabled={!onRemove}
              onClick={onRemove}
            >
              ×
            </button>
          </div>
        </td>
      </tr>
      {message && (
        <tr className={c.msgRow}>
          <td colSpan={4}>
            <FieldError message={message} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Where "Enter items →" scrolls to. */
export const ITEMS_ANCHOR = 'cargo-items';
