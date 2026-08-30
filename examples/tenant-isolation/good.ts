// The same two functions, scoped to the caller's tenant.
export async function searchUsers(ctx: Ctx, name: string) {
  return db.users.findMany({ where: { tenantId: ctx.tenantId, name, active: true } });
}

export async function countSeats(ctx: Ctx) {
  return db.memberships.count({ where: { tenantId: ctx.tenantId, active: true } });
}
