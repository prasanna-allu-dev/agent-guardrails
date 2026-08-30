import { Lang, parse } from '@ast-grep/napi';
import type { Rule, Severity, SourceRule } from './rules.ts';

export type Finding = {
  ruleId: string;
  title: string;
  severity: Severity;
  file: string;
  /** 1-based, so it matches what an editor shows. */
  line: number;
  snippet: string;
  message: string;
  fix: string;
};

/**
 * Check a file's contents against every source rule.
 *
 * Each rule names some code shapes to look for. What makes a match a violation
 * depends on which of three things the rule says:
 *
 *   require: "tenantId"   the match must contain it — if it doesn't, that's a finding
 *   forbid:  [".email"]   the match must not contain any of them
 *   neither               the shape itself is the problem, every match is a finding
 */
export function checkSource(code: string, rules: Rule[], file: string): Finding[] {
  const root = parse(Lang.TypeScript, code).root();
  const findings: Finding[] = [];

  for (const rule of rules) {
    if (rule.kind !== 'source') continue;

    for (const pattern of rule.find) {
      for (const match of root.findAll(pattern)) {
        const text = match.text();
        if (!isViolation(rule, text)) continue;

        findings.push({
          ruleId: rule.id,
          title: rule.title,
          severity: rule.severity,
          file,
          line: match.range().start.line + 1,
          snippet: firstLine(text),
          message: rule.message.trim(),
          fix: rule.fix.trim(),
        });
      }
    }
  }
  return dedupe(findings);
}

function isViolation(rule: SourceRule, matchText: string): boolean {
  if (rule.require !== undefined) return !matchText.includes(rule.require);
  if (rule.forbid !== undefined) return rule.forbid.some((bad) => matchText.includes(bad));
  return true;
}

/**
 * Check an edit against every edit rule, by comparing the file before and after.
 *
 * This is the check a normal linter cannot do. Given only the finished file, a
 * missing permission check and a deleted one look exactly the same. Given the
 * edit, they don't: if there were three guards before and two after, the edit
 * took one off.
 */
export function checkEdit(before: string, after: string, rules: Rule[], file: string): Finding[] {
  const findings: Finding[] = [];

  for (const rule of rules) {
    if (rule.kind !== 'edit') continue;

    for (const guard of rule.guards) {
      const removed = countCalls(before, guard) - countCalls(after, guard);
      if (removed <= 0) continue;

      findings.push({
        ruleId: rule.id,
        title: rule.title,
        severity: rule.severity,
        file,
        line: 0, // the finding is about the edit, not about a line in the result
        snippet: `${guard}(...) — ${removed} removed`,
        message: rule.message.trim(),
        fix: rule.fix.trim(),
      });
    }
  }
  return findings;
}

function countCalls(code: string, fn: string): number {
  return parse(Lang.TypeScript, code).root().findAll(`${fn}($$$ARGS)`).length;
}

/** Two patterns in one rule can match the same code. Report it once. */
function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.ruleId}:${f.file}:${f.line}:${f.snippet}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? '';
  return line.length > 100 ? `${line.slice(0, 97)}...` : line;
}
