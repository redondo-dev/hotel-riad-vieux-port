import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN,
  ADMIN_APP_URL,
  IdentityHarness,
  STRONG_PASSWORD,
  logIn,
} from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * Staff accounts against the test database: login, sessions, CSRF, roles, passwords and account
 * management, including the attempts an attacker would make. Skipped without TEST_DATABASE_URL.
 */

describe.skipIf(!hasTestDatabase)('staff identity', () => {
  let harness: IdentityHarness;

  beforeAll(() => {
    harness = new IdentityHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function auditActions(userId: string): Promise<string[]> {
    const rows = await harness.rows<{ action: string }>(
      'SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id',
      [userId],
    );
    return rows.map((row) => row.action);
  }

  describe('login', () => {
    it('opens a session with a protected cookie and returns the anti-CSRF token', async () => {
      const staff = await harness.createStaff('reception');
      const response = await request(harness.app())
        .post(`${ADMIN}/session`)
        .send({ email: staff.email, password: staff.password });

      expect(response.status).toBe(200);
      expect(response.body.user).toEqual({
        id: staff.id,
        email: staff.email,
        firstName: 'Test',
        lastName: 'reception',
        role: 'reception',
      });
      expect(typeof response.body.csrfToken).toBe('string');
      expect('passwordHash' in response.body.user).toBe(false);

      const cookie = String(response.headers['set-cookie']?.[0] ?? '');
      expect(cookie.startsWith('riad.sid=')).toBe(true);
      expect(cookie.includes('HttpOnly')).toBe(true);
      expect(cookie.includes('SameSite=Strict')).toBe(true);
      expect(cookie.includes('Path=/api/v1/admin')).toBe(true);

      expect(await auditActions(staff.id)).toEqual(['user.login_succeeded']);
    });

    it('gives the same answer for an unknown address and a wrong password', async () => {
      const staff = await harness.createStaff('reception');
      const app = harness.app();
      const unknown = await request(app)
        .post(`${ADMIN}/session`)
        .send({ email: 'personne@test.example', password: STRONG_PASSWORD });
      const wrong = await request(app)
        .post(`${ADMIN}/session`)
        .send({ email: staff.email, password: 'mauvais-mot-de-passe' });

      for (const response of [unknown, wrong]) {
        expect(response.status).toBe(401);
        expect(response.body.code).toBe('INVALID_CREDENTIALS');
        expect(response.headers['set-cookie']).toBe(undefined);
      }
      expect(unknown.body.detail).toBe(wrong.body.detail);
    });

    it('locks the account for 15 minutes after 5 wrong passwords', async () => {
      const staff = await harness.createStaff('housekeeping');
      const app = harness.app();
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await request(app)
          .post(`${ADMIN}/session`)
          .send({ email: staff.email, password: `faux-${attempt}` });
      }
      // Even the right password is refused while the account is locked.
      const locked = await request(app)
        .post(`${ADMIN}/session`)
        .send({ email: staff.email, password: staff.password });
      expect(locked.status).toBe(401);
      expect(locked.body.code).toBe('INVALID_CREDENTIALS');
      expect((await auditActions(staff.id)).includes('user.locked')).toBe(true);

      // Once the 15 minutes are over, the right password works again.
      await harness.execute(
        `UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`,
        [staff.id],
      );
      const unlocked = await request(harness.app())
        .post(`${ADMIN}/session`)
        .send({ email: staff.email, password: staff.password });
      expect(unlocked.status).toBe(200);
    });

    it('refuses a deactivated account', async () => {
      const staff = await harness.createStaff('technician', { isActive: false });
      const response = await request(harness.app())
        .post(`${ADMIN}/session`)
        .send({ email: staff.email, password: staff.password });
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('refuses more than 10 failed logins in 15 minutes from one address', async () => {
      const app = harness.app();
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        await request(app)
          .post(`${ADMIN}/session`)
          .send({ email: `inconnu-${attempt}@test.example`, password: 'x' });
      }
      const response = await request(app)
        .post(`${ADMIN}/session`)
        .send({ email: 'encore@test.example', password: 'x' });
      expect(response.status).toBe(429);
      expect(response.body.code).toBe('TOO_MANY_REQUESTS');
    });
  });

  describe('session', () => {
    it('requires a session to read the current account', async () => {
      const response = await request(harness.app()).get(`${ADMIN}/session`);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('returns the current account with a valid session', async () => {
      const staff = await harness.createStaff('reception');
      const { agent, csrfToken } = await logIn(harness.app(), staff);
      const response = await agent.get(`${ADMIN}/session`);
      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe(staff.id);
      expect(response.body.csrfToken).toBe(csrfToken);
    });

    it('refuses a change without the anti-CSRF token', async () => {
      const staff = await harness.createStaff('reception');
      const { agent } = await logIn(harness.app(), staff);
      const missing = await agent.delete(`${ADMIN}/session`);
      const forged = await agent.delete(`${ADMIN}/session`).set('X-CSRF-Token', 'faux-jeton');
      for (const response of [missing, forged]) {
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('CSRF_TOKEN_INVALID');
      }
      // The session is still open.
      expect((await agent.get(`${ADMIN}/session`)).status).toBe(200);
    });

    it('logs out: the old cookie no longer opens anything', async () => {
      const staff = await harness.createStaff('reception');
      const app = harness.app();
      const login = await request(app)
        .post(`${ADMIN}/session`)
        .send({ email: staff.email, password: staff.password });
      const cookie = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
      const csrfToken = String(login.body.csrfToken);

      const logout = await request(app)
        .delete(`${ADMIN}/session`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfToken);
      expect(logout.status).toBe(204);
      // Replaying the old cookie (for example a stolen one) after logout opens nothing.
      const replay = await request(app).get(`${ADMIN}/session`).set('Cookie', cookie);
      expect(replay.status).toBe(401);
    });

    it('closes a session 12 hours after login, whatever the activity', async () => {
      const staff = await harness.createStaff('reception');
      const { agent } = await logIn(harness.app(), staff);
      await harness.execute(
        `UPDATE user_sessions
         SET sess = jsonb_set(sess, '{authenticatedAt}', to_jsonb($2::bigint))
         WHERE sess->>'userId' = $1`,
        [staff.id, Date.now() - 12 * 60 * 60 * 1000 - 1000],
      );
      expect((await agent.get(`${ADMIN}/session`)).status).toBe(401);
    });

    it('closes the session as soon as the account is deactivated', async () => {
      const staff = await harness.createStaff('reception');
      const { agent } = await logIn(harness.app(), staff);
      await harness.execute('UPDATE users SET is_active = false WHERE id = $1', [staff.id]);
      expect((await agent.get(`${ADMIN}/session`)).status).toBe(401);
    });
  });

  describe('own password', () => {
    it('changes the password and closes the other sessions of the account', async () => {
      const staff = await harness.createStaff('reception');
      const app = harness.app();
      const first = await logIn(app, staff);
      const second = await logIn(app, staff);

      const response = await first.agent
        .post(`${ADMIN}/session/password`)
        .set('X-CSRF-Token', first.csrfToken)
        .send({ currentPassword: staff.password, newPassword: 'Un-Nouveau-Mot-De-Passe' });
      expect(response.status).toBe(204);

      expect((await first.agent.get(`${ADMIN}/session`)).status).toBe(200);
      expect((await second.agent.get(`${ADMIN}/session`)).status).toBe(401);
      await logIn(harness.app(), { email: staff.email, password: 'Un-Nouveau-Mot-De-Passe' });
      expect((await auditActions(staff.id)).includes('user.password_changed')).toBe(true);
    });

    it('requires the right current password and a long enough new one', async () => {
      const staff = await harness.createStaff('reception');
      const { agent, csrfToken } = await logIn(harness.app(), staff);
      const wrongCurrent = await agent
        .post(`${ADMIN}/session/password`)
        .set('X-CSRF-Token', csrfToken)
        .send({ currentPassword: 'pas-le-bon', newPassword: 'Un-Nouveau-Mot-De-Passe' });
      expect(wrongCurrent.status).toBe(400);
      expect(wrongCurrent.body.errors[0].field).toBe('currentPassword');

      const tooShort = await agent
        .post(`${ADMIN}/session/password`)
        .set('X-CSRF-Token', csrfToken)
        .send({ currentPassword: staff.password, newPassword: 'court' });
      expect(tooShort.status).toBe(400);
      expect(tooShort.body.errors[0].field).toBe('newPassword');
    });
  });

  describe('forgotten password', () => {
    it('answers the same way whether the address exists or not', async () => {
      const staff = await harness.createStaff('reception');
      const app = harness.app();
      const before = harness.mails.length;
      const unknown = await request(app)
        .post(`${ADMIN}/password-reset`)
        .send({ email: 'inconnu@test.example' });
      const known = await request(app).post(`${ADMIN}/password-reset`).send({ email: staff.email });
      expect(unknown.status).toBe(202);
      expect(known.status).toBe(202);
      expect(unknown.body).toEqual(known.body);
      // Only the existing account received an e-mail.
      expect(harness.mails.length).toBe(before + 1);
      expect(harness.mails.at(-1)?.to).toBe(staff.email);
      expect(harness.mails.at(-1)?.text.includes(`${ADMIN_APP_URL}/mot-de-passe#jeton=`)).toBe(
        true,
      );
    });

    it('sets a new password with the link, once only, and closes every session', async () => {
      const staff = await harness.createStaff('technician');
      const app = harness.app();
      const session = await logIn(app, staff);
      await request(app).post(`${ADMIN}/password-reset`).send({ email: staff.email });
      const token = harness.lastLinkToken(staff.email);

      // Only the hash of the token is stored.
      const stored = await harness.rows<{ count: string }>(
        'SELECT count(*) FROM password_reset_tokens WHERE token_hash = $1',
        [token],
      );
      expect(stored[0]?.count).toBe('0');

      const confirm = await request(app)
        .post(`${ADMIN}/password-reset/confirm`)
        .send({ token, newPassword: 'Mot-De-Passe-Retrouve' });
      expect(confirm.status).toBe(204);
      expect((await session.agent.get(`${ADMIN}/session`)).status).toBe(401);
      await logIn(harness.app(), { email: staff.email, password: 'Mot-De-Passe-Retrouve' });

      const reused = await request(app)
        .post(`${ADMIN}/password-reset/confirm`)
        .send({ token, newPassword: 'Encore-Un-Autre-Essai' });
      expect(reused.status).toBe(400);
      expect(reused.body.code).toBe('INVALID_RESET_TOKEN');
    });

    it('refuses an expired link and keeps only the last link valid', async () => {
      const staff = await harness.createStaff('technician');
      const app = harness.app();
      await request(app).post(`${ADMIN}/password-reset`).send({ email: staff.email });
      const first = harness.lastLinkToken(staff.email);
      await request(app).post(`${ADMIN}/password-reset`).send({ email: staff.email });
      const second = harness.lastLinkToken(staff.email);

      const old = await request(app)
        .post(`${ADMIN}/password-reset/confirm`)
        .send({ token: first, newPassword: 'Mot-De-Passe-Retrouve' });
      expect(old.status).toBe(400);

      await harness.execute(
        `UPDATE password_reset_tokens SET expires_at = now() - interval '1 second'
         WHERE user_id = $1`,
        [staff.id],
      );
      const expired = await request(app)
        .post(`${ADMIN}/password-reset/confirm`)
        .send({ token: second, newPassword: 'Mot-De-Passe-Retrouve' });
      expect(expired.status).toBe(400);
      expect(expired.body.code).toBe('INVALID_RESET_TOKEN');
    });
  });

  describe('account management', () => {
    it('is reserved to the management', async () => {
      const staff = await harness.createStaff('reception');
      const { agent, csrfToken } = await logIn(harness.app(), staff);
      expect((await agent.get(`${ADMIN}/users`)).status).toBe(403);
      const create = await agent
        .post(`${ADMIN}/users`)
        .set('X-CSRF-Token', csrfToken)
        .send({ email: 'x@test.example', firstName: 'X', lastName: 'Y', role: 'direction' });
      expect(create.status).toBe(403);
      expect(create.body.code).toBe('FORBIDDEN');
    });

    it('creates an account without password and e-mails a link to choose it', async () => {
      const manager = await harness.createStaff('direction');
      const app = harness.app();
      const { agent, csrfToken } = await logIn(app, manager);
      const email = `nouvelle-${Date.now()}@test.example`;
      const response = await agent
        .post(`${ADMIN}/users`)
        .set('X-CSRF-Token', csrfToken)
        .send({ email, firstName: 'Nadia', lastName: 'Benali', role: 'reception' });
      expect(response.status).toBe(201);
      expect(response.body.invitationSent).toBe(true);
      expect(response.body.user.role).toBe('reception');

      // Nobody knows a password yet: login is impossible until the link is used.
      const before = await request(app)
        .post(`${ADMIN}/session`)
        .send({ email, password: STRONG_PASSWORD });
      expect(before.status).toBe(401);

      const confirm = await request(app)
        .post(`${ADMIN}/password-reset/confirm`)
        .send({ token: harness.lastLinkToken(email), newPassword: 'Mot-De-Passe-De-Nadia' });
      expect(confirm.status).toBe(204);
      await logIn(harness.app(), { email, password: 'Mot-De-Passe-De-Nadia' });

      const duplicate = await agent
        .post(`${ADMIN}/users`)
        .set('X-CSRF-Token', csrfToken)
        .send({ email, firstName: 'Autre', lastName: 'Personne', role: 'housekeeping' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.code).toBe('EMAIL_ALREADY_USED');
    });

    it('deactivates an account and closes its sessions at once', async () => {
      const manager = await harness.createStaff('direction');
      const employee = await harness.createStaff('housekeeping');
      const app = harness.app();
      const managerSession = await logIn(app, manager);
      const employeeSession = await logIn(app, employee);

      const response = await managerSession.agent
        .patch(`${ADMIN}/users/${employee.id}`)
        .set('X-CSRF-Token', managerSession.csrfToken)
        .send({ isActive: false });
      expect(response.status).toBe(200);
      expect(response.body.user.isActive).toBe(false);
      expect((await employeeSession.agent.get(`${ADMIN}/session`)).status).toBe(401);
      expect((await auditActions(employee.id)).includes('user.deactivated')).toBe(true);
    });

    it('never leaves the hotel without an active management account', async () => {
      // Deactivate every other management account first.
      await harness.execute(`UPDATE users SET is_active = false WHERE role = 'direction'`);
      const manager = await harness.createStaff('direction');
      const { agent, csrfToken } = await logIn(harness.app(), manager);

      const self = await agent
        .patch(`${ADMIN}/users/${manager.id}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ isActive: false });
      expect(self.status).toBe(409);
      expect(self.body.code).toBe('CANNOT_REMOVE_OWN_ACCESS');

      const other = await harness.createStaff('direction');
      // With two managers, one can demote the other…
      const demote = await agent
        .patch(`${ADMIN}/users/${other.id}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ role: 'reception' });
      expect(demote.status).toBe(200);
      expect(demote.body.user.role).toBe('reception');
    });

    it('sends a reset link to a staff member', async () => {
      const manager = await harness.createStaff('direction');
      const employee = await harness.createStaff('technician');
      const { agent, csrfToken } = await logIn(harness.app(), manager);
      const response = await agent
        .post(`${ADMIN}/users/${employee.id}/password-reset`)
        .set('X-CSRF-Token', csrfToken);
      expect(response.status).toBe(202);
      expect(harness.lastLinkToken(employee.email).length > 20).toBe(true);
    });

    it('lists the accounts without any password hash', async () => {
      const manager = await harness.createStaff('direction');
      const { agent } = await logIn(harness.app(), manager);
      const response = await agent.get(`${ADMIN}/users`);
      expect(response.status).toBe(200);
      expect(response.body.users.some((user: { id: string }) => user.id === manager.id)).toBe(true);
      expect(JSON.stringify(response.body).includes('argon2')).toBe(false);
    });
  });

  describe('demo accounts (portfolio)', () => {
    it('does not exist outside the demo mode', async () => {
      const response = await request(harness.app()).get(`${ADMIN}/demo`);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('lists the four demo accounts and their password in demo mode', async () => {
      const response = await request(harness.app({ demoPassword: 'Mot-De-Passe-Demo' })).get(
        `${ADMIN}/demo`,
      );
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.password).toBe('Mot-De-Passe-Demo');
      expect(response.body.accounts.map((account: { role: string }) => account.role)).toEqual([
        'direction',
        'reception',
        'housekeeping',
        'technician',
      ]);
    });
  });
});
