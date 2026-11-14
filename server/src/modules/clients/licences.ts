import { and, eq, sql } from 'drizzle-orm';
import {
  LICENCE_WARN_DAYS,
  licenceTypeOf,
  type ClientLicence,
  type ClientPortalAccount,
} from '@gs/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { clientLicenceInputSchema, clientPortalAccountInputSchema } from '@gs/shared';
import { db, type DbOrTx } from '../../db/client';
import { clientLicences, clientPortalAccounts, clients, documents } from '../../db/schema';
import { env } from '../../config/env';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { queryRows } from '../../lib/listing';
import { queueFollowUpRules } from '../followups/rules';

type LicenceValues = z.output<typeof clientLicenceInputSchema>;
type PortalValues = z.output<typeof clientPortalAccountInputSchema>;

const today = sql`(now() AT TIME ZONE ${env.BUSINESS_TIMEZONE})::date`;

/**
 * A licence is superseded once another of the same type has a later expiry (the renewed
 * patent): it stays in the list for the record but no longer warns.
 */
export const SUPERSEDED = sql`EXISTS (
  SELECT 1 FROM client_licences n
  WHERE n.client_id = l.client_id AND n.type = l.type AND n.id <> l.id
    AND n.expiry_date IS NOT NULL AND l.expiry_date IS NOT NULL AND n.expiry_date > l.expiry_date)`;

export async function listLicences(clientId: string, tx: DbOrTx = db): Promise<ClientLicence[]> {
  return queryRows<ClientLicence>(
    tx,
    sql`
    SELECT l.id, l.type, l.ref_no AS "refNo", l.issuer,
           to_char(l.start_date, 'YYYY-MM-DD') AS "startDate",
           to_char(l.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
           l.document_id AS "documentId", d.original_name AS "documentName", d.mime_type AS "documentMime", l.notes,
           CASE WHEN l.expiry_date IS NULL THEN 'NO_EXPIRY'
                WHEN l.expiry_date < ${today} THEN 'EXPIRED'
                WHEN l.expiry_date <= ${today} + ${LICENCE_WARN_DAYS}::int THEN 'EXPIRING'
                ELSE 'VALID' END AS state,
           (l.expiry_date - ${today})::int AS "daysLeft",
           ${SUPERSEDED} AS superseded,
           l.updated_at AS "updatedAt"
    FROM client_licences l
    LEFT JOIN documents d ON d.id = l.document_id AND d.deleted_at IS NULL
    WHERE l.client_id = ${clientId}
    ORDER BY ${SUPERSEDED}, l.expiry_date NULLS LAST, l.type, l.ref_no`,
  );
}

async function assertClient(tx: DbOrTx, clientId: string) {
  const [c] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
  if (!c) throw notFound('Client');
}

/** The scan must be a file of this client (uploaded through /documents with its clientId). */
async function assertDocument(tx: DbOrTx, clientId: string, documentId: string | null) {
  if (!documentId) return;
  const [d] = await tx
    .select({ clientId: documents.clientId })
    .from(documents)
    .where(eq(documents.id, documentId));
  if (!d || d.clientId !== clientId)
    throw badRequest('The attached file is not one of this client');
}

/** Blank issuer: the ministry that issues this type (GDT for a patent…). */
const withIssuer = (v: LicenceValues) => ({
  ...v,
  issuer: v.issuer ?? (licenceTypeOf(v.type)?.issuer || null),
});

export async function createLicence(
  clientId: string,
  input: LicenceValues,
  req: Request,
): Promise<{ id: string }> {
  const out = await db.transaction(async (tx) => {
    await assertClient(tx, clientId);
    await assertDocument(tx, clientId, input.documentId);
    const userId = req.auth?.userId ?? null;
    const [row] = await tx
      .insert(clientLicences)
      .values({ clientId, ...withIssuer(input), createdById: userId, updatedById: userId })
      .returning();
    await audit(
      tx,
      { action: 'CREATE', entity: 'client_licence', entityId: row!.id, after: row },
      req,
    );
    return { id: row!.id };
  });
  // A new or renewed licence raises or closes the "Licence expiring" follow-up.
  queueFollowUpRules();
  return out;
}

export async function updateLicence(
  clientId: string,
  licenceId: string,
  input: LicenceValues,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const where = and(eq(clientLicences.id, licenceId), eq(clientLicences.clientId, clientId));
    const [before] = await tx.select().from(clientLicences).where(where).for('update');
    if (!before) throw notFound('Licence');
    await assertDocument(tx, clientId, input.documentId);
    const [after] = await tx
      .update(clientLicences)
      .set({ ...withIssuer(input), updatedById: req.auth?.userId ?? null, updatedAt: new Date() })
      .where(where)
      .returning();
    await audit(
      tx,
      { action: 'UPDATE', entity: 'client_licence', entityId: licenceId, before, after },
      req,
    );
  });
  queueFollowUpRules();
}

/** The scan stays in Documents (soft-deleted files are kept for the audit trail anyway). */
export async function deleteLicence(clientId: string, licenceId: string, req: Request) {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .delete(clientLicences)
      .where(and(eq(clientLicences.id, licenceId), eq(clientLicences.clientId, clientId)))
      .returning();
    if (!before) throw notFound('Licence');
    await audit(
      tx,
      { action: 'DELETE', entity: 'client_licence', entityId: licenceId, before },
      req,
    );
  });
  queueFollowUpRules();
}

/* ---------- Portal accounts ---------- */

export function listPortalAccounts(clientId: string): Promise<ClientPortalAccount[]> {
  return queryRows<ClientPortalAccount>(
    db,
    sql`
    SELECT id, portal, url, username, holder_name AS "holderName", email, phone, role,
           vault_ref AS "vaultRef", notes, updated_at AS "updatedAt"
    FROM client_portal_accounts WHERE client_id = ${clientId}
    ORDER BY portal, username`,
  );
}

export async function createPortalAccount(
  clientId: string,
  input: PortalValues,
  req: Request,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    await assertClient(tx, clientId);
    const userId = req.auth?.userId ?? null;
    const [row] = await tx
      .insert(clientPortalAccounts)
      .values({ clientId, ...input, createdById: userId, updatedById: userId })
      .returning();
    await audit(
      tx,
      { action: 'CREATE', entity: 'client_portal_account', entityId: row!.id, after: row },
      req,
    );
    return { id: row!.id };
  });
}

export async function updatePortalAccount(
  clientId: string,
  accountId: string,
  input: PortalValues,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const where = and(
      eq(clientPortalAccounts.id, accountId),
      eq(clientPortalAccounts.clientId, clientId),
    );
    const [before] = await tx.select().from(clientPortalAccounts).where(where).for('update');
    if (!before) throw notFound('Portal account');
    const [after] = await tx
      .update(clientPortalAccounts)
      .set({ ...input, updatedById: req.auth?.userId ?? null, updatedAt: new Date() })
      .where(where)
      .returning();
    await audit(
      tx,
      { action: 'UPDATE', entity: 'client_portal_account', entityId: accountId, before, after },
      req,
    );
  });
}

export async function deletePortalAccount(clientId: string, accountId: string, req: Request) {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .delete(clientPortalAccounts)
      .where(
        and(eq(clientPortalAccounts.id, accountId), eq(clientPortalAccounts.clientId, clientId)),
      )
      .returning();
    if (!before) throw notFound('Portal account');
    await audit(
      tx,
      { action: 'DELETE', entity: 'client_portal_account', entityId: accountId, before },
      req,
    );
  });
}
