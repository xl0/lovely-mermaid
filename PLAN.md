# Plan

`lovely-mermaid`: render Mermaid as Unicode box-drawing art for terminals.
Born as a byte-faithful port of the Rust renderer in `xai-org/grok-build`;
that bar has been met and retired. The bar now is good terminal output —
every deliberate divergence is listed in `CODE.md`, and the old differential
harness is gone with it (its fuzz corpus lives on in the test suite).
Review docs are episodic: `REDESIGN.md` and `REWORK.md` were executed and
deleted; `REVIEW.md` (2026-08-15) is the current one — local and untracked,
holding only the parked next-major items.

**Intent:** best-effort rendering everywhere (draw as much as possible, warn
about the rest — it is what makes streaming work), a small semantic API
(`role` for what the renderer decided, `classes` for what the author wrote),
and one module per diagram type so new types are cheap to add.

## [x] The port (2026-07)

Skeleton, renderer, all five grammars, `toAnsi`, fallback box; upstream test
suite ported; differential harness over ~7180 cases —
byte-identical at the fidelity cutoff (`617cbf3`). Post-cutoff wins: grapheme
clustering via `Intl.Segmenter`, `width` reported instead of `maxWidth`
enforced, parse warnings, control characters stripped, staged npm releases.

## [x] Redesign (2026-08-12)

- Workspace: library moved to `packages/lovely-mermaid`; `demo/` to come as a
  sibling. Tools stay at the repo root. Repo renamed to `xl0/lovely-mermaid`.
- `parse.ts` split into `statements.ts` + `diagrams/{flowchart,state,class,er,
  sequence}.ts` + `registry.ts`; `diagramKind` and dispatch derive from one
  table. `ClassInfo` parallel arrays replaced by `Node.sections`.
- Lenient everywhere: strict grammars drop unreadable statements with
  warnings (block bodies swallowed structurally); the salvage retry died.
  Caps truncate with a warning instead of refusing (`MAX_CANVAS_CELLS` stays
  fatal). Headers match exactly.
- API: `Cls`/`span.cls` → `Role`/`span.role`; author classes surfaced on
  `span.classes` (flowchart `:::` + `class`, state `class`); `classDef`s
  parsed into `art.classDefs`. `toAnsi` stays role-only.
- Package renamed `lovely-mermaid`; next release 0.3.0.
- Tests reworked into markdown golden files (`test/cases/`, one runner,
  `bun run test:update` to regenerate); programmatic tests keep only what
  the art can't show.

## [x] Releases 0.3.0–0.3.2 (2026-08-15)

Trusted publisher recreated; staged releases flowing.

- [ ] Deprecate `grok-mermaid` on npm with a pointer.
- [ ] Release 0.4.0: the routing rework + review fixes sit under
      `[Unreleased]` — `/cl` audit, then `bun run release minor`.

## [ ] Features (order from REDESIGN.md)

- [x] Composite states as frames, `--` regions, `[*]` scoped per group.
- [x] Flowchart v2 `A@{shape: cyl, label: "..."}` node syntax.
- [x] Sequence activations thicken the lifeline over the active range.
- [x] Cardinalities at their own edge ends (`Edge.cardFrom`/`cardTo`), verb
      mid-edge; `0..*` → `*`.
- [x] ER aliases with spaces (`a["Bank Account"]`).
- [x] `:::` capture in state/class diagrams — classes work in every grammar
      that has them.
- [x] classDef styles applied best-effort: `resolveClassStyle` (fill/stroke/
      color/bold, normalized colors) + contrast guard; `toAnsi` layers it
      over the role theme (bold-only merges rather than replaces), demo
      calls `toAnsi` (`/styles` preset).
- [x] Whole-codebase review rework (2026-08-14, see `REWORK.md`): shared scan
      helpers (quote rules live in `statements.ts` only), `:::` parsed inline
      (captureStyleTags gone), `class A,B` unified, ten bug fixes (frontmatter
      skipped + its title drawn, quoted cardinality, region subtree loss,
      seq-cap throw, lane edges cutting through boxes, …), diamonds drawn as
      double-bordered boxes, css-colors.ts generated from spec.
- [x] New diagram types (2026-08-15): pie (bar list), mindmap (tree),
      timeline, gitGraph (commit lanes, newest-first). One file each in
      `diagrams/`, drawing rows straight onto a Canvas.
- [x] Demo app in `demo/` (SvelteKit): light/dark page theme, class-styled
      `/styles` preset. lovely-mermaid by source alias; svelte-asciiart@0.1.0
      and lovely-ansi-svg@0.1.0 from npm (dev symlinks retired) — Pages
      deploy is unblocked. AsciiArt colors resolve at parse time through its
      `theme` prop (palette + panel fg/bg, keep in sync with
      `--term-bg`/`--term-fg`). 2026-08-15: pure SPA (no SSR/prerender,
      404.html fallback + index.html copy for Pages); the source travels
      as deflate+base64url (old plain-base64 links dropped); shared
      `$lib/{theme,hash,ThemeEditor}`; `/render/<data>` viewer route —
      pan/zoom canvas, minimap, theme drawer, copy, bottom editor drawer
      that rewrites the URL live. 2026-08-16: `AnsiCanvas` shares
      lovely-ansi-svg's cluster width tables; text search (`/`, Enter
      cycles, highlights under the camera); `[mermaid]` toggles the
      official mermaid.js renderer (dynamic import, SVG under the same
      pan/zoom), with an `[elk]` layout toggle — dagre stops
      cluster-crossing edges at the border, ELK pierces to the node.
- [ ] Maybe a `bin` CLI in the main package (mermaid/markdown → art).
- [ ] Width work, both parked (2026-08-16): text discipline without an API
      (sequence message/note wrap at 32 cols, compartment rows truncate at
      40) on the `width-discipline` branch; the full `render(src,
      {maxWidth})` reflow-to-target experiment (wrap steps, sequence
      steps, rank wrapping, demo drag) on `reflow-maxwidth` — rule-based
      routing degrades badly at heavy compression; revisit only with a
      smarter router.

## [x] Review findings (2026-08-15)

All actionable `REVIEW.md` items landed, one commit each: the five
silent-corruption bugs (kebab ids, `class A["Label"]`, BT multi-row content,
state `-->` labels, back-edge lane cut-through — solved by local
adjacent-back routing rather than a left lane strip), the medium tier
(sequence `-x` boundary, ER quotes, tab painting, parallel-label join), the
low tier, plus the streaming-prefix sweep and the ANSI snapshot. Parked for
the next major: typed warnings, `Span.node`. Changelog updated under
`[Unreleased]`.

Follow-on routing rework (same day, demo-driven): adjacent-rank back edges
return locally; skips split off the bottom fan, drop straight when the
column is clear, enter target tops on evenly spread slots with side-aware
labels; lanes pack shortest-innermost. LR/RL skips run straight through
clear rows off the right-side fan (adjacent-back local returns stay
TD-only: three-row boxes have no off-centre side port). An A*
router experiment lives on the `astar-routing` branch: works, legible,
rejected as less disciplined than structured routing (see that commit).

## [ ] Layout engine (started 2026-08-29)

A new in-house layered layout engine, ELK-shaped (cycle breaking →
layering → crossing minimization → placement → routing → labels), written
generically — terminal is the first consumer, not the only one: input is
sized nodes/edges/compounds, output is integer geometry in whatever unit
the sizes came in; aspect and even-width rules belong to the consumer.
Sync, zero deps. Lives inside `packages/lovely-mermaid` for now (may
become its own package). Human in the loop throughout, so the
visualization comes first and every phase must be viewable.

- [x] Lab: Snapshot format (ports included), `snapshotSvg`, `/lab` page
      (CodeMirror editor with completions and two-way selection, presets,
      pan/zoom, hover, URL state), `tools/lab-svg.ts` to PNG.
- [x] ELK dive (2026-08-29): `docs/elk-layered.md`, ~4.3k lines, source
      cached at `~/.cache/checkouts/github.com/eclipse/elk`. Chapter 8
      holds the per-phase decisions (pipeline shape, data model, P1–P5,
      compound hybrid, options, corrections to older notes) and the
      reading order per milestone — start there.
- [x] Engine skeleton (2026-08-30): `src/engine/` with the working model,
      trace, `until` + per-phase options, all phases as pass-throughs,
      direction transform;
      `layout-engine.ts` bridge (Graph in, Canvas out); the lab runs
      mermaid source through it with a phase stepper. Decided with it:
      an outer candidate loop scoring the *real* cost (width, crossings,
      label failures) will wrap the tail phases — keep every phase pure.
- [ ] Corpus stats table (ours vs elkjs) once ordering exists.
- [x] cycles (greedy ELS, deterministic ties; `dfs` alternative), layers
      (network simplex with weight/minLen, balancing; `longestPath`
      alternative), order (port-rank sweep, deterministic restarts,
      greedy switch, port cells; sub-step snapshots) and place
      (Brandes–Köpf in integers, narrowest of four; network-simplex placer
      on the shared simplex core) and route (trunks per source cell,
      crossing-cost dependencies, X-splitting, tracks → band rows), all
      live in the lab; the bridge renders real terminal output; phases
      are pure `graph → graph`. 2026-08-30.
- [x] Compounds (2026-08-30): the global scheme (border nodes, nesting
      edges, blocks — commit 1c0961b) measured 731 columns on
      `arch-system` against the old 312, spans forced by re-entrant
      paths; replaced by the recursive scheme (levels, port dummies,
      fixed ports, routes joined at the border): 316×268, frames tight,
      every corpus diagram at or under the old width. See CODE.md.
- [x] Width pass 1 (2026-08-30): BK grew a free-chains dimension (8
      candidates, port dummies sticky) and a root-only equal-width tie
      break by summed row extents — arch-system 302×280, arch-state
      239×335 (old renderer 312×182 / 378×432). TB `edgeEdge: 0` tried,
      reverted: too dense to read. NS placer has no width
      term at all (it only straightens); BK is the width-aware strategy.
      Remaining mid-row holes are ordering artifacts (see CODE.md), the
      candidate loop's job.
- [x] Chain relaxation in routing (2026-08-31): dummies are gaps, not
      columns; chains slide within slack toward their ports, bend-minimal
      (greedy stabbing). Staircases gone; widths unchanged, arch-state
      height −17. The flat snapshot is a result view: routes run
      source→target, carries `dir`, no reversed flags, no phase
      diagnostics; the lab bands along the flow axis.
- [x] Port-order handshake (2026-08-31): the parent pre-orders each
      child's ports (provisional order pass, free-port placeholders); the
      child's rim rows are pinned to it and the members follow. Border
      double-crossings gone, and the inside adapting to the outside cut
      arch-system to 243×299 (from 302; old renderer 312×182). Port
      dummies then joined the routing relaxation, anchored on their inner
      endpoint, and specs group by inner item (same-target ports adjacent,
      groups in outer order — scattered they pinned every port's slack to
      zero): ports sit over what they connect to, the hairpin loops at
      frame borders are gone. arch-system 258×307 (port placement bought
      back 19 columns; old renderer 312×182), arch-state 239×318.
- [x] Self-loops (2026-08-31): a miniature bottom-to-top cycle around
      the east side (reserved columns; ends are ordinary S/N ports, so
      no corner cells and the width bump counts them); member→own-frame
      edges become frame loops. Subgraph `direction` honoured for closed frames
      (transposed scope, parity-aware leaf sizes, `altSpacing` profile).
      Examples page renders with the engine by default (+ engine options
      panel; legacy/elk/mermaid modes kept).
- [x] Width-bounded layering (2026-08-31): `layering.maxWidth` staggers
      an overwide row into two layers (out-heavy nodes move down; always
      legal). At cap 150: arch-system 258→217, arch-state 239→173 wide
      for ~+15/+33% height; too low and dummy columns win it back. Off by
      default. Decided: in practice the target comes from the terminal
      width, not a hand-set cell count — the consumer passes its width,
      the loop fits (the cap is soft; real width overshoots by the dummy
      columns, ~10–15%, so iterate cap = target − observed overhead) and
      the bridge derives per-level caps (minus frame borders per depth).
- [x] Candidate loop (2026-08-31): `layoutBest` — greedy/dfs × bk/NS,
      plus cap passes toward `fit.width`; lexicographic rank (fits →
      height → width with a target; width → height without), budget 12,
      winner re-traced. `traceEngineFit` in the bridge; the examples bar
      grew a `fit` input (badge = chosen candidate, hover = the table).
      No target already beats defaults: arch-system 258→227. Fine-tuning
      parked: cap refinement is one step (results non-monotonic in the
      target — fit 120 found cap26 → 156 wide, fit 80 stopped at 191);
      a cap ladder / binary search within budget when we return to it.
- [ ] Next: labels (decisions pending). Then the width-aware ordering
      case (the 85-column e64/e75 hole) as a loop dimension.
- [x] Geometry feedback (2026-08-31): `squeeze` — measure band
      occupancy from the routed picture as merged x-intervals, move one
      row per iteration into gaps that fit it, force layers back
      (applyLayers) and re-run split→order→place→route; accept only
      non-regressing measurements, remember rejected rows. session-er
      @100: 89×242 → 93×161. Hard-target policy confirmed by the user
      (terminal width is a wall).
- [x] Port tuning, last word (2026-09-01): tuned ports were being
      un-aligned by the second relax and compactRight running after
      them — ports move no geometry, so tunePorts now runs twice more
      after compaction. arch-state@100 h-runs 225→155, 99×718→99×670;
      arch-system@120 →119×314; session-er@100 →96×149; uncapped
      arch-classes →314×67. The screenshot chain renders wire-straight.
- [x] Chain folding: built, measured, REMOVED entirely (2026-09-01).
      The mechanism (reverse the second half's edges; layering makes
      the boustrophedon naturally) worked — 13-chain height ×0.5 for
      width ×1.5 — but loop candidates never won under hard-width +
      squeeze band packing, and the manual renders looked worse in
      practice (user). If it ever returns, the edge-flip approach is
      the way. tunePorts now moves a port
      only onto an exact partner column (straightens a wire); near-miss
      moves kept the bend and parked it at the border — reverted to
      centred defaults per review of the visuals (+a few rows height,
      user's call: aesthetics over rows). Review finding #4 disposition:
      jog-only channels are 14/317 (system@120) and 21/704 (state@100)
      rows — parked with the ordering dither; folding was the big lever
      and is now available manually.
- [x] Review round (2026-09-01, REVIEW-ENGINE.md): HIGH compound↔
      descendant edge fixed (collapsed self-loop: one spec with
      direction-correct side, matching-port pin, assembly consults the
      original edge for piece sides) + goldens for all three shapes.
      Sideways+target now warns. layoutFast calibration pass (overshoot
      re-cap floored at 0.7×target: arch-state fast@100 191→109).
      Structured comboOf/capOf from opts (label protocol gone), dead
      packW removed, dedupe unified. NEW: seeded geometric lint sweep
      (60 tests) — immediately caught adjacent-band self-loop wraps
      sharing the one trackless-channel row (now two rows when both
      bands loop). Not attempted: disperseRow/feasible unification
      (packLayers↔squeezeMoves), port-spec derivation extraction —
      the copies stand until a cleaner cut shows itself.
- [x] Width-aware ordering, step 1 (2026-09-01): shoveDummiesOut —
      crossing-neutral adjacent swaps move a dummy past a real node
      toward its nearer row edge (kills [frame, chains, frame]
      corridors; strictly terminating potential). arch-system@134
      121→119, rest held; never-worse by construction. Step 2 if
      wanted: same idea within dummy bundles (longest span outermost)
      to stabilize the routing windows behind the dither.
## LR width fitting (planned 2026-09-01)

For sideways flow the terminal width caps the FLOW axis; every existing
mechanism works the cross axis. Facts: caller width ≈ Σ (widest node
per band) + channels; the longest dependency path is a hard floor
(arch-classes: path 8 × ~33w → floor ≈ 300 — no packing fits 160).
Caller height is unconstrained (terminals scroll), which makes LR
easier than TB once the right lever exists.

- [x] LR-1 Corpus + honesty (2026-09-01): rotated variants in
      examples/ (arch-state-lr, arch-system-lr, state-regions-lr); ER
      learned `direction` (mermaid 10.5+) — arch-session-er-lr renders
      197×70, narrower AND shorter than its TB twin. The interim
      `flowFloor` warning estimate is gone (the loop's achieved width
      is the honest number).
- [x] LR-3 Page wrap: built, tuned hard, REMOVED (2026-09-01). A
      compositor cut the strip at content-free columns (DP minimizing
      severed edges), stacked the pieces, rerouted cut edges through
      margin lanes and gutter rows, compressed slack rows, ranked
      severed counts — every refinement landed and the numbers fit
      (arch-state-lr@250 reached 248×407), but the severed-edge
      connectors were unreadable in practice on anything non-trivial
      (user: "completely unreadable... don't bend the edges around to
      compact"). Policy now: stacking is the only sideways fit
      mechanism; a diagram that still misses warns and the caller
      links out (see the escape hatch below). Wrap was built and
      removed within one uncommitted stretch, so no history holds the
      code; the load-bearing ideas were: one cut candidate per free
      run (all its columns cross the same segments), lane nesting by
      exit order, per-strip monotone row compression, pass-through
      bus rows.
- [x] LR-4 Hybrid flow / chain stacking (2026-09-01, user's idea):
      `engine/stack.ts` — a chain of single-in/single-out nodes folds
      into one band, members stacked along the cross axis
      (top-to-bottom on an LR page): nodes drop directly under their
      predecessor and the chain edges become straight vertical runs.
      Contraction after cycle breaking: the chain becomes one
      super-node sized for the members side by side; external edges
      keep flow-side attachment through ports pinned over their
      member's slot (fixed-pos, the compound-port machinery), so no
      phase learns anything; export expands members, chain edges as
      straight cross runs, stubs where a short member stops inside
      the stack. Chains segment by size: plain members (cross ≤
      SIMPLE 5) extend freely — a column of small boxes reads like a
      list — larger ones only while the segment totals ≤ BULK 20, so
      a header⤵entity pair stacks while all-large chains (class
      compartments) split into singletons and stay flat. Compounds
      and rims never chain; a self-loop node chains as a TAIL only
      (the loop wraps past the stack's far border, exactly the free
      side; `loops` transfers to the super, loop ports pin last on
      their sides) — that let the ER hub with its parent
      self-relation stack under its header (user's annotation).
      Members widen at contraction for their busiest external side
      (same pitch rule as the main widening pass, which skips
      stacks), so a stacked hub keeps its fan's port cells. Chain
      edges MAY carry labels — contraction drops them (labels phase
      still pending; ER cardinalities land here too). `stackChains`
      option (lab checkbox); layoutBest doubles its sideways cells
      with `+stack` probes, layoutFast adds one stacked calibration
      pass. Frames render as vertical pipelines inside the LR flow
      (the sketch). OPPORTUNISTIC everywhere (user: "always apply it
      as long as it does not grow the second axis"): every direction,
      target or not, the two most promising candidates re-run stacked
      and win only as a free lunch — down flow's width-first metric
      rejects width growth on its own, a target's fits gate budgets
      it, and sideways-without-target gets an explicit guard (a
      stacked candidate may not exceed the best whole layout's
      height; a pinned `stackChains` bypasses it). Segmentation keeps
      all-small runs unlimited but charges every extension once a
      bulky member is aboard (a tall head no longer drags the smalls
      into one over-tall stack). TB free lunches are real:
      arch-state uncapped 221×331 (stacked, ~90 rows shorter),
      state-regions 46×54. Sideways corpus (stack-only fit):
      state-regions-lr 88×29, arch-session-er-lr 174×79 (header⤵entry
      stacked, fan intact), arch-state-lr floor 408, arch-system-lr
      691 — targets below the floor warn, by policy. Possible refinements: mid-member
      externals E/W (side ports), stacking short branches, labels on
      chain edges.
- [x] Escape hatch: the CONSUMER links oversize diagrams out (user's
      call — a `viewerUrl` helper was built and dropped the same day).
      The pieces already public: the demo's `/render/` viewer takes
      the source deflate-raw+base64url in the URL, `toAnsi` emits
      OSC 8 hyperlinks for `Span.href`.
- [ ] LR-2 Flow packing: dispersal with a flow-extent objective
      (Σ band heights) — pack underfilled bands down to the path
      floor. Reuses packLayers/squeeze machinery with the transposed
      estimator. No-op for depth-dominated diagrams; wins on slack.

- [x] Stranded nodes + channel overlap (2026-09-01). (a) A node whose
      ports are all south now sinks to its band's floor (CompactionOutcome
      hung 93 rows above Idle at the top of a tall frame's band; now 11).
      Homing squeeze moves added for cross-band strandings (accepted at
      equal height — they strictly shorten wiring). (b) The channel
      router's greedy arc-set could silently break MANDATORY stub deps
      (an in-stub ran through another edge's out-stub column — the
      review's 'theoretical' case, live at arch-state@100): violated
      mandatory pairs now split a trunk through a free column and
      re-order; same-edge trunk pairs are exempt from the criticality
      rules (forced governs); forced entries are rewritten on split.
      Overlap lint: 0 same-column runs at 100/120/140/160.
- [x] Hub port pile-up (2026-09-01): tunePorts' fitting clamped every
      tail port of a crowded side onto `hi` — five edges shared one
      Idle cell and the router merged them into one drawn column (the
      overlap screenshot). Fixed: a side without room for full pitch
      keeps portCell's spread, and each tuned position is capped so the
      rest still fit. Widening now counts side populations (a reversed
      edge flips its port's side; edge-count undercounted hubs). Hub
      regression test through layout(). | | pitch confirmed: root
      edgeEdge=1 → pitch 2, Idle takes 11 distinct arrows.
- [x] The zigzag's true parent: compactRight shredding (2026-09-01).
      Instrumenting relaxChains proved chains come out DEAD STRAIGHT —
      compactRight then pushed row members left per-row with no notion
      of chains, re-zigzagging trunks in exactly the wide-box rows. Fix:
      relaxChains runs again after compaction (width-safe: bounded by
      current extent). Every metric jumped: session-er@100 96×137,
      arch-system@120 118×300 (jogs 7%), uncapped 199×243, arch-state
      @100 100×589 (was 621), @160 140×449. Longest-first chain
      processing kept (harmless, principled). Lab: nested frames now
      painted shallowest-first so the child receives pointer events.
- [x] Box stagger was the dither's parent (2026-09-01): NS placement
      weights 32/8/4 let trunks outweigh box chains 8:1 — node columns
      staggered under fans, each box row sliced the bundle corridor at
      a different x, and the bundles zigzagged in the shadow. Stiffened
      to 32/16/8 (ns) and 4/3/2 (ns2): arch-state@100 short jogs
      25%→8%, 99×693→100×621, box chains render as straight columns
      (region verified). pick pack-left fallback tried, no effect,
      reverted.
- [x] Routing dither CLOSED (2026-09-01): continuity targeting in
      relaxChains (middle chain groups hold the previous group's
      column; only the last group aims at the destination) — retried
      after exact-only tuning + ports-last-word changed the landscape,
      and this time the synchronized bundle zigzag is gone (tool-loop
      region verified visually; first attempt had failed against the
      old pass order). Cost ±few rows / +6 width in one config;
      aesthetics-first per user. Leftover micro-jogs are genuine fan
      approaches and order pinches (PA→● class) — width-aware ordering
      territory if ever needed.
- [x] Port tuning (2026-09-01): tunePorts slides free N/S ports to
      their partners' median columns (order/pitch kept, corners and
      fixed/self-loop ports excluded), second relax pass after. Border
      double-bends and node-hugging kinks gone; every corpus number
      improved or held (arch-state@100 →99×704, session-er@100 →96×152,
      arch-system@134 →121×316, uncapped arch-state →232×357).
- [x] Transitive compactRight (2026-09-01): a width-definer blocked by
      a slack-having neighbour now compresses the whole prefix (pushed
      only as far as needed). Firsts: arch-state@100 fits 99×726,
      session-er@100 96×155 (no squeeze needed), arch-system@134
      121×326, @150 146×286; uncapped arch-state 277×432 → 232×383.
      Minor metric ticks: arch-classes 314→318w, state-regions 45→46w
      (different candidates win; acceptable). Parked idea from review:
      squeeze layer *insertion* (shift a suffix down one layer to give
      chain-locked frames / stranded nodes a row) — revisit if fits
      stall again.
- [x] Squeeze move keys (2026-09-01): rejection bookkeeping was
      row-granular — a failed row evacuation poisoned that row's tall
      moves too. Keys are per-move now (`row:l` / `tall:v:t`), which
      unlocked chained sequences (evacuate a small frame, then its old
      band). session-er@130 → 127×126. arch-state@100: the two fattest
      frames are chain-locked (g1→g2 direct edge) — pairing them is
      structurally impossible; remaining tall pairings measured wider
      (182>166) and the width-first guard refuses, by policy.
- [x] compactRight jog fix (2026-09-01): partial tier slides broke
      port alignment with zero width gain — chains dithered ±1 column.
      Now gain-aware and whole-tier. Mixed odd/even node widths need no
      parity bump: port-column alignment absorbs them (isolated chain
      renders dead straight).
- [x] Width compaction + ladder descent (2026-09-01): compactRight in
      routing pulls extent-defining nodes left within row slack (frames
      stranded right of trunk fans — the user's screenshot case); the
      refine ladder descends geometrically (0.7×) past stalls. Firsts:
      arch-system@134 fits 130×388, @150 fits 143×336, session-er@130
      fits 130×127. arch-state@100 166×590. ~0.5-0.8s heavy cases.
- [x] Squeeze v3 for oversized targets (2026-09-01): tall-node moves
      (band height = tallest node; a tall frame moves beside another
      tall band, the source collapses to its shorter rest), finalists
      get squeezeLoose (admission = width already paid when the target
      is unreachable; guard still ratchets width down), all-MISS cases
      always run finalists, refine cap clamps at 4 instead of giving
      up. arch-state@100: 190×689 → 173×622 with frames pairing up;
      arch-system@134: 160×380 → 159×353; session-er@173: 154×108 →
      159×97. The inner-cap-from-target experiment was tried and
      reverted (squeeze packs towers better than pre-widened frames).
- [x] MAX_NODES 128 → 256 (2026-09-01): full arch-state is 149 nodes —
      every earlier arch-state number was a truncated prefix. Full:
      uncapped 277×422 (203ms), fast@120 ~17ms.
- [x] Stacked self-loops (2026-09-01): k loops per node render as
      nested wraps — band tops reserve loops-1 extra rows each side,
      k assigned east→west from port pos (eastmost exit = tightest
      wrap), stacked-loops warning gone. Regression test.
- [x] Lab URL state hardening (2026-09-01): router-aware replaceState
      (raw history.replaceState desyncs SvelteKit's router, which could
      restore its stale /lab and reset the source on a later
      navigation); the derived snapshot JSON is no longer persisted
      (generate() rebuilds it — arch-state URLs 12.5KB → ~2KB), corrupt
      hashes warn instead of silently overwriting. If a reset recurs,
      examples' fragment-hash writes are the same class of suspect.
- [x] Lab restore regenerates (2026-09-01): reload showed the persisted
      snapshot (stale picture, no phases) until [generate]; a restored
      mermaid source now re-runs the pipeline (JSON-only sessions keep
      their hand-authored text). URL round-trip itself verified fine.
- [x] Lab blank-screen fix (2026-09-01): init-time generate() wrote
      `fitted` before its `let` — a TDZ ReferenceError the SvelteKit
      router swallows into a silent blank page (long-lived HMR tabs
      masked it). Declaration hoisted; latent since the URL-state work.
- [x] Squeeze demand model (2026-08-31): room judged by measured band
      demand (nodes + crossing trunks × (1+edgeEdge)) instead of
      occupancy intervals — spread trunk columns fragmented every gap
      and under-admitted; finalist squeezeBudget 24. session-er@100
      100×161 (height parity, width at the wall); arch-state@120 now
      fits at 118×498 (was 157×533 MISS).
- [x] Lab UX (2026-08-31): [stream] replays the source chunk-wise
      through layoutFast (parse failures keep the last picture);
      candidate click = preview (settings untouched, fingerprint-stale
      on any edit), hover [use] adopts.
- [x] Two render modes (2026-08-31): `layoutFast` = one greedy+bk pass
      staggered toward the width, best-effort (may exceed), 1-20ms —
      for rendering while the source streams; `layoutBest` after it
      settles. Bridge: `traceEngineFast`; examples: `fast` checkbox.
      Tiny loop budgets now degrade (finalist slots clamped) instead of
      crashing.
- [x] Perf round 2 + strategy diversity (2026-08-31): BK and nsSolve
      hot paths on typed arrays (bit-identical output; NS placement
      64→35ms/layout on arch-system). Quality-ladder probes tried and
      rejected (cheap ordering redirects the cap ladder — measured
      quality loss). New strategies greedy2 (tail ties) and ns2 (flat
      weights), probe cells pruned to the 7 that ever win, budget 12→16:
      state-regions 58×55→45×59, arch-classes →314×85, arch-state
      uncapped →217×423 (width-first metric; flag if too tall). Times:
      session-er@100 254ms, arch-system@150 386ms, arch-state@120 209ms.
- [x] Perf round (2026-08-31): hand-rolled cloneGraph (~4× vs
      structuredClone, was 28-42% of loop time); squeeze probes get
      squeezeBudget 2 and only the top-2 candidates whose probe kept an
      iteration re-run with the full budget (+sq finalists, 2 reserved
      slots). session-er@100 522→334ms, arch-state@120 342→251ms, small
      diagrams 2-4× faster; arch-system flat (~0.55s, place/order-bound
      — quality-ladder probes are the next lever if needed). Quality
      identical across the corpus.
- [x] Search narrowing (2026-08-31): measured all 4 combos across the
      corpus — none globally dominated (dfs+ns sole-wins arch-system
      @134), so both dims stay; but only the top-2 uncapped probes get
      cap runs. session-er@173: MISS 186×98 → fits 154×108; ~25% faster.
- [x] Fit search refined (2026-08-31): full-budget cap bisection; a
      packWidth spend step was tried and removed (est error too
      nonlinear — cap52+pack63 rendered 135 where cap52 rendered 89).
      Session-er@100's frontier is genuinely 89×242: probes at caps
      58/64/76 render 113/150/121, all over target, and width is
      non-monotonic in the cap. Filling the last holes needs *geometry
      feedback*: re-layer using actual rendered per-row occupancy from a
      completed run (candidate-loop v2), not better estimates.
- [x] Packing v2 (2026-08-31): split and pack reason in estimated
      rendered row width (nodes + passing-edge columns), the pack
      primitive is whole-row dispersal, and the loop bisects up to the
      loosest fitting cap. session-er fit-100 actually fits now (89
      wide); scoring question stands: 89×242 beats a 108×150 near-miss
      only because the target is treated as hard.
- [x] Layer packing (2026-08-31): width-aware never-worse moves after
      layering (row merges, lone-node tucks, safe layer drops), bounded
      by the cap or the current widest row. Capped runs improved
      (arch-state fit-120: 155→133 wide; the ER loop −8 rows, the lone
      BRANCH_SUMMARY tucks in); uncapped corpus untouched. The user's
      range idea lives here: ASAP/ALAP slack is the range, finalized
      inside layering where widths are known — ranges through the whole
      pipeline rejected (ordering needs concrete layers).
- [x] Node slack relaxation (2026-08-31): routing's relax pass now also
      slides real nodes within their row slack toward the median of
      their partners' port columns — a slack row centres over its
      connections instead of sitting where packing left it (BK only
      scores width). Free win: arch-system 258→243, arch-state 239→230.
- [x] Port capacity (2026-08-31): nodes widen to a border cell per edge
      on their busiest side (post cycle breaking); coincident straights
      (the LR forward/return pair) now run on parallel cells. The router
      also refuses identical straights (free-column detour) as a fallback
      for fixed-port frames.
- [ ] Still to land: free ports off the title cells; shared edge columns
      (bundling).
- [ ] Switch-over: registry routes flowchart/state/class/ER through the
      engine, goldens regenerated, `layout.ts` shrinks to draw fns,
      `layout-elk.ts` deleted.

Decided: ports are first-class (every edge end is a port: node, side,
order, position; free ports only until a consumer needs constraints;
flow-aligned sides for normal edges, the perpendicular sides reserved for
self-loops); reversed edges stay on the flow sides too, so a down edge
and its return run side by side (no E/W special case).

Decided by the ELK dive (details in `docs/elk-layered.md` ch. 8): labels
post-hoc on the line (never label dummies); routing assigns layer
positions; BK picks the smallest of four layouts; no RNG. Compound
handling was re-decided afterwards as one global layout (see CODE.md),
replacing ch. 8's recursive hybrid. Still deferred: package split.

## Open questions

- Parked ideas with data: truncating sequence message text at `MAX_LABEL`,
  word-wrapping the source-box body.
- Decided: parsers stay internal (tests import module paths); no auto-flip /
  direction override to fit — width policy stays entirely with the caller.
