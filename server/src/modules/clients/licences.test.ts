import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClientDetail, ClientLicence, ClientPortalAccount, RoleCode } from '@gs/shared';
import { createApp } from '../../app';
import { pool } from '../../db/client';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';

const app = createApp();
let basics: Awaited<ReturnType<typeof seedBasics>>;
let tokens: Partial<Record<RoleCode, string>> = {};

async function as(role: RoleCode) {
  if (!tokens[role]) {
    await createUser(role);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `${role.toLowerCase()}@test.local`, password: TEST_PASSWORD });
    tokens[role] = res.body.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[role]}` };
}

/** The business date (Phnom Penh) `days` from today, as the API counts them. */
const inDays = (days: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(
    new Date(),
  );
  return new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
};

beforeEach(async () => {
  await resetDb();
  tokens = {};
  basics = await seedBasics();
});
afterAll(async () => {
  await pool.end();
});

describe('client identity fields', () => {
  it('stores CIN, business type and tax payer, and formats the VAT-TIN', async () => {
    const h = await as('MANAGER');
    const res = await request(app).patch(`/api/v1/clients/${basics.jr.id}`).set(h).send({
      vattin: 'l001 902401027',
      cin: 'kh2024106187235',
      businessType: 'CMT',
      mainActivity: 'Manufacture of garments',
      lastVerifiedOn: '2026-10-20',
    });
    expect(res.status).toBe(200);
    const c = (await request(app).get(`/api/v1/clients/${basics.jr.id}`).set(h))
      .body as ClientDetail;
    expect(c).toMatchObject({
      vattin: 'L001-902401027',
      cin: 'KH2024106187235',
      businessType: 'CMT',
      mainActivity: 'Manufacture of garments',
      lastVerifiedOn: '2026-10-20',
      licences: [],
    });
  });

  it('refuses a VAT-TIN or CIN already used by another client', async () => {
    const h = await as('MANAGER');
    await request(app)
      .patch(`/api/v1/clients/${basics.jr.id}`)
      .set(h)
      .send({ vattin: 'L001-902401027', cin: 'KH2024106187235' })
      .expect(200);
    const dupTin = await request(app).post('/api/v1/clients').set(h).send({
      code: 'DUP',
      name: 'Duplicate Co',
      countryIso2: 'KH',
      commissionUsd: '50',
      vattin: 'L001902401027',
    });
    expect(dupTin.status).toBe(409);
    expect(dupTin.body.error.message).toMatch(/VAT-TIN .* already used/);
    const dupCin = await request(app).post('/api/v1/clients').set(h).send({
      code: 'DUP',
      name: 'Duplicate Co',
      countryIso2: 'KH',
      commissionUsd: '50',
      cin: 'KH2024106187235',
    });
    expect(dupCin.status).toBe(409);
    // Saving the same client again with its own numbers is fine.
    await request(app)
      .patch(`/api/v1/clients/${basics.jr.id}`)
      .set(h)
      .send({ vattin: 'L001-902401027', name: 'JR Apparel Corp' })
      .expect(200);
  });
});

describe('client licences', () => {
  it('works out each licence state, marks a renewal and raises one follow-up', async () => {
    const h = await as('MANAGER');
    const url = `/api/v1/clients/${basics.jr.id}/licences`;
    const add = (body: Record<string, unknown>) => request(app).post(url).set(h).send(body);

    expect(
      (
        await add({
          type: 'PATENT',
          refNo: 'P-2025',
          startDate: inDays(-400),
          expiryDate: inDays(-35),
        })
      ).status,
    ).toBe(201);
    await add({ type: 'PATENT', refNo: 'P-2026', startDate: inDays(-34), expiryDate: inDays(10) });
    await add({ type: 'QIP', refNo: 'QIP-1', expiryDate: inDays(200) });
    await add({ type: 'VAT_TIN', refNo: 'L001-902401027' });
    const bad = await add({
      type: 'MOC_REGISTRATION',
      refNo: 'X',
      startDate: '2026-05-01',
      expiryDate: '2026-01-01',
    });
    expect(bad.status).toBe(400);

    const list = (await request(app).get(url).set(h)).body as ClientLicence[];
    const by = Object.fromEntries(list.map((l) => [l.refNo, l]));
    expect(by['P-2026']).toMatchObject({
      state: 'EXPIRING',
      superseded: false,
      issuer: 'GDT',
      daysLeft: 10,
    });
    expect(by['P-2025']).toMatchObject({ state: 'EXPIRED', superseded: true });
    expect(by['QIP-1']).toMatchObject({ state: 'VALID', issuer: 'CDC' });
    expect(by['L001-902401027']).toMatchObject({ state: 'NO_EXPIRY', daysLeft: null });
    // The current ones first, soonest expiry first; the renewed one last.
    expect(list.map((l) => l.refNo).at(-1)).toBe('P-2025');

    await request(app).post('/api/v1/follow-ups/rules/run').set(h).expect(200);
    const fu = await request(app)
      .get('/api/v1/follow-ups')
      .query({ rule: 'CLIENT_LICENCE_EXPIRING' })
      .set(h);
    // Only the current patent: the old one is replaced by the renewal.
    expect(fu.body.data.map((r: { subject: string }) => r.subject)).toEqual([
      `Licence expiring: P-2026 (${basics.jr.code})`,
    ]);

    // Renewing it (a later expiry) closes the follow-up.
    await add({ type: 'PATENT', refNo: 'P-2027', expiryDate: inDays(400) });
    await request(app).post('/api/v1/follow-ups/rules/run').set(h).expect(200);
    const after = await request(app)
      .get('/api/v1/follow-ups')
      .query({ rule: 'CLIENT_LICENCE_EXPIRING', status: 'ACTIVE' })
      .set(h);
    expect(after.body.data).toHaveLength(0);
  });

  it('edits and deletes; viewers can read but not write', async () => {
    const h = await as('MANAGER');
    const url = `/api/v1/clients/${basics.jr.id}/licences`;
    const { id } = (await request(app).post(url).set(h).send({ type: 'PATENT', refNo: 'P-1' }))
      .body;
    await request(app)
      .put(`${url}/${id}`)
      .set(h)
      .send({ type: 'PATENT', refNo: 'P-1A', issuer: 'GDT Phnom Penh' })
      .expect(204);
    const v = await as('VIEWER');
    const read = (await request(app).get(url).set(v)).body as ClientLicence[];
    expect(read[0]).toMatchObject({ refNo: 'P-1A', issuer: 'GDT Phnom Penh' });
    expect((await request(app).post(url).set(v).send({ type: 'PATENT', refNo: 'X' })).status).toBe(
      403,
    );
    await request(app).delete(`${url}/${id}`).set(h).expect(204);
    expect((await request(app).get(url).set(h)).body).toEqual([]);
  });
});

describe('client portal accounts', () => {
  it('keeps who logs into which portal, without passwords', async () => {
    const h = await as('OPERATOR');
    const url = `/api/v1/clients/${basics.jr.id}/portal-accounts`;
    const created = await request(app).post(url).set(h).send({
      portal: 'NSW',
      username: 'liyan',
      holderName: 'LI YAN',
      role: 'COMPANY',
      vaultRef: 'Bitwarden → Clients → JR NSW',
      password: 'should-be-ignored',
    });
    expect(created.status).toBe(201);
    const list = (await request(app).get(url).set(h)).body as ClientPortalAccount[];
    expect(list).toEqual([
      expect.objectContaining({ portal: 'NSW', username: 'liyan', role: 'COMPANY' }),
    ]);
    expect(JSON.stringify(list)).not.toContain('should-be-ignored');
    expect(
      (await request(app).post(url).set(h).send({ portal: 'NOPE', username: 'x' })).status,
    ).toBe(400);
  });
});
