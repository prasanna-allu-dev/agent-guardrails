import { type Ctx, requireAuth, requireRole } from './context.ts';
import { countActiveSeats, deactivateUser, listUsers, searchUsers } from './users.ts';

/**
 * The route table. Each entry pairs a path with the permission check that
 * guards it — kept in one place so that a guard going missing is visible.
 */

type Guard = (ctx: Ctx) => void;
type Handler = (ctx: Ctx, arg: string) => Promise<unknown>;

export type Route = {
  method: string;
  path: string;
  guard: Guard;
  handler: Handler;
};

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/users',
    guard: requireRole('admin'),
    handler: (ctx) => listUsers(ctx),
  },
  {
    method: 'GET',
    path: '/users/search',
    guard: requireAuth(),
    handler: (ctx, name) => searchUsers(ctx, name),
  },
  {
    method: 'GET',
    path: '/seats',
    guard: requireAuth(),
    handler: (ctx) => countActiveSeats(ctx),
  },
  {
    method: 'POST',
    path: '/users/deactivate',
    guard: requireRole('admin'),
    handler: (ctx, userId) => deactivateUser(ctx, userId),
  },
];

export async function handle(route: Route, ctx: Ctx, arg = ''): Promise<unknown> {
  route.guard(ctx);
  return route.handler(ctx, arg);
}
