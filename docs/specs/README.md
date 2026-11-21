# Specs

One file per feature branch, committed with the branch and linked from its PR.

A spec records what was **decided** and why the obvious alternative was not
taken. It is the place a later agent or reviewer looks when the code is silent:
the budget that was chosen, the channel that was reused instead of added, the
piece deliberately left for later.

Not here:

- **Handoffs.** A handoff is for one agent's successor and dies with the
  session. If it contains a decision that outlives the branch, move that part
  into the spec first.
- **Review reports.** Those belong on the PR, or in `docs/adr/` when a decision
  changes the architecture.
- **Design that can be read off the code.** The spec is for the part the code
  cannot say: the alternatives considered, the measurement that settled it.

`docs/adr/` holds decisions that bind future work. A spec holds the shape of one
piece of work and may be superseded; note it at the top when it is.
