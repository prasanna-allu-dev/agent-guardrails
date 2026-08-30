// Same diagnostic value. The id is enough to find the user in the database,
// and useless to anyone who cannot already read it.
export function onLoginFailed(user: User, reason: string) {
  logger.warn('login failed', { userId: user.id, reason });
  console.info('profile', { userId: user.id });
}
