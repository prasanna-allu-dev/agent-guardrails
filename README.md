<div align="center">

# agent-guardrails

**Blocks an AI coding agent from writing a data leak — checked before the file is saved, not after.**

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-37%20passing-brightgreen)](#what-is-actually-proven-here)
[![Rules](https://img.shields.io/badge/rules-4-blue)](#the-rules)
[![Eval](https://img.shields.io/badge/eval-46%20agent%20runs-8A3FFC)](evals/)

</div>

---

## The bug this is about

An app keeps several companies' data in the same database tables and tells them
apart with a `tenantId` column. Someone — a person in a hurry, or an AI agent
asked to "add a user search" — writes a query and forgets that one filter.

Nothing breaks. There is no error, no crash, and no failing test unless somebody
thought to put two companies in the test fixture. The endpoint returns rows. They
are just the wrong rows.

```
  Rae is an admin at Acme. She asks for the list of users.

  ✓ What she should get — db.users.findMany({ where: { tenantId, active: true } })
      Rae Nolan  admin
      Sam Ortiz  member

  ✗ What she gets if one filter goes missing — db.users.findMany({ where: { active: true } })
      Rae Nolan  admin · acme
      Sam Ortiz  member · acme
      Kit Alvarez  admin · globex
      Jo Reyes  member · globex

  2 of those 4 rows belong to a different company.
```

That is `npm run demo`, and it is the whole motivation. This kind of mistake
survives code review because the diff looks completely ordinary.

---

## The idea

Write the rule down as a file, and check every edit against it *before the edit
is saved*.

A rule is a short YAML file that anyone can read — including the people who care
about the rule but do not write the code:

```yaml
id: tenant-isolation
title: Every database query must say which customer it is for
severity: critical

# Find any of these database calls...
find:
  - db.$TABLE.findMany($$$ARGS)
  - db.$TABLE.findFirst($$$ARGS)
  - db.$TABLE.count($$$ARGS)

# ...and complain if the call does not mention this.
require: tenantId
```

`$TABLE` and `$$$ARGS` are wildcards. The patterns match code by its *shape*
rather than by text, so formatting, variable names and line breaks do not matter.

Each rule also carries a `why` and a `fix`, in plain English. Both get shown when
the rule fires — a warning nobody can act on just gets switched off.

---

## The rules

| Rule | In one line |
|---|---|
| `tenant-isolation` | Every database query must say which customer it is for |
| `no-pii-in-logs` | Personal details must not be written to logs |
| `no-raw-sql` | No hand-written SQL |
| `keep-auth-checks` | Do not remove a permission check that was already there |

---

## Where the rules run

**On the command line**, over any folder:

```
guard  4 rules · 2 files · examples/tenant-isolation

  ✗  examples/tenant-isolation/bad.ts:4  tenant-isolation
     Every database query must say which customer it is for

       db.users.findMany({ where: { name, active: true } })

     This query is not scoped to a customer, so it reads across all of them.

     Add the caller's tenant to the filter:

         db.users.findMany({ where: { tenantId: ctx.tenantId, active: true } })

     `ctx.tenantId` comes from the authenticated request — never from user input.

  2 problems  · guard explain <rule> for the reasoning
```

**And inside Claude Code**, as a hook. Claude Code asks permission before it
writes a file; `src/hook.ts` answers. If the pending edit breaks a rule, the
write does not happen and the agent is told why:

```
Blocked by agent-guardrails — 1 rule violation in this edit.

• Every database query must say which customer it is for (tenant-isolation)
    db.users.findMany({ where: { name } })
    This query is not scoped to a customer, so it reads across all of them.

    Add the caller's tenant to the filter:

        db.users.findMany({ where: { tenantId: ctx.tenantId, active: true } })
```

The agent then usually just fixes it and carries on. That is the point: the
feedback arrives while it is still working, not in a review comment tomorrow.

---

## The part a normal linter cannot do

Three of the four rules read a file and ask "is anything wrong with it?" — which
is what linters have always done.

`keep-auth-checks` is different, and it is the reason this is a hook rather than
just another lint step. Look at these two files:

```ts
// somebody deleted the guard to make a 403 go away
route('GET', '/users', listUsers)
```
```ts
// this endpoint never had a guard
route('GET', '/users', listUsers)
```

They are the same file. Nothing that reads finished code can tell them apart.

A hook does not get a finished file — it gets the **edit**, including the text
being removed. So it can count: three permission checks before, two after, one
was taken off. That distinction is invisible five minutes later, and it is
exactly the change worth stopping.

```ts
// src/policy/check.ts
const removed = countCalls(before, guard) - countCalls(after, guard);
if (removed <= 0) continue;
```

---

## What is actually proven here

Honest accounting, because "we have guardrails" is easy to say.

**Proven by the test suite** — `npm test`, 37 tests:

- Every rule catches a real violation, and clears a real fix. Each rule ships
  with a `bad` and a `good` example in `examples/`, and the test walks the rules
  folder — so a new rule without both examples fails the build.
- The hook is tested as a real process with JSON on stdin and stdout, not as a
  function call, because the wire format is the part most likely to break.
- The deleted-guard case is tested against the never-had-a-guard case, so the
  distinction above is a test rather than a claim.
- The hook fails *open*: if it cannot parse its own input, it allows the write.
  Blocking every edit because of a bug in the checker would be worse than
  missing a violation.

**Measured, not asserted** — 46 agent runs on `claude-opus-5`, six tasks, each
given to a real agent with the hook on and with it off, everything else held
identical. Method and raw per-run results in [evals/](evals/).

The outcome is more interesting than a clean win, because two thirds of it is
negative:

| What happened | What it means |
|---|---|
| 5 of 6 tasks produced **no violations in either arm** | On this model the tempting query and logging tasks did not tempt it — it scoped its queries and logged ids unprompted. The hook changed nothing there, because there was nothing to change. |
| Every violation, in both batches, was **the same rule** | A permission check deleted to make a 403 go away — the one a linter cannot see. The value concentrates somewhere much narrower than "agents write unsafe code". |
| On that task, **2 of 5** unguarded runs removed the guard; with the hook, 3 runs were blocked and **1 of 5** still got through | It reduces the failure. It does not eliminate it. |

If you are adding guardrails of your own, the first row is the useful finding: a
current model already respects several of these rules unprompted, and a rule
that never fires is cost without benefit. Worth measuring before writing twenty
of them.

**The eval found a bug in the hook.** One run removed a permission check with
the hook enabled and *zero* blocked attempts. The agent had rewritten the file
wholesale with `Write` rather than editing it — and the guard-removal rule only
ran on edits, so the same change delivered a different way walked straight past
the check. Nobody caught that in review; the eval caught it on run 19. It is
fixed, with a regression test. A second bypass is still open and unidentified,
and is written down in [evals/README.md](evals/README.md) rather than rounded
away.

**Known limits**, also in [docs/LIMITATIONS.md](docs/LIMITATIONS.md):

- `require: tenantId` only checks that the words appear. A query filtering on
  `tenantId: req.query.tenant` passes the rule and is still wrong. The
  `rule-reviewer` subagent exists to look for exactly this class of thing.
- Only the changed text is checked, not the whole file, so the agent is never
  blocked for a problem it did not introduce — and a violation assembled across
  several separate edits can slip through.
- At least one way of removing a permission check without the hook noticing is
  still open. It was seen once in the eval and has not been reproduced since.
- `no-pii-in-logs` matches field names. Free text that identifies someone without
  using one of those names gets through.

---

## Try it

```bash
npm install
npm run demo      # why the tenant filter matters
npm run check     # scan the service — should be clean
npm test          # the rules and the hook
```

Point it at the deliberately broken examples:

```bash
npm run check -- examples
```

Ask why a rule exists:

```bash
npx guard explain tenant-isolation
```

Re-run the measurement yourself (this makes real API calls and costs real money —
the 46 runs behind the numbers above came to $13.94):

```bash
npm run eval -- --task internal-tool-403 --reps 3
```

To see the hook block an edit, open this repo in Claude Code — `.claude/settings.json`
wires it up on clone — and ask it to *"add an endpoint that lists all users"*.

---

## How it fits together

```
rules/           4 rules, one YAML file each — readable without knowing TypeScript
examples/        a bad and a good file per rule; the tests run against these
src/policy/      the engine — no network, no state
src/cli.ts       guard check | rules | explain
src/hook.ts      the same engine, wired into Claude Code's PreToolUse hook
service/         a small multi-tenant app for the rules to be demonstrated against
.claude/         the hook, a skill, a slash command, and a reviewer subagent
evals/           the measurement: real agent runs, hook on vs hook off
```

The engine is the only place that knows how to evaluate a rule. The CLI and the
hook are both thin wrappers over `checkSource()` and `checkEdit()`, which is why
adding a rule means adding a YAML file and two examples — and nothing else.

---

## License

MIT
