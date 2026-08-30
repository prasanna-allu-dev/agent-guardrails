---
description: Scan the codebase for rule violations and explain what to do about each one.
---

Run `npm run check -- $1` (default to `service` if no path was given) and read
the findings.

For each one, tell me in plain language:

- what the code currently does
- what goes wrong because of it — the actual consequence, not the rule name
- the smallest change that fixes it

Then ask before changing anything. Some findings are worth a conversation rather
than a patch, particularly anything touching a permission check.

If there are no findings, say so in one line. Do not pad it out.
