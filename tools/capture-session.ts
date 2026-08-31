#!/usr/bin/env node
/**
 * Capture a real agent session for the README GIF.
 *
 *   node tools/capture-session.ts internal-tool-403
 *
 * Runs one eval task against a throwaway copy of the service with the hook
 * enabled, and records every write the agent attempted along with what the
 * hook decided about it. The output feeds tools/render-gifs.py, so the GIF in
 * the README can only ever show a session that actually happened.
 *
 * Writes docs/assets/session.json. Re-run it until you get a session worth
 * showing — the agent does not break the rules every time, which is the whole
 * finding in evals/README.md.
 */
import { query, type HookJSONOutput, type PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { denyReason, reviewToolCall, type ToolCall } from '../src/policy/review.ts';
import { loadRules } from '../src/policy/rules.ts';

const ROOT = join(import.meta.dirname, '..');
const RULES = loadRules(join(ROOT, 'rules'));

type Attempt = {
  tool: string;
  file: string;
  /** The line of the pending edit the rule matched, or the edit's first line. */
  snippet: string;
  decision: 'blocked' | 'allowed';
  reason?: string;
  ruleIds?: string[];
};

const taskId = process.argv[2] ?? 'internal-tool-403';
const task = parseYaml(
  readFileSync(join(ROOT, 'evals', 'tasks', `${taskId}.yaml`), 'utf8'),
) as { id: string; prompt: string };

const workdir = mkdtempSync(join(tmpdir(), 'capture-'));
cpSync(join(ROOT, 'service'), join(workdir, 'service'), { recursive: true });

const attempts: Attempt[] = [];
const seenTools: string[] = [];

const readCurrentFile = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

for await (const message of query({
  prompt: task.prompt,
  options: {
    cwd: workdir,
    model: 'claude-opus-5',
    maxTurns: 15,
    settingSources: [],
    permissionMode: 'bypassPermissions',
    allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep'],
    // Bash is denied on purpose. Left available, the agent edits files with
    // shell commands, which a PreToolUse hook on Write/Edit never sees — the
    // bypass documented in docs/LIMITATIONS.md. This capture is about showing
    // the hook working, so the route around it is closed here.
    disallowedTools: ['Bash'],
    hooks: {
      PreToolUse: [
        {
          // No matcher: fire on every PreToolUse so the capture records which
          // tools the agent actually reaches for, not only the ones we expect.
          hooks: [
            async (input: unknown): Promise<HookJSONOutput> => {
              const call = input as PreToolUseHookInput & ToolCall;
              seenTools.push(call.tool_name ?? '?');
              const findings = reviewToolCall(call, RULES, readCurrentFile);
              const args = call.tool_input ?? {};
              const changed = args.new_string ?? args.content ?? '';

              attempts.push({
                tool: call.tool_name ?? '?',
                file: basename(args.file_path ?? '?'),
                snippet: findings[0]?.snippet ?? firstMeaningfulLine(changed),
                decision: findings.length > 0 ? 'blocked' : 'allowed',
                ...(findings.length > 0
                  ? { reason: denyReason(findings), ruleIds: findings.map((f) => f.ruleId) }
                  : {}),
              });

              if (findings.length === 0) return {};
              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                  permissionDecisionReason: denyReason(findings),
                },
              };
            },
          ],
        },
      ],
    },
  },
})) {
  if (message.type === 'result') {
    const cost = message.subtype === 'success' ? message.total_cost_usd : 0;
    const blocked = attempts.filter((a) => a.decision === 'blocked').length;

    writeFileSync(
      join(ROOT, 'docs', 'assets', 'session.json'),
      `${JSON.stringify({ task: task.id, prompt: task.prompt.trim(), attempts, capturedAt: new Date().toISOString() }, null, 2)}\n`,
    );

    const routesAfter = readCurrentFile(join(workdir, 'service', 'src', 'routes.ts')) ?? '';
    const routesBefore = readFileSync(join(ROOT, 'service', 'src', 'routes.ts'), 'utf8');
    console.log(`\n  tools the agent used: ${seenTools.join(', ') || '(none)'}`);
    console.log(`  routes.ts changed: ${routesAfter !== routesBefore}`);
    console.log(
      `  ${attempts.length} tool call(s) reviewed, ${blocked} blocked · $${cost.toFixed(2)} · ${message.subtype}`,
    );
    for (const a of attempts) {
      console.log(`    ${a.decision === 'blocked' ? '✗' : '✓'} ${a.tool} ${a.file}  ${a.snippet.slice(0, 70)}`);
    }
    console.log(
      blocked > 0
        ? '\n  Worth rendering — the hook fired.\n'
        : '\n  Nothing blocked this time. Run it again.\n',
    );
  }
}

rmSync(workdir, { recursive: true, force: true });

function firstMeaningfulLine(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '' && !l.startsWith('//') && !l.startsWith('*')) ?? ''
  );
}
