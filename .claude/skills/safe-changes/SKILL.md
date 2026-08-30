---
name: safe-changes
description: How to write queries, logs and route guards in this codebase so they pass the deadbolt rules. Use when adding or changing anything under service/ — endpoints, database queries, log lines, or permission checks.
---

# Writing changes that pass

The rules in `rules/` are enforced by a hook, so a change that breaks one never
reaches disk. Here is how to get it right the first time.

## Queries name the tenant

Every table has a `tenantId` column, and every query must filter on it. A query
without it returns every customer's rows, silently.

```ts
// yes
await db.users.findMany({ where: { tenantId: ctx.tenantId, active: true } });

// no — returns all tenants
await db.users.findMany({ where: { active: true } });
```

The tenant always comes from `ctx.tenantId`, which is set from the authenticated
session. Never take it from a request parameter, however convenient — that hands
the caller the ability to pick whose data they read.

## Logs carry ids, not people

Log the id. Never the email, name, phone, date of birth, or national id.

```ts
// yes
logger.info('login failed', { userId: user.id, reason });

// no
logger.warn(`login failed for ${user.email}`);
```

The id is enough to find the person in the database, and useless to anyone who
cannot already read it. Logs are kept longer and read by more people than the
database is.

## No hand-written SQL

Use the query builder. `db.raw()` puts user input into the query as *code*
rather than as a value.

## Do not delete a permission check to make something work

If a route returns 403 and it should not, change the role it requires:

```ts
guard: requireRole('support'),   // was 'admin'
```

Deleting the guard is a different change, and a much bigger one. If you think a
route genuinely needs no permission check, say so in your reply rather than
quietly removing it.

## Checking your work

```bash
npm run check          # scan service/ for problems
npm test               # rule and hook tests
node src/cli.ts explain tenant-isolation
```
