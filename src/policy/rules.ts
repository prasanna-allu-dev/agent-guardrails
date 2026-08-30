import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** A rule that reads a file and asks "is anything wrong with it?" */
export type SourceRule = {
  kind: 'source';
  id: string;
  title: string;
  severity: Severity;
  why: string;
  message: string;
  fix: string;
  /** Code shapes to look for, as ast-grep patterns. */
  find: string[];
  /** If set, a match that does NOT contain this text is a violation. */
  require?: string;
  /** If set, a match that DOES contain any of these is a violation. */
  forbid?: string[];
};

/** A rule that compares a file before and after an edit. */
export type EditRule = {
  kind: 'edit';
  id: string;
  title: string;
  severity: Severity;
  why: string;
  message: string;
  fix: string;
  /** Function calls that count as a permission check. */
  guards: string[];
};

export type Rule = SourceRule | EditRule;
export type Severity = 'critical' | 'high' | 'medium';

const SEVERITIES: Severity[] = ['critical', 'high', 'medium'];

/**
 * Read every .yaml file in a directory as a rule.
 *
 * Rule files are data, and people hand-edit them, so a bad one should say
 * exactly what is wrong with it rather than throwing something cryptic.
 */
export function loadRules(dir: string): Rule[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .toSorted();

  const rules = files.map((file) => {
    const raw: unknown = parseYaml(readFileSync(join(dir, file), 'utf8'));
    return validate(raw, file);
  });

  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new Error(`Two rules share the id "${rule.id}".`);
    seen.add(rule.id);
  }
  return rules;
}

function validate(raw: unknown, file: string): Rule {
  const fail = (msg: string): never => {
    throw new Error(`rules/${file}: ${msg}`);
  };

  if (typeof raw !== 'object' || raw === null) fail('file is empty or not a YAML mapping.');
  const r = raw as Record<string, unknown>;

  for (const field of ['id', 'title', 'why', 'message', 'fix'] as const) {
    if (typeof r[field] !== 'string' || r[field].trim() === '') {
      fail(`missing "${field}". Every rule needs one, so findings can explain themselves.`);
    }
  }
  if (!SEVERITIES.includes(r.severity as Severity)) {
    fail(`severity must be one of ${SEVERITIES.join(', ')} — got ${JSON.stringify(r.severity)}.`);
  }

  const common = {
    id: r.id as string,
    title: r.title as string,
    severity: r.severity as Severity,
    why: r.why as string,
    message: r.message as string,
    fix: r.fix as string,
  };

  if (r.kind === 'edit') {
    if (!isStringArray(r.guards) || r.guards.length === 0) {
      fail('an "edit" rule needs a non-empty "guards" list.');
    }
    return { ...common, kind: 'edit', guards: r.guards as string[] };
  }

  if (!isStringArray(r.find) || r.find.length === 0) {
    fail('needs a non-empty "find" list of patterns (or kind: edit).');
  }
  if (r.require !== undefined && typeof r.require !== 'string') {
    fail('"require" must be a single string.');
  }
  if (r.forbid !== undefined && !isStringArray(r.forbid)) {
    fail('"forbid" must be a list of strings.');
  }
  if (r.require !== undefined && r.forbid !== undefined) {
    fail('use "require" or "forbid", not both — a rule that does two things is hard to read.');
  }

  const find = r.find as string[];
  const requiredText = typeof r.require === 'string' ? r.require : undefined;
  const forbid = isStringArray(r.forbid) ? r.forbid : undefined;

  return {
    ...common,
    kind: 'source',
    find,
    ...(requiredText !== undefined ? { require: requiredText } : {}),
    ...(forbid !== undefined ? { forbid } : {}),
  };
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
