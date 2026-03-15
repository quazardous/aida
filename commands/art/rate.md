# /art:rate

Rate variations for the current pass.

1. Call `pass_status` to see the active pass and pending variations
2. Call `variation_list` for the root node and current pass
3. Present each unrated variation to the user
4. Accept ratings in short format: `[1-5] [verdict] ["notes"] [+axis] [-axis]`
5. Call `variation_rate` for each rating
6. After all rated, show genome delta and remaining uncertain axes
7. If validatable, propose closing the pass
