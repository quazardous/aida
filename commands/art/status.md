# /art:status

Show the current state of the AIDA artistic direction tree.

Call `tree_status` to get all nodes, their statuses, dirty report, and active pass.
Then call `dirty_status` if there are dirty nodes.

Format the output as a visual tree with status indicators:
- ✓ validated
- ● exploring
- ○ draft
- 🔒 locked
- ⚠ dirty:major
- ✕ dirty:broken
- ~ dirty:minor

Show the active pass info and any pending .comment files.
