// The file as it stands today. Both endpoints are behind a role check.
export const routes = [
  route('GET', '/users', requireRole('admin'), listUsers),
  route('POST', '/users/:id/deactivate', requireRole('admin'), deactivateUser),
];
