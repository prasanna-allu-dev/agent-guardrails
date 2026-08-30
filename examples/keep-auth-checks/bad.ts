// "The internal tool keeps getting a 403 on this one, so I took the check off."
// Read on its own, this file looks like an endpoint that simply never had a
// guard. Compared against before.ts, it is a lock that somebody removed.
export const routes = [
  route('GET', '/users', listUsers),
  route('POST', '/users/:id/deactivate', requireRole('admin'), deactivateUser),
];
