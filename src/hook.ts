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
 */
import { join } from 'node:path';
import { checkEdit, checkSource, type Finding } from './policy/check.ts';
import { loadRules } from './policy/rules.ts';

const RULES_DIR = join(import.meta.dirname, '..', 'rules');

type HookInput = {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
    edits?: { old_string?: string; new_string?: string }[];
  };
};

async function main(): Promise<void> {
  const input = await readStdin();
  if (!input) return allow();

  const tool = input.tool_name ?? '';
  if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) return allow();

  const args = input.tool_input ?? {};
  const file = args.file_path ?? 'the file';
  if (!/\.(ts|tsx|js|mjs)$/.test(file)) return allow();

  const rules = loadRules(RULES_DIR);
  const findings: Finding[] = [];

  // Write: the whole file is new, so there is nothing to compare against.
  if (tool === 'Write' && args.content) {
    findings.push(...checkSource(args.content, rules, file));
  }

  // Edit / MultiEdit: check what is being added, and compare it with what is
  // being removed. Only the changed text is checked, not the whole file —
  // the agent should not be blocked for a problem it did not introduce.
  for (const edit of editsOf(args)) {
    const before = edit.old_string ?? '';
    const after = edit.new_string ?? '';
    findings.push(...checkSource(after, rules, file));
    findings.push(...checkEdit(before, after, rules, file));
  }

  if (findings.length === 0) return allow();
  deny(findings);
}

function editsOf(args: NonNullable<HookInput['tool_input']>) {
  if (args.edits) return args.edits;
  if (args.old_string !== undefined || args.new_string !== undefined) {
    return [{ old_string: args.old_string, new_string: args.new_string }];
  }
  return [];
}

/** Say nothing and exit 0 — Claude Code treats silence as "carry on". */
function allow(): void {
  process.exit(0);
}

/**
 * Block the write, and explain it well enough that the next attempt is right.
 * A reason the agent cannot act on just gets worked around.
 */
function deny(findings: Finding[]): void {
  const reason = [
    `Blocked by deadbolt — ${findings.length} rule violation${findings.length === 1 ? '' : 's'} in this edit.`,
    '',
    ...findings.map((f) => [`• ${f.title} (${f.ruleId})`, `    ${f.snippet.trim()}`, `    ${f.message}`, '', indent(f.fix, '    ')].join('\n')),
  ].join('\n');

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

async function readStdin(): Promise<HookInput | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as HookInput;
  } catch {
    // Never block a write because the hook could not read its own input.
    return null;
  }
}

function indent(text: string, pad: string): string {
  return text
    .trim()
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : pad + l))
    .join('\n');
}

main().catch(() => allow());
