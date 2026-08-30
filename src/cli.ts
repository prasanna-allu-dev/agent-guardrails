#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkSource, type Finding } from './policy/check.ts';
import { loadRules, type Rule } from './policy/rules.ts';

const RULES_DIR = join(import.meta.dirname, '..', 'rules');

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function main(argv: string[]): number {
  const [command = 'check', arg] = argv;
  const rules = loadRules(RULES_DIR);

  switch (command) {
    case 'check':
      return check(arg ?? 'service', rules);
    case 'rules':
      return list(rules);
    case 'explain':
      return explain(arg, rules);
    default:
      console.error(`Unknown command "${command}".\n`);
      return usage();
  }
}

function usage(): number {
  console.log(`
${bold('guard')} — checks code against the rules in ${dim('rules/')}

  ${bold('guard check')} ${dim('[path]')}     look for problems (default: service/)
  ${bold('guard rules')}            list the rules
  ${bold('guard explain')} ${dim('<rule>')}   why a rule exists and how to satisfy it
`);
  return 2;
}

function check(path: string, rules: Rule[]): number {
  const files = sourceFilesIn(path);
  const findings = files.flatMap((file) =>
    checkSource(readFileSync(file, 'utf8'), rules, relative(process.cwd(), file)),
  );

  const header = `${bold('guard')}  ${dim(`${rules.length} rules · ${files.length} files · ${path}`)}`;
  console.log(`\n${header}\n`);

  if (findings.length === 0) {
    console.log(`  ${green('✓')}  Nothing to report.\n`);
    return 0;
  }

  for (const f of findings) report(f);

  const count = `${findings.length} problem${findings.length === 1 ? '' : 's'}`;
  console.log(`  ${red(bold(count))}  ${dim(`· guard explain <rule> for the reasoning`)}\n`);
  return 1;
}

function report(f: Finding): void {
  const mark = f.severity === 'critical' ? red('✗') : yellow('!');
  console.log(`  ${mark}  ${bold(`${f.file}:${f.line}`)}  ${dim(f.ruleId)}`);
  console.log(`     ${f.title}\n`);
  console.log(`       ${dim(f.snippet.trim())}\n`);
  console.log(`     ${f.message}\n`);
  console.log(indent(f.fix, '     '));
  console.log('');
}

function list(rules: Rule[]): number {
  console.log('');
  for (const rule of rules) {
    const tag = rule.kind === 'edit' ? dim(' (checks the edit, not the file)') : '';
    console.log(`  ${bold(rule.id)}${tag}`);
    console.log(`  ${dim(rule.title)}\n`);
  }
  return 0;
}

function explain(id: string | undefined, rules: Rule[]): number {
  const rule = rules.find((r) => r.id === id);
  if (!rule) {
    console.error(`No rule called "${id}". Try: ${rules.map((r) => r.id).join(', ')}`);
    return 2;
  }
  console.log(`\n  ${bold(rule.title)}  ${dim(`(${rule.severity})`)}\n`);
  console.log(indent(rule.why.trim(), '  '));
  console.log(`\n  ${bold('How to satisfy it')}\n`);
  console.log(indent(rule.fix.trim(), '  '));
  console.log('');
  return 0;
}

/** Every .ts/.js file under a path, skipping dependencies and build output. */
function sourceFilesIn(path: string): string[] {
  const skip = new Set(['node_modules', '.git', 'dist', 'coverage']);
  const out: string[] = [];

  const walk = (p: string): void => {
    const stat = statSync(p);
    if (stat.isFile()) {
      if (/\.(ts|tsx|js|mjs)$/.test(p) && !p.endsWith('.d.ts')) out.push(p);
      return;
    }
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
      walk(join(p, entry.name));
    }
  };

  walk(path);
  return out.toSorted();
}

function indent(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : pad + l))
    .join('\n');
}

process.exit(main(process.argv.slice(2)));
