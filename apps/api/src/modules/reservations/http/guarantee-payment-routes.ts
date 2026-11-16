import { type Request, type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { validated } from '../../../shared/http/validate.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import { requireCsrf, requireRole } from '../../identity/http/guards.ts';
import type { GuaranteePayments } from '../application/guarantee-payments.ts';

/**
 * Charges of the saved card and refunds, under /api/v1/admin (staff session; management only,
 * decision « 2a » of step D-1):
 *
 *   POST /reservations/:id/guarantee-charge                charges the fees still due on the
 *                                                          saved card; the amount comes from
 *                                                          the API, never from the request
 *   POST /reservations/:id/payments/:paymentId/refund      refunds a payment made online, in full
 *
 * Both answer the reservation, with its payments (201); a card refused answers 402.
 */

const id = z.uuid({ error: 'Identifiant invalide.' });
const reservationParams = z.strictObject({ id });
const paymentParams = z.strictObject({ id, paymentId: id });

function actorOf(req: Request): StaffUser {
  const user = req.staffUser;
  if (user === undefined) {
    throw new Error('requireStaff doit précéder cette route');
  }
  return user;
}

export function guaranteePaymentRouter(
  service: GuaranteePayments,
  requireStaff: RequestHandler,
): Router {
  const router = Router();
  const managers = [requireStaff, requireRole('direction'), requireCsrf];

  router.post(
    '/reservations/:id/guarantee-charge',
    ...managers,
    validated({ params: reservationParams }, async ({ params }, req, res) => {
      res.set('Cache-Control', 'no-store');
      res.status(201).json(await service.charge(actorOf(req), params.id, { ip: req.ip }));
    }),
  );

  router.post(
    '/reservations/:id/payments/:paymentId/refund',
    ...managers,
    validated({ params: paymentParams }, async ({ params }, req, res) => {
      const origin = { ip: req.ip };
      res.set('Cache-Control', 'no-store');
      res.status(201).json(await service.refund(actorOf(req), params.id, params.paymentId, origin));
    }),
  );

  return router;
}
