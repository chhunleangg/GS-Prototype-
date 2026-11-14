import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { CUT_STOCK_CATEGORY_LABEL, type CutStockRow } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useCutStock } from '../../features/hooks';
import { fmtNum } from '../../lib/format';
import { FieldError, Modal } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { icons } from '../../layout/icons';
import { cdcKey, hasLineErrors, ITEMS_ANCHOR, lineEntered, money } from './CargoSection';
import { blankLine, toNum, type FormValues, type LineValues } from './formModel';
import t from './ItemsSection.module.css';

/** "II. Raw Material" → "II. RAW MATERIAL", as the import schedule writes it. */
const materialOf = (it: CutStockRow) => CUT_STOCK_CATEGORY_LABEL[it.category].toUpperCase();

const PAGE_SIZES = [5, 10, 25, 50];

interface Column {
  key: string;
  label: string;
  num?: boolean;
  /** The cell's text: what is shown, and what the column's search box matches. */
  text: (l: LineValues) => string;
}

const amountOf = (l: LineValues) => toNum(l.pcs) * toNum(l.fobUnitPrice);
const n3 = (v: unknown) => (toNum(v) ? fmtNum(toNum(v), 2) : '');

const IMPORT_COLS: Column[] = [
  { key: 'cdcNo', label: 'CDC No.', text: (l) => l.cdcNo ?? '' },
  { key: 'description', label: 'Item', text: (l) => l.description ?? '' },
  { key: 'material', label: 'Material', text: (l) => l.material ?? '' },
  {
    key: 'pcs',
    label: 'Quantity',
    num: true,
    text: (l) => (toNum(l.pcs) ? `${fmtNum(toNum(l.pcs), 2)} ${l.unit ?? ''}`.trim() : ''),
  },
  { key: 'nw', label: 'Net Wt (kg)', num: true, text: (l) => n3(l.netWeightKg) },
  { key: 'gw', label: 'Gross Wt (kg)', num: true, text: (l) => n3(l.grossWeightKg) },
  {
    key: 'price',
    label: 'Unit Price (USD)',
    num: true,
    text: (l) => (toNum(l.fobUnitPrice) ? fmtNum(toNum(l.fobUnitPrice), 4) : ''),
  },
  {
    key: 'amount',
    label: 'Amount (USD)',
    num: true,
    text: (l) => (amountOf(l) ? money(amountOf(l)) : ''),
  },
];

const EXPORT_COLS: Column[] = [
  { key: 'description', label: 'Description', text: (l) => l.description ?? '' },
  { key: 'poNo', label: 'PO No.', text: (l) => l.poNo ?? '' },
  { key: 'styleNo', label: 'Style No.', text: (l) => l.styleNo ?? '' },
  { key: 'pcs', label: 'PCS', num: true, text: (l) => (toNum(l.pcs) ? fmtNum(toNum(l.pcs)) : '') },
  {
    key: 'ctns',
    label: 'CTNS',
    num: true,
    text: (l) => (toNum(l.ctns) ? fmtNum(toNum(l.ctns)) : ''),
  },
  { key: 'nw', label: 'Net Wt (kg)', num: true, text: (l) => n3(l.netWeightKg) },
  { key: 'gw', label: 'Gross Wt (kg)', num: true, text: (l) => n3(l.grossWeightKg) },
  { key: 'cbm', label: 'CBM', num: true, text: (l) => (toNum(l.cbm) ? fmtNum(toNum(l.cbm), 3) : '') },
  {
    key: 'price',
    label: 'Unit Price (USD)',
    num: true,
    text: (l) => (toNum(l.fobUnitPrice) ? fmtNum(toNum(l.fobUnitPrice), 4) : ''),
  },
  {
    key: 'amount',
    label: 'Amount (USD)',
    num: true,
    text: (l) => (amountOf(l) ? money(amountOf(l)) : ''),
  },
];

/**
 * The Items tab, laid out like the NSW item list: one invoice's items as a read-only table
 * (a search box over each column, paged), entered one at a time in a pop-up.
 */
export function ItemsSection({
  active,
  onActive,
}: {
  active: number;
  onActive: (gi: number) => void;
}) {
  const {
    control,
    formState: { errors, defaultValues },
  } = useFormContext<FormValues>();
  const watched = useWatch({ control, name: 'invoices' }) ?? [];
  const isImport = useWatch({ control, name: 'direction' }) === 'IMPORT';
  const clientId = useWatch({ control, name: 'clientId' });
  const cut = useCutStock({ clientId, pageSize: 500, sort: 'lineNo' }, isImport && !!clientId);
  const cdcItems = useMemo(() => cut.data?.data ?? [], [cut.data]);
  // Each import item's quantity comes off its master-list balance. The balance already
  // excludes this shipment's saved items (saving replaces them), so those are added back
  // before the form's are taken off.
  const remainingAfter = new Map<string, number>();
  if (isImport) {
    const byKey = new Map(cdcItems.map((it) => [cdcKey(it.declareRef), it]));
    const add = (cdcNo: string | null | undefined, qty: number) => {
      const it = cdcNo ? byKey.get(cdcKey(cdcNo)) : undefined;
      if (it) remainingAfter.set(it.id, (remainingAfter.get(it.id) ?? Number(it.balance)) + qty);
    };
    defaultValues?.invoices?.forEach((inv) =>
      inv?.lines?.forEach((l) => add(l?.cdcNo, toNum(l?.pcs))),
    );
    watched.forEach((inv) => inv.lines?.forEach((l) => add(l.cdcNo, -toNum(l.pcs))));
  }
  const gi = Math.min(Math.max(active, 0), watched.length - 1);
  const inv = watched[gi];

  return (
    <div className="cx-card" id={ITEMS_ANCHOR}>
      {!inv ? (
        <p className={t.empty}>No invoices yet: add one on the Invoice tab first.</p>
      ) : (
        <ItemsTable
          key={gi}
          gi={gi}
          isImport={isImport}
          cdcItems={cdcItems}
          remainingAfter={remainingAfter}
          errors={Array.isArray(errors.invoices) ? errors.invoices[gi] : undefined}
          switcher={
            watched.length > 1 && (
              <div className={t.switcher} role="group" aria-label="Invoice">
                {watched.map((x, i) => {
                  const n = x.lines.filter(lineEntered).length;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={t.switch}
                      aria-pressed={i === gi}
                      data-error={hasLineErrors(errors.invoices, i)}
                      onClick={() => onActive(i)}
                    >
                      {x.invoiceNo || `Invoice ${i + 1}`}
                      <small>
                        {n} item{n === 1 ? '' : 's'}
                      </small>
                    </button>
                  );
                })}
              </div>
            )
          }
        />
      )}
    </div>
  );
}

type LineErrors = Record<number, Record<string, { message?: string }>>;

function ItemsTable({
  gi,
  isImport,
  cdcItems,
  remainingAfter,
  errors,
  switcher,
}: {
  gi: number;
  isImport: boolean;
  cdcItems: CutStockRow[];
  remainingAfter: Map<string, number>;
  errors: unknown;
  switcher: ReactNode;
}) {
  const {
    control,
    setValue,
    trigger,
    formState: { isSubmitted },
  } = useFormContext<FormValues>();
  const lines = useFieldArray({ control, name: `invoices.${gi}.lines` });
  const watchedLines = (useWatch({ control, name: `invoices.${gi}.lines` }) ?? []) as LineValues[];
  const invoiceNo = useWatch({ control, name: `invoices.${gi}.invoiceNo` });
  const cols = isImport ? IMPORT_COLS : EXPORT_COLS;
  const lineErrs = (errors as { lines?: LineErrors | { message?: string } } | undefined)?.lines;
  const listErr =
    lineErrs && 'message' in lineErrs ? (lineErrs as { message?: string }).message : undefined;
  const errOf = (i: number) =>
    lineErrs && !('message' in lineErrs) ? (lineErrs as LineErrors)[i] : undefined;

  // Only the entered items are listed; a blank line (a new invoice starts with one) is not.
  const entered = watchedLines.map((l, i) => ({ l, i })).filter(({ l }) => lineEntered(l));
  const [filters, setFilters] = useState<Record<string, string>>({});
  const shown = entered.filter(({ l }) =>
    cols.every((c) => {
      const q = filters[c.key]?.trim().toLowerCase();
      return !q || c.text(l).toLowerCase().includes(q);
    }),
  );
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const cur = Math.min(page, pages);
  const rows = shown.slice((cur - 1) * pageSize, cur * pageSize);

  const sum = entered.reduce(
    (s, { l }) => ({
      pcs: s.pcs + toNum(l.pcs),
      ctns: s.ctns + toNum(l.ctns),
      nw: s.nw + toNum(l.netWeightKg),
      gw: s.gw + toNum(l.grossWeightKg),
      cbm: s.cbm + toNum(l.cbm),
      amount: s.amount + amountOf(l),
    }),
    { pcs: 0, ctns: 0, nw: 0, gw: 0, cbm: 0, amount: 0 },
  );

  /** The pop-up: which line (an index into the invoice's lines), or 'new'. */
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const close = useCallback(() => setEditing(null), []);

  /** Writes the pop-up's item into the invoice; returns the line's index. */
  const commit = (at: number | 'new', draft: LineValues): number => {
    let idx: number;
    if (at !== 'new') {
      lines.update(at, draft);
      idx = at;
    } else {
      const blank = watchedLines.findIndex((l) => !lineEntered(l));
      // An export keeps the lines of one description together (they print as one group).
      const sameDesc = isImport
        ? -1
        : watchedLines.findLastIndex(
            (l) =>
              lineEntered(l) &&
              (l.description ?? '').trim().toLowerCase() ===
                (draft.description ?? '').trim().toLowerCase(),
          );
      if (blank >= 0) {
        lines.update(blank, draft);
        idx = blank;
      } else if (sameDesc >= 0 && sameDesc < watchedLines.length - 1) {
        lines.insert(sameDesc + 1, draft);
        idx = sameDesc + 1;
      } else {
        lines.append(draft);
        idx = watchedLines.length;
      }
    }
    // The invoice's own description follows its first line (used on printed documents).
    const first = idx === 0 ? draft : watchedLines[0];
    if (first) setValue(`invoices.${gi}.description`, first.description ?? '', { shouldDirty: true });
    if (isSubmitted) void trigger(`invoices.${gi}.lines`);
    return idx;
  };

  const remove = (i: number) => {
    const l = watchedLines[i];
    if (!window.confirm(`Delete ${l?.description || l?.cdcNo || 'this item'}?`)) return;
    // An invoice always keeps one line; the last one is cleared instead.
    if (watchedLines.length > 1) lines.remove(i);
    else lines.update(0, blankLine());
  };

  const enteredIdx = entered.map((e) => e.i);
  const noun = isImport ? 'item' : 'line';

  return (
    <>
      <div className={t.head}>
        <h4 className={t.title}>
          {icons.menu({})}
          {isImport ? 'CDC Item List' : 'Item List'}
          <span className={t.chip}>{invoiceNo || `Invoice ${gi + 1}`}</span>
        </h4>
        <button type="button" className={t.addBtn} onClick={() => setEditing('new')}>
          {icons.plus({})} Add {noun}
        </button>
      </div>
      {switcher}
      <FieldError message={listErr} />

      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr className={t.filterRow}>
              <th />
              {cols.map((c) => (
                <th key={c.key}>
                  <input
                    className={t.filter}
                    placeholder={c.label}
                    aria-label={`Search ${c.label}`}
                    value={filters[c.key] ?? ''}
                    onChange={(e) => {
                      setFilters((f) => ({ ...f, [c.key]: e.target.value }));
                      setPage(1);
                    }}
                  />
                </th>
              ))}
              <th />
            </tr>
            <tr>
              <th className={t.no}>No.</th>
              {cols.map((c) => (
                <th key={c.key} data-num={c.num}>
                  {c.label}
                </th>
              ))}
              <th className={t.actCol}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, i }) => {
              const err = errOf(i);
              const msg = err && Object.values(err).find((e) => e?.message)?.message;
              return (
                <tr
                  key={lines.fields[i]?.id ?? i}
                  data-error={!!err}
                  title={msg}
                  onClick={() => setEditing(i)}
                >
                  <td className={t.no}>
                    {enteredIdx.indexOf(i) + 1}
                    {err && <span className={t.errDot}>!</span>}
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} data-num={c.num}>
                      {c.text(l) || <span className={t.dash}>—</span>}
                    </td>
                  ))}
                  <td className={t.actCol} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={t.iconBtn}
                      title="Edit"
                      aria-label="Edit"
                      onClick={() => setEditing(i)}
                    >
                      {icons.edit({})}
                    </button>
                    <button
                      type="button"
                      className={t.iconBtn}
                      data-tone="danger"
                      title="Delete"
                      aria-label="Delete"
                      onClick={() => remove(i)}
                    >
                      {icons.trash({})}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr className={t.emptyRow}>
                <td colSpan={cols.length + 2}>
                  {entered.length ? (
                    'No item matches the search.'
                  ) : (
                    <>
                      No {noun}s yet.{' '}
                      <button
                        type="button"
                        className="filter-mini-link"
                        onClick={() => setEditing('new')}
                      >
                        Add the first {noun}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
          {entered.length > 0 && (
            <tfoot>
              <tr>
                <td />
                {cols.map((c, ci) => (
                  <td key={c.key} data-num={c.num}>
                    {ci === 0
                      ? 'Invoice total'
                      : c.key === 'pcs'
                        ? fmtNum(sum.pcs, 2)
                        : c.key === 'ctns'
                          ? fmtNum(sum.ctns)
                          : c.key === 'nw'
                            ? fmtNum(sum.nw, 2)
                            : c.key === 'gw'
                              ? fmtNum(sum.gw, 2)
                              : c.key === 'cbm'
                                ? fmtNum(sum.cbm, 3)
                                : c.key === 'amount'
                                  ? money(sum.amount)
                                  : ''}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className={t.pager}>
        <div className={t.pagerInfo}>
          <label>
            Rows per page{' '}
            <select
              className={t.sizeSelect}
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span>
            {shown.length
              ? `Showing ${(cur - 1) * pageSize + 1} to ${Math.min(cur * pageSize, shown.length)} of ${shown.length} ${noun}s`
              : `0 ${noun}s`}
          </span>
        </div>
        {pages > 1 && (
          <div className={t.pages}>
            <button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>
              Previous
            </button>
            {Array.from({ length: pages }, (_, p) => p + 1).map((p) => (
              <button
                key={p}
                type="button"
                aria-current={p === cur ? 'page' : undefined}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
            <button type="button" disabled={cur >= pages} onClick={() => setPage(cur + 1)}>
              Next
            </button>
          </div>
        )}
      </div>

      {editing !== null && (
        <ItemDialog
          key={String(editing)}
          at={editing}
          isImport={isImport}
          lines={watchedLines}
          enteredIdx={enteredIdx}
          cdcItems={cdcItems}
          remainingAfter={remainingAfter}
          serverErrors={editing === 'new' ? undefined : errOf(editing)}
          onCommit={commit}
          onOpen={setEditing}
          onClose={close}
        />
      )}
    </>
  );
}

/** The pop-up for one item, as on the NSW form: General · Weight · Value. */
function ItemDialog({
  at,
  isImport,
  lines,
  enteredIdx,
  cdcItems,
  remainingAfter,
  serverErrors,
  onCommit,
  onOpen,
  onClose,
}: {
  at: number | 'new';
  isImport: boolean;
  lines: LineValues[];
  enteredIdx: number[];
  cdcItems: CutStockRow[];
  remainingAfter: Map<string, number>;
  serverErrors: Record<string, { message?: string }> | undefined;
  onCommit: (at: number | 'new', draft: LineValues) => number;
  onOpen: (at: number | 'new') => void;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const original = at === 'new' ? undefined : lines[at];
  const [draft, setDraft] = useState<LineValues>(() => ({ ...blankLine(), ...original }));
  const [picking, setPicking] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = <K extends keyof LineValues>(k: K, v: LineValues[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrs((e) => ({ ...e, [k]: '' }));
  };

  const itemOf = (cdcNo: string | null | undefined) =>
    cdcNo ? cdcItems.find((x) => cdcKey(x.declareRef) === cdcKey(cdcNo)) : undefined;
  const it = isImport ? itemOf(draft.cdcNo) : undefined;
  // Balance after saving, with this pop-up's quantity in place of the line's saved one.
  const after =
    it &&
    (remainingAfter.get(it.id) ?? Number(it.balance)) +
      (itemOf(original?.cdcNo)?.id === it.id ? toNum(original?.pcs) : 0) -
      toNum(draft.pcs);
  const over = after !== undefined && after < -1e-9;

  const pick = (x: CutStockRow) => {
    setDraft((d) => ({
      ...d,
      cdcNo: x.declareRef,
      description: x.name,
      material: materialOf(x),
      unit: x.unit,
      fobUnitPrice: toNum(d.fobUnitPrice) ? d.fobUnitPrice : String(Number(x.unitPrice)),
    }));
    setErrs((e) => ({ ...e, cdcNo: '' }));
    setPicking(false);
  };

  const check = () => {
    const e: Record<string, string> = {};
    if (isImport && !draft.cdcNo) e.cdcNo = 'Search and choose the item';
    if (!isImport && !draft.description?.trim()) e.description = 'Enter the description';
    if (!toNum(draft.pcs)) e.pcs = 'Enter the quantity';
    if (over && can('cutstock:override') && !draft.overrideReason?.trim())
      e.overrideReason = 'Give the reason for going over the balance';
    setErrs(e);
    return !Object.values(e).some(Boolean);
  };
  const changed = JSON.stringify({ ...blankLine(), ...original }) !== JSON.stringify(draft);
  const save = () => {
    if (!check()) return;
    onCommit(at, { ...draft, overrideReason: over ? draft.overrideReason : '' });
    onClose();
  };
  /** Prev / next: keeps this item (when changed) and opens the other. */
  const pos = at === 'new' ? enteredIdx.length : enteredIdx.indexOf(at);
  const go = (to: number | undefined) => {
    if (to === undefined) return;
    if (changed) {
      if (!check()) return;
      onCommit(at, draft);
    }
    onOpen(to);
  };

  const err = (k: string) => errs[k] || serverErrors?.[k]?.message;
  const amount = amountOf(draft);
  const title =
    at === 'new'
      ? `New ${isImport ? 'item' : 'line'}`
      : `${isImport ? 'Item' : 'Line'} ${pos + 1} of ${enteredIdx.length}`;

  return (
    <Modal title={title} onClose={onClose} width={900}>
      {picking ? (
        <ItemPicker
          items={cdcItems}
          remainingAfter={remainingAfter}
          onPick={pick}
          onBack={() => setPicking(false)}
        />
      ) : (
        <div
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
              e.preventDefault();
              save();
            }
          }}
        >
          <div className={t.navRow}>
            <button
              type="button"
              className={t.navBtn}
              disabled={at === 'new' || pos <= 0}
              onClick={() => go(enteredIdx[pos - 1])}
            >
              ‹ Prev
            </button>
            <button
              type="button"
              className={t.navBtn}
              disabled={at === 'new' || pos >= enteredIdx.length - 1}
              onClick={() => go(enteredIdx[pos + 1])}
            >
              Next ›
            </button>
          </div>

          <div className={t.dlgCols}>
            <section>
              <h5 className={t.secTitle}>{icons.documents({})}General</h5>
              {isImport ? (
                <>
                  <DlgField label="Item" error={err('cdcNo')}>
                    <div className={t.searchField}>
                      <input
                        className="form-field-box"
                        readOnly
                        value={draft.description ?? ''}
                        placeholder="Search the CDC master list"
                        onClick={() => setPicking(true)}
                        aria-invalid={!!err('cdcNo')}
                      />
                      <button
                        type="button"
                        className={t.searchBtn}
                        title="Search item"
                        aria-label="Search item"
                        onClick={() => setPicking(true)}
                      >
                        {icons.search({})}
                      </button>
                    </div>
                  </DlgField>
                  <DlgField label="CDC No.">
                    <div className={t.ro}>{draft.cdcNo || '—'}</div>
                  </DlgField>
                  <DlgField label="Material">
                    <div className={t.ro}>{draft.material || '—'}</div>
                  </DlgField>
                </>
              ) : (
                <>
                  <DlgField label="Description" error={err('description')}>
                    <input
                      className="form-field-box"
                      list="items-descriptions"
                      value={draft.description ?? ''}
                      placeholder="e.g. Mens woven shorts 100 nylon"
                      onChange={(e) => set('description', e.target.value)}
                      aria-invalid={!!err('description')}
                    />
                    <datalist id="items-descriptions">
                      {[...new Set(lines.map((l) => l.description?.trim()).filter(Boolean))].map(
                        (d) => (
                          <option key={d} value={d!} />
                        ),
                      )}
                    </datalist>
                  </DlgField>
                  <DlgField label="PO No." error={err('poNo')}>
                    <input
                      className="form-field-box"
                      value={draft.poNo ?? ''}
                      onChange={(e) => set('poNo', e.target.value)}
                    />
                  </DlgField>
                  <DlgField label="Style No." error={err('styleNo')}>
                    <input
                      className="form-field-box"
                      value={draft.styleNo ?? ''}
                      onChange={(e) => set('styleNo', e.target.value)}
                    />
                  </DlgField>
                  <DlgField label="HS Code" error={err('htsCode')}>
                    <input
                      className="form-field-box"
                      value={draft.htsCode ?? ''}
                      onChange={(e) => set('htsCode', e.target.value)}
                    />
                  </DlgField>
                </>
              )}
            </section>

            <section>
              <h5 className={t.secTitle}>{icons.documents({})}Quantity &amp; Weight</h5>
              <DlgField label={isImport ? 'Quantity' : 'Quantity (PCS)'} error={err('pcs')}>
                <div className={t.withUnit}>
                  <NumberInput
                    className="form-field-box"
                    decimals={3}
                    value={draft.pcs ?? ''}
                    onChange={(e) => set('pcs', e.target.value)}
                    aria-invalid={!!err('pcs')}
                  />
                  <span>{isImport ? draft.unit || 'Unit' : 'PCS'}</span>
                </div>
              </DlgField>
              {!isImport && (
                <DlgField label="Packages (CTNS)" error={err('ctns')}>
                  <div className={t.withUnit}>
                    <NumberInput
                      className="form-field-box"
                      decimals={3}
                      value={draft.ctns ?? ''}
                      onChange={(e) => set('ctns', e.target.value)}
                    />
                    <span>CTNS</span>
                  </div>
                </DlgField>
              )}
              <DlgField label="Gross Weight" error={err('grossWeightKg')}>
                <div className={t.withUnit}>
                  <NumberInput
                    className="form-field-box"
                    decimals={3}
                    value={draft.grossWeightKg ?? ''}
                    onChange={(e) => set('grossWeightKg', e.target.value)}
                  />
                  <span>KGM</span>
                </div>
              </DlgField>
              <DlgField label="Net Weight" error={err('netWeightKg')}>
                <div className={t.withUnit}>
                  <NumberInput
                    className="form-field-box"
                    decimals={3}
                    value={draft.netWeightKg ?? ''}
                    onChange={(e) => set('netWeightKg', e.target.value)}
                  />
                  <span>KGM</span>
                </div>
              </DlgField>
              {!isImport && (
                <DlgField label="Volume" error={err('cbm')}>
                  <div className={t.withUnit}>
                    <NumberInput
                      className="form-field-box"
                      decimals={3}
                      value={draft.cbm ?? ''}
                      onChange={(e) => set('cbm', e.target.value)}
                    />
                    <span>CBM</span>
                  </div>
                </DlgField>
              )}
            </section>

            <section>
              <h5 className={t.secTitle}>{icons.documents({})}Value</h5>
              <DlgField label="Unit Price" error={err('fobUnitPrice')}>
                <div className={t.withUnit}>
                  <NumberInput
                    className="form-field-box"
                    decimals={4}
                    value={draft.fobUnitPrice ?? ''}
                    onChange={(e) => set('fobUnitPrice', e.target.value)}
                  />
                  <span>USD</span>
                </div>
              </DlgField>
              <DlgField label="Amount">
                <div className={t.withUnit}>
                  <div className={t.ro}>{amount ? money(amount) : '—'}</div>
                  <span>USD</span>
                </div>
              </DlgField>
              {it && after !== undefined && (
                <DlgField label="CDC Balance After Saving">
                  <div className={t.ro} data-over={over}>
                    {fmtNum(after, 2)} {it.unit}
                  </div>
                </DlgField>
              )}
            </section>
          </div>

          {over &&
            (can('cutstock:override') ? (
              <DlgField label="Reason for going over the balance" error={err('overrideReason')}>
                <input
                  className="form-field-box"
                  value={draft.overrideReason ?? ''}
                  placeholder="Required: why this item may exceed the CDC balance"
                  onChange={(e) => set('overrideReason', e.target.value)}
                  aria-invalid={!!err('overrideReason')}
                />
              </DlgField>
            ) : (
              <FieldError message="More than the remaining CDC balance. A Manager must approve this item." />
            ))}

          <div className={t.dlgFoot}>
            <button type="button" className="btn-cancel-shipment" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn-cancel-shipment"
              onClick={() => {
                setDraft(blankLine());
                setErrs({});
              }}
            >
              Clear
            </button>
            <button type="button" className="btn-create-submit" onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DlgField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="form-field-group">
      <label>{label}</label>
      {children}
      <FieldError message={error} />
    </div>
  );
}

/** Search the client's CDC master list and pick an item. */
function ItemPicker({
  items,
  remainingAfter,
  onPick,
  onBack,
}: {
  items: CutStockRow[];
  remainingAfter: Map<string, number>;
  onPick: (it: CutStockRow) => void;
  onBack: () => void;
}) {
  const [q, setQ] = useState('');
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = items.filter((it) => {
    const hay = `${it.declareRef} ${it.name} ${materialOf(it)} ${it.unit}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return (
    <div className={t.picker}>
      <div className={t.pickerBar}>
        <button type="button" className={t.navBtn} onClick={onBack}>
          ‹ Back
        </button>
        <input
          className="form-field-box"
          autoFocus
          placeholder="Search by item name, CDC no. or material"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (found.length === 1) onPick(found[0]!);
            }
          }}
        />
      </div>
      <div className={t.pickerList}>
        <table className={t.table}>
          <thead>
            <tr>
              <th>CDC No.</th>
              <th>Item</th>
              <th>Material</th>
              <th>Unit</th>
              <th data-num>Balance</th>
              <th data-num>Unit Price</th>
            </tr>
          </thead>
          <tbody>
            {found.map((it) => {
              const bal = remainingAfter.get(it.id) ?? Number(it.balance);
              return (
                <tr key={it.id} onClick={() => onPick(it)}>
                  <td>{it.declareRef}</td>
                  <td>{it.name}</td>
                  <td>{materialOf(it)}</td>
                  <td>{it.unit}</td>
                  <td data-num data-over={bal <= 0}>
                    {fmtNum(bal, 2)}
                  </td>
                  <td data-num>{fmtNum(Number(it.unitPrice), 4)}</td>
                </tr>
              );
            })}
            {!found.length && (
              <tr className={t.emptyRow}>
                <td colSpan={6}>
                  {items.length
                    ? 'No item matches the search.'
                    : 'This client has no items on its CDC master list.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
