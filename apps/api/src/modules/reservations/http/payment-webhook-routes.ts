import express, { Router } from 'express';
import type { OnlinePayments } from '../application/online-payments.ts';
import { InvalidSignatureError, type PaymentEventReader } from '../application/payment-events.ts';

/**
 * Notifications of the payment service (step R-5), under /api/v1, called by Stripe itself:
 *
 *   POST /webhooks/stripe   header Stripe-Signature required
 *
 * Mounted BEFORE the JSON reader of the API: the signature is computed on the exact bytes
 * sent by Stripe, which must reach the check untouched. Answered 200 once handled (or already
 * handled); 400 when the signature is wrong; 500 when the handling fails, Stripe then sends
 * the notification again later (for up to 3 days).
 */

/** The notifications of Stripe are a few kilobytes. */
const WEBHOOK_BODY_LIMIT = '256kb';

export function paymentWebhookRouter(events: PaymentEventReader, payments: OnlinePayments): Router {
  const router = Router();

  router.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json', limit: WEBHOOK_BODY_LIMIT }),
    async (req, res) => {
      // Not JSON, or no body at all: it cannot come from Stripe.
      if (!Buffer.isBuffer(req.body)) {
        throw new InvalidSignatureError();
      }
      const event = await events.read(req.body, req.get('Stripe-Signature'));
      const handling = await payments.handle(event);
      res.set('Cache-Control', 'no-store');
      res.json({ received: true, handling });
    },
  );

  return router;
}
