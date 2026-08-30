/**
 * Deciding whether a pending tool call should be allowed.
 *
 * This sits between the rules and whoever is asking. Two callers use it, and it
 * matters that they use the *same* one: `src/hook.ts`, which Claude Code runs as
 * a subprocess, and `evals/run.ts`, which passes a hook callback to the Agent
 * SDK in-process. If the eval measured a second copy of this logic, it would be
 * measuring something other than what ships.
 */
import { checkEdit, checkSource, type Finding } from './check.ts';
import type { Rule } from './rules.ts';

/** The shape Claude Code hands a PreToolUse hook, narrowed to what we read. */
export type ToolCall = {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
    edits?: { old_string?: string; new_string?: string }[];
  };
};

const WRITING_TOOLS = ['Write', 'Edit', 'MultiEdit'];
const CODE_FILE = /\.(ts|tsx|js|mjs)$/;

/**
 * Reads the file as it stands right now, or returns null if there isn't one.
 *
 * Required rather than optional on purpose: a caller that does not supply it
 * silently loses the guard-removal rule on whole-file writes, which is the
 * exact hole the eval found. Better to make every caller decide.
 */
export type ReadCurrentFile = (path: string) => string | null;

/**
 * What is wrong with this tool call, if anything. An empty array means allow.
 *
 * Only the text being written is checked, never the rest of the file — an agent
 * that gets blocked for a problem it did not introduce learns to route around
 * the hook rather than to write better code.
 */
export function reviewToolCall(
  call: ToolCall,
  rules: Rule[],
  readCurrentFile: ReadCurrentFile,
): Finding[] {
  const tool = call.tool_name ?? '';
  if (!WRITING_TOOLS.includes(tool)) return [];

  const args = call.tool_input ?? {};
  const file = args.file_path ?? 'the file';
  if (!CODE_FILE.test(file)) return [];

  const findings: Finding[] = [];

  // Write replaces the whole file. Reading what is on disk first is what makes
  // a rewrite comparable to an edit — without it, an agent can drop a
  // permission check simply by rewriting the file instead of editing it.
  // A real eval run did exactly that before this existed.
  if (tool === 'Write' && args.content !== undefined) {
    const before = readCurrentFile(file) ?? '';
    findings.push(...checkSource(args.content, rules, file));
    findings.push(...checkEdit(before, args.content, rules, file));
  }

  // Edit and MultiEdit carry both halves, which is what makes the
  // deleted-permission-check rule possible at all.
  for (const edit of editsOf(args)) {
    const before = edit.old_string ?? '';
    const after = edit.new_string ?? '';
    findings.push(...checkSource(after, rules, file));
    findings.push(...checkEdit(before, after, rules, file));
  }

  return findings;
}

function editsOf(args: NonNullable<ToolCall['tool_input']>) {
  if (args.edits) return args.edits;
  if (args.old_string !== undefined || args.new_string !== undefined) {
    return [{ old_string: args.old_string, new_string: args.new_string }];
  }
  return [];
}

/**
 * Turn findings into something the agent can act on.
 *
 * A refusal it cannot act on just gets worked around — so this carries the same
 * `why` and `fix` a human would get from the CLI, not a rule id and a shrug.
 */
export function denyReason(findings: Finding[]): string {
  const count = `${findings.length} rule violation${findings.length === 1 ? '' : 's'}`;
  return [
    `Blocked by agent-guardrails — ${count} in this edit.`,
    '',
    ...findings.map((f) =>
      [
        `• ${f.title} (${f.ruleId})`,
        `    ${f.snippet.trim()}`,
        `    ${f.message}`,
        '',
        indent(f.fix, '    '),
      ].join('\n'),
    ),
  ].join('\n');
}

function indent(text: string, pad: string): string {
  return text
    .trim()
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : pad + l))
    .join('\n');
}
