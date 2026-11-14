import { z } from 'zod';
import { CLIENT_STATUSES, type ClientStatus, type Direction, type ShipmentStatus } from '../enums';
import { paginationQuerySchema } from './common';
import { decimal, optDate, optText } from './fields';

/** FOB: buys its own materials; CMT: Cut, Make & Trim, imports materials under its CDC. */
export const CLIENT_BUSINESS_TYPES = ['FOB', 'CMT', 'FOB_CMT'] as const;
export type ClientBusinessType = (typeof CLIENT_BUSINESS_TYPES)[number];
export const CLIENT_BUSINESS_TYPE_LABEL: Record<ClientBusinessType, string> = {
  FOB: 'FOB (Free On Board)',
  CMT: 'CMT (Cut, Make & Trim)',
  FOB_CMT: 'FOB and CMT',
};

/** GDT company TIN: a letter, a 3-digit office code and 9 digits, e.g. L001-902401027. */
export const TIN_PATTERN = /^[A-Z]\d{3}-\d{9}$/;
/** "l001 902401027" / "L001902401027" → "L001-902401027"; anything else is kept as typed. */
export function normalizeTin<T extends string | null | undefined>(v: T): T {
  if (!v) return v;
  const compact = v.replace(/[\s-]+/g, '').toUpperCase();
  const m = /^([A-Z]\d{3})(\d{9})$/.exec(compact);
  return (m ? `${m[1]}-${m[2]}` : v.trim().toUpperCase()) as T;
}

export const clientInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, '2–6 letters or digits, e.g. JR'),
  name: z.string().trim().min(2, 'Enter the company name').max(120),
  legalName: optText(200),
  legalNameKm: optText(200),
  countryIso2: z.string().trim().toUpperCase().length(2, 'Choose a country'),
  address: optText(400),
  addressKm: optText(400),
  // GDT tax number; the VAT number is the same. "L001902401027" is stored as "L001-902401027".
  vattin: optText(40).transform(normalizeTin),
  /** MOC company registration number, e.g. KH2024106187235. */
  cin: optText(40).transform((v) => (v ? v.replace(/\s+/g, '').toUpperCase() : v)),
  businessType: z
    .enum(CLIENT_BUSINESS_TYPES)
    .nullish()
    .or(z.literal(''))
    .transform((v) => v || null),
  mainActivity: optText(200),
  /** When someone last checked these details against the government portal. */
  lastVerifiedOn: optDate,
  contactName: optText(120),
  contactEmail: z
    .string()
    .trim()
    .email('Enter a valid email')
    .nullish()
    .or(z.literal(''))
    .transform((v) => (v ? v : null)),
  contactPhone: optText(40),
  cdcNo: optText(60),
  cdcIssueDate: optDate,
  // Letter signatory: the import permit cover letter and the transfer of rights.
  signatoryName: optText(120),
  signatoryIdNo: optText(40),
  signatoryTitle: optText(120),
  signatoryTitleKm: optText(160),
  letterPhone: optText(40),
  cdcExtensionLetterNo: optText(40),
  customsNoteDate: optDate,
  commissionUsd: decimal(2, { min: 0, allowEmpty: false }),
  status: z.enum(CLIENT_STATUSES).default('ACTIVE'),
});
export type ClientInput = z.input<typeof clientInputSchema>;
export type ClientInputParsed = z.output<typeof clientInputSchema>;

export const clientListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CLIENT_STATUSES).optional(),
});

export interface ClientListItem {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  countryIso2: string;
  countryName: string;
  status: ClientStatus;
  commissionUsd: string;
  shipmentCount: number;
  activeShipments: number;
  lastEta: string | null;
  /** Only returned to roles with accounting:read. */
  netProfitYtd?: string;
}

export interface ClientDetail extends ClientListItem {
  legalNameKm: string | null;
  address: string | null;
  addressKm: string | null;
  vattin: string | null;
  cin: string | null;
  businessType: ClientBusinessType | null;
  mainActivity: string | null;
  lastVerifiedOn: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  cdcNo: string | null;
  cdcIssueDate: string | null;
  signatoryName: string | null;
  signatoryIdNo: string | null;
  signatoryTitle: string | null;
  signatoryTitleKm: string | null;
  letterPhone: string | null;
  cdcExtensionLetterNo: string | null;
  customsNoteDate: string | null;
  createdAt: string;
  importCount: number;
  exportCount: number;
  cutStockItems: number;
  consignees: { id: string; name: string; countryIso2: string | null; address: string | null }[];
  /**
   * Shipper names on the client's shipments plus suppliers added by hand, with their address.
   * `id` is null for a shipper name that has no supplier record (no address) yet.
   */
  suppliers: { id: string | null; name: string; address: string | null }[];
  /** Licences & documents, the soonest expiry first. */
  licences: ClientLicence[];
  recentShipments: {
    id: string;
    reference: string;
    direction: Direction;
    status: ShipmentStatus;
    eta: string | null;
    invoiceNos: string[];
  }[];
}

/** Client Details → Remarks: a note under a subject (a login link, a password, anything). */
export const clientNoteInputSchema = z.object({
  subject: z.string().trim().min(1, 'Enter a subject').max(120),
  body: z.string().trim().max(4000).default(''),
  /** Passwords and the like: the text shows only when someone clicks Show. */
  hidden: z.boolean().default(false),
});
export type ClientNoteInput = z.input<typeof clientNoteInputSchema>;

export interface ClientNote {
  id: string;
  subject: string;
  body: string;
  hidden: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

/** A client's supplier (import shipper): its name and the address under it on the letterhead. */
export const supplierInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter the supplier name').max(200),
  address: optText(500),
});
export type SupplierInput = z.input<typeof supplierInputSchema>;

/** A consignee's address (printed on the export INV + PL). */
export const consigneeAddressSchema = z.object({ address: optText(500) });
export type ConsigneeAddressInput = z.input<typeof consigneeAddressSchema>;

/** Client Details → Consignees → "+ Add": a consignee for this client, with its address. */
export const clientConsigneeInputSchema = z.object({
  name: z.string().trim().min(2, 'Enter the consignee name').max(160),
  address: optText(500),
});
export type ClientConsigneeInput = z.input<typeof clientConsigneeInputSchema>;

/* ---------- Licences & documents ---------- */

/** The registrations and licences a Cambodian (garment) company holds, and who issues them. */
export const LICENCE_TYPES = [
  {
    code: 'VAT_TIN',
    label: 'VAT / TIN registration',
    km: 'វិញ្ញាបនបត្រចុះបញ្ជីអាករ',
    issuer: 'GDT',
  },
  { code: 'PATENT', label: 'Patent tax certificate', km: 'ប័ណ្ណប៉ាតង់', issuer: 'GDT' },
  {
    code: 'MOC_REGISTRATION',
    label: 'Certificate of incorporation',
    km: 'វិញ្ញាបនបត្រចុះបញ្ជីពាណិជ្ជកម្ម',
    issuer: 'MOC',
  },
  { code: 'QIP', label: 'QIP / investment registration', km: 'វិញ្ញាបនបត្រ QIP', issuer: 'CDC' },
  { code: 'CDC_MASTER_LIST', label: 'CDC master list', km: 'បញ្ជីមេ CDC', issuer: 'CDC' },
  {
    code: 'FACTORY_LICENCE',
    label: 'Factory / handicraft licence',
    km: 'អាជ្ញាបណ្ណរោងចក្រ',
    issuer: 'MISTI',
  },
  {
    code: 'ENVIRONMENT',
    label: 'Environmental approval',
    km: 'លិខិតអនុញ្ញាតបរិស្ថាន',
    issuer: 'MOE',
  },
  {
    code: 'LABOUR',
    label: 'Labour registration (LACMS)',
    km: 'ការចុះបញ្ជីការងារ',
    issuer: 'MOLVT',
  },
  { code: 'NSSF', label: 'NSSF registration', km: 'ការចុះបញ្ជី ប.ស.ស.', issuer: 'NSSF' },
  {
    code: 'CUSTOMS_TRADER',
    label: 'Customs trader registration',
    km: 'ការចុះបញ្ជីពាណិជ្ជករគយ',
    issuer: 'GDCE',
  },
  { code: 'OTHER', label: 'Other document', km: 'ឯកសារផ្សេងៗ', issuer: '' },
] as const;
export type LicenceType = (typeof LICENCE_TYPES)[number]['code'];
export const LICENCE_TYPE_CODES = LICENCE_TYPES.map((t) => t.code) as [
  LicenceType,
  ...LicenceType[],
];
export const licenceTypeOf = (code: string) => LICENCE_TYPES.find((t) => t.code === code);

/** Days before the expiry date that a licence counts as "expiring" (and a follow-up is raised). */
export const LICENCE_WARN_DAYS = 30;

export const clientLicenceInputSchema = z
  .object({
    type: z.enum(LICENCE_TYPE_CODES),
    refNo: z.string().trim().min(1, 'Enter the reference number').max(80),
    issuer: optText(60),
    startDate: optDate,
    expiryDate: optDate,
    /** The scan, uploaded first through /documents (with this client). */
    documentId: z
      .string()
      .uuid()
      .nullish()
      .or(z.literal(''))
      .transform((v) => v || null),
    notes: optText(500),
  })
  .refine((v) => !v.startDate || !v.expiryDate || v.startDate <= v.expiryDate, {
    path: ['expiryDate'],
    message: 'The expiry date is before the start date',
  });
export type ClientLicenceInput = z.input<typeof clientLicenceInputSchema>;

export type LicenceState = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'NO_EXPIRY';

export interface ClientLicence {
  id: string;
  type: LicenceType;
  refNo: string;
  issuer: string | null;
  startDate: string | null;
  expiryDate: string | null;
  documentId: string | null;
  documentName: string | null;
  documentMime: string | null;
  notes: string | null;
  /** From the expiry date and today (Phnom Penh). */
  state: LicenceState;
  /** Days until expiry; negative once expired; null without an expiry date. */
  daysLeft: number | null;
  /** A newer licence of the same type replaces this one (it no longer raises follow-ups). */
  superseded: boolean;
  updatedAt: string;
}

/* ---------- Government portal accounts (no passwords) ---------- */

export const PORTALS = [
  { code: 'NSW', label: 'Cambodia National Single Window', url: 'https://apps.nsw.gov.kh' },
  { code: 'ASYCUDA', label: 'GDCE ASYCUDA / Trader portal', url: 'https://www.customs.gov.kh' },
  { code: 'GDT_ETAX', label: 'GDT e-Tax', url: 'https://www.tax.gov.kh' },
  {
    code: 'MOC_OBR',
    label: 'MOC Online Business Registration',
    url: 'https://www.businessregistration.moc.gov.kh',
  },
  { code: 'MOC_CO', label: 'MOC Certificate of Origin', url: '' },
  { code: 'CDC', label: 'Council for the Development of Cambodia', url: 'https://www.cdc.gov.kh' },
  { code: 'LACMS', label: 'MOLVT Labour (LACMS)', url: '' },
  { code: 'NSSF', label: 'NSSF', url: 'https://www.nssf.gov.kh' },
  { code: 'OTHER', label: 'Other portal', url: '' },
] as const;
export type PortalCode = (typeof PORTALS)[number]['code'];
export const PORTAL_CODES = PORTALS.map((p) => p.code) as [PortalCode, ...PortalCode[]];
export const portalOf = (code: string) => PORTALS.find((p) => p.code === code);

export const clientPortalAccountInputSchema = z.object({
  portal: z.enum(PORTAL_CODES),
  url: optText(300),
  username: z.string().trim().min(1, 'Enter the username or login email').max(120),
  /** The person the account belongs to, as on the portal's user list. */
  holderName: optText(120),
  email: optText(160),
  phone: optText(40),
  role: optText(80),
  /** Where the password is kept, e.g. "Bitwarden → Clients → JYX NSW". Never the password. */
  vaultRef: optText(200),
  notes: optText(500),
});
export type ClientPortalAccountInput = z.input<typeof clientPortalAccountInputSchema>;

export interface ClientPortalAccount {
  id: string;
  portal: PortalCode;
  url: string | null;
  username: string;
  holderName: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  vaultRef: string | null;
  notes: string | null;
  updatedAt: string;
}
