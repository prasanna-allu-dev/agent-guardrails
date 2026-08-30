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

## Nothing here has been measured against a real agent

The tests prove the rules work on code that breaks them. They do not show how
often an agent actually writes such code, or how often the hook changes the
outcome of a real task.

That measurement is a real piece of work: a fixed set of tasks, run repeatedly
with the hook on and off, scored the same way each time. Until it exists, this
repository claims that the checks are correct — not that they are sufficient.

## The service is a demonstration

`service/` is a small in-memory app that exists to give the rules something to
run against. It is not a production API and does not pretend to be — no real
database, no authentication, no persistence.
