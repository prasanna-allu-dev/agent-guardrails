#!/usr/bin/env node
/**
 * The PreToolUse hook.
 *
 * Claude Code runs this before it writes a file, hands it the pending edit on
 * stdin, and does what the reply says. Returning a "deny" stops the write from
 * happening at all — the agent is told why, and gets to try again.
 *
 * The interesting part is what arrives on stdin. A linter sees files after the
 * fact; this sees the edit itself — the text being removed as well as the text
 * being added. That is the only place where "somebody deleted a permission
 * check" is visible, because once the edit lands, a deleted guard and a guard
 * that was never there are the same file.
 *
 * The decision itself lives in policy/review.ts, so that the eval harness can
 * make it the same way this does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { denyReason, reviewToolCall, type ToolCall } from './policy/review.ts';
import { loadRules } from './policy/rules.ts';

const RULES_DIR = join(import.meta.dirname, '..', 'rules');

/** The file as it stands before this call, so a rewrite can be compared to it. */
function readCurrentFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null; // a brand new file has nothing to compare against
  }
}

async function main(): Promise<void> {
  const call = await readStdin();
  if (!call) return allow();

  const findings = reviewToolCall(call, loadRules(RULES_DIR), readCurrentFile);
  if (findings.length === 0) return allow();

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: denyReason(findings),
      },
    }),
  );
  process.exit(0);
}

/** Say nothing and exit 0 — Claude Code treats silence as "carry on". */
function allow(): void {
  process.exit(0);
}

async function readStdin(): Promise<ToolCall | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as ToolCall;
  } catch {
    // Never block a write because the hook could not read its own input.
    return null;
  }
}

main().catch(() => allow());
