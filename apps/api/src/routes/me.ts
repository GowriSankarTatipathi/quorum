import { ROLES } from '@quorum/core';
import { orgRepository, userRepository } from '@quorum/db';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError, notFound } from '../plugins/error-handler.js';
import { requireAuth } from '../plugins/auth.js';

const MeSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  role: z.enum(ROLES),
  approvalAuthority: z.enum(['INHERIT', 'GRANTED', 'REVOKED']),
  lastLoginAt: z.string().nullable(),
});

const CapabilitiesSchema = z.object({
  permissions: z.array(z.string()),
  /** null means this person may not approve anything at any level. */
  approvalCeiling: z.number().int().nullable(),
  canApproveAnything: z.boolean(),
});

const OrgSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  allowedDomains: z.array(z.string()),
  maxRunBudgetUsd: z.number(),
  requireApprovalAbove: z.number().int(),
  maxApprovalTrustLevel: z.number().int(),
});

const OrgPolicyPatchSchema = z
  .object({
    allowedDomains: z.array(z.string().min(1)).max(200).optional(),
    maxRunBudgetUsd: z.number().positive().max(1000).optional(),
    requireApprovalAbove: z.number().int().min(0).max(4).optional(),
    maxApprovalTrustLevel: z.number().int().min(0).max(4).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to change.' });

/**
 * Identity and workspace routes.
 *
 * `/me/capabilities` exists so the client can disable an Approve button with an honest
 * reason rather than letting the user click it and receive a 403. The policy itself is
 * computed in one place (`@quorum/core`) and merely projected here — the UI never
 * re-implements authority rules.
 */
export const meRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.get(
    '/me',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['identity'],
        summary: 'The signed-in user',
        security: [{ bearerAuth: [] }],
        response: { 200: MeSchema },
      },
    },
    async (request) => {
      const claims = requireAuth(request);
      const user = await userRepository.findById(claims.sub);
      if (!user) throw notFound('User');
      return {
        id: user.id,
        orgId: user.orgId,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
        approvalAuthority: user.approvalAuthority,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      };
    },
  );

  app.get(
    '/me/capabilities',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['identity'],
        summary: 'What the signed-in user may do, including approval ceiling',
        security: [{ bearerAuth: [] }],
        response: { 200: CapabilitiesSchema },
      },
    },
    (request) => {
      requireAuth(request);
      const capabilities = request.capabilities;
      if (!capabilities) throw new ApiError(500, 'E_INTERNAL', 'capabilities were not resolved');
      return {
        permissions: [...capabilities.permissions],
        approvalCeiling: capabilities.approvalCeiling,
        canApproveAnything: capabilities.canApproveAnything,
      };
    },
  );

  app.get(
    '/org',
    {
      onRequest: app.requirePermission('org:read'),
      schema: {
        tags: ['workspace'],
        summary: 'Workspace policy',
        security: [{ bearerAuth: [] }],
        response: { 200: OrgSchema },
      },
    },
    async (request) => {
      const claims = requireAuth(request);
      const org = await orgRepository.findById(claims.org);
      if (!org) throw notFound('Workspace');
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        allowedDomains: org.allowedDomains,
        maxRunBudgetUsd: org.maxRunBudgetUsd,
        requireApprovalAbove: org.requireApprovalAbove,
        maxApprovalTrustLevel: org.maxApprovalTrustLevel,
      };
    },
  );

  app.patch(
    '/org/policy',
    {
      onRequest: app.requirePermission('org:policy'),
      schema: {
        tags: ['workspace'],
        summary: 'Change workspace policy (Trust Ladder configuration)',
        security: [{ bearerAuth: [] }],
        body: OrgPolicyPatchSchema,
        response: { 200: OrgSchema },
      },
    },
    async (request) => {
      const claims = requireAuth(request);
      const org = await orgRepository.updatePolicy(claims.org, request.body);
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        allowedDomains: org.allowedDomains,
        maxRunBudgetUsd: org.maxRunBudgetUsd,
        requireApprovalAbove: org.requireApprovalAbove,
        maxApprovalTrustLevel: org.maxApprovalTrustLevel,
      };
    },
  );
  done();
};
