import { type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';
import { validated } from '../../../shared/http/validate.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import { requireCsrf, requireRole } from '../../identity/http/guards.ts';
import type { ActionOrigin, IncidentService } from '../application/incident-service.ts';
import {
  INCIDENT_ASSIGN_ROLES,
  INCIDENT_PRIORITIES,
  INCIDENT_READ_ROLES,
  INCIDENT_STATUSES,
} from '../domain/incident-rules.ts';

/**
 * Incidents, under /api/v1/admin/incidents (staff session required, every role):
 *
 *   GET  /                 list; filters status, priority, roomId, mine, includeClosed
 *   POST /                 report an incident (« room unusable » blocks the room)
 *   GET  /rooms            active rooms, for the report form
 *   GET  /technicians      active technicians, for the assignment     (management, reception)
 *   GET  /:id              one incident and its history
 *   POST /:id/status       change the state (rights checked by the service)
 *   POST /:id/assignment   assign to a technician and/or an external contractor
 *   POST /:id/comments     add a comment to the history
 */

const id = z.uuid({ error: 'Identifiant invalide.' });
const status = z.enum(INCIDENT_STATUSES, { error: 'État inconnu.' });
const priority = z.enum(INCIDENT_PRIORITIES, {
  error: 'Priorité inconnue : « urgent », « normal » ou « low ».',
});
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

function text(max: number): z.ZodString {
  return z
    .string()
    .trim()
    .min(1, { error: 'Ce champ est obligatoire.' })
    .max(max, { error: `${max} caractères au maximum.` });
}

/** An empty or blank optional text means « none ». */
function optionalText(max: number): z.ZodType<string | null> {
  return z
    .string()
    .trim()
    .max(max, { error: `${max} caractères au maximum.` })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null);
}

const idParams = z.strictObject({ id });

const listFilter = z.strictObject({
  status: status.optional(),
  priority: priority.optional(),
  roomId: id.optional(),
  mine: booleanQuery.optional(),
  includeClosed: booleanQuery.optional(),
});

const newIncident = z
  .strictObject({
    roomId: id.nullable().default(null),
    location: optionalText(120),
    title: text(120),
    description: text(4000),
    priority,
    blocksRoom: z.boolean().default(false),
  })
  .superRefine((body, context) => {
    if (body.roomId === null && body.location === null) {
      context.addIssue({
        code: 'custom',
        path: ['location'],
        message: 'Indiquez la chambre ou le lieu de la panne.',
      });
    }
    if (body.blocksRoom && body.roomId === null) {
      context.addIssue({
        code: 'custom',
        path: ['blocksRoom'],
        message: 'Seule une chambre peut être déclarée inutilisable.',
      });
    }
  });

const statusChange = z.strictObject({ status, comment: optionalText(4000) });

const assignment = z.strictObject({
  assignedTo: id.nullable(),
  externalContractor: optionalText(120),
});

const newComment = z.strictObject({ comment: text(4000) });

function actorOf(req: Request): StaffUser {
  const user = req.staffUser;
  if (user === undefined) {
    throw new Error('requireStaff doit précéder cette route');
  }
  return user;
}

function originOf(req: Request): ActionOrigin {
  return { ip: req.ip };
}

/** Staff data: never kept by a browser or a proxy cache. */
function noStore(res: Response): void {
  res.set('Cache-Control', 'no-store');
}

/** `requireStaff` comes from the staff part of the API, which owns the sessions. */
export function incidentRouter(service: IncidentService, requireStaff: RequestHandler): Router {
  const router = Router();
  const readers = [requireStaff, requireRole(...INCIDENT_READ_ROLES)];
  const writers = [...readers, requireCsrf];

  router.get(
    '/',
    ...readers,
    validated({ query: listFilter }, async ({ query }, req, res) => {
      noStore(res);
      const items = await service.list({
        status: query.status,
        priority: query.priority,
        roomId: query.roomId,
        assignedTo: query.mine === true ? actorOf(req).id : undefined,
        includeClosed: query.includeClosed ?? false,
      });
      res.json({ items });
    }),
  );

  router.post(
    '/',
    ...writers,
    validated({ body: newIncident }, async ({ body }, req, res) => {
      noStore(res);
      res.status(201).json(await service.report(actorOf(req), body, originOf(req)));
    }),
  );

  router.get('/rooms', ...readers, async (_req, res) => {
    noStore(res);
    res.json({ items: await service.rooms() });
  });

  router.get(
    '/technicians',
    requireStaff,
    requireRole(...INCIDENT_ASSIGN_ROLES),
    async (_req, res) => {
      noStore(res);
      res.json({ items: await service.technicians() });
    },
  );

  router.get(
    '/:id',
    ...readers,
    validated({ params: idParams }, async ({ params }, _req, res) => {
      noStore(res);
      res.json(await service.detail(params.id));
    }),
  );

  router.post(
    '/:id/status',
    ...writers,
    validated({ params: idParams, body: statusChange }, async ({ params, body }, req, res) => {
      noStore(res);
      const actor = actorOf(req);
      res.json(
        await service.changeStatus(actor, params.id, body.status, body.comment, originOf(req)),
      );
    }),
  );

  router.post(
    '/:id/assignment',
    ...writers,
    validated({ params: idParams, body: assignment }, async ({ params, body }, req, res) => {
      noStore(res);
      res.json(await service.assign(actorOf(req), params.id, body, originOf(req)));
    }),
  );

  router.post(
    '/:id/comments',
    ...writers,
    validated({ params: idParams, body: newComment }, async ({ params, body }, req, res) => {
      noStore(res);
      const detail = await service.comment(actorOf(req), params.id, body.comment, originOf(req));
      res.status(201).json(detail);
    }),
  );

  return router;
}
