import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HOOK = join(import.meta.dirname, '..', 'src', 'hook.ts');

/**
 * These run the hook the way Claude Code runs it: a real process, JSON on
 * stdin, JSON on stdout. Testing it as a function would skip the part most
 * likely to break — the wire format the two sides agreed on.
 */
async function callHook(input: unknown): Promise<{ denied: boolean; reason: string }> {
  const child = execFile('node', [HOOK]);
  child.stdin?.end(JSON.stringify(input));

  let out = '';
  child.stdout?.on('data', (d) => {
    out += String(d);
  });
  await new Promise((resolve) => child.on('close', resolve));

  if (out.trim() === '') return { denied: false, reason: '' };
  const parsed = JSON.parse(out) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  return {
    denied: parsed.hookSpecificOutput.permissionDecision === 'deny',
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

const edit = (oldStr: string, newStr: string) => ({
  tool_name: 'Edit',
  tool_input: { file_path: 'service/src/users.ts', old_string: oldStr, new_string: newStr },
});

describe('the hook blocks bad edits before they land', () => {
  it('blocks a query that is not scoped to a tenant', async () => {
    const { denied, reason } = await callHook(
      edit('', 'return db.users.findMany({ where: { name } });'),
    );
    expect(denied).toBe(true);
    expect(reason).toContain('tenant-isolation');
  });

  it('allows the same query once it is scoped', async () => {
    const { denied } = await callHook(
      edit('', 'return db.users.findMany({ where: { tenantId: ctx.tenantId, name } });'),
    );
    expect(denied).toBe(false);
  });

  it('blocks a log line containing an email address', async () => {
    const { denied, reason } = await callHook(edit('', 'logger.info(`hi ${user.email}`);'));
    expect(denied).toBe(true);
    expect(reason).toContain('no-pii-in-logs');
  });

  it('tells the agent how to fix it, not just that it is wrong', async () => {
    const { reason } = await callHook(edit('', 'return db.users.findMany({ where: { name } });'));
    expect(reason).toContain('ctx.tenantId');
  });
});

describe('the hook sees the edit, not just the result', () => {
  const guarded = `route('GET', '/users', requireRole('admin'), listUsers)`;

  it('blocks an edit that deletes a permission check', async () => {
    const { denied, reason } = await callHook(
      edit(guarded, `route('GET', '/users', listUsers)`),
    );
    expect(denied).toBe(true);
    expect(reason).toContain('keep-auth-checks');
  });

  it('allows an edit that changes which role is required', async () => {
    const { denied } = await callHook(
      edit(guarded, `route('GET', '/users', requireRole('support'), listUsers)`),
    );
    expect(denied).toBe(false);
  });

  it('does not flag a file that simply never had a guard', async () => {
    // The same end state as the deleted-guard case above. Without the "before"
    // text there is nothing to suggest anything was taken away — which is
    // exactly the distinction a file-at-rest linter cannot make.
    const { denied } = await callHook(edit('', `route('GET', '/health', healthCheck)`));
    expect(denied).toBe(false);
  });
});

describe('the hook stays out of the way', () => {
  it('ignores tools that do not write files', async () => {
    const { denied } = await callHook({ tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect(denied).toBe(false);
  });

  it('ignores files that are not code', async () => {
    const { denied } = await callHook({
      tool_name: 'Write',
      tool_input: { file_path: 'notes.md', content: 'db.users.findMany({ where: {} })' },
    });
    expect(denied).toBe(false);
  });

  it('allows the write if it cannot understand its own input', async () => {
    // A broken hook must fail open. Blocking every edit because of a bug in
    // here would be a worse outcome than missing a violation.
    const { denied } = await callHook('not json at all');
    expect(denied).toBe(false);
  });
});
