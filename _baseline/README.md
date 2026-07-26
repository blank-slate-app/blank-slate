# _baseline/ — pristine copies of the shipped tools

Do not edit files here. This folder is the recovery source:

- A baseline tool **missing** from `_tools/` is restored from here at startup
  (baseline tools can't be deleted).
- A baseline tool **edited** in `_tools/` is left alone — tinkering is the
  point. Use the app's Revert to Baseline (or copy from here by hand) to get
  a pristine copy back.

Every shipped tool has its pristine twin here; each is also present in
`_tools/` as the live, editable copy. Any change to a shipped tool must be
mirrored byte-identical into this folder in the same commit.
