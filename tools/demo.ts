/**
 * Why any of this matters, in one screen.
 *
 * Run:  npm run demo
 */
import type { Ctx } from '../service/src/context.ts';
import { db } from '../service/src/db.ts';
import { listUsers } from '../service/src/users.ts';

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

// Rae is an admin at Acme. She is allowed to see Acme's users, and nobody else's.
const rae: Ctx = { userId: 'u1', tenantId: 'acme', roles: ['admin'] };

console.log(`\n  ${bold('Rae is an admin at Acme.')} She asks for the list of users.\n`);

// The endpoint as written. One filter on tenantId does all the work.
const correct = await listUsers(rae);
console.log(`  ${green('✓')} ${bold('What she should get')} ${dim('— db.users.findMany({ where: { tenantId, active: true } })')}`);
for (const u of correct) console.log(`      ${u.name}  ${dim(u.role)}`);

// The same query with `tenantId` left out. Nothing errors. Nothing looks wrong.
const leak = await db.users.findMany({ where: { active: true } });
console.log(`\n  ${red('✗')} ${bold('What she gets if one filter goes missing')} ${dim('— db.users.findMany({ where: { active: true } })')}`);
for (const u of leak) console.log(`      ${u.fullName}  ${dim(`${u.role} · ${u.tenantId}`)}`);

const foreign = leak.filter((u) => u.tenantId !== rae.tenantId);
const rows = foreign.length === 1 ? 'row belongs' : 'rows belong';
console.log(`
  ${red(bold(`${foreign.length} of those ${leak.length} ${rows} to a different company.`))}

  ${dim('No error. No crash. No failing test, unless someone thought to write')}
  ${dim('one with two tenants in the fixture. Just a customer seeing another')}
  ${dim("customer's data — found weeks later, by them.")}

  ${dim('That single missing filter is what')} ${bold('deadbolt check')} ${dim('looks for,')}
  ${dim('and what the hook refuses to let an agent write in the first place.')}
`);
