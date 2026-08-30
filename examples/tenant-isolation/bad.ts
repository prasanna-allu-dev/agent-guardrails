// Support asked for a way to look up any user by name.
// This returns matching users from EVERY customer, not just the caller's.
export async function searchUsers(ctx: Ctx, name: string) {
  return db.users.findMany({ where: { name, active: true } });
}

export async function countSeats(_ctx: Ctx) {
  return db.memberships.count({ where: { active: true } });
}
