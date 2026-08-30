import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkEdit, checkSource } from '../src/policy/check.ts';
import { loadRules } from '../src/policy/rules.ts';

const RULES_DIR = join(import.meta.dirname, '..', 'rules');
const EXAMPLES_DIR = join(import.meta.dirname, '..', 'examples');

const rules = loadRules(RULES_DIR);
const read = (...p: string[]) => readFileSync(join(EXAMPLES_DIR, ...p), 'utf8');

/**
 * The point of this file.
 *
 * A rule that has never been shown a real violation is a claim, not a check.
 * Every rule therefore ships with a `bad` example it must catch and a `good`
 * example it must leave alone — and this test walks the rules directory, so a
 * new rule without both examples fails the build rather than being forgotten.
 */
describe('every rule is falsifiable', () => {
  it('finds at least one rule', () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  for (const rule of rules) {
    describe(rule.id, () => {
      const dir = join(EXAMPLES_DIR, rule.id);

      it('has a folder of examples', () => {
        expect(existsSync(dir), `expected examples/${rule.id}/`).toBe(true);
      });

      if (rule.kind === 'source') {
        it('catches bad.ts', () => {
          const findings = checkSource(read(rule.id, 'bad.ts'), [rule], 'bad.ts');
          expect(findings.length).toBeGreaterThan(0);
          expect(findings.every((f) => f.ruleId === rule.id)).toBe(true);
        });

        it('leaves good.ts alone', () => {
          expect(checkSource(read(rule.id, 'good.ts'), [rule], 'good.ts')).toEqual([]);
        });
      } else {
        it('catches the guard being removed', () => {
          const findings = checkEdit(
            read(rule.id, 'before.ts'),
            read(rule.id, 'bad.ts'),
            [rule],
            'bad.ts',
          );
          expect(findings.length).toBeGreaterThan(0);
        });

        it('allows an edit that keeps the guard', () => {
          const findings = checkEdit(
            read(rule.id, 'before.ts'),
            read(rule.id, 'good.ts'),
            [rule],
            'good.ts',
          );
          expect(findings).toEqual([]);
        });
      }
    });
  }
});

describe('rules explain themselves', () => {
  for (const rule of rules) {
    it(`${rule.id} says why it exists and how to fix it`, () => {
      // A finding a developer cannot act on is noise, and noise gets switched off.
      expect(rule.why.length).toBeGreaterThan(80);
      expect(rule.fix.length).toBeGreaterThan(30);
      expect(rule.message.length).toBeGreaterThan(10);
    });
  }
});
