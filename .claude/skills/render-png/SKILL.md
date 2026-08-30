---
name: render-png
description: Render a mermaid diagram to PNG and inspect it visually (vision beats reading box-art text)
---

Render a mermaid source file to PNG, then Read the PNG to inspect the layout
visually. Never judge a large diagram by its raw box-art text output — vision
catches misplaced heads, broken borders, and bad routing that text scanning
misses.

## Usage

```
bun "$CLAUDE_PROJECT_DIR/.claude/skills/render-png/render-png.ts" <file.mmd> [--rule] [--out x.png] [-w 2000] [--opt k=v ...]
```

- Default renderer: ELK (`renderElk` from `packages/lovely-mermaid/src/layout-elk.ts`).
- `--rule`: rule-based layout via `render()` instead.
- `--opt elk.foo=bar` (repeatable): extra ELK layoutOptions for A/B comparisons.
- Writes `<input>.svg` + `<input>.png` next to the input (or `--out`), prints the PNG path.
- Put throwaway `.mmd` files in the scratchpad dir; the standing test corpus
  (real-world architecture diagrams, one per kind, plus small regressions)
  lives in `examples/`.

Then `Read` the printed PNG path to view it.

Pipeline: renderer → `toAnsi` → lovely-ansi-svg `exportSvg` (imported from
`demo/node_modules/lovely-ansi-svg` — no dependency needs installing) →
`inkscape` SVG→PNG. If a test needs a wider PNG for small text, raise `-w`.

## Lab snapshots

For a layout-lab picture (a Snapshot JSON file or a pasted `/lab/<data>`
URL), use the sibling tool — same pipeline, same PNG inspection:

```
bun "$CLAUDE_PROJECT_DIR/tools/lab-svg.ts" <snapshot.json | lab-url> [--out x.png] [-w 1600] [--sx 10 --sy 20 --gapx 4 --gapy 2]
```
