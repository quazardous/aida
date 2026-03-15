# /art:init

Initialize a new AIDA artistic direction for this project.

1. Ask the user for the project name
2. Call `node_init` to create the universe_root
3. Begin mood exploration: ask structured questions about the project's visual identity
4. Translate answers into initial genome values via `genome_bulk_update`
5. Call `pass_start` to begin the first exploration pass
6. Show the initial genome state with `node_get`
