/**
 * Who is asking, and what they are allowed to do.
 *
 * `tenantId` is set from the authenticated session and never from anything the
 * caller sends. That is the whole reason the tenant-isolation rule can be as
 * blunt as "the query must mention tenantId" — there is exactly one place the
 * value can come from.
 */

export type Ctx = {
  userId: string;
  tenantId: string;
  roles: string[];
};

export class ForbiddenError extends Error {
  readonly status = 403;
}

/** A permission check. Removing one of these is what `keep-auth-checks` watches for. */
export function requireRole(role: string) {
  return (ctx: Ctx): void => {
    if (!ctx.roles.includes(role)) {
      throw new ForbiddenError(`This endpoint needs the "${role}" role.`);
    }
  };
}

export function requireAuth() {
  return (ctx: Ctx): void => {
    if (!ctx.userId) throw new ForbiddenError('Sign in first.');
  };
}
