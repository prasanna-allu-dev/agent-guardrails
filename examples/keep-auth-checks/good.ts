// The same problem solved by naming the role the internal tool actually has,
// rather than by deleting the check. The endpoint is still guarded.
export const routes = [
  route('GET', '/users', requireRole('support'), listUsers),
  route('POST', '/users/:id/deactivate', requireRole('admin'), deactivateUser),
];
