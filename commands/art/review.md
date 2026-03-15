# /art:review

Process .comment files dropped by the user in the tree.

1. Call `comment_pending` to find unprocessed .comment files
2. For each .comment:
   a. Call `comment_process` to parse actions
   b. Present the parsed actions to the user for confirmation
   c. Execute each confirmed action via the appropriate MCP tool
   d. Call `comment_mark_processed` with a summary response
3. If genome changes occurred, check for dirty propagation
4. Show updated tree status
