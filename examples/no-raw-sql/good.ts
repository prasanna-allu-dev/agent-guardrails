// The builder sends `search` to the database as a value, so there is no quote
// for anyone to escape out of.
export async function findByName(ctx: Ctx, search: string) {
  return db.users.findMany({ where: { tenantId: ctx.tenantId, name: search } });
}
