# What this does not catch

Every check of this kind has holes. Writing them down is more useful than
pretending otherwise — an unknown gap is dangerous, a known one is just a
backlog item.

## The rules match shapes, not meaning

`tenant-isolation` checks that a query *mentions* `tenantId`. It cannot tell
where the value came from:

```ts
// passes the rule, still wrong — the caller chooses whose data they read
db.users.findMany({ where: { tenantId: req.query.tenant } });
```

The only correct source is `ctx.tenantId`, which comes from the authenticated
session. Catching the wrong-source case properly needs to follow the value back
to where it was assigned, which the current engine does not do.

This is why `.claude/agents/rule-reviewer.md` exists. It is pointed at exactly
this class of problem — things that satisfy the letter of a rule and break its
intent — and it reads code rather than matching patterns.

## Only the changed text is checked

The hook checks what an edit adds, not the whole file. That is deliberate: an
agent should not be blocked for a problem that was already in the file when it
got there, or it will start working around the hook instead of with it.

The cost is that a violation assembled across several separate edits can pass.
Building a query in one edit and removing the tenant filter in another would not
be caught by the hook — though `npm run check` over the whole folder would find
the result, which is why CI runs it.

## Field-name matching misses free text

`no-pii-in-logs` looks for `.email`, `.fullName`, `.phone` and friends. Anything
that identifies a person without going through one of those field names gets
through:

```ts
logger.info(`could not reach ${contactString}`); // not caught
```

Widening this rule trades false negatives for false positives, and a rule that
fires on innocent code is a rule people turn off. The current setting is
deliberately conservative.

## The hook can still be got around

The eval (see [../evals/README.md](../evals/README.md)) found one way, and
strongly suggests a second.

**Found and fixed:** rewriting a file wholesale with `Write` instead of editing
it. The guard-removal rule only ran on edits, so the same change delivered as a
rewrite was invisible to the hook. `Write` now reads the file from disk and
compares against it, with a regression test in `tests/hook.test.ts`.

**Found, and not fixable here:** a later run removed a guard with the hook
enabled and zero blocked attempts again. Instrumenting the session to log every
tool call explained it — the agent had stopped using `Edit` and was changing
files with **shell commands**. Ten `Bash` calls, no `Edit` calls, and a hook on
`Write|Edit|MultiEdit` that never fired once.

This is worth being blunt about, because it bounds the whole idea:

> **A hook gates tools, not the filesystem.**

Any agent with shell access can walk around every rule in this repository, and
writing better rules does not change that. `sed -i`, a heredoc, a build step, a
dependency's postinstall — none of them pass through `PreToolUse`.

Two things follow. First, the hook is fast feedback, not an enforcement
boundary; `npm run check` over the finished tree is the part that actually holds,
which is why CI runs it. Second, if you genuinely need enforcement, it belongs
somewhere the agent cannot reach — a pre-commit hook it does not control, a
required CI check, or branch protection.

`tools/capture-session.ts` passes `disallowedTools: ['Bash']` for exactly this
reason: with shell access left open, a captured session shows the agent quietly
routing around the thing the capture is supposed to demonstrate.

## What the measurement does and does not cover

46 agent runs, one model (`claude-opus-5`), six tasks. Enough to show a
direction; nowhere near enough for a rate quoted to two significant figures.

It says nothing about other models, and the most interesting untested question
is whether a smaller or cheaper one trips these rules more often. Five of the
six tasks produced no violations at all here — that is a fact about this model,
not a fact about agents.

## The service is a demonstration

`service/` is a small in-memory app that exists to give the rules something to
run against. It is not a production API and does not pretend to be — no real
database, no authentication, no persistence.
