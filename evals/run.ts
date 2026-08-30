#!/usr/bin/env node
/**
 * Does the hook actually change what an agent writes?
 *
 * Every task below is given to a real agent twice: once with the hook wired in,
 * once without. Everything else is held identical — same prompt, same model,
 * same starting files, same tools, and `settingSources: []` so no settings file
 * on this machine leaks into either arm. The hook is the only difference.
 *
 * Scoring is deterministic. When the agent stops, the resulting files are run
 * through the same rule engine the hook uses, and a run either has violations
 * on disk or it does not. No model grades another model's work.
 *
 * Usage:
 *   node evals/run.ts                       every task, 1 repetition
 *   node evals/run.ts --reps 3              every task, 3 repetitions
 *   node evals/run.ts --task flexible-filter --reps 2
 *   node evals/run.ts --model claude-sonnet-5
 */
import { query, type HookJSONOutput, type PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { denyReason, reviewToolCall, type ToolCall } from '../src/policy/review.ts';
import { loadRules } from '../src/policy/rules.ts';
import { didTheWork, scoreWorkdir } from './score.ts';

const ROOT = join(import.meta.dirname, '..');
const RULES = loadRules(join(ROOT, 'rules'));

type Task = { id: string; tempts: string; prompt: string; expect: string };
type Arm = 'with-hook' | 'without-hook';

type Run = {
  task: string;
  tempts: string;
  arm: Arm;
  rep: number;
  /** Violations found in the files the agent left behind. */
  violations: { ruleId: string; file: string; line: number; snippet: string }[];
  /** False when the agent did not actually carry out the task — reported, never scored as a pass. */
  completed: boolean;
  blockedAttempts: number;
  turns: number;
  costUsd: number;
  durationMs: number;
  error?: string;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tasks = loadTasks().filter((t) => !args.task || t.id === args.task);
  if (tasks.length === 0) throw new Error(`No task matched "${args.task}".`);

  const arms: Arm[] = ['with-hook', 'without-hook'];
  const total = tasks.length * arms.length * args.reps;
  console.log(
    `\n  ${tasks.length} task(s) x ${arms.length} arms x ${args.reps} rep(s) = ${total} agent runs on ${args.model}\n`,
  );

  const runs: Run[] = [];
  let n = 0;

  for (let rep = 1; rep <= args.reps; rep++) {
    for (const task of tasks) {
      for (const arm of arms) {
        n++;
        process.stdout.write(`  [${n}/${total}] ${task.id} · ${arm} · rep ${rep} ... `);
        const run = await runOnce(task, arm, rep, args.model);
        runs.push(run);
        console.log(summarise(run));
      }
    }
  }

  const report = {
    startedAt: new Date().toISOString(),
    model: args.model,
    reps: args.reps,
    rules: RULES.map((r) => r.id),
    runs,
    summary: summarize(runs),
  };

  const path = join(ROOT, 'evals', 'results', `${stamp()}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report.summary, runs);
  console.log(`  Written to ${path.replace(`${ROOT}/`, '')}\n`);
}

/** The file as it stands before a call, so a whole-file rewrite can be compared to it. */
function readCurrentFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** One agent run, in a throwaway copy of the service. */
async function runOnce(task: Task, arm: Arm, rep: number, model: string): Promise<Run> {
  const workdir = mkdtempSync(join(tmpdir(), 'guardrails-eval-'));
  const started = Date.now();
  let blockedAttempts = 0;

  try {
    cpSync(join(ROOT, 'service'), join(workdir, 'service'), { recursive: true });

    // The whole ablation is this object being present or absent.
    const hooks =
      arm === 'with-hook'
        ? {
            PreToolUse: [
              {
                matcher: 'Write|Edit|MultiEdit',
                hooks: [
                  async (input: unknown): Promise<HookJSONOutput> => {
                    const call = input as PreToolUseHookInput;
                    const findings = reviewToolCall(call as ToolCall, RULES, readCurrentFile);
                    if (findings.length === 0) return {};
                    blockedAttempts++;
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
          }
        : {};

    let turns = 0;
    let costUsd = 0;
    let error: string | undefined;

    for await (const message of query({
      prompt: task.prompt,
      options: {
        cwd: workdir,
        model,
        maxTurns: 15,
        // Nothing on this machine may influence either arm.
        settingSources: [],
        permissionMode: 'bypassPermissions',
        allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep'],
        hooks,
      },
    })) {
      if (message.type === 'result') {
        turns = message.num_turns;
        costUsd = message.total_cost_usd;
        if (message.subtype !== 'success') error = message.subtype;
      }
    }

    const violations = scoreWorkdir(workdir, ROOT, RULES).map((f) => ({
      ruleId: f.ruleId,
      file: f.file,
      line: f.line,
      snippet: f.snippet,
    }));

    return {
      task: task.id,
      tempts: task.tempts,
      arm,
      rep,
      violations,
      completed: didTheWork(workdir, task.expect),
      blockedAttempts,
      turns,
      costUsd,
      durationMs: Date.now() - started,
      ...(error ? { error } : {}),
    };
  } catch (e) {
    return {
      task: task.id,
      tempts: task.tempts,
      arm,
      rep,
      violations: [],
      completed: false,
      blockedAttempts,
      turns: 0,
      costUsd: 0,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

type Summary = ReturnType<typeof summarize>;

function summarize(runs: Run[]) {
  const per = (arm: Arm) => {
    const all = runs.filter((r) => r.arm === arm);
    const done = all.filter((r) => r.completed);
    const dirty = done.filter((r) => r.violations.length > 0);
    return {
      runs: all.length,
      completed: done.length,
      withViolations: dirty.length,
      violationRate: done.length ? dirty.length / done.length : null,
      totalViolations: done.reduce((n, r) => n + r.violations.length, 0),
      blockedAttempts: all.reduce((n, r) => n + r.blockedAttempts, 0),
      costUsd: all.reduce((n, r) => n + r.costUsd, 0),
    };
  };
  return { 'with-hook': per('with-hook'), 'without-hook': per('without-hook') };
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);

function printSummary(s: Summary, runs: Run[]): void {
  const row = (label: string, arm: Arm) => {
    const a = s[arm];
    console.log(
      `  ${label.padEnd(14)} ${String(a.completed).padStart(3)}/${String(a.runs).padEnd(3)}  ` +
        `${String(a.withViolations).padStart(3)}  ${pct(a.violationRate).padStart(5)}  ` +
        `${String(a.totalViolations).padStart(4)}  $${a.costUsd.toFixed(2)}`,
    );
  };

  console.log(`\n  ${'arm'.padEnd(14)} done    bad   rate  total  cost`);
  console.log(`  ${'-'.repeat(52)}`);
  row('without hook', 'without-hook');
  row('with hook', 'with-hook');

  const incomplete = runs.filter((r) => !r.completed);
  if (incomplete.length > 0) {
    console.log(`\n  ${incomplete.length} run(s) did not complete the task and are excluded from the rate:`);
    for (const r of incomplete) {
      console.log(`    ${r.task} · ${r.arm} · rep ${r.rep}${r.error ? ` (${r.error})` : ''}`);
    }
  }
  console.log('');
}

function summarise(run: Run): string {
  if (run.error) return `error: ${run.error}`;
  if (!run.completed) return 'did not complete the task';
  const v = run.violations.length;
  const blocked = run.blockedAttempts > 0 ? `, ${run.blockedAttempts} blocked` : '';
  return v === 0 ? `clean (${run.turns} turns${blocked})` : `${v} violation(s)${blocked}`;
}

function loadTasks(): Task[] {
  const dir = join(ROOT, 'evals', 'tasks');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .toSorted()
    .map((f) => parseYaml(readFileSync(join(dir, f), 'utf8')) as Task);
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    reps: Number(get('--reps') ?? 1),
    task: get('--task'),
    model: get('--model') ?? 'claude-opus-5',
  };
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

await main();
