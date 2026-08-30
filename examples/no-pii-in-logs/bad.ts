// Added while debugging a login problem. It works — and it writes a real
// person's email address into a log that gets kept for a year.
export function onLoginFailed(user: User, reason: string) {
  logger.warn(`login failed for ${user.email}: ${reason}`);
  console.info('profile', { name: user.fullName, phone: user.phone });
}
