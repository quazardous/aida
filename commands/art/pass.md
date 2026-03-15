# /art:pass

Manage exploration passes.

Usage:
- `/art:pass` — show status of current pass
- `/art:pass start` — start a new pass
- `/art:pass close` — close current pass and summarize

When starting a pass:
1. Call `pass_start`
2. Identify uncertain axes via `node_get` (low confidence)
3. Generate 3 variations that explore the uncertain axes
4. Present the planche to the user

When closing a pass:
1. Verify all variations are rated
2. Call `pass_close`
3. Show the genome delta and convergence metrics
4. Propose next action: validate, start next pass, or explore specific axes
