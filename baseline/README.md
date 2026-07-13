# baseline/ — pristine copies of the shipped tools

Do not edit files here. This folder is the recovery source:

- A baseline tool **missing** from `tools/` is restored from here at startup
  (baseline tools can't be deleted).
- A baseline tool **edited** in `tools/` is left alone — tinkering is the
  point. Use the app's Revert to Baseline (or copy from here by hand) to get
  a pristine copy back.

Baseline tools land here as they are ported from the original CanvasApp
(see PLAN.md). Each is also present in `tools/` as the live, editable copy.
