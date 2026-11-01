import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { rateLimiter } from '../../../shared/http/rate-limit.ts';
import { SESSION_COOKIE_NAME, SESSION_COOKIE_PATH } from '../../../shared/http/session.ts';
import { validated } from '../../../shared/http/validate.ts';
import type { IdentityService, RequestOrigin } from '../application/identity-service.ts';
import {
  ACCOUNT_MANAGER_ROLE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  ROLES,
  type StaffUser,
} from '../domain/identity-rules.ts';
import {
  type FindActiveStaff,
  destroySession,
  newCsrfToken,
  requireCsrf,
  requireRole,
  requireStaff,
} from './guards.ts';

/**
 * Routes of the staff accounts, under /api/v1/admin (architecture, section 5):
 *
 *   POST   /session                     log in (public)
 *   GET    /session                     current account + anti-CSRF token
 *   DELETE /session                     log out
 *   POST   /session/password            change one's own password
 *   POST   /password-reset              ask for a reset link (public)
 *   POST   /password-reset/confirm      set a new password from the link (public)
 *   GET    /users                       list the accounts               (management)
 *   POST   /users                       create an account               (management)
 *   PATCH  /users/:id                   rename, change role, (de)activate (management)
 *   POST   /users/:id/password-reset    send a reset link               (management)
 */

const email = z
  .email({ error: 'Adresse e-mail invalide.' })
  .max(254, { error: 'Adresse e-mail trop longue.' });

const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    error: `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`,
  })
  .max(PASSWORD_MAX_LENGTH, {
    error: `Le mot de passe ne doit pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`,
  });

/** On login, any typed password is checked (an old account may predate the length rule). */
const anyPassword = z.string().min(1).max(PASSWORD_MAX_LENGTH);

const personName = z.string().trim().min(1).max(100);
const role = z.enum(ROLES, { error: 'Rôle inconnu.' });

const loginBody = z.strictObject({ email, password: anyPassword });
const changePasswordBody = z.strictObject({ currentPassword: anyPassword, newPassword });
const resetRequestBody = z.strictObject({ email });
const resetConfirmBody = z.strictObject({
  token: z.string().min(20).max(200),
  newPassword,
});
const userIdParams = z.strictObject({ id: z.uuid({ error: 'Identifiant invalide.' }) });
const createUserBody = z.strictObject({ email, firstName: personName, lastName: personName, role });
const updateUserBody = z
  .strictObject({
    firstName: personName.optional(),
    lastName: personName.optional(),
    role: role.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { error: 'Aucune modification demandée.' });

function originOf(req: Request): RequestOrigin {
  return { ip: req.ip };
}

function currentStaff(req: Request): StaffUser {
  const user = req.staffUser;
  if (user === undefined) {
    throw new Error('requireStaff doit précéder cette route');
  }
  return user;
}

function sessionView(user: StaffUser, csrfToken: string | undefined): object {
  return { user, csrfToken };
}

/** Starts a NEW session (new identifier) for the account: protects against session fixation. */
function openSession(req: Request, user: StaffUser): Promise<string> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateError: unknown) => {
      if (regenerateError) {
        reject(regenerateError instanceof Error ? regenerateError : new Error('session'));
        return;
      }
      const csrfToken = newCsrfToken();
      req.session.userId = user.id;
      req.session.authenticatedAt = Date.now();
      req.session.csrfToken = csrfToken;
      req.session.save((saveError: unknown) => {
        if (saveError) {
          reject(saveError instanceof Error ? saveError : new Error('session'));
        } else {
          resolve(csrfToken);
        }
      });
    });
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: SESSION_COOKIE_PATH });
}

export function identityRouter(service: IdentityService, findActiveStaff: FindActiveStaff): Router {
  const router = Router();
  const staff = requireStaff(findActiveStaff);
  const managers = requireRole(ACCOUNT_MANAGER_ROLE);

  // Limits of the architecture (section 5): 10 failed logins per 15 minutes, per IP address and
  // per account; 5 reset requests per hour per IP address.
  const loginPerAddress = rateLimiter({
    windowMs: 15 * 60_000,
    limit: 10,
    skipSuccessfulRequests: true,
  });
  const loginPerAccount = rateLimiter({
    windowMs: 15 * 60_000,
    limit: 10,
    skipSuccessfulRequests: true,
    key: (req) =>
      `compte:${String((req.body as { email?: unknown } | undefined)?.email ?? '')}`.toLowerCase(),
  });
  const resetRequests = rateLimiter({ windowMs: 60 * 60_000, limit: 5 });
  const resetConfirmations = rateLimiter({ windowMs: 15 * 60_000, limit: 10 });

  // --- Session ---

  router.post(
    '/session',
    loginPerAddress,
    loginPerAccount,
    validated({ body: loginBody }, async ({ body }, req, res) => {
      const user = await service.authenticate(body.email, body.password, originOf(req));
      const csrfToken = await openSession(req, user);
      res.status(200).json(sessionView(user, csrfToken));
    }),
  );

  router.get('/session', staff, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(sessionView(currentStaff(req), req.session.csrfToken));
  });

  router.delete('/session', staff, requireCsrf, async (req, res) => {
    await destroySession(req);
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.post(
    '/session/password',
    staff,
    requireCsrf,
    validated({ body: changePasswordBody }, async ({ body }, req, res) => {
      await service.changePassword(
        currentStaff(req),
        body.currentPassword,
        body.newPassword,
        req.sessionID,
        originOf(req),
      );
      res.status(204).end();
    }),
  );

  // --- Forgotten password (no session) ---

  router.post(
    '/password-reset',
    resetRequests,
    validated({ body: resetRequestBody }, async ({ body }, req, res) => {
      await service.requestPasswordReset(body.email, originOf(req));
      // Same answer whether the address exists or not.
      res.status(202).json({
        message: 'Si un compte actif correspond à cette adresse, un lien vient d’être envoyé.',
      });
    }),
  );

  router.post(
    '/password-reset/confirm',
    resetConfirmations,
    validated({ body: resetConfirmBody }, async ({ body }, req, res) => {
      await service.resetPassword(body.token, body.newPassword, originOf(req));
      res.status(204).end();
    }),
  );

  // --- Account management (management only) ---

  router.get('/users', staff, managers, async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ users: await service.listUsers() });
  });

  router.post(
    '/users',
    staff,
    managers,
    requireCsrf,
    validated({ body: createUserBody }, async ({ body }, req, res) => {
      const result = await service.createUser(currentStaff(req), body, originOf(req));
      res.status(201).json(result);
    }),
  );

  router.patch(
    '/users/:id',
    staff,
    managers,
    requireCsrf,
    validated(
      { params: userIdParams, body: updateUserBody },
      async ({ params, body }, req, res) => {
        const user = await service.updateUser(currentStaff(req), params.id, body, originOf(req));
        res.json({ user });
      },
    ),
  );

  router.post(
    '/users/:id/password-reset',
    staff,
    managers,
    requireCsrf,
    validated({ params: userIdParams }, async ({ params }, req, res) => {
      await service.sendResetLink(currentStaff(req), params.id, originOf(req));
      res.status(202).json({ message: 'Un lien de réinitialisation a été envoyé.' });
    }),
  );

  return router;
}
