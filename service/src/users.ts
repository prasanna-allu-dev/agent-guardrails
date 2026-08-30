import type { Ctx } from './context.ts';
import { db } from './db.ts';
import { logger } from './logger.ts';

/**
 * The handlers. Every query below names `tenantId`, and every log line below
 * carries an id rather than a person — which is exactly what the rules check.
 */

export async function listUsers(ctx: Ctx) {
  const users = await db.users.findMany({ where: { tenantId: ctx.tenantId, active: true } });
  logger.info('listed users', { tenantId: ctx.tenantId, count: users.length });
  return users.map(publicView);
}

export async function searchUsers(ctx: Ctx, name: string) {
  const users = await db.users.findMany({ where: { tenantId: ctx.tenantId, fullName: name } });
  return users.map(publicView);
}

export async function countActiveSeats(ctx: Ctx) {
  return db.memberships.count({ where: { tenantId: ctx.tenantId, active: true } });
}

export async function deactivateUser(ctx: Ctx, userId: string) {
  const changed = await db.users.updateMany({
    where: { tenantId: ctx.tenantId, id: userId },
    data: { active: false },
  });

  if (changed === 0) {
    logger.warn('deactivate matched nothing', { tenantId: ctx.tenantId, userId });
    return { ok: false };
  }

  logger.info('user deactivated', { tenantId: ctx.tenantId, userId, by: ctx.userId });
  return { ok: true };
}

/** Never hand the whole row to a caller — it carries fields they do not need. */
function publicView(user: { id: string; fullName: string; role: string }) {
  return { id: user.id, name: user.fullName, role: user.role };
}
