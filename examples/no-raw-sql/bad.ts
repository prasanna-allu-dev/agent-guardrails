// A search box wired straight into a SQL string. Type  ' OR '1'='1  into it
// and the WHERE clause stops filtering anything.
export async function findByName(ctx: Ctx, search: string) {
  return db.raw(`SELECT * FROM users WHERE tenant_id = '${ctx.tenantId}' AND name = '${search}'`);
}
