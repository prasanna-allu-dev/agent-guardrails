/**
 * A very small stand-in for a real query builder.
 *
 * It is in-memory and about sixty lines, because the point of this app is to be
 * something the rules can be demonstrated against — not to be a database. What
 * matters is that it has the shape the rules expect: `db.<table>.findMany(...)`,
 * a `where` filter, and a `tenantId` column on every row.
 */

export type Row = Record<string, unknown> & { id: string; tenantId: string };
type Where = Record<string, unknown>;
type Query = { where?: Where };

class Table<T extends Row> {
  readonly #rows: T[];

  constructor(rows: T[]) {
    this.#rows = rows;
  }

  async findMany(q: Query = {}): Promise<T[]> {
    return this.#rows.filter((row) => matches(row, q.where));
  }

  async findFirst(q: Query = {}): Promise<T | undefined> {
    return this.#rows.find((row) => matches(row, q.where));
  }

  async count(q: Query = {}): Promise<number> {
    return this.#rows.filter((row) => matches(row, q.where)).length;
  }

  async updateMany(q: Query & { data: Partial<T> }): Promise<number> {
    const hits = this.#rows.filter((row) => matches(row, q.where));
    for (const row of hits) Object.assign(row, q.data);
    return hits.length;
  }
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

export type User = Row & { email: string; fullName: string; role: string; active: boolean };
export type Membership = Row & { userId: string; team: string; active: boolean };

// Two tenants, so a query that forgets `tenantId` visibly returns the wrong thing.
const users: User[] = [
  { id: 'u1', tenantId: 'acme', email: 'rae@acme.test', fullName: 'Rae Nolan', role: 'admin', active: true },
  { id: 'u2', tenantId: 'acme', email: 'sam@acme.test', fullName: 'Sam Ortiz', role: 'member', active: true },
  { id: 'u3', tenantId: 'globex', email: 'kit@globex.test', fullName: 'Kit Alvarez', role: 'admin', active: true },
  { id: 'u4', tenantId: 'globex', email: 'jo@globex.test', fullName: 'Jo Reyes', role: 'member', active: true },
];

const memberships: Membership[] = [
  { id: 'm1', tenantId: 'acme', userId: 'u1', team: 'platform', active: true },
  { id: 'm2', tenantId: 'acme', userId: 'u2', team: 'support', active: true },
  { id: 'm3', tenantId: 'globex', userId: 'u3', team: 'platform', active: true },
];

export const db = {
  users: new Table(users),
  memberships: new Table(memberships),
};
