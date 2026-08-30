# ELK Layered — a code dive for the lovely-mermaid engine

**Provenance.** `eclipse/elk` commit `8aaa3c14` (2026-08-05), cached at
`~/.cache/checkouts/github.com/eclipse/elk` (refresh with the librarian
skill). elkjs 0.12 (what the demo runs) is a GWT transpilation of exactly
this Java; everything here applies to it, including the bugs. Written
2026-08-29 from seven parallel reads of the source — one per subsystem —
then assembled and cross-checked against the code where the reads
disagreed. Every claim carries a `File.java:line` reference into that
commit; when in doubt, open the file.

**Why this document exists.** We are writing our own layered layout
engine (see `PLAN.md`, "Layout engine"): TypeScript, synchronous, zero
dependencies, integer geometry in unit-agnostic units (terminal cells
first, px later), ports first-class, compound graphs planned. The
Sugiyama pipeline and the papers are known; what ELK adds is twenty
years of engineering decisions that papers never state — which hidden
steps exist, in what order, what the defaults really do, where the
half-open intervals and the `+1`s live, and what breaks. This is that
knowledge, kept in full so the implementation sessions can start from
it without re-reading Java.

**How to read it.** Chapters 1–7 follow the pipeline (architecture,
cycles + layering, crossing minimization + ports, node placement, edge
routing, compound graphs, options + sizing). Each chapter is
self-contained, ends with a "For our engine" section, and defines its
own path abbreviations (`L/` = the layered plugin's source root,
`C/` or `common/` = `org.eclipse.elk.alg.common`, `core/` =
`org.eclipse.elk.core`). Chapter 8 consolidates every "for our engine"
into one set of decisions and lists corrections to our earlier notes.
Read chapter 1 and 8 now; read the phase chapter just before
implementing that phase.

**Conventions to keep straight.** ELK lays out **left-to-right
internally**, always: layers are *columns*, the flow axis is **x**, the
in-layer (cross) axis is **y**, input ports are **WEST**, output ports
**EAST**, and "north/south ports" means "ports on the non-flow sides".
Any other direction is produced by transposing/mirroring the graph
before phase 1 and back after phase 5. Our engine will lay out
**top-to-bottom internally** (layers are rows), so while reading: ELK's
`y` is our column `x`, ELK's `x` is our row `y`, WEST/EAST are our N/S,
ELK's "north/south" are our E/W, "layer width" (`size.x`) is our band
*height*, and "vertical spacing / in-layer" is horizontal for us.

## Top findings

The facts most likely to change how we build, collected from all
chapters:

1. The five "phases" are five entries in one flat, deduplicated list of
   ~20 processors per graph, assembled by feature flags detected at
   import and ordered by one enum. ELK dumps a debug graph *before every
   slot* — the same shape as our lab's snapshots.
2. **Node placement sets only the cross-axis coordinate. The edge router
   assigns the flow-axis positions of layers**, because only it knows
   how many routing slots each channel needs. Channel width =
   `max(nodeNodeBetweenLayers, 2·edgeNode + (slots−1)·edgeEdge)`.
3. Every edge end is a port, even in a port-less input (one synthesized
   port per edge end). All dummies — long-edge, label, external-port,
   north/south-port — are real nodes with real ports and `FIXED_POS`.
   Port order (one clockwise list per node) is the primitive crossing
   minimization actually optimizes; node order is derived from it.
4. FREE ports get their side by net flow **after** cycle breaking, so
   reversed edges never produce inverted ports; the "feedback loop"
   look is nothing but running that one processor before phase 1.
5. Reversed edge = endpoints swapped + a toggled flag; phases 2–5 never
   know; the restorer re-swaps and reverses the bend list at the end.
   Direction is handled the same way: transform in, run LTR, transform out.
6. Network simplex layering is capped at `4·thoroughness·√n` pivots (28√n
   by default) — ELK routinely stops before optimality. It strips
   degree-1 subtrees first for n ≥ 40 and re-attaches them exactly.
7. ELK's default Brandes–Köpf **does not balance** the four layouts: with
   orthogonal routing `favorStraightEdges` is on, and BK picks the
   smallest-extent layout (ties → RIGHTDOWN). Its compactor resolves
   class shifts through a small class graph, which sidesteps the
   Brandes–Walter–Zink erratum bugs by construction. Type-2 conflicts are
   never marked.
8. The orthogonal router's unit is the **trunk** = connected component of
   ports over all edges in a channel; dependencies cost crossings ×16,
   "too close" ×1, overlaps are critical; Eades–Lin–Smyth greedy FAS on
   the dependency graph; critical cycles are resolved by *splitting* a
   trunk into two joined by a horizontal jog; slots by longest path.
9. Center edge labels become **nodes in the layering** (an extra layer
   between the endpoints, layer width ≥ label width) — that is precisely
   the inflation we measured when we handed labels to ELK.
10. ELK never lays out a compound graph globally: each level is its own
    graph and processor list; cross-hierarchy edges are cut into per-level
    segments ending at zero-size external-port dummies pinned into hidden
    first/last layers; lists are interleaved bottom-up around the single
    hierarchy-aware processor (crossing minimization), which by default
    degrades to "child orders its exits, parent obeys".
11. Export writes **one** `ElkEdgeSection` per edge, in the coordinates of
    the edge's ELK container (the LCA). Our note about "one section per
    level" is wrong (the exporter does not do that).
12. The elkjs crash we hit (model-order cycle breaking on a compound with a
    cycle) is ELK commit `80b3a2de`: two internal properties are set on the
    root graph only, and the model-order breakers unbox `null` on nested
    graphs. Per-subgraph `elk.direction` is silently overwritten by the
    root's under `INCLUDE_CHILDREN`.
13. Spacing option names refer to the **layer role**, not the screen axis:
    with DOWN, `nodeNode` is horizontal and `nodeNodeBetweenLayers`
    vertical; with RIGHT it flips. The demo's fixed 1:2 cell spacings are
    only aspect-correct for DOWN/UP.
14. `randomSeed` defaults to 1 for layered (`Layered.melk:124`) — layouts
    are deterministic unless `0` is passed. Randomness is used for the
    greedy cycle breaker's ties, crossing-minimization restarts (first
    sweep direction, ±0.035 barycenter jitter, a coin flip choosing the
    port distributor), routing-dependency cycle ties and self-loop slots.
15. `nodeSize.constraints` defaults to empty (fixed size) and
    `nodeLabels.placement` to empty (labels ignored by sizing entirely);
    layered overrides `portAlignment` to JUSTIFIED and crams ports with a
    negative pitch rather than growing the node when space is short.

## Contents

1. Architecture and pipeline
2. Phase 1–2: cycle breaking, layering, dummies, constraints, wrapping
3. Phase 3: crossing minimization and the port model
4. Phase 4: node placement and compaction
5. Phase 5: edge routing, self-loops, edge labels
6. Compound graphs
7. Options, node sizing, port placement, spacing
8. What we take: decisions for the lovely-mermaid engine

---

## 1. Architecture and pipeline

Source: `plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/` (= `L/`),
commit 8aaa3c14. Core assembler: `plugins/org.eclipse.elk.core/src/org/eclipse/elk/core/alg/`.

### 1. Control flow

#### 1.1 Entry point

`L/LayeredLayoutProvider.java:48-66` `layout(ElkNode, monitor)`:

1. `new ElkGraphTransformer().importGraph(elkgraph)` → `LGraph` (§5).
2. `HIERARCHY_HANDLING == INCLUDE_CHILDREN` → `ElkLayered.doCompoundLayout`, else `doLayout`.
3. `graphTransformer.applyLayout(lgraph)` writes coordinates back (§6).

Outside the plugin, `org.eclipse.elk.core.RecursiveGraphLayoutEngine.layoutRecursively`
(`RecursiveGraphLayoutEngine.java:132-230`) decides what a "layout run" is. Default
(`SEPARATE_CHILDREN`; `INHERIT` resolves to parent's value, root `INHERIT` → `SEPARATE_CHILDREN`,
`:512-527`): each compound node is laid out first (post-order, bottom-up), gets its size set,
and the parent run then sees it as an opaque fixed-size node. Cross-hierarchy edges are not
routable in that mode (importer throws `UnsupportedGraphException` when an edge end is missing,
`L/graph/transform/ElkGraphImporter.java:1129`). `INCLUDE_CHILDREN` hands the whole subtree to
one ELK Layered run.

#### 1.2 Flat run: `ElkLayered.doLayout` (`L/ElkLayered.java:135-166`)

1. `graphConfigurator.prepareGraphForLayout(lgraph)` — normalise options, build processor list (§2).
2. `componentsProcessor.split(lgraph)` → `List<LGraph>` (§7).
3. `layout(component, monitor)` for each component (`:576-640`):
   - log "Slot NN: class" for each processor when logging is enabled;
   - for each processor: optional `DebugUtil.logDebugGraph(monitor, g, slotIndex, "Before X")`,
     then `processor.process(g, subMonitor)`;
   - after the last one: log "Finished", then **flatten**: move all nodes from `layers` back into
     `layerlessNodes`, `node.setLayer(null)`, `layers.clear()`. The finished `LGraph` is layerless.
4. `componentsProcessor.combine(components, lgraph)` — pack, move nodes into the original graph.
5. `resizeGraph(lgraph)` (`:675-770`): apply `NODE_SIZE_MINIMUM` (+ `DEFAULT_MINIMUM_SIZE` 20x20),
   `CONTENT_ALIGNMENT` shifts `graph.offset`, east/south external-port dummies are pushed to
   the new border; `graph.size = new - padding`. Skipped when `NODE_SIZE_FIXED_GRAPH_SIZE`.

#### 1.3 Compound run: `doCompoundLayout` (`:179-199`) and `hierarchicalLayout` (`:214-298`)

1. `CompoundGraphPreprocessor` splits every cross-hierarchy edge into per-level segments,
   creating external-port dummies on every nested graph (`L/compound/`; another section).
2. `hierarchicalLayout`:
   1. `collectAllGraphsBottomUp` — BFS over `node.getNestedGraph()`, pushed on a deque so the
      resulting list is deepest-first, root last (`:308-325`).
   2. `reviewAndCorrectHierarchicalProcessors` (`:336-354`): every nested graph must use the same
      `CROSSING_MINIMIZATION_STRATEGY` as the root (else `UnsupportedGraphException`); the root's
      `GREEDY_SWITCH_HIERARCHICAL_TYPE` is copied to all children.
   3. Each graph gets its **own** processor list (`prepareGraphForLayout(g)` per graph — the list
      depends on that graph's `GRAPH_PROPERTIES`). Lists are held as iterators.
   4. Interleaved execution loop (`:238-288`): while the root's iterator has items, walk graphs
      deepest→root; run each graph's processors until hitting one that
      `instanceof IHierarchyAwareLayoutProcessor`. If the graph is the root, run that processor
      (it works on the whole hierarchy) and restart from the deepest graph; if it is not the root,
      skip it (do **not** consume it) and move to the next graph. Net effect: everything before the
      hierarchy-aware processor runs bottom-up for all levels, then the hierarchy-aware processor
      runs once on the root, then everything after it runs bottom-up again.
   5. Only one hierarchy-aware processor exists: `LayerSweepCrossingMinimizer` (`L/p3order/`).
      So the sequence is: [cycle breaking, layering, pre-P3 processors] per level bottom-up →
      one hierarchical crossing minimisation → [pre-P4 …, node placement, routing, post] per level
      bottom-up. `HIERARCHICAL_NODE_RESIZER` (after P5) sizes the parent node from the child graph
      before the parent level runs its node placement, which is why bottom-up ordering matters.
3. `CompoundGraphPostprocessor` re-joins the edge segments.

**No connected-components processing in compound mode** (comment at `:173`).

#### 1.4 White-box stepping (relevant to a phase-snapshot lab)

`prepareLayoutTest`, `runLayoutTestStep`, `runLayoutTestUntil(Class, inclusive, state)`
(`:407-527`): configure + split, then execute processor `state.step` on every component. Debug
graphs are dumped *before* each slot with `slotIndex` = position in the processor list, and once
after the last. The processor list is a plain `List<ILayoutProcessor<LGraph>>` on
`InternalProperties.PROCESSORS`, so "run until processor X" is just an index scan.

### 2. Algorithm assembly

#### 2.1 Phases and slots

`L/LayeredPhases.java`: `P1_CYCLE_BREAKING, P2_LAYERING, P3_NODE_ORDERING, P4_NODE_PLACEMENT,
P5_EDGE_ROUTING` (comments: P4 = y coordinates, P5 = routing **and x coordinates**).

`core/alg/LayoutProcessorConfiguration.java`: list of 6 `Set<factory>` indexed
`before(P) = P.ordinal()`, `after(P) = P.ordinal()+1`; so `after(P4) == before(P5)`. Slots are
sets → duplicates requested by several sources collapse to one instance.

`core/alg/AlgorithmAssembler.build(graph)` (`:265-310`):

1. instantiate the 5 configured phase factories (cached);
2. union `phase.getLayoutProcessorConfiguration(graph)` for each phase + the assembler's
   `additionalProcessors` (from `GraphConfigurator`);
3. for each phase in order: emit `processorsBefore(phase)` **sorted by enum ordinal**
   (`EnumBasedFactoryComparator`), then the phase; finally `processorsAfter(P5)`.

Consequences: the order of processors inside one slot is exactly the declaration order in
`L/intermediate/IntermediateProcessorStrategy.java` (the enum comment says so: "listed by the
earliest slot … order determined by dependencies"). Processor instances are cached per
`GraphConfigurator` (`withCaching(true)`), one instance per enum constant, reused across runs
and across components — processors keep no state between `process()` calls.

#### 2.2 `GraphConfigurator.prepareGraphForLayout` (`L/GraphConfigurator.java:165-186`)

`configureGraphProperties` (`:99-136`):
- `SPACING_EDGE_EDGE` clamped to ≥ 2.0;
- `DIRECTION == UNDEFINED` → `LGraphUtil.getDirection`: `ASPECT_RATIO >= 1` → RIGHT else DOWN
  (`L/graph/LGraphUtil.java:1134-1146`; default aspect ratio 1.6 → RIGHT);
- `InternalProperties.RANDOM` = `new Random(seed)`; the layered default is `randomSeed = 1` (`Layered.melk:124`), an explicit 0 → unseeded `new Random()`;
- `NODE_PLACEMENT_FAVOR_STRAIGHT_EDGES` defaults to `EDGE_ROUTING == ORTHOGONAL`;
- `ORIGINAL_PORT_CONSTRAINTS` copied onto every node (recursively) — later processors upgrade
  `PORT_CONSTRAINTS` in place: FREE→FIXED_SIDE (`PortSideProcessor.java:90`), →FIXED_ORDER
  (`p3order/LayerSweepCrossingMinimizer.java:168`, `SweepCopy.java:122`); all dummies are
  created FIXED_POS;
- `InternalProperties.SPACINGS = new Spacings(graph)`: a NodeType×NodeType lookup of which
  spacing option applies between two node kinds (`L/options/Spacings.java:60-120`), e.g.
  NORMAL–LONG_EDGE → `SPACING_EDGE_NODE`, LONG_EDGE–LONG_EDGE → `SPACING_EDGE_EDGE`,
  NORMAL–LABEL → `SPACING_NODE_NODE`.

Phase selection: `CYCLE_BREAKING_STRATEGY` (default GREEDY), `LAYERING_STRATEGY`
(NETWORK_SIMPLEX), `CROSSING_MINIMIZATION_STRATEGY` (LAYER_SWEEP), `NODE_PLACEMENT_STRATEGY`
(BRANDES_KOEPF), `EdgeRouterFactory.factoryFor(EDGE_ROUTING)` (ORTHOGONAL; POLYLINE, SPLINES;
anything else → orthogonal).

Phase-independent additions (`:195-342`) — see trigger column of the table.

### 3. Intermediate processors — complete table

Slot = where it is actually requested (javadoc slot noted where it differs). "always" = part of
every default configuration. Enum order within a slot is execution order. Sources:
`L/GraphConfigurator.java` (GC), phase classes `L/p1cycles/*`, `L/p2layers/*`, `L/p3order/*`,
`L/p4nodes/*`, `L/p5edges/OrthogonalEdgeRouter.java:117-215`, `PolylineEdgeRouter.java:118-180`,
`splines/SplineEdgeRouter.java:88-152`.

#### Before P1 (cycle breaking)

| Processor | Trigger | Purpose |
|---|---|---|
| DIRECTION_PREPROCESSOR | GC: direction ∈ {LEFT, DOWN, UP} | `GraphTransformer` — rotate/mirror the imported graph so all phases work left-to-right (§8). |
| COMMENT_PREPROCESSOR | GC: `COMMENTS` | Detach comment boxes with exactly one edge to a normal node; stored in `TOP_COMMENTS`/`BOTTOM_COMMENTS` of that node. |
| EDGE_AND_LAYER_CONSTRAINT_EDGE_REVERSER | all layerers except InteractiveLayerer (→ always) | Nodes with `LAYERING_LAYER_CONSTRAINT` FIRST/LAST or `EDGE_CONSTRAINT` get only outgoing / only incoming edges (reverses the rest) so layering can honour the constraint. |
| INTERACTIVE_EXTERNAL_PORT_POSITIONER | InteractiveCycleBreaker or InteractiveLayerer | Gives external-port dummies coordinates from the original port positions for interactive modes. |
| PARTITION_PREPROCESSOR | GC: `PARTITIONS` (`PARTITIONING_ACTIVATE`) | Reverse edges going from higher to lower partition index. |
| SELF_LOOP_PREPROCESSOR | all routers: `SELF_LOOPS` (javadoc says "before P2") | Build `SELF_LOOP_HOLDER` per node, hide self-loop edges/ports from the graph so P1–P3 never see them. |
| PORT_SIDE_PROCESSOR | GC: `FEEDBACK_EDGES == true` (else before P3) | Ports with FREE constraints get a side: inputs WEST, outputs EAST. Running it here (before reversal) makes reversed edges attach to "wrong" sides → inverted ports → routed around the node (feedback look). |

#### Before P2 (layering)

| Processor | Trigger | Purpose |
|---|---|---|
| LABEL_DUMMY_INSERTER | routers: `CENTER_LABELS` | Split each edge with a center label at one `LABEL` dummy node whose size = label size (reserves space in a layer). |
| LAYER_CONSTRAINT_PREPROCESSOR | all layerers (→ always) | Hide `FIRST_SEPARATE`/`LAST_SEPARATE` nodes (external port dummies mostly) so they don't affect layering; edges parked via `HIDDEN_NODES`, `ORIGINAL_OPPOSITE_PORT`. |
| PARTITION_MIDPROCESSOR | GC: `PARTITIONS` | Add constraint edges between partitions so layering keeps partition i left of i+1. |

#### Before P3 (crossing minimisation)

| Processor | Trigger | Purpose |
|---|---|---|
| HIGH_DEGREE_NODE_LAYER_PROCESSOR | GC: `HIGH_DEGREE_NODES_TREATMENT` | Move trees hanging off very-high-degree nodes into their own layers (javadoc "after P2"). |
| NODE_PROMOTION | GC: `LAYERING_NODE_PROMOTION_STRATEGY != NONE` (default NONE) | Nikolov/Tarassov node promotion: move nodes up a layer when it removes dummies. |
| LAYER_CONSTRAINT_POSTPROCESSOR | all layerers (→ always) | Re-insert hidden nodes into new first/last layers; move FIRST/LAST nodes to the first/last layer. |
| PARTITION_POSTPROCESSOR | GC: `PARTITIONS` | Remove the constraint edges. |
| HIERARCHICAL_PORT_CONSTRAINT_PROCESSOR | orthogonal router: `EXTERNAL_PORTS` | For fixed-order external ports: in-layer successor constraints so N/S external-port dummies keep their order. |
| SEMI_INTERACTIVE_CROSSMIN_PROCESSOR | GC: `CROSSING_MINIMIZATION_SEMI_INTERACTIVE` | In-layer successor constraints between regular nodes from their `POSITION`. |
| BREAKING_POINT_INSERTER | GC: `WRAPPING_STRATEGY == MULTI_EDGE` | Cut long layerings into rows via `BREAKING_POINT` dummies (javadoc "after P2"). |
| LONG_EDGE_SPLITTER | all crossing minimisers (→ always) | Proper layering: one `LONG_EDGE` dummy per skipped layer, each with a WEST in-port and EAST out-port; `LONG_EDGE_SOURCE/TARGET` remember the original ends; dummy `ORIGIN` = the edge. **Original edge stays as the first segment**; new `LEdge`s for the rest. |
| PORT_SIDE_PROCESSOR | GC: default (`FEEDBACK_EDGES == false`) | As above, but after edges were reversed → no inverted ports arise from cycle breaking. |
| INVERTED_PORT_PROCESSOR | orthogonal: `HYPEREDGES` or `NON_FREE_PORTS` or `FEEDBACK_EDGES`; polyline, splines: always | Edge enters a node from the wrong side (west edge into an east port): insert a `LONG_EDGE` dummy **in the same layer** and an in-layer edge dummy→port. Layering stops being proper; P3–P5 must handle in-layer edges. |
| PORT_LIST_SORTER | LayerSweep, NoCrossing: always; Interactive: `NON_FREE_PORTS` | Sort `node.ports` clockwise from top-left N, E, S, W using `PORT_INDEX`, positions, or `PORT_SORTING_STRATEGY`; then `node.cachePortSides()`. Only for `FIXED_ORDER`/`FIXED_POS`(/`FIXED_SIDE` by side). |
| SORT_BY_INPUT_ORDER_OF_MODEL | GC: `CONSIDER_MODEL_ORDER_STRATEGY != NONE` (default NONE) | Sort nodes in each layer and ports by `MODEL_ORDER` before crossing minimisation starts. |
| NORTH_SOUTH_PORT_PREPROCESSOR | orthogonal: `NORTH_SOUTH_PORTS` and (`NON_FREE_PORTS` or `FEEDBACK_EDGES`); polyline/splines: `NORTH_SOUTH_PORTS` | For each N/S port create `NORTH_SOUTH_PORT` dummies in the **same layer** above/below the node; edges rerouted to them; `IN_LAYER_LAYOUT_UNIT` = the node so they stay adjacent; successor constraints keep N dummies above and S below. |

#### Before P4 (node placement)

| Processor | Trigger | Purpose |
|---|---|---|
| BREAKING_POINT_PROCESSOR | MULTI_EDGE wrapping | Perform the wrap after crossing minimisation (javadoc "after P3"). |
| ONE_SIDED_GREEDY_SWITCH / TWO_SIDED_GREEDY_SWITCH | GC `activateGreedySwitchFor` (`:362-387`): not interactive, type ≠ OFF (default TWO_SIDED), and `activationThreshold` (default 40) == 0 or > node count; hierarchical: root's `GREEDY_SWITCH_HIERARCHICAL_TYPE` ≠ OFF (default OFF) | A second `LayerSweepCrossingMinimizer` instance in greedy-switch mode, post-optimising the barycenter result. |
| SELF_LOOP_PORT_RESTORER | `SELF_LOOPS` | Put self-loop ports back on the node, compute loop types. |
| ALTERNATING_LAYER_UNZIPPER | GC: `LAYER_UNZIPPING_STRATEGY == ALTERNATING` | Split a layer into sub-layers, alternating, for compactness. |
| SINGLE_EDGE_GRAPH_WRAPPER | GC: `WRAPPING_STRATEGY == SINGLE_EDGE` | Path-like graphs wrapped into rows. |
| IN_LAYER_CONSTRAINT_PROCESSOR | all crossing minimisers (→ always) | Enforce `IN_LAYER_CONSTRAINT` TOP/BOTTOM (external N/S port dummies) after P3. |
| END_NODE_PORT_LABEL_MANAGEMENT_PROCESSOR | `LABEL_MANAGER` set | Call the label manager (shorten/wrap) on node, port, end labels. |
| LABEL_AND_NODE_SIZE_PROCESSOR | always (baseline) | Via `alg.common` `NodeDimensionCalculation` through `LGraphAdapters`: place ports, place node & port labels, compute node sizes per `NODE_SIZE_CONSTRAINTS`. Precondition: ports ≥ FIXED_ORDER and sorted. |
| INNERMOST_NODE_MARGIN_CALCULATOR | always | `node.margin` = bounding box of ports + port labels (+ node labels outside). Later extended by SELF_LOOP_ROUTER, COMMENT_NODE_MARGIN_CALCULATOR, END_LABEL_PREPROCESSOR. |
| SELF_LOOP_ROUTER | `SELF_LOOPS` | Bend points for self loops relative to the node; extends margin. |
| COMMENT_NODE_MARGIN_CALCULATOR | `COMMENTS` | Extend margins for attached comments. |
| END_LABEL_PREPROCESSOR | `END_LABELS` | Build `END_LABELS` label cells per port, extend margins. |
| LABEL_DUMMY_SWITCHER | `CENTER_LABELS` | Swap the label dummy with a long-edge dummy of the same edge so the label sits in the "best" (widest/middle) layer. |
| CENTER_LABEL_MANAGEMENT_PROCESSOR | `LABEL_MANAGER` set | Label manager on center labels. |
| LABEL_SIDE_SELECTOR | `CENTER_LABELS` or `END_LABELS` | Decide above/below per `EDGE_LABELS_SIDE_SELECTION` (default SMART_DOWN); sets `LABEL_SIDE`. |
| HYPEREDGE_DUMMY_MERGER | orthogonal: `HYPEREDGES` | Merge long-edge dummies of edges leaving the same port / entering the same port in the same layer → shared segments. |
| HIERARCHICAL_PORT_DUMMY_SIZE_PROCESSOR | orthogonal: `EXTERNAL_PORTS` | Width of external port dummies; N/S dummies get CENTER alignment. |

#### Before P5 (edge routing) = after P4

| Processor | Trigger | Purpose |
|---|---|---|
| NODE_PLACEMENT_REPEATER | GC: a node has `NodeFlexibility` and graph has `…NODE_FLEXIBILITY_RECOMPUTE_NODE_PLACEMENT` | Fix sizes from network-simplex flexibility, rerun placement. |
| LAYER_SIZE_AND_GRAPH_HEIGHT_CALCULATOR | always | `layer.size.x` = max(node width + margins), `layer.size.y` = extent; `graph.size.y = maxY-minY`; **`graph.offset.y -= minY`** (so negative y from placement is absorbed into the offset, not by moving nodes). Width unknown until routing. |
| HIERARCHICAL_PORT_POSITION_PROCESSOR | all node placers: `EXTERNAL_PORTS` | Final y of E/W external-port dummies (FIXED_POS / ratio). |
| NORTH_SOUTH_PORT_POSTPROCESSOR (splines only) | splines: `NORTH_SOUTH_PORTS` | Spline router wants N/S dummies gone *before* routing; orthogonal/polyline remove them after. |

#### After P5

| Processor | Trigger | Purpose |
|---|---|---|
| CONSTRAINTS_POSTPROCESSOR | GC: `INTERACTIVE_LAYOUT` or `GENERATE_POSITION_AND_LAYER_IDS` | Write `LAYERING_LAYER_ID` / `CROSSING_MINIMIZATION_POSITION_ID` on nodes (exported to ElkNode). |
| COMMENT_POSTPROCESSOR | `COMMENTS` | Re-insert comments above/below their node. |
| HYPERNODE_PROCESSOR | orthogonal: `HYPERNODES` | Move hypernodes onto the junction of their edges. |
| HIERARCHICAL_PORT_ORTHOGONAL_EDGE_ROUTER | orthogonal: `EXTERNAL_PORTS` | Restore N/S external dummies, route their edges orthogonally, fix graph size. Same-slot dependency of LONG_EDGE_JOINER. |
| LONG_EDGE_JOINER | all crossing minimisers (→ always) | Remove `LONG_EDGE` dummies: the incoming edge survives, takes the outgoing edge's target (inserted at the same index in the target port's incoming list, KIPRA-1670), bend points, labels, junction points appended; optional extra bend at the dummy when `UNNECESSARY_BENDPOINTS`. Dummies removed from layers but their `layer` field is left non-null. |
| SELF_LOOP_POSTPROCESSOR | `SELF_LOOPS` | Restore self-loop edges, translate their bends by node position. |
| BREAKING_POINT_REMOVER | MULTI_EDGE wrapping | Remove breaking-point dummies, splice routes. |
| NORTH_SOUTH_PORT_POSTPROCESSOR | orthogonal, polyline: `NORTH_SOUTH_PORTS` | Remove N/S dummies; produce the vertical segment from the port to the dummy's horizontal channel as bend points. |
| HORIZONTAL_COMPACTOR | GC: `COMPACTION_POST_COMPACTION_STRATEGY != NONE` (default NONE) and routing ≠ POLYLINE | Scanline/network-simplex compaction of nodes + vertical edge segments in x. |
| LABEL_DUMMY_REMOVER | `CENTER_LABELS` | Remove label dummies; label position = dummy position (+ side). |
| FINAL_SPLINE_BENDPOINTS_CALCULATOR | splines | Turn spline segments into control points. |
| END_LABEL_SORTER | always (baseline) | Order multiple end labels at a port by the order of the nodes they lead to. |
| REVERSED_EDGE_RESTORER | all cycle breakers (→ always) | `edge.reverse()` again for `REVERSED` edges (swaps source/target, reverses bend chain, swaps HEAD/TAIL labels). |
| END_LABEL_POSTPROCESSOR | `END_LABELS` | Final coordinates for end-label cells. |
| HIERARCHICAL_NODE_RESIZER | GC: `INCLUDE_CHILDREN` | Set the parent `LNode`'s size (and its ports) from the finished nested graph; "must be the last non-hierarchical processor". |
| DIRECTION_POSTPROCESSOR | GC: direction ∈ {LEFT, DOWN, UP} | Inverse transform (§8). |

Not in the enum but in `L/intermediate/`: `DummySelfLoopProcessor` (legacy self-loop handling,
unused by the current configuration), helper packages `compaction/`, `greedyswitch/`, `loops/`,
`preserveorder/`, `unzipping/`, `wrapping/`.

Default configuration for a plain graph (RIGHT, orthogonal, no ports/labels/self-loops, < 40
nodes): `EDGE_AND_LAYER_CONSTRAINT_EDGE_REVERSER, GreedyCycleBreaker, LAYER_CONSTRAINT_PREPROCESSOR,
NetworkSimplexLayerer, LAYER_CONSTRAINT_POSTPROCESSOR, LONG_EDGE_SPLITTER, PORT_SIDE_PROCESSOR,
PORT_LIST_SORTER, LayerSweepCrossingMinimizer, TWO_SIDED_GREEDY_SWITCH, IN_LAYER_CONSTRAINT_PROCESSOR,
LABEL_AND_NODE_SIZE_PROCESSOR, INNERMOST_NODE_MARGIN_CALCULATOR, BKNodePlacer,
LAYER_SIZE_AND_GRAPH_HEIGHT_CALCULATOR, OrthogonalEdgeRouter, LONG_EDGE_JOINER, END_LABEL_SORTER,
REVERSED_EDGE_RESTORER`. Twenty steps; the five "phases" are five of them.

### 4. Data model (`L/graph/`)

All elements extend `MapPropertyHolder` (a `Map<IProperty, Object>` bag) via `LGraphElement`,
which adds a public scratch `int id` (`L/graph/LGraphElement.java`) — used as visited-mark,
index, priority… by many processors; never assume it is stable across processors. Geometry is
`KVector` doubles.

```ts
type NodeType = 'NORMAL' | 'LONG_EDGE' | 'EXTERNAL_PORT' | 'NORTH_SOUTH_PORT' | 'LABEL'
              | 'BREAKING_POINT' | 'PLACEHOLDER' | 'NONSHIFTING_PLACEHOLDER';
// NORMAL: from an input node.  LONG_EDGE: one per skipped layer (and inverted-port dummies).
// EXTERNAL_PORT: a port of the graph node itself (size 0, one LPort, FIXED_POS,
//   E/W ones get LayerConstraint FIRST_SEPARATE/LAST_SEPARATE, N/S ones InLayerConstraint TOP/BOTTOM,
//   EDGE_CONSTRAINT INCOMING_ONLY/OUTGOING_ONLY, EXT_PORT_SIDE, EXT_PORT_SIZE, PORT_RATIO_OR_POSITION).
// NORTH_SOUTH_PORT: same-layer dummy that hosts the horizontal channel of an N/S port edge.
// LABEL: one per center-labelled edge, sized like the label(s) (REPRESENTED_LABELS).
// BREAKING_POINT / PLACEHOLDER*: wrapping and unzipping only.

interface LGraph  { size: KVector; padding: LPadding; offset: KVector;
                    layerlessNodes: LNode[]; layers: Layer[]; parentNode: LNode | null }
interface Layer   { owner: LGraph; size: KVector; nodes: LNode[] }   // index = position in graph.layers
interface LShape  { pos: KVector; size: KVector }                     // LNode, LPort, LLabel
interface LNode   extends LShape { graph: LGraph; layer: Layer|null; type: NodeType;
                    ports: LPort[]; labels: LLabel[]; nestedGraph: LGraph|null;
                    margin: LMargin; padding: LPadding }
interface LPort   extends LShape { node: LNode; side: 'N'|'E'|'S'|'W'|'UNDEFINED';
                    anchor: KVector; explicitAnchor: boolean; margin: LMargin; labels: LLabel[];
                    incoming: LEdge[]; outgoing: LEdge[]; connectedToExternalNodes: boolean }
interface LEdge   { source: LPort; target: LPort; bendPoints: KVector[]; labels: LLabel[] }
interface LLabel  extends LShape { text: string }
```

Notes:
- `LNode.setLayer(layer)` / `setLayer(index, layer)` maintain `layer.nodes` (remove from old,
  append/insert into new). `getIndex()` is `indexOf` — O(n), hence the scratch `id`.
- **Every edge has ports.** Port-less input edges get generated ports (§5).
- `LNode.ports` order is arbitrary until `PORT_LIST_SORTER`; afterwards clockwise from north-west:
  N left→right, E top→bottom, S right→left, W bottom→top (`LNode.java:218-235`).
  `getPortSideView(side)` is a sublist view; `cachePortSides()` freezes side ranges.
- `LPort.side` setter re-centres `anchor` on that side unless `explicitlySuppliedPortAnchor`
  (`LPort.java:setSide`). `getAbsoluteAnchor() = node.pos + port.pos + anchor`.
- `LEdge.reverse(graph, adaptPorts)` (`LEdge.java:reverse`): swap ends, toggle `REVERSED`,
  reverse the bend chain, swap HEAD↔TAIL label placement; with `adaptPorts`, collector ports
  (`INPUT_COLLECT`/`OUTPUT_COLLECT`) are replaced by the opposite collector.
- `LEdge.isInLayerEdge()` = both ends in the same layer and not a self loop.
- `LMargin`/`LPadding` = `ElkMargin`/`ElkPadding` (top/right/bottom/left doubles). Margin is the
  reserved outside area (ports, labels, self loops); padding is the inside area (for graphs: from
  the `PADDING` option + inside node-label padding).
- `LGraph.getActualSize() = size + padding`. `parentNode` non-null only for nested graphs.
- `LGraphUtil.java` (1163 lines) holds the shared helpers: `createPort`, `initializePort`,
  `provideCollectorPort`, `createExternalPortDummy`, `getExternalPortPosition`,
  `placeNodesHorizontally`, `changeCoordSystem`, `isDescendant`, `getDirection`,
  `computeGraphProperties`.

#### 4.1 Coordinate system inside the algorithm

- Node `pos` is the top-left corner in the graph's content coordinates, i.e. relative to
  (padding.left + offset.x, padding.top + offset.y) of the graph node. Nothing forces non-negative
  coordinates during P4; `LAYER_SIZE_AND_GRAPH_HEIGHT_CALCULATOR` and the exporter fold the min
  into `graph.offset`.
- P4 writes `node.pos.y` only. P5 writes `node.pos.x`: `OrthogonalEdgeRouter.process`
  (`L/p5edges/OrthogonalEdgeRouter.java:225-330`) walks layers left→right, calls
  `LGraphUtil.placeNodesHorizontally(layer, xpos)` (nodes aligned inside the layer's width by
  `ALIGNMENT` or by out/(in+out) port ratio, clamped by margins, `LGraphUtil.java:223-306`),
  then reserves `routingWidth = (slots-1)*edgeEdgeSpacing + edgeNodeSpacing*2`, at least
  `nodeNodeBetweenLayers` (20) between two node layers, `nodeNodeBetweenLayers` when no bends
  are needed; sets `graph.size.x`. So **layer x positions are a by-product of edge routing**.
- Port `pos` relative to node top-left; port labels relative to port; node labels relative to
  node; edge bend points and edge labels in graph coordinates (same as node `pos`).
- Junction points (`LayeredOptions.JUNCTION_POINTS`, a `KVectorChain` on the edge) are created
  by the orthogonal router when a bend point of one edge lies strictly inside, or at the matching
  end of, another edge's vertical segment of the same hyperedge
  (`L/p5edges/orthogonal/direction/BaseRoutingDirectionStrategy.java:95-135`); polyline creates
  them at the bend point where several edges of one port fan out
  (`PolylineEdgeRouter.java:465-485`). They are transformed/offset alongside bend points everywhere.

### 5. Import: `L/graph/transform/ElkGraphImporter.java`

`importGraph(elkgraph)` (`:96-141`):

1. `createLGraph(elkgraph)` (`:592-629`): copy all properties, resolve direction, remember
   `ORIGIN`, `GRAPH_PROPERTIES = ∅`, `padding = PADDING + computeInsideNodeLabelPadding(...)`
   (space for inside node labels of the graph node itself).
2. `ensureDefinedPortSide` for the graph's own ports (`:146-175`): side from `PORT_SIDE`, else
   inferred from position (`ElkUtil.calcPortSide`), else from net flow and direction.
3. `checkExternalPorts` (`:655-708`): `EXTERNAL_PORTS` iff some graph port has an edge to a child
   (or an inside self loop) or has an inside-placed label; `HYPEREDGES` if a port has >1 such
   edges. Then `transformExternalPort` (`:720-810`): one `EXTERNAL_PORT` dummy per port via
   `LGraphUtil.createExternalPortDummy`; `PORT_BORDER_OFFSET` inferred from position (0 if the
   port is at (0,0)); port labels copied, but shrunk to width/height 0 when placed outside.
4. Optional minimum graph size from label/port needs (`NODE_SIZE_CONSTRAINTS` non-empty, nested
   graphs only). `PARTITIONS` flag. `SPACING_BASE_VALUE` expansion applied to the LGraph only.
5. `importFlatGraph` (`:234-299`) or `importHierarchicalGraph` (`:309-464`).

`transformNode` (`:905-966`): copy properties, size, **position** (used by interactive modes),
`COMPOUND_NODE` if it has children; `PORT_CONSTRAINTS` UNDEFINED→FREE, ≠FREE → `NON_FREE_PORTS`;
ports (skipping `NO_LAYOUT`), labels (skipping empty text); `COMMENT_BOX` → `COMMENTS`;
`HYPERNODE` → `HYPERNODES`+`HYPEREDGES` and constraints forced FREE. Model-order indices
(`MODEL_ORDER`) are assigned to nodes, ports and edges in declaration order when any model-order
strategy is active (`needsModelOrderBasedOnParent`, `:484-506`).

`transformPort` (`:989-1069`): copy, side = `PORT_SIDE`, size/pos, `INSIDE_CONNECTIONS`
(edges to descendants), `LGraphUtil.initializePort` (`LGraphUtil.java:657-745`): if side
UNDEFINED and constraints ≥ FIXED_SIDE → side from position, `PORT_BORDER_OFFSET` computed;
FIXED_RATIO → `PORT_RATIO_OR_POSITION`; anchor = explicit `PORT_ANCHOR` or side-centre or
port-centre (side still free). `NORTH_SOUTH_PORTS` is direction-relative: N/S for LEFT/RIGHT,
**E/W for UP/DOWN** (they become N/S after the direction transform).

`transformEdge` (`:1084-1240`): rejects hyperedges (`checkEdgeValidity`). Missing end port →
`LGraphUtil.createPort(node, endPoint, type, graph)` (`LGraphUtil.java:433-480`): with
`MERGE_EDGES` or hypernode → one shared collector port per direction (`provideCollectorPort`);
else a fresh `LPort`, side from the edge section's start/end point if the node has fixed sides,
else default (output → side facing the layout direction, input → opposite). `SELF_LOOPS` if
both ends on one node; `HYPEREDGES` if any end port now has >1 edge on one side; labels →
`CENTER_LABELS` / `END_LABELS` (placement forced to CENTER when unset); `JUNCTION_POINTS` reset;
`ORIGINAL_BENDPOINTS` kept only for interactive crossing minimisation / node placement.

Hierarchical import: BFS over nodes; a nested `LGraph` is created for a node only if it has
children (or inside self loops), uses ELK Layered and has `INCLUDE_CHILDREN`; the nested graph
inherits the parent's `DIRECTION`. Edges are placed in the LGraph of `source.parent`, unless one
end is a descendant of the other (then in the ancestor's nested graph).
`COORDINATE_SYSTEM_ORIGIN` (`:535-579`) records the LGraph whose coordinates ELK expects
(the edge's `containingNode`) when it differs from the source's graph.

### 6. Export: `L/graph/transform/ElkGraphLayoutTransferrer.java`

`applyLayout(lgraph)` (`:67-149`), recursive over nested graphs:

1. `offset = graph.offset + (padding.left, padding.top)`.
2. `COMPUTE_PADDING` size option → write the LGraph padding back to the node's `PADDING`.
3. Nodes (`applyNodeLayout`, `:159-217`): `elk.xy = lnode.pos + offset`; size written only if
   `NODE_SIZE_CONSTRAINTS` non-empty, node has a nested graph, or network-simplex flexible size;
   ports: `elkport.xy = lport.pos`, `PORT_SIDE` written; node labels written only if a
   `NODE_LABELS_PLACEMENT` is set on node or label; port labels unless placement is fixed;
   `LAYERING_LAYER_ID` / `CROSSING_MINIMIZATION_POSITION_ID` copied.
4. External ports of the top-level graph: `LGraphUtil.getExternalPortPosition`
   (`LGraphUtil.java:980-1030`) maps the dummy centre to the port's top-left on the border,
   using `PORT_BORDER_OFFSET`.
5. Edges (`applyEdgeLayout`, `:233-314`), collected per source node excluding edges into the
   node's own nested graph, plus the parent node's edges into its nested graph:
   `chain = [source.absoluteAnchor] + bendPoints + [target.absoluteAnchor + TARGET_OFFSET]`,
   `chain.offset(offset + hierarchicalOffset)`; hierarchical offset walks up from the source's
   graph to `COORDINATE_SYSTEM_ORIGIN` adding `parentNode.pos + graph.offset + graph.padding`
   (`:326-349`). Written into `ElkGraphUtil.firstEdgeSection(edge, reset=true, removeOthers=true)`
   via `ElkUtil.applyVectorChain`: first point → start, last → end, middle → bend points;
   `incomingShape/outgoingShape` = the edge's source/target. Labels: `pos + edgeOffset`.
   Junction points offset and copied to the ElkEdge property. `EDGE_ROUTING` on the edge set to
   SPLINES (bend points are control points) or **null** (plain bend points).
6. `applyParentNodeLayout` (`:357-397`): top level only: `ElkUtil.resizeNode(actualSize)` —
   with external ports also `PORT_CONSTRAINTS = FIXED_POS`; `NODE_SIZE_CONSTRAINTS` overwritten
   with `fixed()` (or `{PORT_LABELS}`) so a later pass treats the size as final.

`applyLayoutNonMutating` (`:428-563`) builds a fresh ElkGraph from an LGraph for logging.

### 7. Connected components (`L/components/`)

`ComponentsProcessor.split(graph)` (`ComponentsProcessor.java:91-165`; `combine` at `:230`):
- Active when `SEPARATE_CONNECTED_COMPONENTS` (default true) and (no `EXTERNAL_PORTS` or the
  graph's `PORT_CONSTRAINTS` are not order-fixed). Otherwise one component.
- DFS over `port.getConnectedPorts()`; `node.id` is the visited mark. Each component becomes a
  new `LGraph` with copied properties and padding, `NODE_SIZE_MINIMUM = null`,
  `EXT_PORT_CONNECTIONS` = set of external-port sides touched. Nodes are moved (`setGraph`).
- Placer: `SimpleRowGraphPlacer`; with external ports `ComponentGroupGraphPlacer` (greedy groups
  by which port sides a component touches, groups along a diagonal) or model-order variants
  (`CONSIDER_MODEL_ORDER_COMPONENTS`); components sorted by minimal `MODEL_ORDER` in that case.

`SimpleRowGraphPlacer.combine` (`SimpleRowGraphPlacer.java:42-160`): sort by summed `PRIORITY`
desc, ties by area **ascending**; `maxRowWidth = max(widest component, sqrt(totalArea) *
ASPECT_RATIO)`; greedy left-to-right rows with `SPACING_COMPONENT_COMPONENT`; optional
`ComponentsCompactor` (`COMPACTION_CONNECTED_COMPONENTS`) repacks polyomino-style; then
`moveGraph` adds the offset to node positions, bend points, junction points and edge labels and
appends the nodes to the target graph. Single component: nodes moved as-is, size/padding copied.

### 8. Direction handling: `L/intermediate/GraphTransformer.java`

Everything between DIRECTION_PREPROCESSOR and DIRECTION_POSTPROCESSOR assumes RIGHT: layers are
columns, P4 assigns y, P5 assigns x, "north/south ports" are the perpendicular sides. Both
processors are the same class with a `Mode`; the enum wires PREPROCESSOR to
`TO_INPUT_DIRECTION` and POSTPROCESSOR to `TO_INTERNAL_LTR` (`IntermediateProcessorStrategy.java:211-215`,
names look swapped) — harmless because the two are exact inverses.

`process` (`:72-142`) operates on layerless + layered nodes. With `DIRECTION_CONGRUENCY =
READING_DIRECTION` (default): LEFT → `mirrorX`; DOWN → `transpose`; UP → `transpose` then
`mirrorY` (post: `mirrorY` then `transpose`). With `ROTATION`: LEFT → mirrorX+mirrorY (180°),
DOWN → rotate 90° (transpose+mirrorX), UP → rotate −90°.

Primitive operations:
- `transpose` (`:589-676`): swap x/y of node pos & size & padding, port pos/anchor/size, bend
  points, junction points, edge/port/node label pos & size, graph offset/size/padding,
  `NODE_LABELS_PADDING`; port side N↔W, S↔E; `NODE_LABELS_PLACEMENT` H↔V; `NODE_SIZE_MINIMUM`
  swapped; `ALIGNMENT` L↔T, R↔B; `POSITION` swapped; `EDGE_LABELS_SIDE_SELECTION.transpose()`;
  external-port dummies: `EXT_PORT_SIDE` transposed and `LayerConstraint FIRST_SEPARATE /
  LAST_SEPARATE ↔ InLayerConstraint TOP / BOTTOM` (`:795-812`); `PORT_INDEX` negated.
- `mirrorX` (`:187-280`): `x' = W - x - w` with `W` = graph width (or max node extent incl.
  margin when size is still 0, i.e. before layout); applied to nodes, `POSITION`, ports (within
  node width), anchors (within port width), bend/junction points, labels; port side E↔W,
  `EXT_PORT_SIDE`, `ALIGNMENT` L↔R, `NODE_LABELS_PLACEMENT` H_LEFT↔H_RIGHT, layer constraint
  FIRST↔LAST (and *_SEPARATE), paddings left↔right, `PORT_INDEX` negated.
- `mirrorY`: same on y; N↔S; `IN_LAYER_CONSTRAINT` TOP↔BOTTOM; V_TOP↔V_BOTTOM.

### 9. Internal state between processors (`L/options/InternalProperties.java`)

Graph-level:
- `PROCESSORS` — the assembled list. `GRAPH_PROPERTIES` — `EnumSet<GraphProperties>`
  (`COMMENTS, EXTERNAL_PORTS, HYPEREDGES, HYPERNODES, NON_FREE_PORTS, NORTH_SOUTH_PORTS,
  SELF_LOOPS, CENTER_LABELS, END_LABELS, PARTITIONS`) computed at import; drives configuration.
- `RANDOM`, `SPACINGS`, `CYCLIC` (cycle breaker reversed something), `HIDDEN_NODES`,
  `EXT_PORT_CONNECTIONS` (per component), `EXT_PORT_REPLACED_DUMMIES`, `CROSS_HIERARCHY_MAP`,
  `MAX_MODEL_ORDER_NODES`, `CB_NUM_MODEL_ORDER_GROUPS`, `FIRST/SECOND_TRY_WITH_INITIAL_ORDER`.
Node-level:
- `ORIGIN` (ElkNode / ElkPort for ext-port dummies / LEdge for long-edge & label dummies / LNode
  for N-S dummies), `COMPOUND_NODE`, `EDGE_CONSTRAINT` (NONE/INCOMING_ONLY/OUTGOING_ONLY),
  `IN_LAYER_CONSTRAINT` (NONE/TOP/BOTTOM), `IN_LAYER_SUCCESSOR_CONSTRAINTS` (list of nodes that
  must come after), `IN_LAYER_LAYOUT_UNIT` (nodes sharing a unit stay contiguous in the layer),
  `BARYCENTER_ASSOCIATES`, `LONG_EDGE_SOURCE/TARGET` (original ports), `LONG_EDGE_HAS_LABEL_DUMMIES`,
  `LONG_EDGE_BEFORE_LABEL_DUMMY`, `REPRESENTED_LABELS`, `EXT_PORT_SIDE/SIZE`,
  `EXT_PORT_REPLACED_DUMMY`, `TOP_COMMENTS/BOTTOM_COMMENTS`, `SELF_LOOP_HOLDER`, `END_LABELS`,
  `MODEL_ORDER`, `ORIGINAL_PORT_CONSTRAINTS`, `BREAKING_POINT_INFO`, Tarjan scratch
  (`TARJAN_ID/LOWLINK/ON_STACK`, `IS_PART_OF_CYCLE`), `WEIGHT` (median heuristic).
Port-level: `PORT_DUMMY`, `CROSSING_HINT`, `PORT_RATIO_OR_POSITION`, `INPUT_COLLECT`/`OUTPUT_COLLECT`,
`INSIDE_CONNECTIONS`, `MAX_EDGE_THICKNESS`, `LONG_EDGE_TARGET_NODE`, `ORIGINAL_OPPOSITE_PORT`.
Edge-level: `REVERSED`, `ORIGINAL_BENDPOINTS`, `TARGET_OFFSET`, `COORDINATE_SYSTEM_ORIGIN`,
`PARTITION_DUMMY`, `SPLINE_*`, `END_LABEL_EDGE`, `LABEL_SIDE` (on labels).

Public options that are really state: `LayeredOptions.JUNCTION_POINTS`, `PORT_CONSTRAINTS`
(upgraded in place), `PORT_SIDE`, `LAYERING_LAYER_CONSTRAINT`, `LAYERING_LAYER_ID`,
`CROSSING_MINIMIZATION_POSITION_ID`.

### 10. Debug output (`L/DebugUtil.java`, `L/JsonDebugUtil.java`, `L/DotDebugUtil.java`)

- Enabled by the monitor: `new BasicProgressMonitor().withLogging(true).withLogPersistence(bool)`;
  persisted logs go to `~/elk/<run>/…` (`docs/content/documentation/algorithmdevelopers/algorithmdebugging.md`).
- `DebugUtil.logDebugGraph(monitor, graph, slotIndex, name)` logs both formats under tag
  `"<slotIndex>-Before <ProcessorSimpleName>"`; final tag `"<n>-Finished"`. Also
  `logDebugGraph(graph, linearSegments, successors)` (P4 linear segments) and
  `(graph, layerIndex, hyperedgeSegments, prefix, label)` (P5 routing dependency graph).
- JSON (`JsonDebugUtil.createDebugGraph`): ELK JSON. Root `{id:"root", x, y, width, height}` =
  bounding box over nodes+margins, ports, bend points; `properties` = every property on the
  element as `id: "toString"` (the `PROCESSORS` list is rendered as class names). `children`:
  layerless nodes first (layer −1), then layer by layer; node `id = "n<hash>"`, label text
  `"<designation> (<layer>,<index>)"`, dummies add `" [ DUMMY: <TYPE> ]"` and N/S dummies their
  owner node; `x,y` = pos + graph offset + padding; `ports` with `id "p<hash>"`, size, pos,
  properties; nested graphs recurse into `children`. `edges`: `source/target` node ids,
  `sourcePort/targetPort`, `sourcePoint/targetPoint` = absolute anchors (+ `TARGET_OFFSET`),
  `bendPoints`, properties. Layer membership is only in the label string — no explicit layer field.
- DOT: `digraph { rankdir=LR; }`, one line per node `<hash>[label="name (layer,idx)", shape=box]`
  for NORMAL, `style="rounded,filled", color=<NodeType.getColor()>` for dummies
  (LONG_EDGE `#eaed00`, EXTERNAL_PORT `#cc99cc`, NORTH_SOUTH_PORT `#0034de`, LABEL `#75c3c3`,
  BREAKING_POINT `#eeeeff`), then `src -> tgt;` per edge. No layer clusters, no coordinates.
- Designations: `ElkGraphTransformer.getOriginIdentifier` → dotted identifier path of the
  origin element; nodes fall back to first label text then index; `toString` forms are
  `n_<name>`, `n(long_edge)_<name>`, `p_<name>[n_x]`, `e_<label> p[n] -> p[n]`, `L_<i>[...]`.

### 11. For our engine

#### Adopt

- **One flat processor list with named slots** (`before P1 … after P5`), deduplicated,
  ordered by a single declaration enum, chosen by graph features detected at import. It makes
  "run until step N" and per-step snapshots trivial — exactly what the lab needs. Keep
  `GRAPH_PROPERTIES`-style feature flags computed once at import; they are the only thing that
  varies the pipeline.
- **Ports on every edge, dummies as real nodes with real ports.** Long-edge dummies with one
  W in-port and one E out-port, N/S-port dummies in the same layer, label dummies sized like the
  label: all four phases after layering then treat everything uniformly. Keep `NodeType` on the
  node and a Snapshot `kind` mapping (`NORMAL`→node, everything else→dummy).
- The **Splitter/Joiner contract**: original edge object survives as the first segment; joiner
  concatenates bend points/labels/junctions and re-inserts at the same incoming index. Cheap and
  keeps identity for the caller.
- **`REVERSED` flag + `reverse()` that also flips bend chain and head/tail labels**, restored as
  the last step. Same for direction: transform in, run LTR, transform out. Both are
  self-inverse; put them at the outermost slots and never let inner phases know about direction.
- **P5 owns x.** Node placement produces only the in-layer coordinate; layer x positions come
  from routing-channel widths. In cells this is where `2 + slots` columns between layers come
  from. Also adopt `graph.offset` as "translation folded in at export" rather than shifting nodes.
- **Ext-port dummy as node with layer/in-layer constraints** — when compound graphs arrive,
  this is the whole mechanism that lets one algorithm route to the border of a parent.
- Coordinate conventions: node pos relative to graph content origin; port relative to node;
  label relative to owner; bend points in graph coordinates; export adds
  `offset + padding (+ hierarchical offset)`. Edge section = `[sourceAnchor, …bends, targetAnchor]`.
- The debug dump *before each slot* with `slot-index-ProcessorName` tags, and layer/index in
  the node designation.

#### Simplify away

- `AlgorithmAssembler`/`LayoutProcessorConfiguration`/factory enums/caching: in TS this is an
  array of `{name, slot, when: (g)=>boolean, run: (g)=>void}` filtered and stably sorted once.
- `MapPropertyHolder` property bags with `IProperty` keys and `getAllProperties()`: use typed
  optional fields on the structs; the bag exists because ELK is EMF/OSGi and options are
  registered at runtime. Keep one `debug: Record<string, unknown>` if you want arbitrary
  annotations in snapshots.
- Interactive/semi-interactive modes, `ORIGINAL_BENDPOINTS`, `POSITION`, layer/position IDs,
  partitions, wrapping (BREAKING_POINT), unzipping (PLACEHOLDER*), comments, hypernodes,
  `MERGE_EDGES` collector ports, label management, splines and polyline routers, compaction
  post-processing, node flexibility repeater, model-order machinery (we pre-break cycles in
  declaration order already; a stable sort by input index before P3 covers most of the value of
  `SORT_BY_INPUT_ORDER_OF_MODEL`).
- `alg.common` node-size/label-placement stack (`NodeDimensionCalculation`, cell system,
  `LGraphAdapters`): our nodes already have integer sizes from text; margins only need ports
  and end labels.
- `DIRECTION_CONGRUENCY`: pick one (reading-direction transpose/mirror) and hard-code.
- Connected-components packing: a single-row/greedy-rows packer with integer spacing; skip the
  polyomino compactor and the external-port group placer until compound graphs with border ports
  are real.
- Separate `Layer` objects with their own `size`: `layers: LNode[][]` plus a per-layer width
  array computed in P5 is enough; keep `layerIndex`/`orderIndex` as fields on the node instead
  of `indexOf`.
- The scratch `id` field: replace with local maps/arrays in the pass that needs them.

#### Pitfalls to carry over as invariants

- Slot order is declaration order; some processors have same-slot dependencies (PortListSorter
  after NorthSouthPortPreprocessor, InnermostNodeMargin after LabelAndNodeSize,
  LongEdgeJoiner after HierarchicalPortOrthogonalEdgeRouter, HierarchicalNodeResizer last).
  Encode the order explicitly; do not rely on insertion order of a set.
- After `INVERTED_PORT_PROCESSOR` / `NORTH_SOUTH_PORT_PREPROCESSOR` the graph has **in-layer
  edges**; crossing counting, placement and routing must accept them (or we forbid inverted
  ports by forcing port sides only after cycle breaking, as the default `FEEDBACK_EDGES=false`
  path does — take that default).
- `PORT_CONSTRAINTS` are mutated in place (FIXED_SIDE after port-side assignment, FIXED_ORDER
  after crossing minimisation); keep the original if any later step needs the user's intent
  (ELK copies it into `ORIGINAL_PORT_CONSTRAINTS` for that reason).
- `NORTH_SOUTH_PORTS` means "perpendicular to flow" and is decided at import relative to the
  *input* direction (E/W for UP/DOWN), before the transform makes them N/S. Detect features after
  transforming, or mirror ELK's rule exactly.
- The finished LGraph is layerless again (`layout()` flattens); the exporter must not depend on
  layers. Dummies removed by joiners keep a stale `layer` pointer.
- Component split copies graph properties per component and nulls the minimum size; ext-port
  E/S dummies need re-positioning after final resize (`resizeGraphNoReallyIMeanIt`).
- `hierarchicalLayout` executes per-level processor lists that may differ per level; it needs a
  single hierarchy-aware step (crossing minimisation) and the resizer to run last per level.
  Anything else hierarchy-aware breaks the interleaving (issue #228 in the code comment).
- Edge routing of the top-level graph decides `graph.size.x`; minimum-size and content alignment
  are applied *after* components are combined, shifting `offset`, not nodes.
- `ORIGIN` on dummies points to different types (edge, port, node); designations for debugging
  fall back through label text → identifier path → index. Give every element a stable string id
  at import and carry it on dummies (`originId` + `dummyOf`), which the lab's hover/select needs.
- Junction points only exist for hyperedges (shared ports); they are metadata for renderers,
  not part of the route. In cells we can derive them from the crossing glyph and skip them.

---

## 2. Phase 1–2: cycle breaking, layering, dummies, constraints, wrapping

Source: eclipse/elk @ 8aaa3c14. `L/` = `plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/`,
`C/` = `plugins/org.eclipse.elk.alg.common/src/org/eclipse/elk/alg/common/`. Line numbers are from that commit.

### 0. Pipeline context

ELK Layered internally always lays out LEFT→RIGHT: layers are columns, "layer width" = `node.size.x`, in-layer extent =
`size.y`. Other directions are handled by transposing the graph before P1 and back after P5 (`DIRECTION_PREPROCESSOR`).
Everything below uses that convention; for a TB terminal layout swap x/y mentally.

Processor slots relevant here (`L/intermediate/IntermediateProcessorStrategy.java:41-92`, enum order = execution order
within a slot):

| slot | processors (in order) |
|---|---|
| before P1 | DIRECTION_PREPROCESSOR, COMMENT_PREPROCESSOR, EDGE_AND_LAYER_CONSTRAINT_EDGE_REVERSER, INTERACTIVE_EXTERNAL_PORT_POSITIONER, PARTITION_PREPROCESSOR |
| before P2 | LABEL_DUMMY_INSERTER, SELF_LOOP_PREPROCESSOR, LAYER_CONSTRAINT_PREPROCESSOR, PARTITION_MIDPROCESSOR |
| before P3 | HIGH_DEGREE_NODE_LAYER_PROCESSOR, NODE_PROMOTION, LAYER_CONSTRAINT_POSTPROCESSOR, PARTITION_POSTPROCESSOR, …, BREAKING_POINT_INSERTER, LONG_EDGE_SPLITTER, PORT_SIDE_PROCESSOR, INVERTED_PORT_PROCESSOR, … |
| before P4 | BREAKING_POINT_PROCESSOR, greedy switch, …, ALTERNATING_LAYER_UNZIPPER, SINGLE_EDGE_GRAPH_WRAPPER, IN_LAYER_CONSTRAINT_PROCESSOR, …, HYPEREDGE_DUMMY_MERGER |
| after P5 | …, LONG_EDGE_JOINER, …, BREAKING_POINT_REMOVER, …, REVERSED_EDGE_RESTORER, … |

Who requests what (`L/GraphConfigurator.java:195-342` + each phase's `getLayoutProcessorConfiguration`):
- every cycle breaker adds REVERSED_EDGE_RESTORER after P5.
- every layerer (except interactive) adds EDGE_AND_LAYER_CONSTRAINT_EDGE_REVERSER (before P1), LAYER_CONSTRAINT_PREPROCESSOR (before P2), LAYER_CONSTRAINT_POSTPROCESSOR (before P3).
- LONG_EDGE_SPLITTER / LONG_EDGE_JOINER are requested by the crossing minimizer (P3), not the layerer.
- HYPEREDGE_DUMMY_MERGER only by `OrthogonalEdgeRouter` and only if `mergeEdges=true`.
- NODE_PROMOTION iff `layering.nodePromotion.strategy != NONE`; HIGH_DEGREE_NODE_LAYER_PROCESSOR iff `highDegreeNodes.treatment`; PARTITION_* iff any node has `partitioning.partition`; wrapping/unzipping per option.

Data model facts that matter for P1/P2:
- `LGraph.getLayerlessNodes()` holds all nodes before layering; a layerer must move every node into a `Layer` and `clear()` the list. `Layer` = `{ nodes: LNode[], size: KVector, id: int }`; `Layer.getIndex()` is `indexOf` (O(L)).
- `LNode.id` / `LEdge.id` / `LPort.id` are scratch ints, re-assigned by every phase/processor for array indexing. Never rely on them across processors.
- Self loops: `SelfLoopPreProcessor` (before P2) detaches self-loop edges entirely (`setSource(null)/setTarget(null)`), so layerers only see them if they check; all P1 breakers and all layerers additionally skip `isSelfLoop()` explicitly. `NEdge` builder throws on self loops (`C/networksimplex/NEdge.java:220`).
- Center edge labels become `LABEL` dummy nodes *before layering* (`LabelDummyInserter`), so a labelled edge is two edges through a node; it always spans ≥2 layers and the dummy counts as a node in every width computation.
- Model order (`InternalProperties.MODEL_ORDER`) = index of the node among its parent's children in input order (`L/graph/transform/ElkGraphImporter.java:235-252`), assigned only when a model-order option is active; `MAX_MODEL_ORDER_NODES` = number of such nodes.
- Randomness: `InternalProperties.RANDOM` = `new Random(randomSeed)` (`L/GraphConfigurator.java:117-122`); the layered default is `randomSeed = 1` (`Layered.melk:124`), so layouts are deterministic unless 0 is passed explicitly (0 → unseeded `new Random()`).

### 1. Phase 1 — cycle breaking

#### 1.1 Representation of a reversed edge — `L/graph/LEdge.java:58-92`

`edge.reverse(graph, adaptPorts)`:
1. swap `source`/`target` ports (ports keep their sides — an edge now may leave from a WEST port; `InvertedPortProcessor` later routes such edges around the node);
2. end labels HEAD↔TAIL;
3. `REVERSED = !REVERSED` (toggle, so double reversal restores);
4. `bendPoints = reverse(bendPoints)`.
`adaptPorts` only matters for "collector ports" (`INPUT_COLLECT`/`OUTPUT_COLLECT`, `L/graph/LGraphUtil.java:612`); nothing in
the current importer sets those flags, so in practice it's a no-op. Every breaker also sets `graph.CYCLIC = true`, which
nothing reads.

`ReversedEdgeRestorer` (`L/intermediate/ReversedEdgeRestorer.java:46-68`, after P5): for every outgoing edge with
`REVERSED`, call `reverse(graph,false)` again → original direction, bend points reversed back. So all P3–P5 code sees a
DAG and never knows about reversal; the routed polyline is simply read backwards.

#### 1.2 `GreedyCycleBreaker` (default) — `L/p1cycles/GreedyCycleBreaker.java:93-222`

Eades–Lin–Smyth with edge priorities and random tie-break. `n` nodes, `node.id := index`.

1. Weighted degrees (`:112-133`): for each non-self-loop edge, `w = priority.direction > 0 ? priority+1 : 1`; `indeg[t] += w`, `outdeg[s] += w`. `outdeg==0` → `sinks` (checked first, so isolated nodes are sinks); else `indeg==0` → `sources`. Both are FIFO lists.
2. `nextRight = -1`, `nextLeft = 1`, `mark[] = 0`. While unprocessed nodes remain:
   a. drain `sinks`: `mark = nextRight--`; `updateNeighbors`.
   b. drain `sources`: `mark = nextLeft++`; `updateNeighbors`.
   c. if still unprocessed: scan all nodes with `mark==0`, collect the set with max `outdeg−indeg` (current residual, weighted); pick one **uniformly at random** (`chooseNodeWithMaxOutflow`, `:231`); `mark = nextLeft++`; `updateNeighbors`. (Scan is O(n) per pick → O(n²) worst case; no bucket structure.)
3. `updateNeighbors(v)` (`:253-284`): for each incident non-self-loop edge to an unmarked `u`: if edge is `v→u`, `indeg[u] -= w`, and if `indeg[u] ≤ 0 && outdeg[u] > 0` push to `sources`; else `outdeg[u] -= w`, and if `outdeg[u] ≤ 0 && indeg[u] > 0` push to `sinks`. (Each edge is decremented exactly once so a node crosses zero once; no duplicate pushes.)
4. Negative marks (sinks) shifted by `n+1` (`:196-201`): sinks end up ranked `n, n−1, …` after all left-placed nodes.
5. Reverse every edge with `mark[src] > mark[tgt]` (`:204-218`).

Priorities only bias the greedy choice (bigger weighted outflow); they don't guarantee direction. `PartitionPreprocessor`
uses this by stamping `priority.direction = 1000 (+user value)` on edges it already reversed (§1.7).

Not implemented from the paper: bucket lists; the "remove all sources/sinks first" is there, the `δ`-buckets are
replaced by a linear scan.

#### 1.3 `DepthFirstCycleBreaker` — `L/p1cycles/DepthFirstCycleBreaker.java:80-161`

DFS from every node with no incoming edges (in node order), then from every still-unvisited node; edges to *active*
(on-stack) nodes are back edges → reversed. Iteration order = port order then edge order → fully deterministic, but the
number of reversed edges is whatever DFS happens to produce. Self loops skipped.

#### 1.4 Model-order breakers

"Model order" = input order of nodes. `GroupModelOrderCalculator.computeConstraintModelOrder(node, offset)`
(`L/p1cycles/GroupModelOrderCalculator.java:45-69`), `offset = max(n, MAX_MODEL_ORDER_NODES)`:
`FIRST_SEPARATE → −2·offset + k`, `FIRST → −offset`, `LAST → +offset`, `LAST_SEPARATE → 2·offset + k`, then `+ MODEL_ORDER`
if present. With `cbGroupOrderStrategy == ENFORCED` the group id is scaled in as the primary key (`bigOffset =
offset · numGroups`).

- `ModelOrderCycleBreaker` (`ModelOrderCycleBreaker.java:59-100`): reverse every edge with `order(target) < order(source)`. Trivially acyclic (total order), zero heuristics.
- `GreedyModelOrderCycleBreaker` (`GreedyModelOrderCycleBreaker.java:34-59`): `GreedyCycleBreaker` with the random tie-break replaced by "min model order among the max-outflow candidates" (nodes without model order ignored; falls back to random if none has one).
- `DFSNodeOrderCycleBreaker` / `BFSNodeOrderCycleBreaker` (`DFSNodeOrderCycleBreaker.java:146-211`, `BFSNodeOrderCycleBreaker.java:173-233`): the DFS/BFS variants but children are visited in ascending target model order (nodes without model order last). BFS reverses an edge to an already-visited node unless the source is an original source or the target an original sink (`:227`) — note this is not a real cycle test; BFS "visited" ≠ "ancestor".
- SCC family (`SCCModelOrderCycleBreaker.java:84-169`, `SCConnectivity.java:41-100`, `SCCNodeTypeCycleBreaker.java:39-113`): loop { Tarjan → non-trivial SCCs (`L/graph/Tarjan.java:94`); per SCC pick `min`/`max` model-order node; `SCC_CONNECTIVITY`: if `|in(min)| > |out(max)|` reverse all intra-SCC incoming edges of `min` else all intra-SCC outgoing edges of `max`; `SCC_NODE_TYPE`: first prefer configured source/target group ids, then the connectivity rule } until no SCC. Reversal uses `adaptPorts=false`. Cost: Tarjan per round.

#### 1.5 `InteractiveCycleBreaker` — `L/p1cycles/InteractiveCycleBreaker.java:58-126`

Reverse edges whose target's `interactiveReferencePoint.x < source.x`; then a DFS over `id`-marked nodes catches
remaining cycles among equal-x nodes.

#### 1.6 `EdgeAndLayerConstraintEdgeReverser` — `L/intermediate/EdgeAndLayerConstraintEdgeReverser.java:71-350` (before P1)

Makes layer constraints satisfiable by turning edges *before* the cycle breaker runs:
- `FIRST`/`FIRST_SEPARATE` node → reverse all **incoming** edges (node becomes source-only).
- `LAST`/`LAST_SEPARATE` node → reverse all **outgoing** edges.
- Refusals (`canReverse*`, `:281-350`): edge already `REVERSED`; edge to a `LAST_SEPARATE` target / from a `FIRST_SEPARATE` source; `FIRST`/`LAST` node ↔ `LABEL` dummy (the label dummy must sit between FIRST_SEPARATE and FIRST layers).
- Two passes: constrained nodes first (`handleOuterNodes`), then the rest (`handleInnerNodes`), so conflicts resolve in favour of the constrained node.
- Feedback-node heuristic (`:172-213`): unconstrained node with fixed port sides whose every port is "backwards" (EAST ports net inflow, WEST ports net outflow) and no constrained neighbours → reverse *all* its edges, so it lays out as a normal node with reversed edges instead of all edges being routed around it.
Sets `EDGE_CONSTRAINT = OUTGOING_ONLY` unconditionally for both cases (`:112`, `:156`) — a latent bug, harmless because only external-port code reads it.

#### 1.7 Partitions as a cycle-breaking constraint — `L/intermediate/PartitionPreprocessor.java:68-153`

`partitioning.partition: int` on nodes. Before P1: for every edge leaving a partitioned node, reverse it if the target
is partitioned with a smaller id, or (target unpartitioned) if a BFS along outgoing edges reaches *any* node with a
smaller partition id (`mustBeReversed`, `:89-139` — note: reverses only the first edge of such a path, and the BFS is
O(V+E) per edge). Reversed edges get `priority.direction = 1000 (+ existing)` so the greedy breaker keeps them.
The layering side is in §3.3.

### 2. Phase 2 — layering

All layerers: input `layerlessNodes` of an acyclic graph; output `graph.layers` (list, index 0 = leftmost) with every node
assigned, `layerlessNodes` cleared. A layer's "width" for width-aware heuristics is `Σ(size.y + spacing)` of its nodes
plus dummies (edges spanning the layer), since ELK is LR internally.

#### 2.1 `NetworkSimplexLayerer` (default) — `L/p2layers/NetworkSimplexLayerer.java`

1. Connected components by undirected DFS (`:108-138`), largest first (`node.id` re-indexed).
2. Per component build an `NGraph` (`initialize`, `:182-214`): one `NNode` per `LNode` (`origin` = LNode); per non-self-loop edge `NEdge{ weight = max(1, priority.shortness), delta = 1 }`. All minimum lengths are 1 — ELK does not use `delta>1` for layering (label dummies already force length 2).
3. `NetworkSimplex.forGraph(g).withIterationLimit(4·thoroughness·⌊√|component|⌋).withPreviousLayering(counts).withBalancing(true).execute()` (`:229`, `:262-270`). `thoroughness` default 7 → 28√n pivots.
4. Copy `nNode.layer` → `Layer` objects (created on demand, `:273-281`). For later components pass the per-layer node counts of the layering so far so balancing spreads across components (`:283-289`) — only relevant when `separateConnectedComponents=false`, otherwise ELK lays out components separately anyway.

#### 2.2 `NetworkSimplex` — `C/networksimplex/NetworkSimplex.java` (Gansner et al. 1993 §2, as implemented)

Data (`C/networksimplex/NNode.java`, `NEdge.java`):
```ts
NNode { id, internalId, origin, layer: int, treeNode: bool, in: NEdge[], out: NEdge[], unknownCutvalues: NEdge[] }
NEdge { id, internalId, origin, source, target, weight: double, delta: int /* min length, default 1 */, treeEdge: bool }
// per-run arrays indexed by internalId: poID[], lowestPoID[] (nodes); cutvalue[], edgeVisited[] (edges); treeEdges: LinkedHashSet
```
Requirements: connected, acyclic, no self loops. For a disconnected graph `minimalSlack()` returns `null` → NPE; the
placer uses `NGraph.makeConnected()` (`NGraph.java:86-114`: artificial root with `delta=0, weight=0` edges to one
representative per component), the layerer splits components itself.

`execute()` (`:274-323`):
1. `layer := 0` for all nodes.
2. If `|V| ≥ 40` (`REMOVE_SUBTREES_THRESH`): **removeSubtrees** (`:330-369`) — repeatedly pop degree-1 nodes, unlink their only edge, push `(node, edge)` on a stack, remove node from `graph.nodes`. Trees hanging off the core are placed afterwards at `placed.layer ± delta` (`reattachSubtrees`, `:375-396`) — exact, since a leaf's optimum is always tight. Big win on tree-like diagrams.
3. `initialize()` (`:203-243`): re-index nodes/edges, `sources` = nodes with no incoming edges, clear tree flags.
4. `feasibleTree()` (`:412-440`):
   a. `layeringTopologicalNumbering(sources)` (`:453-474`): Kahn's algorithm, `target.layer = max(target.layer, node.layer + delta)` → longest-path-from-sources layering; every edge has slack ≥ 0.
   b. Grow a tight spanning tree: `tightTreeDFS(firstNode)` (`:520-542`) marks `treeNode`, follows existing tree edges and adds any **tight** (`slack == 0`) non-tree edge to an untreed node. While `|tree| < |V|`: `e = minimalSlack()` (`:554-569`, min slack over edges with exactly one endpoint in the tree, first wins ties); `slack = e.target.layer − e.source.layer − e.delta`, negated if `e.target` is the tree endpoint; shift **all tree nodes** by `slack` (tree moves toward the non-tree side; feasibility preserved because the shifted-toward edge had minimum slack); rerun `tightTreeDFS` from the same root (tree flags persist, so it only grows).
   c. `postorderTraversal(root)` (`:586-597`) assigns `poID` (postorder number) and `lowestPoID` (min poID in subtree) = Gansner's `lim`/`low`; then `cutvalues()`.
5. Pivot loop: `while ((e = leaveEdge()) != null && iter < limit) exchange(e, enterEdge(e))`.
   - `leaveEdge()` (`:727-734`): first tree edge in `treeEdges` insertion order with `cutvalue < −1e-10`. No cyclic search pointer, no "most negative" — first found.
   - `isInHead(node, edge)` (`:615-635`): head component = side containing `edge.target` after deleting the tree edge. Uses the `low ≤ poID(node) ≤ lim` interval test on the subtree below the lower endpoint, plus which endpoint is the subtree root (`poID(source) < poID(target)` ⇒ source is the deeper node).
   - `enterEdge(leave)` (`:748-770`): over **all** edges, pick a non-tree edge with `source ∈ head ∧ target ∉ head` (head→tail) of minimum slack (first wins ties). O(E).
   - `exchange(leave, enter)` (`:787-816`): swap tree flags; `d = slack(enter)`; if `enter.target ∉ head` then `d = −d`; for every node `∉ head`: `layer += d` (i.e. tail component moves by `slack` toward head so `enter` becomes tight). Then **full recomputation** of postorder numbers and all cut values (`// TODO ... incrementally`). Per pivot: O(V + E) + O(E) enterEdge scan.
6. `reattachSubtrees()`.
7. `normalize()` (`:828-854`): subtract min layer; returns `filling[layer] = node count`, plus `previousLayeringNodeCounts` if given.
8. If balancing: `balance(filling)` (`:866-889`): single pass over nodes with `|in| == |out|`; `minimalSpan(node)` = (min incoming edge length, min outgoing edge length); candidate layers `(layer − minIn, layer + minOut)` exclusive; move to the least-filled candidate if strictly less filled than the current layer, updating `filling`. Note it compares *lengths*, not slack, so it silently assumes `delta = 1` (true for the layerer).

Cut values (`cutvalues()`, `:647-717`) — leaf-peeling, not DFS: for each node, `unknownCutvalues` = its incident tree
edges; start from nodes with exactly one; while the current node has exactly one unknown tree edge `t`:
```
cut(t) = w(t)
       + Σ non-tree e at n :  s(e)·w(e)            s = +1 if e is tail→head aligned with t at n
                                                    (e leaves n when n=tail(t); e enters n when n=head(t)), else −1
       + Σ tree e≠t at n   : −(cut(e) − w(e))      if e has the same orientation at n as t (both enter / both leave n)
                            : +(cut(e) − w(e))      otherwise
```
then remove `t` from both endpoints' unknown sets and continue at the other endpoint. Equivalent to dot's `x_val` (the
cross terms between sibling subtrees cancel). Cut values are `double` only because weights are; with int weights use ints
and drop `FUZZY_ST_ZERO`.

Complexity: feasible tree O(V·(V+E)) worst; each pivot O(V+E); pivots ≤ 28√n by default (so on big graphs ELK stops
*before* optimality — "thoroughness" is literally this cap). Determinism: `treeEdges` is a `LinkedHashSet` and all scans
are in list order, so given the same input order the result is deterministic.

#### 2.3 `LongestPathLayerer` / `LongestPathSourceLayerer` — `L/p2layers/LongestPathLayerer.java:99-140`, `LongestPathSourceLayerer.java:102-143`

Recursive memoised `height(v) = 1 + max(height(succ))` (`LONGEST_PATH`: sinks in the last layer, layers prepended as
heights grow; `layer = L − height`) or over predecessors (`LONGEST_PATH_SOURCE`: sources in layer 0). Self loops skipped.
Recursion depth = longest path (stack risk on huge chains). No width control, no balancing. Model-order promotion
strategies are documented to pair with these.

#### 2.4 `CoffmanGrahamLayerer` — `L/p2layers/CoffmanGrahamLayerer.java:75-295`

Bound `w = layering.coffmanGraham.layerBound` (default `Integer.MAX_VALUE` = no bound).
1. Transitive reduction (`:270-295`): for each start node DFS marking edges `start→w` whenever `w` is reachable via a longer path (`nodeMark` reset per start → O(V·(V+E))). Marked edges are ignored below.
2. Topological labelling with a priority queue: pop the source whose sorted list of predecessor labels is lexicographically smallest comparing from the largest element down (`compareNodesInTopo`, `:233-265`; ties → `node.id`), assign `topoOrd = i++`.
3. Layer assignment from sinks (`:152-193`): priority queue of nodes whose successors are all placed, highest `topoOrd` first; start a new layer when the current has `w` nodes or adding would create an in-layer edge (`canAdd`). Layers are built right-to-left and reversed.
Only *original* nodes count toward `w`; dummies are ignored, so the effective width can be much larger.

#### 2.5 `MinWidthLayerer` — `L/p2layers/MinWidthLayerer.java:139-454` (Nikolov, Tarassov, Branke 2005 "MinWidth")

Options `layering.minWidth.upperBoundOnWidth` (UBW, default 4, −1 → try 1..4) and
`upperLayerEstimationScalingFactor` (c, default 2, −1 → try 1..2); up to 8 layerings computed, keep the one with min
(estimated max width, then fewer layers).
Size-awareness (ELK's deviation from the paper, `:152-191`): `minSize = max(1, min NORMAL node size.y)`;
`normSize[v] = size.y / minSize`; `dummySize = spacing.edgeEdge / minSize`; `avgSize` = mean normSize;
`ubwConsiderSize = UBW · avgSize`.
Algorithm (`computeMinWidthLayering`, `:325-430`), bottom-up (sinks first):
1. Nodes pre-sorted by descending out-degree (ConditionSelect).
2. Loop: `v = selectNode()` = first unplaced node whose successors are all in *earlier finished* layers (`:445-454`, O(V) scan with `Set.containsAll`).
3. Place `v`: `widthCurrent += normSize[v] − outDeg[v]·dummySize`, `widthUp += inDeg[v]·dummySize`, track `realWidth`, `goingOutFromThisLayer`.
4. Close the layer if `v == null`, or no unplaced nodes left, or `(widthCurrent ≥ ubwConsiderSize && normSize[v] > outDeg[v]·dummySize)` (ConditionGoUp, "node is wider than the dummies it removes"), or `widthUp ≥ c · ubwConsiderSize`. On close: `currentSpanningEdges −= goingOutFromThisLayer; maxWidth = max(maxWidth, currentSpanningEdges·dummySize + realWidth); currentSpanningEdges += widthUp; widthCurrent = widthUp; widthUp = 0`.
Width estimate = real node sizes + spanning edges × dummy size; this is exactly what the final drawing will contain, up to
spacing. O(V²) per run.

#### 2.6 `StretchWidthLayerer` — `L/p2layers/StretchWidthLayerer.java:116-240` (Nikolov & Tarassov "StretchWidth")

Rank = max(outdeg(v), max outdeg of predecessors) (`:297-310`), nodes sorted by rank descending. `maxWidth` starts at
`maxNodeSize/minNodeSize` and is **incremented and the whole layering restarted** whenever a node can't be placed
(`:191-209`). `upperLayerInfluence` = average out-degree. `conditionGoUp` (`:236-240`):
`widthCurrent − outDeg·dummy + normSize > maxWidth` or `widthUp + inDeg·dummy > maxWidth · avgOutDeg · dummy`. Selection =
first node in rank order whose successors are all placed (`remainingOutGoing ≤ 0`). Restart loop makes it potentially
O(W · V²). Experimental.

#### 2.7 Others

- `BF_MODEL_ORDER` / `DF_MODEL_ORDER` (`L/p2layers/BreadthFirstModelOrderLayerer.java:66-138`, `DepthFirstModelOrderLayerer.java:91-215`): place real nodes in model order; BF opens a new layer (plus an interleaved label-dummy layer) whenever a node has a predecessor in the current layer; DF builds "strips". Require every real node to have a model order (throws otherwise). Not graph-aware beyond adjacency; ignore.
- `INTERACTIVE` (`L/p2layers/InteractiveLayerer.java:66-185`): merge overlapping x-intervals of existing node positions into layers, then push targets right until all edges point forward, delete empty layers.

### 3. Layer constraints and post-layering processors

#### 3.1 `layering.layerConstraint` FIRST/LAST/FIRST_SEPARATE/LAST_SEPARATE

Three cooperating processors plus §1.6:
- `LayerConstraintPreprocessor` (`L/intermediate/LayerConstraintPreprocessor.java:61-251`, before P2): `*_SEPARATE` nodes are **hidden** from the layerer — removed from `layerlessNodes`, each incident edge detached at the far end (`setTarget(null)`/`setSource(null)`, far port saved in `ORIGINAL_OPPOSITE_PORT`). Throws `UnsupportedConfigurationException` if a FIRST_SEPARATE node has incoming edges (or LAST_SEPARATE outgoing) that aren't between external-port dummies — §1.6 must already have reversed them. A neighbour that loses *all* its edges this way and has no constraint of its own gets `FIRST`/`LAST` (`:185-211`) so it stays next to the hidden node.
- Layerer runs on the remainder; FIRST/LAST nodes are layered normally (their edges were reversed in §1.6 so they are sources/sinks, but not necessarily in layer 0 / L−1).
- `LayerConstraintPostprocessor` (`LayerConstraintPostprocessor.java:63-251`, before P3): move every `FIRST` node to layer 0 and `LAST` to the last layer (throws if it still has incoming/outgoing non-label edges); attached LABEL dummies go to a new label layer inserted right after/before; delete emptied layers; then restore hidden nodes into new outermost `firstSeparate`/`lastSeparate` layers and reattach their edges. Moving nodes this way can create very long edges — that's accepted.
- `layerChoiceConstraint` (int layer index) is *not* part of the pipeline; only `InteractiveLayeredGraphVisitor` uses it.

#### 3.2 `InLayerConstraintProcessor` — `L/intermediate/InLayerConstraintProcessor.java:52-104` (before P4)

Reorders each layer so nodes with `IN_LAYER_CONSTRAINT = TOP` come first and `BOTTOM` last (stable). The property is set
only by `GraphTransformer` for external-port dummies of north/south ports; irrelevant unless you have hierarchical ports.

#### 3.3 Partitions as layering constraints — `PartitionMidprocessor.java:62-119`, `PartitionPostprocessor.java:49-67`

Before P2: for consecutive partition ids `a < b`, add a dummy edge (flagged `PARTITION_DUMMY`, with fresh EAST/WEST dummy
ports) from **every** node of `a` to **every** node of `b` — `|a|·|b|` edges per pair, weight 1, min length 1. This
forces `layer(b-nodes) > layer(a-nodes)` in any layerer. Before P3 the dummy ports (and thereby edges) are removed. The
edges also bias network simplex (they carry weight) — partitions therefore pull layers together.

#### 3.4 `NodePromotion` — `L/intermediate/NodePromotion.java:169-723` (before P3; default strategy NONE)

Nikolov, Tarassov & Branke's promotion heuristic: move a node one layer up (toward sources; ELK's internal ids are
reversed so "promote" = `layer+1` in its own numbering) if doing so, together with recursively promoting predecessors
that would end up in the same layer, reduces the dummy count.

- Precompute (`:270-348`): `degreeDiff[v] = {out−in, in, out}`; per-layer width in nodes+dummies (`dummyBaggage` running count of edges spanning the layer) and in "pixels" (`Σ(size.y + spacing.nodeNode) + dummies·spacing.edgeNodeBetweenLayers`); `maxWidth`, `maxWidthPixel`, `dummyNodeCount`.
- `promoteNode(v)` (`:629-687`): updates widths of old/new layers (`−1 + out` / `+1 − in`), grows `maxHeight` if promoting past the top, recursively promotes predecessors sitting in the target layer, returns `(Δdummies = Σ(out−in) over promoted nodes, widthOK)`.
- `promotionMagic` (`:557-612`): repeat { for every node with incoming edges: try promotion; keep iff `Δdummies < 0` (and, for NIKOLOV/NIKOLOV_PIXEL, no layer exceeds the original max width); else roll back arrays } until an iteration makes no promotion or the strategy's stop predicate fails.
- Strategies: `NO_BOUNDARY` (pure dummy minimisation, width may grow), `NIKOLOV` / `NIKOLOV_PIXEL` (never exceed original max width, count / pixels), `NIKOLOV_IMPROVED[_PIXEL]` (try NO_BOUNDARY; if max width grew, redo with NIKOLOV), `DUMMYNODE_PERCENTAGE` / `NODECOUNT_PERCENTAGE` (stop after `maxIterations`% of dummies removed / iterations), `MODEL_ORDER_LEFT_TO_RIGHT|RIGHT_TO_LEFT` (promote to make layer order agree with model order; ignores width).
- Rollback is by copying whole arrays per rejected attempt → O(V) per attempt, O(V²) per sweep.
After network simplex there is little to gain (NS already minimises Σ edge length); it exists for longest-path layerings.

#### 3.5 `HighDegreeNodeLayeringProcessor` — `L/intermediate/HighDegreeNodeLayeringProcessor.java:69-371` (before P3, opt-in)

`highDegreeNodes.treatment=true`, `threshold` (default 16), `treeHeight` (default 5, 0 = unlimited). For each node with
degree ≥ threshold: find incoming/outgoing **pure trees** hanging off it (each tree node has exactly one parent, height ≤
treeHeight, not itself high-degree); insert `maxHeight` fresh layers immediately before/after the hub's layer and move
each tree into them level by level (root adjacent to the hub). Puts fan-in/fan-out trees next to the hub instead of
letting NS spread them; empty layers removed afterwards.

#### 3.6 `LayerSizeAndGraphHeightCalculator` — `L/intermediate/LayerSizeAndGraphHeightCalculator.java:49-113` (before P5)

After node placement: `layer.size.x = max(node.size.x + margin.left + margin.right)`, `layer.size.y = bottom(last) −
top(first)` including margins (external-port dummies add `spacing.portsSurrounding`); `graph.size.y = maxY − minY`,
`offset.y −= minY`. Pure bookkeeping for the edge router.

### 4. Long edges: dummies

#### 4.1 `LongEdgeSplitter` — `L/intermediate/LongEdgeSplitter.java:63-247` (before P3)

Skips graphs with ≤ 2 layers. Walk layers left to right; for each outgoing edge whose target is not in this or the next
layer, insert one dummy in the next layer and iterate (the new edge is picked up when the next layer is processed, so an
edge spanning k layers yields k−1 dummies in order).
`createDummyNode`: `type = LONG_EDGE`, `ORIGIN = edge`, `PORT_CONSTRAINTS = FIXED_POS`, appended to the layer.
`splitEdge(edge, dummy)` (`:136-172`, also used by wrapping/unzipping):
- `thickness = max(0, edge.thickness)` (core default 1); `dummy.size = (0, thickness)`; two ports WEST/EAST at `y = ⌊thickness/2⌋`, x = 0.
- `edge.target := dummyIn`; new `dummyEdge` = `copyProperties(edge)` minus `JUNCTION_POINTS`, `dummyOut → oldTarget`. So the original `LEdge` object survives as the **first** segment; properties (thickness, priority, REVERSED, …) are duplicated onto each segment.
- `LONG_EDGE_SOURCE` / `LONG_EDGE_TARGET` (`LPort`) on the dummy = the real end ports, copied from the upstream dummy/label dummy if any; `LONG_EDGE_HAS_LABEL_DUMMIES` if a label dummy is part of the chain (`:185-222`).
- HEAD end labels migrate to the last segment (`moveHeadLabels`).
Width of a dummy = 0 in the layer direction; in-layer extent = edge thickness. The room a dummy takes is entirely spacing
(`spacing.edgeEdge`, `spacing.edgeNode`), computed later by the node placer.

#### 4.2 `LongEdgeJoiner` — `L/intermediate/LongEdgeJoiner.java:66-175` (after P5)

For each LONG_EDGE dummy (in layer order): pair the i-th incoming edge of its WEST port with the i-th outgoing edge of
its EAST port (index correspondence is an invariant maintained by splitter and merger — `setTargetAndInsertAtIndex`
keeps it, KIPRA-1670); surviving edge = incoming; `surviving.target := dropped.target`; bend points = `surviving.bends ++
[dummy port anchor if unnecessaryBendpoints] ++ dropped.bends`; labels and junction points appended; dropped edge
detached; dummy removed from the layer. Bend points are already absolute at this point, so nothing is recomputed.

#### 4.3 `HyperedgeDummyMerger` — `L/intermediate/HyperedgeDummyMerger.java:67-254` (before P4, only `mergeEdges=true` + orthogonal routing)

After crossing minimisation: label every port with a hyperedge id by DFS over "ports connected by an edge" and "both
ports of a LONG_EDGE dummy" (`identifyHyperedges`). Then, per layer, merge **adjacent** LONG_EDGE dummies iff they belong
to the same hyperedge id (no label dummies involved), or share `LONG_EDGE_SOURCE` before their label dummy / share
`LONG_EDGE_TARGET` after it. Merge = re-hang all edges of the second dummy onto the first's ports; clear the
source/target property that no longer holds. Result: one dummy carrying several edges → the orthogonal router draws a
shared trunk. Requires the joiner's index invariant to hold (it does, because edges are appended in order).

### 5. Layer unzipping — `L/intermediate/unzipping/AlternatingLayerUnzipper.java:58-314` (before P4, `layerUnzipping.strategy=ALTERNATING`)

Motivation: a tall layer of many small nodes wastes width; split it into `N = layerSplit` (default 2, per-node property,
min over the layer) sub-layers, sending node i to sub-layer `i mod N`. Each moved node's edges are re-split with
LONG_EDGE dummies through the sub-layers it skips (`shiftNode`, `:219-298`), `PLACEHOLDER` dummies fill sub-layers for
nodes without incoming edges so the alternation stays aligned, `resetOnLongEdges` (default true) restarts the alternation
after a LONG_EDGE dummy. `minimizeEdgeLength=true` skips the layer if `maxNodeWidth/avgNodeHeight ≥ n/4` (heuristic: the
vertical edge growth ~n²/4 wouldn't pay off). Placeholders removed at the end. Node order within the layer must already be
final (runs after P3).

### 6. Graph wrapping — `L/intermediate/wrapping/` (`wrapping.strategy = SINGLE_EDGE | MULTI_EDGE`)

Goal: a long layering (many layers, few nodes per layer) is cut into rows ("chunks") placed one below the other so the
drawing approaches `aspectRatio` (× `wrapping.correctionFactor`). Cuts are layer indices `c` meaning "row starts at layer
c". Everything is computed on the *layered* graph, before node placement, using size estimates.

#### 6.1 `GraphStats` — `GraphStats.java:59-357`
- `dar` = desired aspect ratio, inverted for UP/DOWN directions (`:66-73`).
- `width(layer) = max(node.size.x + margins) + spacing.nodeNodeBetweenLayers`; `height(layer) = Σ(node.size.y + margins + spacing.nodeNode)` (+ origin sizes for north/south port dummies) (`:193-259`). `sumWidth`, `maxWidth`, `maxHeight`.
- `isCutAllowed(i)` (`:287-357`): index 0 never; if `wrapping.validify.forbiddenIndices` set, exactly those are forbidden; otherwise cut before layer `i` is allowed only if *all* edges entering layer `i` connect a single (source, target) node pair — the SINGLE_EDGE validity condition.

#### 6.2 Cut index heuristics (`ICutIndexCalculator`)
- `MANUAL`: `wrapping.cutting.cuts` list as-is.
- `ARD` (`ARDCutIndexHeuristic.java:30-60`): `rows = round(√(sumWidth / (dar · maxHeight)))`, capped at layer count; cuts at `round(k · L / rows)`. Aspect-ratio-driven, ignores actual layer widths.
- `MSD` (default, `MSDCutIndexHeuristic.java:40-119`): prefix sums of layer widths; for every cut count `m` in `[rows−1 ± freedom]` (`wrapping.cutting.msd.freedom`, default 1): greedily cut whenever the accumulated width since the last cut reaches `total/(m+1)`; row height = Σ max layer height per row; score `min(1/maxRowWidth, (1/dar)/height)` (= max uniform scale factor fitting the target box) — best score wins. Note the greedy `≥ rowSum` rule cuts *after* exceeding, so row width overshoots the target.
Neither heuristic guarantees valid cuts → `wrapping.validify.strategy` (default GREEDY): `GREEDY` shifts each cut right to the next allowed index (accumulating offset, dropping cuts that fall off the end, `SingleEdgeGraphWrapper.java:126-145`); `LOOK_BACK` snaps each cut to the nearest allowed index on either side and skips desired cuts that collapse onto the same one (`:150-213`); `NO` leaves them.

#### 6.3 `SINGLE_EDGE` — `SingleEdgeGraphWrapper.java:68-290` (before P4)
Early exit if the layering is already within aspect ratio (`sumWidth/maxWidth < dar` — note `currentAR` is computed as
`(maxWidth·L)/maxWidth = L`, i.e. it compares `dar` against the layer count, not the real width). Then `performCuts`:
walk layers with old index `i`, new index `j` (reset to 0 at each cut); move nodes of layer `i` to layer `j` (appended);
at the first layer of a new row (`j == 0`) every incoming edge (there is exactly one node pair by validity) is
**reversed** (`REVERSED` toggled, so the restorer flips it back) and `CuttingUtils.insertDummies` creates LONG_EDGE
dummies for it from `src.layer .. tgt.layer` in the *new* layering — i.e. the wrapped edge runs backwards through all
row layers as an ordinary long edge whose dummies carry `SPACING_INDIVIDUAL edgeNode += wrapping.additionalEdgeSpacing`
(default 10) to keep it visibly apart. The first dummy is inserted at `layer.size − offset` so it sits right after the
moved nodes. The result is one normal layered graph with extra rows stacked in-layer: crossing minimisation of row 1 vs
row 2 nodes is whatever P3 does with them (row order is kept only because the wrapped edges' dummies chain them);
node placement stacks them vertically. Empty layers removed.

#### 6.4 `MULTI_EDGE` — breaking points (`BreakingPointInserter` before P3, `BreakingPointProcessor` before P4, `BreakingPointRemover` after P5)
Allows several edges to cross a cut. Three stages:
1. Inserter (`BreakingPointInserter.java:73-245`): compute cuts (same heuristics; `improveCuts` if `wrapping.multiEdge.improveCuts` (default true): per cut pick the index minimising `openEdges(idx) + dist^distancePenalty` (`distancePenalty` default 2) near the heuristic position (`:248-330`); validify only if a validify strategy is set explicitly). At each cut insert **two new layers**; every edge open across the cut becomes `src → BP_start → BP_end → (original edge, now sourced at BP_end)`; both markers are `BREAKING_POINT` nodes with FIXED_SIDE ports, linked by a `BPInfo{start,end,nodeStartEdge,startEndEdge,originalEdge,prev,next}` chain so an edge crossing k cuts has k linked pairs. P3 orders the markers like any other node (with model order copied onto the dummy edges).
2. Processor (`BreakingPointProcessor.java:97-173`): prepend an empty layer; walk layers; on meeting a layer of BP start markers, set `idx = 0` so the *next* layer (end markers) and everything after moves to the front layers (row 2 goes to layers 0..); in that end-marker layer reverse each incoming edge (`start → end` becomes `end → start`) and `insertDummies` for it across the row (dummies placed at `layer.size − offset`, i.e. above the moved nodes, in reverse order so chains don't cross). `BPInfo` records the in-layer dummies. If `improveWrappedEdges` (default true): collapse chains of markers for edges crossing multiple cuts (`improveMultiCutIndexEdges`) and pull markers forward/backward over adjacent LONG_EDGE dummies to shorten the wrap-around (`improveUnneccesarilyLongEdges`, uses `LongEdgeJoiner.joinAt`).
3. Remover (`BreakingPointRemover.java:91-185`): after routing, stitch `nodeStartEdge.bends ++ reverse(startEndEdge.bends) ++ originalEdge.bends` (for POLYLINE add the marker positions; for SPLINES concatenate the spline-segment lists), restore `originalEdge.source`, merge junction points, detach the helper edges and markers, recurse to `prev`.
The wrapped edge is thus drawn as: forward to the row's right edge (start marker), a vertical segment down between rows
(the reversed start→end edge is routed as an in-layer/backward edge in layer 0), then forward from the row start.

### 7. Options and defaults (`L/Layered.melk`, core `Core.melk`)

| option | default | used by |
|---|---|---|
| `cycleBreaking.strategy` | GREEDY | P1 (GREEDY, DEPTH_FIRST, INTERACTIVE, MODEL_ORDER, GREEDY_MODEL_ORDER, SCC_CONNECTIVITY, SCC_NODE_TYPE, DFS_NODE_ORDER, BFS_NODE_ORDER) |
| `layering.strategy` | NETWORK_SIMPLEX | P2 (LONGEST_PATH, LONGEST_PATH_SOURCE, COFFMAN_GRAHAM, INTERACTIVE, STRETCH_WIDTH, MIN_WIDTH, BF_MODEL_ORDER, DF_MODEL_ORDER) |
| `layering.layerConstraint` (node) | NONE | §1.6, §3.1 |
| `layering.layerChoiceConstraint` (node) | null | interactive visitor only |
| `layering.layerId` (node, output) | −1 | written by CONSTRAINTS_POSTPROCESSOR if `interactiveLayout` / `generatePositionAndLayerIds` |
| `layering.minWidth.upperBoundOnWidth` | 4 (−1 = try 1..4) | MinWidth |
| `layering.minWidth.upperLayerEstimationScalingFactor` | 2 (−1 = try 1..2) | MinWidth |
| `layering.coffmanGraham.layerBound` | MAX_INT | Coffman–Graham |
| `layering.nodePromotion.strategy` / `.maxIterations` | NONE / 0 | §3.4 |
| `priority.direction` (edge) | 0 | greedy breakers (weight `p+1`) |
| `priority.shortness` (edge) | 0 | NS edge weight `max(1,p)` |
| `priority` (core, edge) | — | **not** used by P1/P2 |
| `thoroughness` | 7 (≥1) | NS pivot cap `4·t·√n` |
| `highDegreeNodes.treatment` / `.threshold` / `.treeHeight` | false / 16 / 5 | §3.5 |
| `partitioning.activate` / `.partition` (node) | false / — | §1.7, §3.3 |
| `mergeEdges` | false | hyperedge merger (+ one port per side at import) |
| `unnecessaryBendpoints` | false | joiner adds a bend at each dummy |
| `edge.thickness` (core) | 1 | dummy in-layer size |
| `spacing.edgeEdge` / `edgeNode` / `nodeNode` (core) | 10 / 10 / 20 | dummy size in MinWidth/StretchWidth (`edgeEdge`, floored to 2 by `GraphConfigurator:105`), promotion pixels |
| `spacing.edgeNodeBetweenLayers` / `edgeEdgeBetweenLayers` / `nodeNodeBetweenLayers` | 10 / 10 / 20 | promotion pixels, wrapping stats |
| `wrapping.strategy` | OFF | §6 |
| `wrapping.additionalEdgeSpacing` / `.correctionFactor` | 10 / 1.0 | §6 |
| `wrapping.cutting.strategy` / `.cuts` / `.msd.freedom` | MSD / — / 1 | §6.2 |
| `wrapping.validify.strategy` / `.forbiddenIndices` | GREEDY / — | §6.2 |
| `wrapping.multiEdge.improveCuts` / `.distancePenalty` / `.improveWrappedEdges` | true / 2.0 / true | §6.4 |
| `layerUnzipping.strategy` / `.layerSplit` / `.resetOnLongEdges` / `.minimizeEdgeLength` | NONE / 2 / true / false | §5 |
| `considerModelOrder.strategy` | NONE | enables MODEL_ORDER assignment at import; P3 sorting |
| `considerModelOrder.groupModelOrder.cycleBreakingId` (node) / `.cbGroupOrderStrategy` / `.cbPreferredSourceId` / `.cbPreferredTargetId` | 0 / ONLY_WITHIN_GROUP / — / — | model-order & SCC breakers |
| `aspectRatio` (core) | 1.6 | wrapping target |
| `randomSeed` (core) | 1 for layered (0 = unseeded) | greedy tie-break |

### 8. For our engine (TS, sync, integer cells, ports first-class, compound later)

**Adopt as-is**
- Edge reversal as a toggled `reversed` flag + swapped endpoints + restore-after-routing (reverse bend list). Keep P2–P5 oblivious. Ports: swapping endpoints leaves an edge leaving a west port — you need the "inverted port" treatment later anyway for ports; if a node's ports are free, just move the port to the other side on reversal.
- Greedy ELS cycle breaker, but with a deterministic tie-break (first in input order or lowest model order — ELK's is random, seeded with 1 by default). Weighted degrees via an edge `directionPriority` are cheap and useful (mermaid has no such input, but partition/constraint code can use it). Bucket lists are unnecessary below ~10⁴ nodes; keep the O(n²) scan.
- Network simplex exactly as in §2.2 including `removeSubtrees` (trees are the common case in flowcharts) and balancing. Integer everywhere: layers, slack, weights, cut values (`cut < 0`, no epsilon). Keep the `4·thoroughness·√n` pivot cap — it's what makes ELK "always finish". Keep the connected-component split or the artificial-root trick.
- Longest-path-from-sources is already inside NS (initial feasible layering); expose it as the "fast" strategy for free.
- Long-edge splitter/joiner with the `longEdgeSource/Target` end-port bookkeeping and the "i-th in ↔ i-th out" index invariant (or, simpler: one dummy carries exactly one edge, and a hyperedge merge step creates explicit multi-edge dummies). Copy edge properties onto segments; the original edge object stays the first segment.
- Layer constraints FIRST/LAST via §1.6 (reverse edges before cycle breaking) + §3.1 postprocessor (move to layer 0 / L−1, delete empty layers). Drop `*_SEPARATE` (hiding + restoring is 400 lines for a feature mermaid never expresses); a compound-graph "external port" layer can be added when needed.
- Partitions (mermaid subgraph "rank" alignment, or explicit rank constraints) as complete bipartite dummy edges between consecutive partitions: trivially correct with NS, and the weight pulls partitions tight. Guard against `|a|·|b|` blow-up by adding one hub dummy node per partition instead (a→hub→b): same constraint, O(|a|+|b|) edges; ELK doesn't bother.

**Simplify away / skip**
- All model-order and SCC cycle breakers, BF/DF model-order layerers, interactive breaker/layerer: nothing in our input has a meaningful "model order" beyond statement order, and greedy+deterministic tie-break already respects it for ties.
- Coffman–Graham, StretchWidth, MinWidth as layerers. If layer *width* (across-layer extent, i.e. terminal columns for TB) matters, the honest fix is wrapping or an explicit width-bounded layering; MinWidth's bookkeeping (§2.5: width = Σ node extents + spanning edges × dummy extent) is however exactly the integer formula you'd use in a bound check, so reuse the accounting, not the heuristic.
- NodePromotion: pointless after NS. HighDegreeNode treatment: skip until a real case shows up.
- Hyperedge merging: only if you draw orthogonal shared trunks; mermaid renders each edge separately.
- Layer unzipping: niche; the same effect for terminals is better obtained by wrapping.
- MULTI_EDGE wrapping with breaking points (3 processors, BPInfo chains, post-routing stitching, spline special cases): too much machinery. If wrapping is needed, take §6.2's cut computation and the SINGLE_EDGE stitching idea (rows stacked in-layer, wrapped edge = reversed long edge with extra spacing), or — simpler and usually better for a terminal — cut, then **lay out each row as its own subgraph** and draw the connecting edge as an explicit backward edge between rows. ELK never re-layouts; it keeps one layering so P3–P5 run once.

**Pitfalls seen in the code**
- `node.id` is scratch and re-assigned by every processor; do the same with typed scratch arrays, never persist ids.
- `layer.getIndex()` is `indexOf` — cache layer indices when you loop over edges.
- NS `balance()` assumes `delta=1`; if you ever use min lengths >1 (e.g. to reserve room for a label without a dummy node) fix it to use slack.
- NS on a disconnected NGraph NPEs; always split components or add a root.
- `leaveEdge` restarts the scan from the beginning each pivot; on big graphs a cyclic pointer (dot's `S_i` search) reduces pivots' cost noticeably; ELK compensates with the iteration cap.
- Greedy breaker: isolated nodes go to `sinks` (right side); fine, but it means they get the highest ranks — irrelevant for reversal, relevant if you reuse the ranks for anything else.
- Splitter skips graphs with ≤2 layers; with the "target not in this or next layer" test you never create a dummy for a length-1 edge, but self loops and in-layer edges (possible after LAST/FIRST moves? no — those are checked) must have been removed before.
- `EdgeAndLayerConstraintEdgeReverser` runs *before* cycle breaking, so a FIRST node with an incoming edge from a cycle ends up with a reversed edge that the breaker treats as normal; the breaker may reverse it *again* only if it's on a chosen back edge — ELK's `canReverse*` guards prevent double reversal only inside this processor, not in P1. With greedy ELS a source node can never be reversed away (it has indeg 0), so it's safe; with DFS it is not guaranteed.
- Dummy width in the layer direction is 0 (`size.x = 0`); a layer of only dummies has width 0 and lives on `spacing.*` alone. In cells an edge segment occupies a real cell: keep ELK's `(0, thickness)` dummy size but make the in-layer extent of a dummy exactly 1 cell (thickness = 1) and require the between-layer gap to be ≥ 1 cell so the segment has a column/row to live in. For TB terminal layouts (layers = rows) a dummy is one column of width 1 inside the row and the long edge is a run of `│` glyphs — the MinWidth accounting `Σ nodeWidth + #spanningEdges·1 + gaps` is then the exact row width, no estimation involved.

**Integer / terminal specifics**
- Everything in P1/P2 is already integer except NS weights/cut values and the size-normalised heuristics; use `int` throughout. Priorities stay small ints. `√n` cap: `Math.floor(Math.sqrt(n))`.
- Node "size" enters P2 only through MinWidth/StretchWidth/NodePromotion (all skipped) and through wrapping stats. For wrapping, replace "aspect ratio" by a hard **max width in cells** (terminal columns): the MSD loop becomes: for `m` cuts, greedily start a new row when `rowWidth + width(layer) > maxCols` (use `>` not `≥`, ELK overshoots), score = total height (rows × max row height); pick min height, tie → fewer cuts. Layer width in cells = `max(nodeWidth) + gap` for LR, `Σ(nodeWidth + gap) + #dummies·1` for TB.
- Thickness: ELK default 1 px ⇒ dummy in-layer extent 1 and port offset `⌊1/2⌋ = 0`; in cells thickness is literally 1 and the same formula holds.
- Determinism: use no RNG at all; pick "first in input order" for every tie (greedy candidate, min-slack edge, leave edge, balance target). ELK's only randomness in these phases is the greedy pick among max-outflow candidates (seeded, so reproducible, but input-order-blind).

---

## 3. Phase 3: crossing minimization and the port model

Source root `L/` = `plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/`
(commit 8aaa3c14). Everything below is left-to-right: ELK's `DirectionPreprocessor`
rotates other directions into LR before phase 1, so "north/south" always means
"non-flow sides" and "west/east" means "in/out sides".

### 0. Slot order around phase 3

Processors run in the order of the `IntermediateProcessorStrategy` enum within a slot
(`L/intermediate/IntermediateProcessorStrategy.java:65-131`). Relevant subset:

```
before P3:  LAYER_CONSTRAINT_POSTPROCESSOR, HIERARCHICAL_PORT_CONSTRAINT_PROCESSOR,
            SEMI_INTERACTIVE_CROSSMIN_PROCESSOR, LONG_EDGE_SPLITTER, PORT_SIDE_PROCESSOR,
            INVERTED_PORT_PROCESSOR, PORT_LIST_SORTER, SORT_BY_INPUT_ORDER_OF_MODEL,
            NORTH_SOUTH_PORT_PREPROCESSOR
P3:         LayerSweepCrossingMinimizer(BARYCENTER|MEDIAN) | InteractiveCrossingMinimizer | NoCrossingMinimizer
before P4:  ONE_SIDED_GREEDY_SWITCH | TWO_SIDED_GREEDY_SWITCH (same class, different CrossMinType),
            SELF_LOOP_PORT_RESTORER, IN_LAYER_CONSTRAINT_PROCESSOR, LABEL_AND_NODE_SIZE_PROCESSOR, ...
after P5:   ..., NORTH_SOUTH_PORT_POSTPROCESSOR, ...
```

Who adds what (`L/GraphConfigurator.java`, `L/p5edges/OrthogonalEdgeRouter.java:175-183`):
- `PORT_SIDE_PROCESSOR`: always; before P1 if `feedbackEdges=true`, else before P3 (`GraphConfigurator.java:213-218`).
- `INVERTED_PORT_PROCESSOR`: iff graph has `NON_FREE_PORTS` or `HYPEREDGES` or `feedbackEdges`.
- `NORTH_SOUTH_PORT_PRE/POSTPROCESSOR`: iff `NON_FREE_PORTS && NORTH_SOUTH_PORTS` (a FREE-port graph never gets N/S dummies: PortSideProcessor puts everything W/E).
- `PORT_LIST_SORTER`: added by the crossing minimizer itself (`L/p3order/LayerSweepCrossingMinimizer.java:642-648`; Interactive only if `NON_FREE_PORTS`).
- `SORT_BY_INPUT_ORDER_OF_MODEL`: iff `considerModelOrder.strategy != NONE` (`GraphConfigurator.java:331-334`).
- greedy switch: `activateGreedySwitchFor` (`GraphConfigurator.java:366-387`): non-hierarchical: `greedySwitch.type != OFF && !(semiInteractive || INTERACTIVE) && (threshold == 0 || threshold > #real nodes)`; hierarchical: root's `greedySwitchHierarchical.type != OFF` (default OFF), copied to all children (`L/ElkLayered.java:336-354`).

Graph flags come from the importer: `PortConstraints.UNDEFINED -> FREE`; anything but FREE sets `NON_FREE_PORTS` (`L/graph/transform/ElkGraphImporter.java:921-933`); a port on N/S (for LR) sets `NORTH_SOUTH_PORTS` (`:1050-1066`); a port with >1 edge sets `HYPEREDGES`.

### 1. The port model

#### 1.1 LPort (`L/graph/LPort.java`)

```ts
interface LPort extends LShape {          // LShape: position (top-left, node-relative), size
  id: number;                             // scratch int (LGraphElement.java:43); re-assigned by every phase
  owner: LNode;
  side: PortSide;                         // UNDEFINED|NORTH|EAST|SOUTH|WEST
  anchor: KVector;                        // where edges attach, relative to port position
  explicitlySuppliedPortAnchor: boolean;  // user gave org.eclipse.elk.port.anchor
  margin: LMargin;                        // space for port labels
  labels: LLabel[];
  incomingEdges: LEdge[]; outgoingEdges: LEdge[];   // getConnectedEdges() = concat
  connectedToExternalNodes: boolean;
}
```
- `setSide()` (`LPort.java:130-159`) re-centres the anchor on the chosen border unless explicitly supplied.
- `getIndex()` is `owner.ports.indexOf(this)` — linear (`:363-369`). "Port rank" is *not* a field: it lives in a `float[] portRanks` indexed by `port.id` inside the port distributor (see 4).
- `getNetFlow() = in - out` (`:248`) drives FREE side assignment.
- Every edge end is a port. Port-less nodes get one fresh LPort per edge end (`L/graph/LGraphUtil.java:433-475`, `createPort`); only `mergeEdges`/hypernodes share a collector port per side (`:615`). So hyperedges (ports with degree > 1) appear only with explicit user ports.

#### 1.2 Canonical port order

`LNode.getPorts()` is one list, **clockwise starting at the north-west corner**: north L→R, east T→B, south R→L, west B→T (`L/graph/LNode.java:225-229`). All per-side views are contiguous sublists (`getPortSideView`, `:287`; index ranges cached by `cachePortSides()` `:512`, valid only after `PortListSorter` and until a side changes). `CrossMinUtil.inNorthSouthEastWestOrder(node, side)` (`L/p3order/counting/CrossMinUtil.java:44-54`) returns N/E views as-is and reverses S/W, giving "top-to-bottom / left-to-right as seen on screen".

`PortSide` (`org.eclipse.elk.core.options.PortSide`): ordinal order UNDEFINED(0) N(1) E(2) S(3) W(4); `right()`=clockwise next, `left()`, `opposed()`.

#### 1.3 PortConstraints and where each level is enforced

| level | meaning (`PortConstraints.java`) | enforced by |
|---|---|---|
| UNDEFINED | importer maps to FREE | `ElkGraphImporter.java:923-925` |
| FREE | sides + order decided by layout | `PortSideProcessor` (side), sweep port distributor (order) |
| FIXED_SIDE | `isSideFixed()`; order free | side taken from `port.side` or derived from position (`LGraphUtil.initializePort` `:657-675`, `calcPortSide`: outside-box → that side; else nearest side by diagonal test); order by distributor |
| FIXED_ORDER | `isOrderFixed()`; order = `port.index` if set, else position | `PortListSorter` sorts once; distributors skip node; greedy port switch skips node |
| FIXED_RATIO | as FIXED_ORDER + ratio kept (`PORT_RATIO_OR_POSITION`, `LGraphUtil.java:678-699`) | phase 4/5 |
| FIXED_POS | order from positions only | `PortListSorter`; positions untouched |

Crossing minimization only distinguishes `isOrderFixed()` (skip) vs not (distribute). After P3 every node whose order was free is stamped `FIXED_ORDER` (`L/p3order/SweepCopy.java:120-124`), so later phases never reorder.

#### 1.4 PortSideProcessor (`L/intermediate/PortSideProcessor.java`)

1. Node with `isSideFixed()`: only ports with side UNDEFINED get a side (`:78-84`).
2. Otherwise all ports get a side and the node becomes `FIXED_SIDE` (`:85-91`).
3. `setPortSide(port)` (`:99-108`): port with a `PORT_DUMMY` (external-port dummy) copies `EXT_PORT_SIDE`; else `netFlow < 0` (more outgoing) → EAST, else WEST. Ties (in == out, or unconnected) → WEST.

Runs *after* cycle breaking by default, so reversed edges already point forward and no inverted ports arise from FREE nodes. With `feedbackEdges=true` it runs before P1, a reversed edge then leaves an east port going backwards → InvertedPortProcessor routes it around the node.

#### 1.5 PortListSorter (`L/intermediate/PortListSorter.java`)

- `isOrderFixed()`: sort by `CMP_COMBINED` = side ordinal, then `PORT_INDEX` (FIXED_ORDER only), then coordinate: N by x asc, E by y asc, S by x desc, W by y desc (`:214-261`).
- `isSideFixed()` only: stable sort by side (`CMP_PORT_SIDE`), then `reverseWestAndSouthSide` so that input order is preserved on screen, then optional `PORT_DEGREE` strategy: east ports by out-degree desc, west by in-degree asc, counting only non-`REVERSED` edges (`:76-84`, `:181-197`).
- Finally `node.cachePortSides()`.

**Bug**: `findPortSideRange` (`:110-131`) updates `currentSide` from `lowIdx` instead of `highIdx` (line 127) and stops at `size-1`, and `reverse` (`:139-149`) returns for ranges of ≤2 elements. Net effect: a 2-port W side is never reversed, a 4-port W side becomes `[W3,W2,W1,W4]`. Untested (`PortListSorterTest` only checks side grouping). Harmless in practice because the sweep re-sorts free-order ports anyway; only affects tie-breaking of unconnected/equal-barycenter ports. Don't copy.

#### 1.6 InvertedPortProcessor (`L/intermediate/InvertedPortProcessor.java`)

For every NORMAL node with `isSideFixed()` (`:109-146`): each edge *into* an EAST port and each edge *out of* a WEST port (self-loops excluded) is split at a new `LONG_EDGE` dummy placed **in the same layer** (W in-port, E out-port, `FIXED_POS`). East case (`:171-225`): original edge now ends at dummy.W, new edge dummy.E → east port (an in-layer edge). West case (`:241-294`): west port → dummy.W, dummy.E → original target. Head labels and `LONG_EDGE_SOURCE/TARGET` are propagated (`:312-343`). Consequence: the layering is no longer proper; every later step must tolerate in-layer edges.

#### 1.7 North/south ports → dummies (`L/intermediate/NorthSouthPortPreprocessor.java`)

`USE_NEW_APPROACH = true` (`:148`): one dummy per port, order left to crossing minimization. Per NORMAL node with fixed sides (`:167-300`):

1. If order not fixed and no model order: `sortPortList` (`:317-375`) reorders N/S ports so in-only ports are left, in/out middle, out-only right (north), mirrored for south; E/W untouched. With model order: incoming N/S ports are reversed instead (`:377-391`).
2. `node.IN_LAYER_LAYOUT_UNIT = node`.
3. North ports left→right: `createDummyNodes` (`:413-534`). Self-loops first: N→S loop → two one-port dummies (north out, south in, ports on EAST) (`:677-717`); same-side loop → one dummy with W in + E out, edge disconnected (`:627-659`). Then each remaining port → `createDummyNode` (`:552-613`): `NORTH_SOUTH_PORT` type, `FIXED_POS`; in-port → dummy gets a WEST port, all incoming edges rerouted to it; out-port → EAST port; in/out port → both. `port.PORT_DUMMY = dummy`, `dummyPort.ORIGIN = port`, `dummy.ORIGIN = node`, `CROSSING_HINT` = number of ports (1 or 2).
4. North dummies inserted in the layer *before* the node (`:213-246`), each with `IN_LAYER_LAYOUT_UNIT = node` and successor constraint `dummy → node` (unless the port has `allowNonFlowPortsToSwitchSides`).
5. South ports (list is R→L, so `addFirst` to get L→R), dummies inserted after the node with constraint `node → dummy` (`:250-294`).
6. All non-self-loop dummies are stored in `node.BARYCENTER_ASSOCIATES` (`:296-299`) so the node's barycenter includes them.

Postprocessor (`L/intermediate/NorthSouthPortPostprocessor.java`, after P5): every NS dummy is removed; edges reconnected to the origin port with one bend point at `(originPort.absoluteAnchor.x, dummy.y)` (`:146-206`), plus a junction point if the dummy served a single origin port with ≥2 ports; self-loop dummies get two bends (`:213-233`). Splines only record `SPLINE_NS_PORT_Y_COORD` (`:241-269`).

`allowNonFlowPortsToSwitchSides` (default false): with no successor constraint the dummy floats; after P3 `SweepCopy.assertCorrectPortSides` (`SweepCopy.java:148-184`) flips the port to SOUTH if its dummy ended up below the node (and vice versa), mirrors an explicit anchor, and re-sorts/caches the port list.

#### 1.8 Self-loops (port-side aspect only)

`SelfLoopPreProcessor` (before P2) detaches all self-loop edges from their ports and, unless the node is `FIXED_ORDER+` (or a compound with external ports), removes ports that carried only self-loops from the node (`L/intermediate/SelfLoopPreProcessor.java:85-120`). Crossing minimization never sees them. `SelfLoopPortRestorer` (before P4) puts them back: FREE/FIXED_SIDE → `PortSideAssigner` picks sides, then `PortRestorer` inserts them into the now-fixed port order (`L/intermediate/SelfLoopPortRestorer.java:50-80`). Self-loops on N/S ports that survive (fixed order) are handled by 1.7.

#### 1.9 In-layer constraint vocabulary (`L/options/InternalProperties.java`)

- `IN_LAYER_SUCCESSOR_CONSTRAINTS: List<LNode>` (`:206`): "this node must be above X". Producers: NS preprocessor (1.7), `HierarchicalPortConstraintProcessor` (chain of W/E external-port dummies for FIXED_ORDER parents, `:160-181`), `SemiInteractiveCrossMinProcessor` (see 9.5).
- `IN_LAYER_SUCCESSOR_CONSTRAINTS_BETWEEN_NON_DUMMIES` (`:213`): graph flag set only by SemiInteractive; switches the resolver into two-stage mode.
- `IN_LAYER_LAYOUT_UNIT: LNode` (`:188`): a NORMAL node and its NS dummies; units must not interleave.
- `BARYCENTER_ASSOCIATES: List<LNode>` (`:300`): nodes whose barycenter is folded into the owner's.
- `IN_LAYER_CONSTRAINT` TOP/BOTTOM (user option `layering.layerConstraint`-adjacent): **not** seen by crossing minimization; `InLayerConstraintProcessor` (before P4) simply moves TOP nodes to the front and BOTTOM nodes to the back of the layer afterwards (`L/intermediate/InLayerConstraintProcessor.java:62-100`).
- `inLayerPredOf/SuccOf`, `positionChoiceConstraint` options exist in `Layered.melk:450-484` but are only consumed by the interactive graph visitor, not by phase 3.

### 2. LayerSweepCrossingMinimizer (`L/p3order/LayerSweepCrossingMinimizer.java`)

#### 2.1 Setup

`process()` (`:109-137`): return early if empty graph or single node non-hierarchical. `initialize()` (`:609-630`) walks the graph hierarchy BFS, gives each `LGraph.id`, builds a `GraphInfoHolder` per graph; graphs with `dontSweepInto()` (bottom-up roots) are collected in reverse BFS order (children first).

`GraphInfoHolder` (`L/p3order/GraphInfoHolder.java:80-124`) per graph: `currentNodeOrder: LNode[][]` (layers × nodes, *the* working state), `AllCrossingsCounter`, port distributor, `LayerSweepTypeDecider`, and the heuristic:
- BARYCENTER (default): `ForsterConstraintResolver` + `BarycenterHeuristic`, or `ModelOrderBarycenterHeuristic` if `forceNodeModelOrder`.
- MEDIAN: `MedianHeuristic`.
- ONE/TWO_SIDED_GREEDY_SWITCH: `GreedySwitchHeuristic`.
Port distributor (`L/p3order/ISweepPortDistributor.java:55-64`): TWO_SIDED greedy → `GreedyPortDistributor`; otherwise a **coin flip** between `NodeRelativePortDistributor` and `LayerTotalPortDistributor` ("neither is clearly better").

All of these implement `IInitializable` (`L/p3order/counting/IInitializable.java:36-63`): one traversal layer→node→port→edge assigns `layer.id = l`, `node.id = index in layer`, `port.id = global running index`, and sizes the arrays (`portRanks`, `portPositions`, barycenter states, ...).

Working state, stripped to what matters:
```ts
interface SweepState {
  order: LNode[][];                 // order[layer][pos]; mutated in place
  // node.ports is mutated in place too — port order is part of the state
  portRanks: Float32Array;          // by port.id; recomputed for one layer at a time
  portBary:  Float32Array;          // by port.id; per-port sort key, 0 = unset
  bary: { sum: number; deg: number; value: number | null; visited: boolean }[][]; // [layer][node]
  nodePos: Int32Array[];            // [layer][node.id] -> index in layer (for in-layer/N-S keys)
  best: { order: LNode[][]; ports: LPort[][][] } | null;     // SweepCopy
  bestCrossings: number;
}
```

#### 2.2 Top level: restarts and best-of

`chooseMinimizingMethod` (`:139-148`):
- heuristic not deterministic (barycenter) → `compareDifferentRandomizedLayouts`
- deterministic and `alwaysImproves` (two-sided greedy) → `minimizeCrossingsNoCounter`
- deterministic otherwise (one-sided greedy, median) → `minimizeCrossingsWithCounter` once.

`compareDifferentRandomizedLayouts` (`:185-231`):
1. Reset RNG to the seed captured in `initialize` (so identical child graphs lay out identically).
2. `thoroughness` (default 7, `Layered.melk:1265`) times: run `minimizeCrossingsWithCounter`; if its crossing count beats the best, snapshot all changed graphs (`saveAllNodeOrdersOfChangedGraphs`, `:545-549`); stop at 0.
3. With `considerModelOrder.strategy != NONE`, `FIRST_TRY_WITH_INITIAL_ORDER` makes try 1 start forward from the *existing* (model) order, try 2 backward from it (`SECOND_TRY`), later tries random (`:246-260`).
4. Note the copy-paste bug at `:193-194`: the `if` tests `CROSSING_COUNTER_NODE_INFLUENCE` twice, so `PORT_INFLUENCE` alone never activates the weighted counter.

`minimizeCrossingsWithCounter` (`:233-277`):
```
dir = random bool
if initial crossings == 0 and FIRST_TRY: return 0             // keep model order untouched
crossMinimizer.setFirstLayerOrder(order, dir)                  // barycenter: shuffle first layer
sweepReducingCrossings(dir, firstSweep=true)
c = countAllCrossings
loop: snapshot current as "currently best"; if c==0 return 0
      dir = !dir; old = c; sweep(dir, firstSweep=false); c = count
      while c < old
return old
```
Snapshots are `SweepCopy` (`L/p3order/SweepCopy.java:53-63`): deep copy of `LNode[][]` plus a copy of every node's port list (port order is mutated in place by distributors, so it must be captured too). `getBestSweep()` = "currently best" for deterministic heuristics, else the best over restarts (`GraphInfoHolder.java:234-236`). At the end `transferNodeAndPortOrdersToGraph` (`SweepCopy.java:93-142`) writes node order into `Layer.nodes`, port lists into nodes, sets `FIXED_ORDER`, fixes flipped N/S sides.

#### 2.3 One sweep (`sweepReducingCrossings`, `:450-469`)

```
nodes = currentNodeOrder; first = forward ? 0 : L-1
portDistributor.distributePortsWhileSweeping(nodes, first, forward)   // first layer: only its own ports
sweepInHierarchicalNodes(nodes[first])                                 // 2.4
for i = first±1 .. end:
    crossMinimizer.minimizeCrossings(nodes, i, forward, firstSweep && !model-order-try)
    portDistributor.distributePortsWhileSweeping(nodes, i, forward)    // re-sorts ports of layer i AND of the fixed layer's facing side
    sweepInHierarchicalNodes(nodes[i])
```
Forward = layers left→right with the *left* neighbour fixed; backward mirrors. Node order and port order are refined alternately inside one sweep: the free layer's node order uses port ranks of the fixed layer; then the free layer's west ports are sorted by the ranks they connect to; then the fixed layer's *east* ports are re-sorted against the new free-layer order (4.2).

#### 2.4 Hierarchy (`crossingMinimization.hierarchicalSweepiness`, default 0.1)

`LayerSweepTypeDecider.useBottomUp()` (`L/p3order/LayerSweepTypeDecider.java:66-138`): bottom-up (child laid out alone first) if `sweepiness < -1`, root graph, parent's port order fixed, parent has <2 ports on both W and E, or heuristic deterministic → *not* bottom-up. Otherwise propagate two counters through the child's DAG (`:76-134`): sources that are external-port dummies carry "hierarchical influence", sources without west ports carry "random influence" (their order is decided by random barycenters); each edge adds the source's influence to path counts; `normalized = (pathsToRandom - pathsToHierarchical) / all ∈ [-1,1]`; bottom-up iff `normalized >= sweepiness`. Intuition: if the child's order is mostly dictated by its own random sources, lay it out bottom-up; if mostly by cross-hierarchy edges, sweep into it.

Sweeping into a child (`sweepInHierarchicalNode`, `:482-502`): the child's first layer consists of external-port dummies; order them by the parent node's port order on the side facing the sweep (`sortPortDummiesByPortPositions`, `:525-543`), sweep the child, then order the parent's ports on the far side by the last layer's dummy order (`sortPortsByDummyPositionsInLastLayer`, `:504-523`). Bottom-up children instead get minimized first and then fix the parent's port order to `FIXED_ORDER` (`setPortOrderOnParentGraph`, `:162-170`). Crossing counts recurse into swept-into children (`:392-409`). All child graphs must use the same strategy as the root (`ElkLayered.java:339-347`).

### 3. BarycenterHeuristic (`L/p3order/BarycenterHeuristic.java`)

State per node: `BarycenterState {summedWeight, degree, barycenter: number|null, visited}` (`:287-316`), indexed `[layer.id][node.id]`, shared with the resolver.

`minimizeCrossings(order, freeIdx, forward, isFirstSweep)` (`:336-355`):
1. Unless this is the first layer, `portDistributor.calculatePortRanks(fixedLayer, forward ? OUTPUT : INPUT)` (4.1).
2. `preOrdered = !isFirstSweep || first node is an EXTERNAL_PORT dummy`.
3. `calculateBarycenters` then `fillInUnknownBarycenters`, sort, resolve constraints (`:77-104`).

`calculateBarycenter(node, forward)` (`:218-278`), memoised via `visited`:
```
deg = 0; sum = 0
for port of node.ports:
  for fixedPort of (forward ? port.predecessorPorts : port.successorPorts):
    fixedNode = fixedPort.node
    if fixedNode.layer == node.layer:            // in-layer edge (inverted-port dummy etc.)
        if fixedNode != node: recurse; deg += its deg; sum += its sum    // self-loops ignored
    else: sum += portRanks[fixedPort.id]; deg++
for assoc of node.BARYCENTER_ASSOCIATES in same layer: recurse; deg += ; sum +=
if deg > 0: sum += rand()*0.07 - 0.035; bary = sum/deg     // RANDOM_AMOUNT = 0.07f (:204)
else bary = null
```
Note: `predecessorPorts` = sources of incoming edges regardless of which layer they are in; with a non-proper layering (long edges split, so neighbours are always adjacent) this is fine. In-layer recursion is not cycle-safe ("such cases do not occur").

`fillInUnknownBarycenters` (`:129-181`): `preOrdered` → each null node gets the midpoint between the previous value (starts at -1) and the next defined value in current order (keeps unconnected nodes where they are); else → uniform random in `[-1, maxBary+1)`.

`setFirstLayerOrder` (`:358-373`) = random barycenters in `[0,1)` for the first layer, sort, resolve constraints. Comparator (`:321-333`): nulls last. Sort is `Collections.sort` (stable mergesort) — ties keep previous order. `alwaysImproves=false`, `isDeterministic=false`.

### 4. Port ranks and port distribution

#### 4.1 Ranks (`L/p3order/AbstractBarycenterPortDistributor.java`, subclasses)

`calculatePortRanks(layer, type)` (`:123-128`) walks the fixed layer top→bottom, `consumedRank += calculatePortRanks(node, consumedRank, type)`:

- `LayerTotalPortDistributor` (`L/p3order/LayerTotalPortDistributor.java:41-89`): OUTPUT ports get `rankSum+1, +2, ...` in list order (N L→R, E T→B, S R→L, W B→T), node consumes `#outputs`. INPUT ports: north inputs get `rankSum+northCount ... rankSum+1` (counting down L→R), all others get `rankSum+inCount ... ` counting down in list order; node consumes `#inputs`. Result for inputs: ascending rank = N right→left, W top→bottom, S left→right, E bottom→top = counter-clockwise from the NE corner, i.e. top-to-bottom as seen from the *right* layer. Integers, node weight ∝ port count.
- `NodeRelativePortDistributor` (`L/p3order/NodeRelativePortDistributor.java:46-104`): same orders but each node owns `[rankSum, rankSum+1]`, ports at `incr = 1/(count+1)` steps; consumes exactly 1. All nodes weigh the same regardless of degree.
- Only ports with edges of that type get ranks (`getPorts(PortType)` filters by non-empty edge list); unconnected ports keep stale `portRanks` values.

#### 4.2 Distributing free ports (`distributePortsWhileSweeping`, `:83-112`)

For layer `i`, side `s = forward ? WEST : EAST`:
1. If `i` is not the first layer: recompute ranks of the fixed layer (`forward ? OUTPUT : INPUT`), `distributePorts(node, s)` for every node in layer `i`; then recompute ranks of layer `i` for the *opposite* type and `distributePorts(node, s.opposed())` for every fixed-layer node without a nested graph.
2. First layer: only `distributePorts(node, s)`.
3. Always returns `false` (never claims improvement).

`distributePorts(node, side)` (`:152-161`): skipped if `isOrderFixed()`. Computes per-port barycenters for the ports on `side`, on SOUTH and on NORTH, then re-sorts the *whole* port list (`sortPorts`, `:351-374`) by (side ordinal, barycenter asc), treating `0` as "unset" and putting unset first. Untouched sides keep stale barycenters, so their relative order is preserved by the stable sort.

Per-port barycenter (`iteratePortsAndCollectInLayerPorts`, `:179-236`):
- W/E port: `sum += rank(target)` per outgoing edge, `sum -= rank(source)` per incoming edge; `bary = sum/degree`. The sign trick makes ascending order correct on both sides given that west ports are listed bottom→top: a west port fed by a low neighbour (large rank) gets a very negative value → first in list → bottom.
- Any edge to a node in the same layer marks the port as in-layer; handled afterwards (`calculateInLayerPortsBarycenterValues`, `:238-280`): mean 1-based index of connected in-layer nodes vs own index; edges pointing up → push port to the top of its side (E: `min - bary`, W: `max + bary`), pointing down → bottom (E: `max + (layerSize - bary)`, W: `min - (layerSize - bary)`), using the min/max barycenter of the regular ports on that node so in-layer ports land outside the regular range.
- N/S port with a dummy (`dealWithNorthSouthPorts`, `:282-317`), using `pos = index of dummy in current layer order`: north in-port `-pos` (closer dummy → more negative → further left), north out-port `pos+1`, north in/out `0`; south in-port `BIG - pos`, out `pos+1`, in/out `BIG/2` with `BIG = 2*layerSize+1`. This is exactly the order in which the vertical stubs don't cross the horizontal dummy segments.

#### 4.3 GreedyPortDistributor (`L/p3order/GreedyPortDistributor.java`, two-sided greedy only)

Initialise a `CrossingsCounter` for (prev, free) or (free, next) layer pair, or for in-layer on the border layer (`:131-140`). For each free-order node, take the ports on the sweep-facing side in top-down order (`:75-97`) and bubble adjacent pairs while `countCrossingsBetweenPortsInBothOrders(upper, lower)` says swapped is strictly better (`:106-122`); for compound nodes with a nested graph add crossings inside the child via `BetweenLayerEdgeTwoNodeCrossingsCounter` on the external-port dummies. Returns whether anything switched.

### 5. ForsterConstraintResolver (`L/p3order/ForsterConstraintResolver.java`)

Input: layer list already sorted by barycenter, all barycenters non-null (assert `:239`).

1. `processConstraints(nodes)` (`:131-142`): if the graph has constraints between regular nodes, first resolve only those (stage 1), re-init groups, then run stage 2 with everything.
2. `buildConstraintsGraph` (`:176-221`): one `ConstraintGroup` per node; edges from `IN_LAYER_SUCCESSOR_CONSTRAINTS`; additionally, in stage 2, walking the sorted list, every node of the previous NORMAL node's layout unit gets an edge to every node of the current NORMAL node's layout unit — this is what keeps a node's N/S dummies adjacent to it and units in the same relative order the barycenters chose for the normal nodes.
3. `findViolatedConstraint` (`:233-286`): Kahn-style traversal from sources; a predecessor with greater barycenter, or equal (float-compared) barycenter but later index, is a violation. Returns `(predecessor, successor)`.
4. `handleViolatedConstraint` (`:303-348`): merge both groups into one (`ConstraintGroup(g1,g2)`, `:408-454`), reinsert it in barycenter order, redirect constraints of other groups to the merged group, decrement counts for successors of both.
5. Loop until no violation; flatten groups to the node list; each node's barycenter := group barycenter (`:159-166`).

Merged barycenter: `summedWeight/degree` if `degree > 0`, else average of the two group values. Single-node groups never copy `summedWeight/degree` from the barycenter state, so in practice a merge is always the **plain mean of the two barycenters**, not the degree-weighted one Forster describes. Merged node arrays keep g1 before g2, so a chain of N/S dummies and their node end up contiguous in constraint order.

### 6. Crossing counting (`L/p3order/counting/`)

#### 6.1 CrossingsCounter — everything becomes one sorted line

Core primitive (`countCrossingsOnPorts`, `CrossingsCounter.java:366-385`): ports carry integer positions (`portPositions[port.id]`); walk ports by increasing position, for each port: `tree.removeAll(pos)` (edges ending here are closed), then for every edge whose other end has a larger position: `crossings += tree.rank(end)` (= number of open edges whose end is < this end, i.e. that must cross), push the end; then add all pushed ends. Edges ending at the same position (same port) do not count as crossing each other. `BinaryIndexedTree` (`BinaryIndexedTree.java:38-119`): Fenwick tree with `add`, `rank(i)` = count of stored values `< i`, `removeAll(i)`, `size`. O(log n) each; `clear()` reallocates.

```ts
// positions: Int32Array by port.id, filled by one of the init* methods below
function countOnPorts(ports: LPort[] /* sorted by position */, edgesOf: (p: LPort) => [LPort, number][]): number {
  const tree = new Fenwick(ports.length); let x = 0; const ends: number[] = [];
  for (const p of ports) {
    tree.removeAll(pos(p));
    for (const [q, w] of edgesOf(p)) if (pos(q) > pos(p)) { x += w * tree.rank(pos(q)); ends.push(pos(q)); }
    while (ends.length) tree.add(ends.pop()!);
  }
  return x;
}
```

Three problems mapped onto it (class doc `:38-135`):
- **Between-layer** (`countCrossingsBetweenLayers`, `:169-174`): positions = left layer's EAST ports top→down, then right layer's WEST ports bottom→up (`initPortPositionsCounterClockwise`, `:479-485`) — "fold the right layer down". Counts in-layer edges on those sides too.
- **In-layer on one side** (`countInLayerCrossingsOnSide`, `:185-188`, `:387-411`): positions top→down on that side; only in-layer edges enter the tree; each between-layer edge at a port adds `tree.size()` (it crosses every in-layer edge spanning the port).
- **North/south** (`countNorthSouthPortCrossingsInLayer`, `:198-202`, positions `:490-555`, counting `:413-458`): walk the layer top→down; NORMAL node: its north ports (those with a `PORT_DUMMY`) L→R, then pop the stack of pending dummies' EAST ports (LIFO → bottom-up), then south ports in list order (R→L); NS dummy: WEST port indexed now, node pushed if it has an EAST port; long-edge dummy: WEST indexed, pushed; whenever the layout unit changes, flush the stack. Then virtual edges: origin N/S port → its dummy's ports (weighted by port degree), long-edge dummy W → E, dummy port → origin port. This counts crossings among the horizontal N/S stubs and between them and long edges passing the node.

Incremental helpers for greedy switching: `countCrossingsBetweenPortsInBothOrders` (`:217-230`) and `countInLayerCrossingsBetweenNodesInBothOrders` (`:245-258`) count only the ports involved, swap positions (`switchPorts` `:301-305`, `switchNodes` `:319-329` shifting by `nodeCardinalities`), count again, swap back.

#### 6.2 HyperedgeCrossingsCounter (`HyperedgeCrossingsCounter.java:154-381`)

Used for a layer pair only if some port there has >1 edge (`AllCrossingsCounter.java:101-111`). Spönemann/Schulze/Rüegg/von Hanxleden, DIAGRAMS 2014: merge edges sharing a port into hyperedges (union of ports), each hyperedge gets `upperLeft/lowerLeft/upperRight/lowerRight` port positions (left positions: output ports in list order; right: north inputs first, then the rest reversed — `:155-213`); count (1) crossings of the "top" edges `(upperLeft,upperRight)` with the classic accumulator tree (`:285-328`), (2) overlaps of vertical spans on the left (`:331-353`) and (3) on the right (`:356-378`). An estimate, not exact.

#### 6.3 AllCrossingsCounter (`AllCrossingsCounter.java:61-92`)

`total = inLayer(first layer, WEST) + inLayer(last layer, EAST) + Σ_i [hyper_i ? hyperedge(i,i+1) + inLayer(i,EAST) + inLayer(i+1,WEST) : between(i,i+1)] + Σ_i [hasNSdummies_i ? northSouth(i) : 0]`. This integer is what "best sweep" compares. In-layer counting relies on `node.id` being the index within the layer at init time; the counter never updates ids, it re-derives positions from the passed `LNode[][]`.

### 7. Greedy switch (`L/intermediate/greedyswitch/`)

Same sweep driver, `CrossMinType.ONE_SIDED_GREEDY_SWITCH | TWO_SIDED_GREEDY_SWITCH`, slot before P4, so it post-processes the barycenter result (defaults: `greedySwitch.type = TWO_SIDED`, `activationThreshold = 40` real nodes, hierarchical OFF).

`GreedySwitchHeuristic` (`GreedySwitchHeuristic.java`): per free layer, build a `SwitchDecider` with side WEST (forward) or EAST (backward); repeat "sweep down the layer, swap adjacent pairs when `doesSwitchReduceCrossings`" until a pass makes no switch (`:90-129`). `setFirstLayerOrder` does one such pass on the first layer too. `isDeterministic = true`; `alwaysImproves = !ONE_SIDED`.

`SwitchDecider.doesSwitchReduceCrossings(u, l)` (`SwitchDecider.java:124-157`): refuse if `constraintsPreventSwitch` (`:171-243`: successor constraint u→l; different multi-node layout units, or u has north edges / l has south edges; NORMAL vs NS dummy). Otherwise `crossings(u above l) > crossings(l above u)` where each side sums: crossing-matrix entry (between-layer edges of the two nodes, one side for ONE_SIDED, both sides for TWO_SIDED, `CrossingMatrixFiller.java:53-78`, lazily filled, indexed by `node.id`), in-layer crossings on both sides (`CrossingsCounter` in both orders), N/S crossings (`NorthSouthEdgeNeighbouringNodeCrossingsCounter.java:83-147`: two NS dummies of the same node ordered against their port order; NS dummy vs long-edge dummy = 1; NORMAL with N/S stubs vs long-edge dummy = number of stubs on the side crossed), and for external-port dummies of a swept-into child, crossings in the parent (`:85-101`, `:147-154`).

`BetweenLayerEdgeTwoNodeCrossingsCounter` (`BetweenLayerEdgeTwoNodeCrossingsCounter.java`): neighbour-layer ports numbered top→down in N-S-E-W screen order (`:64-89`; despite the doc, ports of free-order nodes get distinct positions); per node a sorted adjacency list of (neighbour port position, multiplicity); merge the two lists (`:210-225`): if `u.first > l.first` then `ul += |u|` and drop `l.first`; symmetric; if equal, both sides add "remaining adjacencies below the current node of the first port". O(deg) per pair, cached per node.

Two-sided is what `minimizeCrossingsNoCounter` (`LayerSweepCrossingMinimizer.java:173-183`) drives: alternate directions until a full sweep changes nothing, no global counting. One-sided uses `minimizeCrossingsWithCounter`, one run.

### 8. Other minimizers

- `MedianHeuristic` (`L/p3order/MedianHeuristic.java`, `MEDIAN_LAYER_SWEEP`): first layer gets random weights then integer weights 1..n (`:61-83`); each free node's weight = the median (upper for even) of its neighbours' weights in the reference layer (`:116-171`); unconnected nodes get `(min+max)/2` — but `min` is initialised to `Double.MIN_VALUE` (positive tiny) and `max` to `Double.MAX_VALUE` (`:118-119`), so they always go last. Declares `isDeterministic = true` despite using the RNG, so it runs a single time without restarts. Ports are still distributed by the barycenter distributor; no constraint resolution at all.
- `InteractiveCrossingMinimizer` (`L/p3order/InteractiveCrossingMinimizer.java:76-151`): sort each layer by previous y (`getPos`, `:160-234`: long-edge dummies interpolate the original edge polyline at the layer's mean x; NS dummies use their node's top/bottom edge; ties broken by successor constraints), then `NodeRelativePortDistributor.distributePortsWhileSweeping(layer, forward)` once per layer.
- `NoCrossingMinimizer` (`L/p3order/NoCrossingMinimizer.java`): nothing; order = whatever the pre-P3 processors (model order sorter) left. Set greedy switch OFF or it will reorder.

### 9. Model order ("considerModelOrder")

Import: nodes get `MODEL_ORDER` = index among siblings, edges = index among contained edges, ports = index within node (`ElkGraphImporter.java:236-262`, `:936-945`); `MAX_MODEL_ORDER_NODES` on the graph. Long-edge dummies have no `MODEL_ORDER`.

#### 9.1 SortByInputModelProcessor (`L/intermediate/SortByInputModelProcessor.java:59-102`, before P3)

Per layer (with `layer.id` set): insertion-sort nodes with `ModelOrderNodeComparator(beforePorts=true)`; for every node whose ports are not FIXED_ORDER/FIXED_POS, `Collections.sort` the ports with `ModelOrderPortComparator`; insertion-sort nodes again (`beforePorts=false`). Insertion sort is deliberate: the comparator is not a total order (dummies vs model order), and insertion sort never moves a real node past another real node the comparator forbids (`:158-171`). Both comparators memoise decisions in transitive `biggerThan/smallerThan` sets and are cleared after each sort.

#### 9.2 ModelOrderNodeComparator (`L/intermediate/preserveorder/ModelOrderNodeComparator.java:117-283`)

Order of decisions when `strategy == PREFER_EDGES` or either node lacks a model order (i.e. is a dummy):
1. Find each node's first port with an incoming edge from the *previous* layer (`layer.id - 1`).
2. Both found, same source node → order by the source ports' order on that node (`:174-202`).
3. Both found, different sources → order of the source nodes in the previous layer (`:207-215`).
4. Exactly one found → `handleHelperDummyNodes` (`:330-484`: long-edge dummies of feedback edges are ordered relative to the real node they loop around: below their source/target, else compared through that reference node); then, if one is a dummy, compare first-incoming-edge model orders, missing edge → `longEdgeStrategy.returnValue()` (`DUMMY_NODE_OVER` default: dummies above unconnected nodes).
5. Neither found → helper-dummy check, then fall through.
Fallthrough / `NODES_AND_EDGES` / `PREFER_NODES`: compare node model order (via `CMGroupModelOrderCalculator`, `:268-276`); no model order on both → arbitrary but memoised `-1`.

#### 9.3 ModelOrderPortComparator (`L/intermediate/preserveorder/ModelOrderPortComparator.java:107-351`)

Side ordinal first. Then both-incoming: `reverseOrder = -1` for W/N/S sides (list order is reversed on screen there); same source node → source port order; both from long-edge dummies in the *same* layer → order of those dummies; else order of the source nodes in the previous layer; else (`portModelOrder`) port model order. Both-outgoing: `PREFER_NODES` → model order of the (long-edge) target nodes (`LONG_EDGE_TARGET_NODE`, precomputed by `longEdgeTargetNodePreprocessing`, `SortByInputModelProcessor.java:109-132`); else port model order if enabled; else edge model order, with ports to the same target node sharing the minimal model order (`TARGET_NODE_MODEL_ORDER`) so they bundle. Mixed: outgoing before incoming. No edges: port model order, else arbitrary.

#### 9.4 During the sweep

- `FIRST/SECOND_TRY_WITH_INITIAL_ORDER` (2.2) give the pre-sorted order two chances (forward, backward) before random restarts; with `firstSweep` disabled on those tries, unconnected nodes keep their model position (`preOrdered` interpolation).
- `crossingCounterNodeInfluence` / `PortInfluence` (defaults 0): `minimizeCrossingsNodePortOrderWithCounter` (`LayerSweepCrossingMinimizer.java:279-323`) scores `crossings + nodeInfluence * #node-pairs-out-of-model-order + portInfluence * #port-pairs-out-of-order` (`:334-386`, O(n²) per layer, comparator instantiated per layer/node). Docs recommend small values (0.001–0.1) so crossings still dominate.
- `forceNodeModelOrder` (default false): `ModelOrderBarycenterHeuristic` (`L/p3order/ModelOrderBarycenterHeuristic.java`): comparator = transitive memo → model order (or group order, unless `cmGroupOrderStrategy == ONLY_WITHIN_GROUP` and groups differ) → barycenter (`:65-105`); layers sorted by insertion sort; **no constraint resolver** (`:136-138`). Real nodes never reorder; only dummies move between them.
- Group model order (`groupModelOrder.crossingMinimizationId`, `cmGroupOrderStrategy`, `cmEnforcedGroupOrders`, `CMGroupModelOrderCalculator.java:30-51`): `ENFORCED` compares `groupId * maxModelOrder + modelOrder` for elements whose groups are both in the enforced list, else plain model order.

#### 9.5 SemiInteractiveCrossMinProcessor (`L/intermediate/SemiInteractiveCrossMinProcessor.java:55-85`)

For NORMAL nodes carrying `org.eclipse.elk.position`: sort by y, chain successor constraints, set `IN_LAYER_SUCCESSOR_CONSTRAINTS_BETWEEN_NON_DUMMIES`. The barycenter sweep then keeps that order via Forster; greedy switch is disabled when this is on.

### 10. Options and defaults (`L/Layered.melk`, `Core.melk`)

| option | default | notes |
|---|---|---|
| `crossingMinimization.strategy` | LAYER_SWEEP | LAYER_SWEEP, MEDIAN_LAYER_SWEEP, INTERACTIVE, NONE (`CrossingMinimizationStrategy.java:67-77`) |
| `thoroughness` | 7 | number of random restarts (`melk:1265`) |
| `crossingMinimization.greedySwitch.type` | TWO_SIDED | ONE_SIDED, TWO_SIDED, OFF |
| `...greedySwitch.activationThreshold` | 40 | greedy only if `#nodes < threshold` (0 = always) |
| `...greedySwitchHierarchical.type` | OFF | only root value counts |
| `...hierarchicalSweepiness` | 0.1 | ∈[-1,1]; < -1 forces bottom-up (`melk:385`) |
| `...semiInteractive` | false | (`melk:439`) |
| `...forceNodeModelOrder` | false | (`melk:374`) |
| `considerModelOrder.strategy` | NONE | NODES_AND_EDGES, PREFER_EDGES, PREFER_NODES |
| `considerModelOrder.portModelOrder` | false | ports ordered by their own index instead of edges (`melk:1064`) |
| `considerModelOrder.longEdgeStrategy` | DUMMY_NODE_OVER | |
| `considerModelOrder.crossingCounterNodeInfluence/PortInfluence` | 0 | (`melk:1099`, `:1111`) |
| `considerModelOrder.groupModelOrder.crossingMinimizationId` | 0 | per node/edge/port (`melk:1134`) |
| `considerModelOrder.groupModelOrder.cmGroupOrderStrategy` | ONLY_WITHIN_GROUP | |
| `feedbackEdges` | false | PortSideProcessor before P1 → inverted ports for reversed edges (`melk:1202`) |
| `allowNonFlowPortsToSwitchSides` | false | per port (`melk:1243`) |
| `portSortingStrategy` | INPUT_ORDER | or PORT_DEGREE (`melk:1256`) |
| `portConstraints` (core) | UNDEFINED→FREE | per node |
| `portAlignment.default` (core) | DISTRIBUTED | JUSTIFIED, BEGIN, CENTER, END; per-side overrides; phase 4+ only |
| `port.side` / `port.index` / `port.anchor` / `port.borderOffset` (core) | UNDEFINED / – / – / – | inputs to PortListSorter / initializePort |
| `crossingMinimization.inLayerPredOf/SuccOf`, `positionChoiceConstraint` | null | not consumed by phase 3 |

### 11. Gotchas seen in the code

1. `PortListSorter.reverseWestAndSouthSide` is wrong (1.5). 2. `LayerSweepCrossingMinimizer:193-194` tests node influence twice. 3. `MedianHeuristic` min/max init and false `isDeterministic`. 4. Forster merge uses the mean of barycenters, not degree-weighted (5). 5. Port distributor treats barycenter exactly `0` as "unset" (`AbstractBarycenterPortDistributor.java:362-367`). 6. Everything keys on `port.id`/`node.id` scratch ints that every phase overwrites; the counter's `node.id` must be the index-in-layer from init time. 7. The port distributor chosen per graph is random; two runs with different seeds differ in port order style, not just node order. 8. `RANDOM_AMOUNT` noise on every barycenter means ties are broken randomly even with thoroughness 1. 9. `BetweenLayerEdgeTwoNodeCrossingsCounter` can undercount with hyperedges into free-order ports (its own doc). 10. Sweep-into hierarchy needs external-port dummies in the first/last layers; bottom-up path fixes the parent's port order to FIXED_ORDER permanently.

### 12. For our engine

**Adopt**
- The port list as *the* node-order primitive: one clockwise list from the NW corner, contiguous per-side ranges with cached indices, per-side view helpers. Every edge end is a port; FREE nodes get one port per edge end (ELK does exactly this). Hyperedge = a port with degree > 1, only if we ever let users share ports.
- Side assignment for FREE ports: after cycle breaking, by net flow (`in > out` → west, else east). Never run it before cycle breaking (that is what produces inverted ports). For TB flow, rotate to LR first like ELK, so "west/east" is the only pair phase 3 knows.
- The sweep: `thoroughness` restarts × alternating sweeps until the exact crossing count stops improving; keep the best `(nodeOrder[][], portOrder[][])` snapshot. With integers, "improved" is a plain `<`.
- Barycenter over **port ranks**, `NodeRelative` or `LayerTotal` flavour — pick one deterministically (LayerTotal is already integer: ranks 1..k per layer). Node barycenter = sum(rank of neighbour ports) / degree; port barycenter = ±rank per edge; sort node's ports on the facing side by it; re-sort the fixed layer's facing side after ordering the free layer. Keep ratios as `(num, den)` pairs or fixed-point ×2^k — no floats needed, and no random perturbation: break ties by input order (stable sort) and use restarts for diversity.
- `fillInUnknownBarycenters` behaviour: unconnected nodes keep their slot between neighbours after the first sweep.
- Forster resolver: needed as soon as we have any in-layer constraint (N/S dummies, "keep A above B", compound port chains). Implement the group-merge exactly; use the mean of the two barycenters like ELK (it works and avoids carrying degrees).
- `CrossingsCounter` + Fenwick tree for exact counting: between-layer via the fold, in-layer via the `size()` trick. ~150 lines, all integer. Skip the hyperedge estimator until ports can be shared.
- Two-sided greedy switch as a cheap post-pass for small graphs (< 40 nodes): crossing matrix from adjacency-list merging, in-layer counts via the incremental counter. Do this *after* node/port order is fixed; it only ever improves.
- Compound graphs: bottom-up only (child laid out alone → its external port order becomes FIXED_ORDER on the parent node). Sweeping into children (sweepiness) is a lot of machinery for modest gain.

**Simplify away**
- `SweepCopy`, `GraphInfoHolder`, `IInitializable`: two arrays and an init loop.
- The three port-side processors' dummy zoo: with FREE ports and LR flow there are no N/S ports and no inverted ports, so `InvertedPortProcessor`, `NorthSouthPort*` and layout units are not needed for v1. When constraints arrive, add them in this order: FIXED_SIDE W/E (free), inverted ports (in-layer dummy + in-layer edge support in barycenter, counter and port distribution), then N/S ports (dummies + successor constraints + Forster + the N/S counter).
- Model order: replace all of section 9 with "initial order = input order; stable sorts; input-order tie-break; try the initial order as restart #1 and keep it if it is crossing-minimal" (that is what `FIRST_TRY_WITH_INITIAL_ORDER` + stable sort + zero influence gives). The comparator zoo exists to keep layouts stable under edits; input order as tie-break gets most of it.
- Median, interactive, semi-interactive, group model order, `portSortingStrategy`: skip.

**Port capacity per side (terminal)**
- ELK has none: ports are continuous coordinates, phase 4 places them by `portAlignment`. In a terminal a node of height `h` cells has at most `h` (or `h-2` excluding corners) distinct west cells. Phase 3 should stay capacity-agnostic (it only produces an order); capacity is a phase-4/5 concern: assign cells to ports in order, and when `#ports > capacity` merge adjacent same-direction ports into one cell. That is exactly ELK's collector-port/hyperedge case, and the fold counter already treats edge ends at the same position as non-crossing, so counting stays consistent if the merge is done before the final count. Alternatively grow the node to fit; decide per node type.
- Keep the anchor concept (`port.anchor`) so that an edge attaches at a cell centre while the "port" occupies a border cell; with integers anchor = the border cell itself.

**Pitfalls**
- Barycenter recursion over in-layer edges assumes no in-layer cycles — guard with the `visited` flag and never create dummies that form one.
- Rank arrays must be recomputed for the fixed layer *before* the free layer is sorted and for the free layer *after*, every step; forgetting the second recompute silently degrades port order.
- Sort stability matters everywhere (equal barycenters, unset ports); use a stable sort and never compare floats for equality — with integer ratios compare `a.num*b.den` vs `b.num*a.den`.
- Node/port scratch ids: give every element a stable index once per phase (layer index, index-in-layer, global port index) and rebuild after any structural change; ELK's bugs cluster where an id was stale.
- Don't count crossings between edges sharing a port, and don't count self-loops at all (ELK strips them before P3).
- When a constraint chain (`A above B`) contradicts barycenters, the resolver merges groups; the merged group's position is the *mean*, so a heavy node can be dragged by a light dummy — acceptable, but it is why ELK re-runs greedy switch afterwards.

---

## 4. Phase 4: node placement and compaction

Paths: `L/` = `plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/`,
`C/` = `plugins/org.eclipse.elk.alg.common/src/org/eclipse/elk/alg/common/`. Commit 8aaa3c14.

### 0. Contract: what phase 4 gets, what it sets, what it does NOT set

ELK Layered always lays out **left-to-right internally** (direction transposed at import/export).
Layers are columns. Phase 4 assigns exactly one number per node: `node.position.y`
(top edge of the node box, absolute, may be **negative**). Nothing else.

* `x` is **not** assigned in phase 4. It is assigned in phase 5 by the edge router because the
  router decides how many routing slots each inter-layer gap needs. `L/p5edges/OrthogonalEdgeRouter.java:222-292`:
  running `xpos`; for each layer: `LGraphUtil.placeNodesHorizontally(layer, xpos)`
  (`L/graph/LGraphUtil.java:223-290`: node x inside the layer column = `(layer.size.x - node.w) * ratio`,
  ratio = `outports/(inports+outports)` (0 → flush left, 1 → flush right, 0.5 or no ports → centred),
  corrected by the layer's max left/right margins, clamped to the node's own margins;
  `ALIGNMENT` option overrides ratio), then `xpos += layer.size.x`; then edges are routed starting at
  `xpos + edgeNodeBetweenLayers`; `routingWidth = (slots-1)*edgeEdgeBetweenLayers + edgeNodeBetweenLayers*(sides)`,
  bumped to `nodeNodeBetweenLayers` if smaller; if `slots == 0`: `xpos += nodeNodeBetweenLayers`.
  `graph.size.x = xpos` at the end. Polyline/spline routers do their own (`PolylineEdgeRouter.java:211-300`).
* `layer.size.x` (= max over nodes of `w + margin.left + margin.right`) and `layer.size.y`, `graph.size.y`,
  `graph.offset.y` are set by `LayerSizeAndGraphHeightCalculator` (`L/intermediate/LayerSizeAndGraphHeightCalculator.java:49-113`),
  slotted **before phase 5** (`L/GraphConfigurator.java:64-65`). `offset.y -= minY` is how negative y
  from placement gets normalised at export; phase 4 itself never normalises.

Preconditions established before phase 4 (`GraphConfigurator.java:62-63`, order in
`L/intermediate/IntermediateProcessorStrategy.java` "Before Phase 4"):
1. `LABEL_AND_NODE_SIZE_PROCESSOR` (`L/intermediate/LabelAndNodeSizeProcessor.java`): final node sizes,
   port positions (relative to node origin) and node/port label positions. After this, ports are fixed.
2. `INNERMOST_NODE_MARGIN_CALCULATOR` (`L/intermediate/InnermostNodeMarginCalculator.java:57-66` →
   `C/nodespacing/NodeMarginCalculator.java:138-223`): `LMargin{top,bottom,left,right}` = bounding box of
   node ∪ node labels ∪ ports ∪ port labels, minus the node box. Extended later in the same slot by
   `SELF_LOOP_ROUTER`, `COMMENT_NODE_MARGIN_CALCULATOR`, `END_LABEL_PREPROCESSOR` (margins are *additive* per
   `LMargin`: `NodeMarginCalculator` starts from the existing margin, `:218`).
   `LMargin` (`L/graph/LMargin.java`) is a plain `{top,right,bottom,left}` double record.

All placers treat a node as the box `[y - margin.top, y + size.y + margin.bottom]` and never look inside
the margin. Dummy nodes: `LONG_EDGE` dummies have `size.y = edge thickness` (`L/intermediate/LongEdgeSplitter.java:145`),
width 0; `NORTH_SOUTH_PORT`, `LABEL` (size = label size), `EXTERNAL_PORT`, `BREAKING_POINT` dummies exist
too (`L/graph/LNode.java:43-61`). Port geometry used everywhere: `port.position` (relative to node) +
`port.anchor` (relative to port, usually port centre). Edge endpoint y = `node.y + port.pos.y + port.anchor.y`.

#### Spacing resolution (`L/options/Spacings.java`)

`Spacings` is built once per graph (`GraphConfigurator.java:134`) and stored as `InternalProperties.SPACINGS`.
It is a `NodeType × NodeType` table (`:62-124`) mapping a pair of node types to an option id, one table for
in-layer ("vertical") and one for between-layer ("horizontal"):

| pair (in-layer / vertical)            | option                          | default |
|---------------------------------------|---------------------------------|---------|
| NORMAL–NORMAL, NORMAL–LABEL           | `spacing.nodeNode`              | 20      |
| NORMAL–LONG_EDGE, NORMAL–NS_PORT, NORMAL–EXTERNAL_PORT, LONG_EDGE–LABEL, BREAKING_POINT–NORMAL/LABEL/LONG_EDGE | `spacing.edgeNode` | 10 |
| LONG_EDGE–LONG_EDGE, LONG_EDGE–NS_PORT, NS_PORT–NS_PORT, LABEL–LABEL, BREAKING_POINT–BREAKING_POINT | `spacing.edgeEdge` | 10 |
| NS_PORT–LABEL                         | `spacing.labelNode`             |         |
| EXTERNAL_PORT–EXTERNAL_PORT           | `spacing.portPort`              | 10      |

Between-layer ("horizontal") variants: `nodeNodeBetweenLayers` (20), `edgeNodeBetweenLayers` (10),
`edgeEdgeBetweenLayers` (10) (`L/Layered.melk:690-730`); some pairs have no horizontal entry.

`getVerticalSpacing(n1, n2)` (`:195-220`) = `max(individual(n1), individual(n2))` where
`individual(n)` = value from `n`'s `spacing.individual` override if set, else the graph's value (`:239-254`).
So spacing between two adjacent in-layer nodes is the **max of the per-node values of the option chosen by
the type pair**. Spacing is measured margin-box to margin-box; edges have no thickness for spacing purposes
(docs `docs/content/documentation/tooldevelopers/graphdatastructure/spacingdocumentation.md`, Remarks).

`getVerticalSpacing(NodeType, NodeType)` (`:206-208`) ignores individual overrides (used by Interactive placer
and post-compaction).

### 1. BKNodePlacer (default strategy) — `L/p4nodes/bk/`

Five steps (`BKNodePlacer.java:148-292`): neighbourhood precalc → mark conflicts (once) →
for each of 4 layouts: `verticalAlignment` + `insideBlockShift` → for each: `horizontalCompaction` →
choose / balance → write `node.y = y[node] + innerShift[node]` (`:270-274`).

Terminology (ELK vs paper). ELK is left-to-right, paper is top-to-bottom, so ELK's *layer* index ≙
paper's layer, ELK's *position in layer* (index, y) ≙ paper's horizontal position. Directions:
`HDirection.RIGHT` = layers traversed left→right, blocks built by aligning a node with its **left
(predecessor) neighbours** (paper "up"); `LEFT` = right→left, aligning with right neighbours.
`VDirection.DOWN` = nodes in a layer visited top→bottom, blocks pushed **towards the top** (paper "left");
`UP` = bottom→top, pushed to the bottom. `FixedAlignment.LEFTDOWN` = (LEFT, DOWN) etc.

#### 1.1 Per-layout state — `BKAlignedLayout.java:38-58`
```ts
root[n]        // block root (node with the smallest layer index for RIGHT, largest for LEFT)
align[n]       // next node in block; last node → root (ring)
innerShift[n]  // y of node top relative to block top (block top includes margins)
blockSize[r]   // extent of block r incl. margins (only used for layoutSize)
sink[r]        // class representative (block root) — for block roots only
shift[r]       // class shift, ±Infinity = none
y[n]           // block y (for all nodes of a block after compaction), null = unplaced
su[r]          // block already used to straighten an edge (threshold strategy)
od[r]          // block consists "only of dummies" (see quirk in 1.7)
```

#### 1.2 NeighborhoodInformation — `NeighborhoodInformation.java:89-190`
* Assigns `layer.id`, `node.id` (dense), `layerIndex[layer.id]`, `nodeIndex[node.id]` (0-based in-layer index).
* `leftNeighbors[n]` = list of `(sourceNode, edge)` over incoming edges, `rightNeighbors[n]` over outgoing,
  **skipping self-loops and in-layer edges** (`:139, :172`), keeping only edges with the **maximum
  `priority.straightness`** among that node's edges (`:142-150`), sorted by in-layer index of the neighbour.
  Multi-edges → duplicates in the list (fine; median picks by position).
* Consequence: north/south-port dummies (same layer as their node, no direct edge to it) and inverted-port
  dummies (in-layer edge) are **never** aligned with their parent node by BK; they form their own blocks.

#### 1.3 Conflict marking — `BKNodePlacer.java:318-382`
Inner segment = edge between two `LONG_EDGE` dummies (`incidentToInnerSegment`, `:478-492`: node is a
dummy, has an incoming edge whose source is a dummy in the previous layer). Only **type 1** (non-inner
crossing inner) is marked, exactly the paper's Alg. 1; type 2 (inner × inner) is not marked — resolved
implicitly by alignment order (earlier/upper wins); type 0 ignored.

```
for i in 1 .. L-2:                       // pairs (layer i, layer i+1); pair (0,1) skipped: no dummies in layer 0
  cur = layers[i+1]; k0 = 0; l = 0
  for l1 in 0 .. |cur|-1:
    v = cur[l1]
    if l1 == |cur|-1 or v has inner segment to layer i:
      k1 = |layers[i]| - 1
      if v has inner segment: k1 = index of leftNeighbors[v][0]   // dummy has one predecessor
      while l <= l1:
        w = cur[l]
        if w has no inner segment:
          for (u, e) in leftNeighbors[w]: if index(u) < k0 or index(u) > k1: mark e
        l++
      k0 = k1
```
Graphs with < 3 layers: nothing marked (`:322`). Note: the priority filter in `leftNeighbors` also hides
low-priority edges from conflict marking.

#### 1.4 Vertical alignment — `BKAligner.java:70-164`
```
init root[v]=v, align[v]=v, innerShift[v]=0
layers = hdir==LEFT ? reversed : forward
for layer in layers:
  r = vdir==UP ? +INF : -1;  nodes = vdir==UP ? reversed(layer) : layer
  for v in nodes:
    nb = hdir==LEFT ? rightNeighbors[v] : leftNeighbors[v]
    if nb empty: continue
    d = |nb|; low = floor((d+1)/2)-1; high = ceil((d+1)/2)-1   // 0-based medians; d odd → low==high
    for m in (vdir==UP ? high..low : low..high):               // UP iterates high first
      if align[v] != v: break            // already aligned
      (u, e) = nb[m]
      if e not marked and (vdir==UP ? r > index(u) : r < index(u)):
        align[u] = v; root[v] = root[u]; align[v] = root[v]
        od[root[v]] &= v.type == LONG_EDGE
        r = index(u)
```
Faithful to the paper with 0-based indices (`r=-1`, strict `<`), which is the corrected initialisation.
Tie rule for even degree: DOWN tries the upper median first, UP the lower median first. Because a node
can only join a block once (`align[v]==v` check) and `r` is monotone, blocks never cross within a layer.

#### 1.5 insideBlockShift — `BKAligner.java:173-234` (not in the paper)
For each block, walking `root → align → …`:
```
spaceAbove = root.margin.top; spaceBelow = root.size.y + root.margin.bottom; innerShift[root] = 0
for each consecutive pair (cur, next) in the block, edge e = getEdge(cur,next):
  portDiff = hdir==LEFT ? (e.tgt.pos.y + e.tgt.anchor.y) - (e.src.pos.y + e.src.anchor.y)
                        : (e.src.pos.y + e.src.anchor.y) - (e.tgt.pos.y + e.tgt.anchor.y)
  innerShift[next] = innerShift[cur] + portDiff
  spaceAbove = max(spaceAbove, next.margin.top - innerShift[next])
  spaceBelow = max(spaceBelow, innerShift[next] + next.size.y + next.margin.bottom)
for each node: innerShift += spaceAbove
blockSize[root] = spaceAbove + spaceBelow
```
Result: within a block every edge is exactly straight (port anchors coincide) and
`innerShift[n] ≥ n.margin.top`, i.e. block-top = top of the union of margin boxes.
`getEdge(cur,next)` (`BKNodePlacer.java:501-509`) returns the **first** edge between the two nodes —
with multi-edges at different ports this may not be the median edge that caused the alignment (minor).

#### 1.6 Horizontal compaction — `BKCompactor.java:88-156`, `placeBlock` `:167-332`, `placeClasses` `:337-381`
```
init: sink[v]=v; shift[v] = vdir==UP ? -INF : +INF; y[*] = null; threshStrategy.init
for layer in (hdir==LEFT ? reversed : forward), v in (vdir==UP ? reversed : forward):
  if root[v]==v: placeBlock(v)
placeClasses()
for layer in same order, v: y[v] = y[root[v]]; if v is root and shift[sink[v]] finite: y[v] += shift[sink[v]]
   // non-root nodes are visited later (they live in later layers) and copy the shifted root value
threshStrategy.postProcess()
```
`placeBlock(root)`:
```
if y[root] != null: return
y[root] = 0; initial = true; thresh = vdir==DOWN ? -INF : +INF
for cur in block ring:
  idx = index(cur)
  if (DOWN and idx > 0) or (UP and idx < |layer|-1):
    nb = layer[idx∓1]; nbRoot = root[nb]
    placeBlock(nbRoot)                                  // recursion; returns immediately if in progress
    thresh = strategy.calculateThreshold(thresh, root, cur)   // after placeBlock (queue order matters)
    if sink[root]==root: sink[root] = sink[nbRoot]      // first neighbour decides the class
    if sink[root]==sink[nbRoot]:                        // same class: hard constraint
      s = spacings.getVerticalSpacing(cur, nb)
      DOWN: pos = y[nbRoot] + innerShift[nb] + nb.size.y + nb.margin.bottom + s + cur.margin.top - innerShift[cur]
            y[root] = initial ? max(pos, thresh) : max(y[root], pos, thresh)
      UP:   pos = y[nbRoot] + innerShift[nb] - nb.margin.top - s - cur.margin.bottom - cur.size.y - innerShift[cur]
            y[root] = initial ? min(pos, thresh) : min(y[root], pos, thresh)
      initial = false
    else:                                               // different class: record slack, class graph edge
      s = graph.spacing.nodeNode                        // NOTE: plain nodeNode, not type-aware
      DOWN: slack = (y[root] + innerShift[cur] - cur.margin.top) - (y[nbRoot] + innerShift[nb] + nb.size.y + nb.margin.bottom) - s
      UP:   slack = (y[root] + innerShift[cur] + cur.size.y + cur.margin.bottom + s) - (y[nbRoot] + innerShift[nb] - nb.margin.top)
      classNode(sink[root]).addEdge(classNode(sink[nbRoot]), slack)
  else:
    thresh = strategy.calculateThreshold(thresh, root, cur)
strategy.finishBlock(root)
```
Notes:
* `initial` replaces the paper's `x[v]=0` start: the first same-class neighbour *sets* y (may be negative,
  e.g. UP direction with inner shifts) instead of `max(0, …)` (KIPRA-1426, comment `:174-179`).
* A block whose nodes are all first-in-layer never gets a neighbour → stays at `y=0`, becomes its own class.
* The class of a block = class of its first encountered neighbour; hence any different-class neighbour is
  met *after* the first assignment, so the recorded `slack` uses a provisional `y[root]` that can only move
  further in the compaction direction later → slack is conservative (never causes overlap, may waste space).
* Class shifts (`placeClasses`): class graph nodes = sinks; edges `cur-class → neighbour-class` with
  `separation = slack`. Longest-path style propagation from indegree-0 classes (`classShift = 0`):
  `target.shift = first ? src.shift + sep : (DOWN ? min : max)(target.shift, src.shift + sep)`.
  Then `shift[sink] = classShift`. This replaces the paper's `shift[sink[u]] = min(shift, x[v]-x[u]-δ)`
  (kept as comments `:297-300, :318-320`). Effect (DOWN): bottom-most classes stay, classes above are pulled
  down (or pushed up if slack < 0) by the tightest slack, with shifts composed transitively. Works for
  different node sizes and disconnected components (comment `:127-131`). The class graph is a DAG because
  blocks do not cross; a cycle would leave `classShift == null` → NPE at `:142` (no guard).
* Recursion depth = chain length of neighbour blocks (one level per in-layer neighbour) — can be deep.

#### 1.7 Edge straightening (`ThresholdStrategy.java`) — option `nodePlacement.bk.edgeStraightening`
`NONE` → `NullThresholdStrategy` (`:144-159`): thresh stays ±INF, no effect = original BK.
`IMPROVE_STRAIGHTNESS` (**default**) → `SimpleThresholdStrategy` (`:167-410`):
* `calculateThreshold` (`:170-209`): only for the root or the last node of the block (single-node block:
  both). `t = getBound(root, isRoot=true)`; if still infinite and last: `t = getBound(cur, false)`.
* `getBound` (`:277-333`) → `pickEdge` (`:227-271`): candidate edges are the root's incoming (RIGHT) /
  outgoing (LEFT) edges, or for the last node the opposite side. In-layer edges skipped unless
  `od[block]` ("only dummies"). Skips if the free block was already straightened (`su`) — the condition at
  `:253` tests `su[root[free]]` **twice** (copy-paste; the other block's `su` is not checked). Picks the
  first candidate whose other block is already `finishBlock`ed; otherwise, if candidates exist, enqueues a
  `Postprocessable(free, isRoot)` and returns invalid (±INF).
* Threshold value = block y that would make that edge straight:
  `y[otherRoot] + innerShift[other] + otherPort.pos.y + otherPort.anchor.y − innerShift[me] − myPort.pos.y − myPort.anchor.y`;
  marks `su` on both blocks. In `placeBlock` it enters `max(…, thresh)` (DOWN) / `min` (UP): it can only
  push the block **further in the compaction direction**, i.e. it trades size for straightness, never
  compactness violations. Not applied for cross-class neighbours or neighbour-less blocks.
* `postProcess` (`:336-370`): drain the queue in order; for each, `pickEdge` again (now with more blocks
  finished); `process` (`:372-409`): `delta = calculateDelta(fixPort, myPort)` (`BKAlignedLayout.java:147-153`,
  = my port y − other port y, computed with current `y[root]+innerShift`); if `delta > 0` move my block
  **up** by `min(delta, checkSpaceAbove)`; if `< 0` move **down** by `min(-delta, checkSpaceBelow)`.
  `checkSpaceAbove/Below` (`BKAlignedLayout.java:184-246`) = min over block nodes of the gap to the in-layer
  neighbour (margins + type-aware spacing) — the block is shifted as far as space allows even if that does
  not fully straighten the edge. Failed items are retried once in reverse order via a stack.
  `THRESHOLD = Double.MAX_VALUE` (`:37`) → the `< THRESHOLD` guards are no-ops.
* `od` quirk: `od[root] &= (v is dummy)` is evaluated only for nodes *joining* a block, never for the root,
  and defaults to `true` → single-node blocks and "normal root + dummies" blocks count as "only dummies",
  so in-layer edges are considered for them.

#### 1.8 Choosing the final layout — `BKNodePlacer.java:157-164, 236-267`
* `produceBalancedLayout = (fixedAlignment == NONE && !favorStraightEdges) || fixedAlignment == BALANCED`.
  `favorStraightEdges` defaults to `edgeRouting == ORTHOGONAL` (`GraphConfigurator.java:124-128`), and
  layered's default routing is ORTHOGONAL (`Layered.melk:122`). **So with default options BK does NOT
  balance: it picks the smallest of the four layouts.** (Contrary to the paper's headline behaviour.)
* Candidates order: RIGHTDOWN, RIGHTUP, LEFTDOWN, LEFTUP (`:204-207`); with a fixed alignment only that one.
* `layoutSize()` (`BKAlignedLayout.java:117-134`) = `max(y[n] + blockSize[root[n]]) − min(y[n])`
  (block extents, incl. margins). Smallest wins, ties → first in list (RIGHTDOWN).
* Every candidate (and the balanced one) is validated by `checkOrderConstraint` (`:577-627`): per layer,
  nodes in order must satisfy `top > pos && bottom > pos` with `pos` = previous bottom (margin boxes, no
  spacing). Note the **strict** comparison: two margin boxes that exactly touch are "infeasible". Broken
  layouts are skipped; if all break, `layouts[0]` is used anyway (`:265-267`).
* Balanced (`createBalancedLayout`, `:400-463`): find the smallest layout; align the others to it —
  DOWN layouts shifted so their `min` node top matches, UP layouts so their `max` bottom matches; per node,
  sort the 4 shifted `y+innerShift` values and take `(v[1]+v[2])/2` (mean of the two medians → half-units);
  `innerShift = 0` afterwards; `blockSize` left null (never queried for balanced).

#### 1.9 Erratum (Brandes–Walter–Zink 2020) status
No comment in ELK references the erratum; the BK code dates to 2012–2016 (git). The erratum's central
defect — class shifts computed relative to a class that is itself shifted — does not exist here: ELK never
uses the paper's `shift[sink[u]] = min(...)`, it builds the class graph and resolves shifts by propagation
in dependency order (§1.6), which is the same idea as the erratum's post-processing over classes, generalised
to a DAG. Vertical alignment uses the 0-based `r = -1` / strict comparison that the corrected pseudocode
requires. Type-2 conflicts are not marked (ELK relies on crossing minimisation to avoid them, and on
alignment order to break them). ELK's other deviations (initial-assignment fix, threshold straightening,
`layoutSize` over block extents) are ELK's own.

#### 1.10 BK gotchas (summary)
1. y can be negative; normalise afterwards.
2. `spacing.nodeNode` (untyped) is used for cross-class slack; type-aware spacing only within a class.
3. Multi-edge `getEdge` picks the first edge, not the aligning one.
4. `checkOrderConstraint` strict `>`; exactly touching boxes reject a layout.
5. `pickEdge` `su` double-check typo; `od` never accounts for the root.
6. Straightening only shifts in the compaction direction during placement; post-processing shifts freely
   within available space.
7. Deep recursion in `placeBlock` for tall layers.

### 2. LinearSegmentsNodePlacer — `L/p4nodes/LinearSegmentsNodePlacer.java`
Sander's method. Pipeline (`:185-206`): `sortLinearSegments` → `createUnbalancedPlacement` →
`balancePlacement` → `postProcess`.

#### 2.1 Segments (`:221-319`, `fillSegment :466-510`)
A segment = one regular node, or a maximal chain of `LONG_EDGE`/`NORTH_SOUTH_PORT` dummies connected by
successor edges across layers (at most one successor is followed per dummy; other node types stop the chain).
`node.id` = segment id. Segment ordering graph: for each layer, an edge from each node's segment to the next
node's segment (`:426-434`). Cycle avoidance (`:377-424`): when a segment reappears in a layer and some
segment after it in this layer was *before* it in the previous layer, the segment is **split** at the
current node (`LinearSegment.split :111-128`) — i.e. long edges are allowed to bend to honour the in-layer
order. Topological sort (Kahn) gives the final segment ranks (`:281-316`).

#### 2.2 Unbalanced placement (`:521-564`)
Segments in rank order; for each: `top = max over its nodes of (layer.size.y + spacing)` where
`layer.size.y` is abused as the running bottom of that layer and spacing = type-aware
`getVerticalSpacing(previousNodeInLayer, node)`, or `spacing.edgeEdge` if the layer is empty (quirk: every
layer starts at `edgeEdge`); then `node.y = top + margin.top`, `layer.size.y = top + margin.top + size.y + margin.bottom`.
Straight long edges by construction (all nodes of a segment share `top`; dummies have equal anchors).

#### 2.3 Balancing (`:595-660`)
Constants: `PENDULUM_ITERS = 4`, `FINAL_ITERS = 3`, `THRESHOLD_FACTOR = 20`, threshold = `20 / thoroughness`
(thoroughness default 7). Modes `FORW_PENDULUM` (incoming edges only), `BACKW_PENDULUM` (outgoing only),
`RUBBER` (both). Loop:
1. `calcDeflection` for every segment (`:671-736`): per node, over its ports/edges of the allowed direction
   whose other end is in a *different* segment and whose `priority.straightness` is ≥ the node's own max
   priority and ≥ the other node's: `nodeDeflection += otherPortY − myPortY`; node value = mean over its
   edges; segment deflection = `dampening × mean over nodes with edges`; `weight` = number of such nodes.
   `deflectionDampening` default **0.3** (`Layered.melk:553-562`).
2. `mergeRegions` (`:750-795`) until fixpoint: for adjacent in-layer nodes of different regions, if
   `n1.bottom + margin + region1.deflection + spacing > n2.top − margin + region2.deflection + ε`
   (ε = `1e-4 × nodeNode`) merge region1 into region2 with weighted-mean deflection.
3. Move every node by its region's deflection.
4. Mode switch: after ≥4 pendulum iterations, go to RUBBER when total |deflection| decreased or after
   `thoroughness` extra iterations; alternate FORW/BACKW meanwhile. In RUBBER: `ready` when total ≥ last or
   improvement < threshold; then 3 more iterations. No hard cap otherwise (bounded by monotone conditions).
Regions are a union-find via `refSegment` (`:92-98`), reset every iteration.

#### 2.4 Post-process (`:808-886`)
Per segment: compute min free room above/below (type-aware spacing, margins; bottom-most node: `2*y`,
a placeholder). Among incoming edges of the first node and outgoing of the last, pick the smallest |d| that
would straighten one edge and fits in the room; shift the whole segment by it.

Properties: no explicit non-overlap guarantee beyond region merging with ε — positions are doubles and
overlaps are avoided by construction of merging; fractional throughout.

### 3. NetworkSimplexPlacer — `L/p4nodes/NetworkSimplexPlacer.java`
Gansner et al. x-coordinate assignment as a layering problem on an auxiliary graph (`NGraph`, `NNode.layer`
is the resulting integer coordinate, `NEdge.delta` = min length, `NEdge.weight`). Positions are **integers by
construction** (comment `:74-81`).

#### 3.1 Preparation (`prepare :307-353`)
Assign dense node/edge ids. Round port `position.y + anchor.y` to the nearest integer by adjusting
`position.y` (`:338-344`); for flexible nodes also the anchor itself. Margins need not be integral.

#### 3.2 Auxiliary graph (`:376-619`)
* Non-flexible node → one `NNode` (`transformFixedPosNode :429-442`), all its E/W ports map to it.
* Flexible node (`isFlexibleNode :894-946`: NORMAL, ≥2 ports, port constraints not FIXED_POS,
  `nodeFlexibility != NONE`, and unless size may grow: node tall enough for `portsSurrounding + (k−1)·portPort`
  on each side) → `head` and `tail` NNodes + one NNode per E/W port (`transformFixedOrderNode :447-501`):
  edge head→tail with `delta = ceil(size.y)` and weight `10000` (static) or `1` (`NODE_SIZE`);
  head→port1 (`delta = portsSurrounding.top`), port_i→port_{i+1} (`delta = ceil(portPort + port_i.size.y)`),
  last→tail (`delta = ceil(portsSurrounding.bottom + size)`), all weight 0. West ports reversed to top→bottom.
* In-layer separation (`transformLayer :400-419`): `last.tail → cur.head`,
  `delta = ceil(last.margin.bottom + spacing(last,cur) + cur.margin.top [+ last.size.y if last non-flexible])`, weight 0.
* Each non-self-loop, non-in-layer edge (`transformEdge :571-619`): a dummy NNode `d` and two edges
  `d → src`, `d → tgt` with `srcDelta = max(0, tgtOff − srcOff)`, `tgtDelta = max(0, srcOff − tgtOff)`
  (`off` = port pos + anchor for fixed nodes, anchor only for flexible), both with weight
  `max(1, priority.straightness) × w` where `w = 4` (normal–normal), `8` (one dummy), `32` (dummy–dummy)
  (`getEdgeWeight :796-811`, `EDGE_WEIGHT_BASE = 4`; paper's 1/2/8 scaled ×4). Minimising
  `Σ w·(len(d→src) + len(d→tgt))` = `Σ w·|srcY − tgtY|` since `d` sits at the min of the two.
* In-layer edges of NORMAL nodes (inverted ports) (`:622-656`): port → dummy or dummy → port by in-layer
  order, `delta 0`, weight 4 (keeps them close; direction already known so no |·| needed).
* North/south port dummies (`:659-689`): `node.tail → southDummy.head` and `northDummy.tail → node.head`,
  `delta 0`, weight **0.1** (pull the dummy near its node; separation is already enforced by the layer chain).
* `favorStraightEdges` (`preferStraightEdges :1017-1079`): mark crossing edges between adjacent layers
  (`markCrossingEdges :1313-1354`, open-list sweep); classify nodes: JUNCTION = in-degree > 1 or out-degree
  > 1 or degree 1 (`:1279-1293`); follow maximal paths from junctions through degree-2 nodes, stopping at
  junctions/visited/crossing edges (`:1229-1269`). Paths of length ≥3 without long-edge dummies or resizable
  nodes get their aux-edge weights raised to `2 × (8 for end segments, 32 inner)` (`LONG_EDGE_VS_PATH_FACTOR = 2`)
  — "treat straight node paths like long edges". Length-2 paths with a non-flexible centre are kept as
  `twoPaths` for post-processing.
* `nGraph.makeConnected()` (`C/networksimplex/NGraph.java:86-97`): artificial root with weight-0, delta-0
  edges to one representative per component.

#### 3.3 Solve and apply (`:255-297`)
`NetworkSimplex.forGraph(nGraph).withIterationLimit(thoroughness × |NNodes|).withBalancing(false)`.
`NODE_SIZE_WHERE_SPACE_PERMITS` (`:266-284, :692-729`): second solve after pinning all multi-port normal
nodes between a global source/sink (edges with `delta = tail.layer − min` and `usedLayers − head.layer`,
weight 0) so nodes may only grow into existing slack, then size-edge weight lowered to 1.
`postProcessTwoPaths` (`:1084-1216`): for each u–c–v with non-flexible centre `c`: if not both aux edges are
straight, compute free space above/below `c` (ceil'd spacing, margins) and move `c` by the length of one of
the four aux edges (cases A/B, `:1162-1207`) if it fits, so one of the two bends disappears; equal free space
on both sides → retry later in reverse order.
`applyPositions` (`:735-774`): `node.y = head.layer`; flexible: `size.y += (tail−head) − size.y` (size modes),
port `pos.y = portNode.layer − head.layer`, labels re-adjusted (`:776-784`), south ports shifted.

#### 3.4 When ELK prefers it
Docs only say (`docs/content/blog/posts/2025/25-08-21-layered.md:80-96`) BK is default, NS "uses a network
simplex approach", and node flexibility "dynamically increase[s] the node height to straighten edges".
Source comments (`:83-108, :148-153`): NS gives globally minimal weighted edge length (very compact, many
straight edges) but symmetric optima produce "stair-cases"; `favorStraightEdges` mitigates, not eliminates.
Cost: aux graph with `|V| + |E| + ports` nodes, `2|E| + |V|` edges; NS iteration limit `7 × |N|`.
`NodePlacementRepeater` (`L/intermediate/NodePlacementRepeater.java:42-72`, slot after P4,
`GraphConfigurator.java:336-339`, option `nodeFlexibility.recomputeNodePlacement`): after an NS run with
flexibility, freeze the new sizes (`NODE_SIZE_CONSTRAINTS = null`, flexibility cleared), recompute ports/labels/
margins, reset y, and run the named placer again (e.g. BK on the resized nodes).

### 4. SimpleNodePlacer, InteractiveNodePlacer (brief)
* `SimpleNodePlacer.java:62-101`: per layer stack nodes top-down with margins + type-aware spacing;
  `layer.size.y` = stack height; then every layer is vertically centred on the tallest layer:
  `pos = (maxHeight − layerHeight) / 2` (half-units possible). No alignment, no straight edges.
* `InteractiveNodePlacer.java:92-130`: keeps existing `y` of NORMAL nodes; dummies take
  `ORIGINAL_DUMMY_NODE_POSITION` if the interactive crossing minimiser set one, else stack below
  the previous node; any node overlapping the previous is pushed down to `minValidY + spacing + margin.top`.
  Spacing by type pair only (no individual overrides).

### 5. Post-compaction after routing — `L/intermediate/compaction/`, `C/compaction/oned/`
`HorizontalGraphCompactor` (`HorizontalGraphCompactor.java:80-156`), slot **after phase 5**, only when
`compaction.postCompaction.strategy != NONE` and routing != POLYLINE (`GraphConfigurator.java:273-276`).
It compacts **x** (the flow axis) of nodes and of vertical edge segments after routing — it is unrelated to
phase 4's y and does not touch y. Must run before `ReversedEdgeRestorer` and `LabelDummyRemover` (locking
uses edge direction; label dummies must still be boxes).

#### 5.1 CGraph construction — `LGraphToCGraphTransformer.java`
* Every node (except comment boxes attached to a node, which follow their node afterwards `:136-146, :613-620`)
  → `CNode` with hitbox = margin box (`:149-166`), each in its own `CGroup` (`master = node`).
  Lock quadruplet per node: fewer incoming than outgoing → locked LEFT, more → locked RIGHT
  (`:171-179`); external port dummies unlocked, spacing to them 0.
* Orthogonal edges (`collectVerticalSegmentsOrthogonal :219-327`): every pair of consecutive bend points
  with different y → a `VerticalSegment` (hitbox = the segment, width 0); segments leaving/entering a N/S
  port become a segment from the port bend to the node border, **grouped with the node** (`potentialGroupParents`,
  `:387-391`) so it moves with it. First/last segments adjacent to a node get `ignoreSpacing.up/down` set so
  the edge-node spacing is not enforced against its own node (`:262-282`).
* Segments with equal x and overlapping y are merged (`mergeVerticalSegments :362-390`, sorted by x then y);
  merged segments remember all bends, junction points, edges. Segment locks: by number of distinct source
  vs target ports (`:410-426`).
* Splines: non-straight spline segments' bounding boxes become segments with predefined constraints between
  consecutive ones (`:329-360`).
* Applying (`applyLayout :435-517`): `node.x = hitbox.x + margin.left`; bends/junctions/bounding boxes shifted
  by `Δx`; graph size/offset recomputed; external port dummies snapped back to the left/right border.

#### 5.2 OneDimensionalCompactor — `C/compaction/oned/OneDimensionalCompactor.java`
Direction handled by mirroring/transposing hitboxes (`:177-307`); vertical compaction is only allowed for
graphs without edges (`LGraphToCGraphTransformer.java:101-105`). `compact()` (`:126-151`): reset group
`outDegree`, `startPos = −INF`, run the compaction algorithm. Constraints (`:432-459`): predefined pairs +
algorithm + group aggregation (`:465-490`: constraint edges between groups, `outDegree` = number of groups
constrained by this group).
* `QuadraticConstraintCalculation` (`:24-70`): `A → B` if B is right of A (or same x and narrower) and the
  y-ranges overlap when B is enlarged by the pair's vertical spacing. O(n²).
* `ScanlineConstraintCalculator` (`:60-212`, Lengauer): sweep y with open/close events (close before open
  at equal y → touching boxes get no constraint); ordered set of open intervals keyed by x-centre; on close,
  constraint to the immediate left/right neighbour if it was the candidate recorded at open. O(n log n) but
  spacing-unaware, hence `EdgeAwareScanlineConstraintCalculation` (`L/intermediate/compaction/EdgeAwareScanlineConstraintCalculation.java:120-195`,
  default): three sweeps — segments only (hitboxes enlarged by `edgeEdge/2 − 0.5`), nodes only (enlarged by
  `edgeEdge/2 − 0.5`, deliberately not `nodeNode/2`, comment `:144-148`), then everything enlarged by the global
  minimum half-spacing (groups: N/S segments enlarged on the free side only). Enlargements are undone after each sweep.
* `LongestPathCompaction` (`:33-127`): groups with `outDegree == 0` start at the global min x; pop, fix
  `startPos + offset` per node (unless the group is locked in this direction and its current x already
  satisfies the constraints → keep), propagate `incGroup.startPos = max(startPos + width + spacing − offset)`
  and decrement outDegree; finally `hitbox.x = startPos`. Spacing via `ISpacingsHandler`
  (`HorizontalGraphCompactor.java:184-256`: 0 between segments of the same edge or involving external ports,
  else `Spacings.getHorizontalSpacing(type1, type2)` with segments typed as LONG_EDGE).
* `NetworkSimplexCompaction` (`L/intermediate/compaction/NetworkSimplexCompaction.java:57-96`): one NNode per
  group; constraint edges with `delta = ceil(offset + width + spacing − otherOffset)`, weight 1 (2 if node–segment);
  original edges as `delta 0, weight 100` edges src→tgt (skipping N/S–N/S pairs) plus helper nodes to let
  same-edge segments reorder; result `hitbox.x = layer + offset`. Minimises edge length, not width.

#### 5.3 Strategies (`GraphCompactionStrategy`, `HorizontalGraphCompactor.java:112-147`)
`NONE` (default) · `LEFT` · `RIGHT` · `LEFT_RIGHT_CONSTRAINT_LOCKING` (left, then right with groups of
`outDegreeReal == 0` locked) · `LEFT_RIGHT_CONNECTION_LOCKING` (left, then right with the in/out-degree locks
above — shortens edges of nodes that were pulled away from their targets) · `EDGE_LENGTH` (network simplex).
`compaction.postCompaction.constraints`: `SCANLINE` (default, edge-aware) or `QUADRATIC`.
Invariants it keeps: in-layer y untouched; relative order of x among overlapping-in-y boxes (constraints);
node/segment spacing; N/S segments glued to their node; segments of one edge may touch (spacing 0).
What it can break: layer columns (nodes of one layer no longer share x — by design), and the "layers are
vertical strips" assumption used by later processors; hence the ordering constraints above.

### 6. Options and defaults (`L/Layered.melk`, `plugins/org.eclipse.elk.core/.../Core.melk`)
| option | default | notes |
|---|---|---|
| `nodePlacement.strategy` | `BRANDES_KOEPF` | SIMPLE, INTERACTIVE, LINEAR_SEGMENTS, BRANDES_KOEPF, NETWORK_SIMPLEX (`melk:503-509`) |
| `nodePlacement.favorStraightEdges` | none → `edgeRouting == ORTHOGONAL` (`GraphConfigurator.java:124-128`) | BK: disables balancing; NS: path straightening (`melk:511-521`) |
| `nodePlacement.bk.edgeStraightening` | `IMPROVE_STRAIGHTNESS` | `NONE` = original BK (`melk:525-537`) |
| `nodePlacement.bk.fixedAlignment` | `NONE` (= smallest of four) | LEFTUP/RIGHTUP/LEFTDOWN/RIGHTDOWN/BALANCED (`melk:539-548`) |
| `nodePlacement.linearSegments.deflectionDampening` | 0.3, > 0 | (`melk:553-562`) |
| `nodePlacement.networkSimplex.nodeFlexibility` | per node, unset | NONE / PORT_POSITION / NODE_SIZE_WHERE_SPACE_PERMITS (experimental) / NODE_SIZE (`melk:567-577`, `L/options/NodeFlexibility.java`) |
| `…nodeFlexibility.default` | `NONE` | graph-level fallback (`melk:580-588`) |
| `…nodeFlexibility.recomputeNodePlacement` | null | strategy for a second run (`melk:590-600`) |
| `compaction.postCompaction.strategy` | `NONE` | (`melk:771-777`) |
| `compaction.postCompaction.constraints` | `SCANLINE` | (`melk:779-786`) |
| `compaction.connectedComponents` | false | requires separateConnectedComponents (`melk:789-795`) |
| `priority.straightness` (edge) | 0 | BK neighbour filter, LS deflection filter, NS weight multiplier (`melk:752-757`) |
| `thoroughness` | 7 | LS threshold `20/t`, NS iteration limit `t·|N|` (`melk:1265-1271`) |
| `spacing.nodeNode / edgeNode / edgeEdge / portPort` | 20 / 10 / 10 / 10 | in-layer (`Core.melk:366-455`) |
| `spacing.*BetweenLayers` | 20 / 10 / 10 | phase 5 only (`melk:690-730`) |
| `spacing.portsSurrounding` | `ElkMargin(0)` | NS flexible ports, layer height for external ports |

### 7. For our engine (TypeScript, synchronous, integer cells, ports first-class)

#### Adopt
1. **BK as in §1, four layouts, pick smallest** (ELK's actual default for orthogonal routing). Cheap
   (4 × O(V+E)), deterministic, straight long edges, understandable output. Implement `verticalAlignment`,
   `insideBlockShift`, `placeBlock` with `initial` replacement, and the **class graph** shift propagation
   (§1.6) — do not implement the paper's `shift[sink[u]]` line; ELK's class-graph version is the corrected
   algorithm and it also handles disconnected components and unequal sizes.
2. `NeighborhoodInformation` as plain arrays: `layerIdx[]`, `posInLayer[]`, `pred[]`, `succ[]` (sorted by
   position, self-loops and in-layer edges removed).
3. `insideBlockShift` with **port anchors**: this is the piece that makes ports first-class — the block is
   straight at the anchor rows, not node centres. Keep `innerShift` per node.
4. The order/overlap validation of each candidate (§1.8) — cheap insurance; make it `>=`.
5. Type-aware spacing as a tiny function `spacing(a, b) = max(sp[a.kind][b.kind] …)` — but collapse ELK's
   node-type matrix to {node, edgeDummy} × {node, edgeDummy}; individual overrides: skip until needed.
6. Margins as a per-node integer `{top,bottom,left,right}` computed once before placement (ports on the
   border with labels, edge end labels later). Placement always uses the margin box.
7. Compute `layer.height`, `graph.height`, and normalise `y -= minTop` immediately after placement (ELK
   defers to export via `offset`; we have no reason to carry negative coordinates).

#### Simplify away / skip
* Balanced layout (median of four): needs halves, and ELK itself does not use it by default. If wanted later:
  `floor((v1+v2)/2)` then re-run the overlap check (ELK does check; the balanced layout can violate order).
* `LINEAR_SEGMENTS`: fractional deflections × 0.3 dampening, ε-merging, pendulum termination on a real
  threshold — rounding each iteration would oscillate. Skip.
* `NETWORK_SIMPLEX` placer: **inherently integer** (ELK ceil()s every delta) and gives the straightest, most
  compact result; the aux graph is trivial to build (§3.2). Worth having as a second strategy once the
  network-simplex core exists for layering; skip node flexibility, twoPaths, straight-path weighting initially.
  Its stair-case artefact is real; BK is the safer default.
* `SIMPLE` (centre stacks) is fine as a debug/fallback placer — 30 lines; use `floor` for the centring.
* Post-compaction (§5): it is an x-axis pass after routing; not needed for a first terminal renderer whose
  router already assigns compact x. Revisit only if inter-layer gaps look wasteful; if so, the
  scanline/longest-path core is ~150 lines and integer-safe.
* ELK's `su`/`od` book-keeping and postprocess queue of the threshold strategy: implement the in-placement
  threshold (5 lines inside `placeBlock`) first; the postprocess pass only matters when the other block was
  placed later — measure before adding.
* `priority.straightness`, individual spacings, comment boxes, external-port dummies, hierarchical port
  processors: nothing to do until compound graphs land.

#### Integer specifics
* All BK arithmetic is sums/differences of `y`, `size`, `margin`, `spacing`, `port.pos + anchor` → exact in
  integers **provided port anchors are integers**. Define anchor rows explicitly: a node of height `h` with one
  port on a side gets anchor row `(h-1) >> 1` (top-biased centre); with `k` ports distribute rows explicitly
  (no `/`); an edge dummy has `h = 1`, anchor `0`. Then a block is straight iff `y + anchor` coincide — no
  rounding anywhere.
* Even/odd heights: aligning a 1-row dummy with a 4-row node's centre puts the edge on row 1 of the node
  (top-biased). Keep the same bias in the router. Do not centre by `h/2` anywhere; use the stored anchor.
* `spacing`: ELK measures node–edge spacing to the *centre line* of an edge of thickness 1 with `edgeEdge = 10`.
  In cells, an edge occupies a full row: dummy height 1, `edgeEdge = 0` (adjacent parallel edges allowed) or 1
  (one blank row), `edgeNode = 0` or 1, `nodeNode = 1`. All non-negative ints; everything stays integral.
* Class slack can be negative (overlap that the class shift must undo) — signed ints, fine.
* `layoutSize` comparison and tie-break: integers, exact; keep ELK's tie order (RIGHTDOWN first) for stable output.
* Balanced/Simple centring are the *only* places ELK divides; both are optional here.
* Recursion in `placeBlock`: depth = number of stacked blocks in a layer; for TS use an explicit stack or
  accept recursion up to a few thousand nodes.
* Post-compaction (if ever): ELK enlarges hitboxes by `spacing/2 − 0.5` and epsilons for the scanline; in
  integers use half-open cell ranges `[y, y+h)` and add the full spacing to one side instead.

---

## 5. Phase 5: edge routing, self-loops, edge labels

Reference: ELK commit 8aaa3c14. `L/` = `plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/`.
Everything below is written for the horizontal (RIGHT) layout direction; ELK handles
DOWN/UP/LEFT by transposing/mirroring the whole graph before phase 1 and back after
phase 5 (`L/intermediate/GraphTransformer.java`), so the router itself only ever knows
"layers are columns, the flow axis is x, ports are EAST/WEST".

Papers are thin here on purpose: ELK's orthogonal router is Sander's GD'03 hyperedge
routing plus a hand-tuned dependency graph, and every detail that matters (thresholds,
weights, cycle breaking, splitting, slot compaction) is code, not paper.

### 0. Where routing sits in the pipeline

Phase 5 is a single `ILayoutPhase` chosen by `edgeRouting`
(`L/p5edges/EdgeRouterFactory.java:355`): `OrthogonalEdgeRouter` (default),
`PolylineEdgeRouter`, `SplineEdgeRouter`. Each router *declares* the intermediate
processors it needs; `OrthogonalEdgeRouter` (`L/p5edges/OrthogonalEdgeRouter.java:61-214`):

| slot | processor | when |
|---|---|---|
| before P1 | `SelfLoopPreProcessor` | graph has self loops |
| before P2 | `LabelDummyInserter` | center edge labels |
| before P3 | `InvertedPortProcessor` | non-free ports, hyperedges, or `feedbackEdges` |
| before P3 | `NorthSouthPortPreprocessor` | non-free ports with N/S ports |
| before P3 | `HierarchicalPortConstraintProcessor` | external ports |
| before P4 | `HyperedgeDummyMerger` | hyperedges (a port with >1 edge, or `mergeEdges`) |
| before P4 | `SelfLoopPortRestorer`, `SelfLoopRouter` | self loops |
| before P4 | `LabelDummySwitcher`, `LabelSideSelector` | center labels (side selector also for end labels) |
| before P4 | `EndLabelPreprocessor` | head/tail labels |
| before P4 | `HierarchicalPortDummySizeProcessor` | external ports |
| after P5 | `HierarchicalPortOrthogonalEdgeRouter`, `LongEdgeJoiner`*, `SelfLoopPostProcessor`, `NorthSouthPortPostprocessor`, `LabelDummyRemover`, `EndLabelSorter`*, `ReversedEdgeRestorer`*, `EndLabelPostprocessor` | (* = baseline, always) |

Processors in one slot run in the enum order of
`L/intermediate/IntermediateProcessorStrategy.java` (after-P5 order: hierarchical port
router, long edge joiner, self-loop post, breaking-point remover, N/S port post,
horizontal compactor, label dummy remover, final spline bendpoints, end label sorter,
reversed edge restorer, end label post). Also `LayerSizeAndGraphHeightCalculator` runs
before P5 (baseline): `layer.size.x = max(node.w + margin.left + margin.right)` over
*all* nodes of the layer, dummies included (`L/intermediate/LayerSizeAndGraphHeightCalculator.java:65-71`).
This is where label dummies inflate layer widths (section 6).

Precondition of P5: nodes have y (phase 4), ports have relative positions and sides,
layer widths are known. Postcondition: nodes have x, edges have bend points, graph width set.

### 1. `OrthogonalEdgeRouter`: the layer loop

`L/p5edges/OrthogonalEdgeRouter.java:217-295`. Spacing inputs (all graph-level):
`nodeNode = spacing.nodeNodeBetweenLayers` (20), `edgeEdge = spacing.edgeEdgeBetweenLayers`
(10), `edgeNode = spacing.edgeNodeBetweenLayers` (10).

```ts
const gen = new OrthogonalRoutingGenerator(WEST_TO_EAST, edgeEdge)
let x = 0, left: Layer|null = null
do {
  const right = nextLayerOrNull()
  if (left) { placeNodesHorizontally(left, x); x += left.size.x }
  const startPos = left ? x + edgeNode : x           // x of routing slot 0
  const slots = gen.routeEdges(left?.nodes, right?.nodes, startPos)
  const leftExt  = !left  || left.nodes.every(isExternalWestEastPortDummy)
  const rightExt = !right || right.nodes.every(isExternalWestEastPortDummy)
  if (slots > 0) {
    let w = (slots - 1) * edgeEdge + (left ? edgeNode : 0) + (right ? edgeNode : 0)
    if (w < nodeNode && !leftExt && !rightExt) w = nodeNode
    x += w
  } else if (!leftExt && !rightExt) x += nodeNode
  left = right
} while (right)
graph.size.x = x
```

Notes:
- The loop runs once *before* the first layer (`left == null`) and once *after* the last
  (`right == null`): those iterations route in-layer edges on the outer sides (section 3)
  and external-port edges.
- Channel width between two ordinary layers is `max(nodeNode, 2*edgeNode + (slots-1)*edgeEdge)`
  if any slot is used, else `nodeNode`. When the `nodeNode` minimum wins, tracks still sit at
  `startPos + slot*edgeEdge`, i.e. hugging the left layer (the spline router centers them,
  the orthogonal one does not).
- `placeNodesHorizontally(layer, x0)` (`L/graph/LGraphUtil.java:223-263`): a node's x inside
  the layer strip depends on `alignment` (LEFT 0, CENTER 0.5, RIGHT 1, AUTOMATIC =
  `outports / (inports + outports)`, 0.5 if unconnected; a port counts as in/out if it has
  incoming/outgoing edges). `xpos = (layer.w - node.w) * ratio`, shifted by
  `-maxRightMargin*2*(ratio-0.5)` or `+maxLeftMargin*2*(0.5-ratio)`, then clamped into
  `[margin.left, layer.w - margin.right - node.w]`; `node.x = x0 + xpos`. So sinks hug the
  left of their layer, sources the right, throughput nodes sit in the middle: this
  shortens the horizontal stubs, it is not cosmetic.
- Port absolute anchor (`L/graph/LPort.java:198`) = `node.pos + port.pos + port.anchor`;
  the anchor is the point on the port where the edge attaches (center of the port by default).
  Port positions relative to the node were fixed before P4 (`LabelAndNodeSizeProcessor`).

### 2. `OrthogonalRoutingGenerator` — exhaustive

`L/p5edges/orthogonal/OrthogonalRoutingGenerator.java`. One call routes everything
between one pair of layers (or one layer and "outside"). Vocabulary, horizontal layout:

- **trunk** = vertical segment of an edge inside the channel, at x = a *routing slot*
  (`startPos + slot*edgeEdge`).
- **connection** = horizontal stub from a port to the trunk. *Incoming* connections
  come from EAST ports of the left layer, *outgoing* connections go to WEST ports of the
  right layer. Coordinates of connections are y values.
- **HyperEdgeSegment** (`HyperEdgeSegment.java`) = one trunk shared by a set of ports:
  `ports`, sorted `incomingConnectionCoordinates`, sorted `outgoingConnectionCoordinates`,
  extent `[start, end]` = min/max over both lists, `routingSlot`, dependency lists,
  `splitPartner`/`splitBy`.

Constants (`:66-79`): `TOLERANCE = 1e-3`; `CONFLICT_THRESHOLD_FACTOR = 0.5`;
`CRITICAL_CONFLICT_THRESHOLD_FACTOR = 0.2`; `CONFLICT_PENALTY = 1`; `CROSSING_PENALTY = 16`.
`conflictThreshold = 0.5 * edgeEdge` (constant per generator).

#### 2.1 `routeEdges(sourceNodes, targetNodes, startPos)` (`:159-242`)

1. `segments = []`, `portToSegment = {}`.
2. `createHyperEdgeSegments(sourceNodes, EAST)`: for every node, for every port that is
   on the EAST side **and has outgoing edges** (`node.getPorts(OUTPUT, EAST)`), if the
   port is not yet mapped: new segment, `seg.addPortPositions(port)`.
3. `createHyperEdgeSegments(targetNodes, WEST)`: same for WEST ports *with outgoing
   edges* of the right layer. Those only exist for in-layer edges (inverted ports,
   section 3) — a regular WEST port has only incoming edges and is reached transitively
   in step 2.
4. `criticalConflictThreshold = 0.2 * min(minDiff(all incoming coords), minDiff(all outgoing coords))`
   where `minDiff` = smallest gap between two *distinct* sorted values, `+inf` if fewer
   than two (`:248-280`). I.e. "overlap" is defined relative to how tightly ports are
   packed on either side, per layer pair.
5. For every unordered pair `i<j`: `critical += createDependencyIfNecessary(s_i, s_j)`.
6. If `critical >= 2`: `breakCriticalCycles` (may split segments, section 2.5).
7. `breakNonCriticalCycles` (section 2.6).
8. `topologicalNumbering` (section 2.7) assigns `routingSlot`.
9. For each segment that is not straight (`|start-end| >= TOLERANCE`):
   `rankCount = max(rankCount, slot)`; `strategy.calculateBendPoints(seg, startPos, edgeEdge)`.
10. Clear the junction-point set; return `rankCount + 1` (= number of slots, 0 if all
    edges are straight).

#### 2.2 Segment creation: what merges into one trunk

`HyperEdgeSegment.addPortPositions(port, map)` (`HyperEdgeSegment.java:123-144`):

```ts
add(port) {
  map.set(port, this); ports.push(port)
  const y = strategy.portPositionOnHyperNode(port)   // W→E: node.y + port.y + anchor.y
  if (port.side === strategy.sourcePortSide /*EAST*/) insertSorted(incoming, y)
  else insertSorted(outgoing, y)
  recomputeExtent()
  for (const other of port.connectedPorts)            // all ports joined to it by any edge
    if (!map.has(other)) add(other)
}
```

`insertSorted` drops exact duplicates. `connectedPorts` = predecessor ∪ successor ports
across *all* edges of the port. Consequences:

- Two edges leaving the same EAST port share one segment (fan-out trunk, junction
  points). Two edges entering the same WEST port share one segment (fan-in trunk).
  Transitively, anything reachable through shared ports is one segment: this is the
  *hyperedge*. With `mergeEdges=true` every node gets one collector port per direction
  (`LGraphUtil.createPort`/`provideCollectorPort`, `L/graph/LGraphUtil.java:437,615`),
  so all edges out of a node share one trunk. `HyperedgeDummyMerger` (section 4) makes
  long-edge dummies of one hyperedge share ports too, so the shared trunk continues
  across several channels.
- The side test decides the list, not the edge direction: an in-layer edge from a
  dummy's EAST port to a node's EAST port puts *both* y's into `incoming` (a segment
  with two incoming and zero outgoing connections). A WEST→WEST in-layer edge gives
  a segment with only outgoing connections.
- Extent = `[min(first of both lists), max(last of both lists)]`. Length 0 (within
  1e-3) = straight edge: no slot, no bend points, no dependencies.

#### 2.3 Dependencies (`createDependencyIfNecessary(he1, he2)`, `:325-385`)

A dependency `s → t` means "s wants a *lower* slot (closer to the left layer) than t".
Two kinds (`HyperEdgeSegmentDependency.java`): `REGULAR` with a weight = how much worse
the drawing gets if ignored, and `CRITICAL` (weight 1) = ignoring it makes two horizontal
connections overlap.

```ts
if (straight(he1) || straight(he2)) return 0
// he1 left of he2: he1's outgoing stubs run right past he2's trunk x, he2's incoming stubs
// run left past he1's trunk x — same-y pairs of those stubs overlap horizontally.
const c1 = countConflicts(he1.outgoing, he2.incoming)     // cost of he1 left of he2
const c2 = countConflicts(he2.outgoing, he1.incoming)     // cost of he2 left of he1
if (c1 === CRITICAL || c2 === CRITICAL) {
  if (c1 === CRITICAL) addCritical(he2, he1)   // he1 must not be left of he2
  if (c2 === CRITICAL) addCritical(he1, he2)
  return (c1 === CRITICAL) + (c2 === CRITICAL)
}
const x1 = crossings(he1.outgoing, he2.start, he2.end) + crossings(he2.incoming, he1.start, he1.end)
const x2 = crossings(he2.outgoing, he1.start, he1.end) + crossings(he1.incoming, he2.start, he2.end)
const d1 = 1*c1 + 16*x1, d2 = 1*c2 + 16*x2
if (d1 < d2)      addRegular(he1, he2, d2 - d1)
else if (d1 > d2) addRegular(he2, he1, d1 - d2)
else if (d1 > 0)  { addRegular(he1, he2, 0); addRegular(he2, he1, 0) }  // zero-weight 2-cycle
return 0
```

- `countCrossings(sorted ys, start, end)` (`:436-446`) = number of ys with
  `start <= y <= end` (boundary touches count): a stub at y crosses a trunk whose extent
  covers y.
- `countConflicts(ys1, ys2)` (`:397-426`) is a merge walk over both sorted lists; for
  each visited pair: if `|y1-y2| < criticalConflictThreshold` → return `-1` (CRITICAL,
  the stubs would lie on top of each other); else if `|y1-y2| < conflictThreshold`
  (= `0.5*edgeEdge`) → `conflicts++` (too close to read). Then advance the smaller
  (equal: advance list 1).
- Weight: a conflict costs 1, a crossing 16; so the order is chosen by crossings unless
  crossing counts tie, then by closeness. Equal non-zero cost on both sides yields a
  zero-weight two-cycle, which `breakNonCriticalCycles` later resolves by deleting one
  direction (any order is equally bad, but they must still get different slots because
  each dependency edge forces `slot(t) >= slot(s)+1`).
- Both critical directions can be present at once (both orders overlap): that is a
  critical 2-cycle → splitting.

#### 2.4 Cycle detection: `HyperEdgeCycleDetector.detectCycles(segments, criticalOnly, rnd)`

`L/p5edges/orthogonal/HyperEdgeCycleDetector.java`. Eades–Lin–Smyth greedy feedback arc
set on the dependency graph; returns the dependencies that point backwards in the
computed linear order. Used twice: once on critical dependencies only, then on all.

1. `initialize` (`:82-128`): every segment `mark = -1, -2, ...` (negative = unprocessed);
   `inWeight/outWeight` = sum of weights of incident deps (critical ones only if
   `criticalOnly`), plus separate `criticalIn/OutWeight`. `outWeight == 0` → `sinks`,
   else `inWeight == 0` → `sources`.
2. `computeLinearOrderingMarks` (`:134-206`): `markBase = n`; sink marks count *down*
   from `n-1`, source marks count *up* from `n+1`. Loop while unprocessed segments exist:
   - pop all sinks: `mark = nextSinkMark--`, `updateNeighbors`;
   - pop all sources: `mark = nextSourceMark++`, `updateNeighbors`;
   - otherwise pick the unprocessed segment with maximum `outWeight - inWeight`
     (random among ties, seeded `RANDOM`); **but** in the all-dependencies pass, the
     first unprocessed segment found with `criticalOutWeight > 0 && criticalInWeight <= 0`
     is taken immediately — guaranteeing critical dependencies end up pointing forward
     and are never reversed. Mark it as a source.
   - finally add `n+1` to every mark `< markBase`, so all sinks sort after all sources.
3. `updateNeighbors(v)` (`:221-259`): for each outgoing dep (of the considered type) with
   unprocessed target and weight > 0: `target.inWeight -= w` (also critical weight if
   critical); if `target.inWeight <= 0 && target.outWeight > 0` push to sources.
   Symmetric for incoming deps → sinks. Zero-weight deps never influence the order.
4. Result (`:63-72`): every dep of the considered type with `source.mark > target.mark`.

#### 2.5 Critical cycles: `HyperEdgeSegmentSplitter`

`breakCriticalCycles` (`OrthogonalRoutingGenerator.java:455-465`) only runs if at least 2
critical deps exist. `deps = detectCycles(segments, criticalOnly=true)`, then
`splitter.splitSegments(deps, segments, criticalConflictThreshold)`
(`HyperEdgeSegmentSplitter.java:39-59`):

1. `findFreeAreas` (`:68-93`): sort *all* connection coordinates of all segments; every
   gap `c[i]-c[i-1] >= 2*crit` yields a free area `[c[i-1]+crit, c[i]-crit]` — y bands
   where a new horizontal connection can be placed without touching existing stubs.
2. `decideWhichSegmentsToSplit` (`:102-138`): for each returned dep `(src → tgt)`: if
   either is already chosen, skip; `toSplit = src`, `causing = tgt`; if `src` represents a
   hyperedge (>2 connections) and `tgt` does not, swap (prefer splitting plain edges).
   `toSplit.splitBy = causing`.
3. Split chosen segments in ascending length order (short ones have fewer places to go):
   - `computePositionToSplitAndUpdateFreeAreas` (`:187-224`): candidate areas = those
     overlapping `[seg.start, seg.end]`; default split y = `center(seg)`; if candidates
     exist pick `chooseBestAreaIndex`, split y = `center(area)`, then `useArea` removes it
     and, if `area.size/2 >= crit`, re-inserts `[start, center-crit]` and `[center+crit, end]`
     when non-degenerate.
   - `chooseBestAreaIndex` (`:229-258`): with >1 candidate, `simulateSplit()` builds the
     two halves (incoming-only piece and outgoing-only piece); `rateArea` (`:263-302`) sets
     the link coordinate to the area center and counts, against every segment currently
     depending on the original, the min crossings/dependencies over both orderings for each
     half (`updateConsideringBothOrderings`: equal non-zero → 2 deps + that many crossings;
     otherwise 1 dep + min crossings), plus 2 fixed deps and the crossings of the forced
     order `half1 → splitBy → half2`. `isBetter`: fewer crossings, then fewer deps, then
     larger area.
   - `seg.splitAt(y)` (`HyperEdgeSegment.java:403-430`): new partner takes *all* outgoing
     coordinates; `seg.outgoing = [y]`, `partner.incoming = [y]`; extents recomputed; all
     deps of `seg` removed. Geometry: the edge goes port → trunk A (slot a) → horizontal
     link at y → trunk B (slot b) → target ports, i.e. two vertical trunks joined by a
     horizontal jog.
   - `updateDependencies` (`:161-178`): `critical(seg → splitBy)`, `critical(splitBy → partner)`
     (the culprit must sit *between* the two halves), then `createDependencyIfNecessary`
     between every other segment and each half. No second cycle detection: if the new deps
     form a critical cycle again, the non-critical pass just orders them by marks.
4. `partner.isDummy()` (`splitPartner != null && splitBy == null`) marks the second half so
   bend-point emission handles both halves from the first one.

#### 2.6 Non-critical cycles

`breakNonCriticalCycles` (`:471-483`, public static, reused by the self-loop slot
assigner): `deps = detectCycles(segments, false)`; weight 0 → `dep.remove()` (assumes
zero weight only occurs in 2-cycles), else `dep.reverse()`. After this the dependency
graph is a DAG with all critical deps intact.

#### 2.7 Slot assignment: `topologicalNumbering` (`:493-562`)

```ts
for (s of segs) { s.in = s.incomingDeps.length; s.out = s.outgoingDeps.length
  if (s.in === 0) sources.push(s)
  if (s.out === 0 && s.incoming.length === 0) rightwardTargets.push(s) }   // WEST-only segments
maxRank = -1
while (sources.length) {                      // Kahn: slot = longest path from a source
  const s = sources.shift()
  for (d of s.outgoingDeps) { d.target.slot = max(d.target.slot, s.slot + 1); maxRank = max(maxRank, d.target.slot)
    if (--d.target.in === 0) sources.push(d.target) } }
if (maxRank > -1) {                           // compaction pass for WEST-only segments
  for (s of rightwardTargets) s.slot = maxRank
  while (rightwardTargets.length) {
    const s = rightwardTargets.shift()
    for (d of s.incomingDeps) { const p = d.source
      if (p.incoming.length > 0) continue     // only WEST-only predecessors move
      p.slot = min(p.slot, s.slot - 1)
      if (--p.out === 0) rightwardTargets.push(p) } } }
```

Slots start at 0 (nearest the left layer). Longest-path numbering packs everything
leftwards; the second pass pulls segments that touch only the right layer's WEST ports
(in-layer edges on the target side, section 3) as far right as their dependencies allow,
so a back-loop hugs its own node instead of sitting next to the far layer.
Segments have no lower bound from geometry: two segments with no dependency can share a
slot (they don't overlap or cross, by construction of the dependency).

#### 2.8 Bend point emission and junction points

`WestToEastRoutingStrategy.calculateBendPoints` (`L/p5edges/orthogonal/direction/WestToEastRoutingStrategy.java:31-82`):

```ts
if (seg.isDummy()) return                       // handled via its partner
const x = startPos + seg.slot * edgeEdge
for (port of seg.ports) {
  const sy = port.absoluteAnchor.y
  for (e of port.outgoingEdges) {               // every edge is emitted from its source port
    if (e.isSelfLoop) continue
    const ty = e.target.absoluteAnchor.y
    if (|sy - ty| <= TOLERANCE) continue        // straight: no bend points at all
    let cx = x, cs = seg
    bend(e, cx, sy); junction?(e, cs, (cx,sy))
    if (seg.splitPartner) {
      const jy = seg.splitPartner.incoming[0]   // the link y
      bend(e, cx, jy); junction?(...)
      cx = startPos + seg.splitPartner.slot * edgeEdge; cs = seg.splitPartner
      bend(e, cx, jy); junction?(...)
    }
    bend(e, cx, ty); junction?(e, cs, (cx,ty))
  }
}
```

Per edge: 2 bend points `(x, sy), (x, ty)` (4 with a split). ELK bend points exclude the
end points; the exporter (`L/graph/transform/ElkGraphLayoutTransferrer.java`) prepends the
source anchor and appends the target anchor, so the polyline is
`source anchor → (x,sy) → (x,ty) → target anchor`: stub, trunk, stub. A long edge is
routed channel by channel; through a long-edge dummy (size 0, both ports at the same y)
nothing is emitted unless the y changes, and `LongEdgeJoiner` concatenates the chains
(section 4). Bend points accumulate on an `LEdge` across processors: N/S postprocessor
prepends/appends, joiner concatenates, `ReversedEdgeRestorer` reverses.

Junction points (`BaseRoutingDirectionStrategy.addJunctionPointIfNecessary`, `:73-118`),
written to the edge's `junctionPoints` property, deduplicated per generator call by exact
position: point `p = bend.y` on segment `seg` is a junction if
`seg.start < p < seg.end` (strictly inside the trunk: a branch leaves the trunk there) or
(`incoming` and `outgoing` both non-empty and `p` equals both `incoming.first` and
`outgoing.first` within 1e-3, or both `.last`) — an end of the trunk where a straight
through-connection and the trunk meet. Ordinary two-port segments never qualify.
Junction points are the only place ELK tells the renderer "this is a T, not a crossing".

#### 2.9 Direction strategies (`direction/*`)

`BaseRoutingDirectionStrategy` abstracts: `portPositionOnHyperNode(port)` (the
cross-axis coordinate), `sourcePortSide`, `targetPortSide`, `calculateBendPoints`.
`WEST_TO_EAST`: y coordinate, EAST → WEST, `x = startPos + slot*spacing`.
`NORTH_TO_SOUTH` (`NorthToSouthRoutingStrategy.java`): x coordinate, SOUTH → NORTH,
`y = startPos + slot*spacing`, bend points `(sx, y), (tx, y)`.
`SOUTH_TO_NORTH`: NORTH → SOUTH, `y = startPos - slot*spacing` (slots grow upwards).
The generator, cycle breaker, splitter and numbering are direction-agnostic; the two
vertical strategies exist for `HierarchicalPortOrthogonalEdgeRouter`, which routes edges
to northern/southern *external* ports of a compound node in a strip above/below the
child layout (`L/intermediate/HierarchicalPortOrthogonalEdgeRouter.java`, compound
agent's scope). Layout direction DOWN is *not* done this way: the whole graph is
transposed by `GraphTransformer` and routed WEST_TO_EAST.

#### 2.10 Complexity

Dependencies are O(S²·(ports)) per channel where S = segments (non-straight edges),
cycle detection O(S + D), numbering O(S + D). Fine for hundreds of segments; the
`detectCycles` random tie-break is seeded (`randomSeed`, default 1) so results are stable.

### 3. Odd-side ports and in-layer edges

The router only ever connects EAST ports of layer i to WEST ports of layer i+1. Every
other port situation is rewritten into that shape before crossing minimization by
inserting dummy nodes *in the same layer*, producing **in-layer edges** (both ends in one
layer), which the router then handles as loops in the adjacent channel.

#### 3.1 Inverted ports (`L/intermediate/InvertedPortProcessor.java`, before P3)

For NORMAL nodes with fixed port sides:
- input port on EAST with edge `u → v.EAST`: new LONG_EDGE dummy `d` in v's layer
  (FIXED_POS, ports d.WEST/d.EAST, `ORIGIN = edge`); `edge.target = d.WEST`; new edge
  `d.EAST → v.EAST` (in-layer, EAST→EAST); HEAD labels move to the new edge;
  `LONG_EDGE_SOURCE/TARGET` set for hyperedge merging.
- output port on WEST with edge `v.WEST → w`: dummy `d` in v's layer; `edge.target = d.WEST`
  (so `v.WEST → d.WEST` is in-layer, WEST→WEST); new edge `d.EAST → w`.
Self loops are skipped. Crossing minimization orders `d` above/below `v`; node placement
gives it a y (dummy–dummy gaps use `spacing.edgeEdge`, dummy–node gaps `spacing.edgeNode`).

Routing of the result:
- `d.EAST → v.EAST` is found while routing the channel *right* of the layer: `d.EAST` is an
  EAST output port → segment; `v.EAST` joins it via `connectedPorts`; both y's go into
  `incoming` (extent = the two y's, no outgoing). Kahn gives it the lowest slot its
  dependencies allow. Bend points `(x, d.y), (x, v.y)`; after joining with `u → d`'s route
  the edge runs `u … → (across the layer at d.y) → (x, d.y) → (x, v.y) → v.EAST`: it passes
  the node horizontally and hooks back into its right side.
- `v.WEST → d.WEST` is found in the channel *left* of the layer through step 3 of 2.1
  (WEST output ports of the target layer): a segment with only outgoing connections →
  `rightwardTargets` → pushed to the highest slot (next to the layer). Bend points
  `(x, v.y), (x, d.y)`.
The polyline and spline routers require "at least one end of an in-layer edge is a
dummy" — true by construction.

#### 3.2 North/south ports (`L/intermediate/NorthSouthPortPreprocessor.java`, before P3)

For NORMAL nodes with `portConstraints.isSideFixed()` (a graph gets `NORTH_SOUTH_PORTS`
only if some port actually sits on N/S for the layout direction):
1. If port order is free and no model order: `sortPortList` — N ports become
   in-only | in/out | out-only left→right; S mirrored (`:244-295`).
2. Per N port (left→right), then per S port (right→left, i.e. list reversed): one
   `NORTH_SOUTH_PORT` dummy (`USE_NEW_APPROACH = true`, `:389-396`; the old approach paired
   an in-port with an out-port to its right on one dummy). In-port → dummy gets a WEST port
   with `ORIGIN = port`, incoming edges retargeted to it; out-port → EAST port, outgoing
   edges resourced; in/out port → both. `port.PORT_DUMMY = dummy`, `CROSSING_HINT` =
   number of dummy ports.
3. Dummies inserted into the layer list directly before the node (N) / after (S), all
   with `IN_LAYER_LAYOUT_UNIT = node` (kept together by crossing minimization) and
   successor constraints north-dummy → node, node → south-dummy unless
   `allowNonFlowPortsToSwitchSides`; dummies are `BARYCENTER_ASSOCIATES` of the node.
The self-loop branches (`:361-371`, `createSameSideSelfLoopDummyNode`,
`createNorthSouthSelfLoopDummyNodes`) belong to the dead `DummySelfLoopProcessor` path;
with the current pipeline self loops are hidden before P1 and never reach here.

Effect: the north port's edge now ends at a size-0 dummy directly above the node, and P5
routes it like any other edge — it arrives horizontally at the dummy's y.

`NorthSouthPortPostprocessor` (`L/intermediate/NorthSouthPortPostprocessor.java`, after P5):
for each dummy port with edges, `origin = port.ORIGIN`, `x = origin.absoluteAnchor.x`,
`y = dummy.y`; input port: `edge.target = origin; bendPoints.addLast(x, y)`; output port:
`edge.source = origin; bendPoints.addFirst(x, y)`. If the dummy has ≥2 ports and all were
created for the *same* origin port, `(x, y)` is also a junction point. Dummy removed. The
exporter then appends the origin anchor, giving `… → (trunk x, y) → (port.x, y) → (port.x, node.top)`:
the last leg runs along the node's top edge and drops vertically into the port. Several N
ports of one node get distinct dummy y's (stacked above the node by node placement), so
their horizontal runs do not coincide. For SPLINES the postprocessor only records
`SPLINE_NS_PORT_Y_COORD` on the origin port.

### 4. Reversed edges, feedback edges, joining, merging, unnecessary bend points

- **`ReversedEdgeRestorer`** (`L/intermediate/ReversedEdgeRestorer.java`, after P5,
  baseline): every edge with `REVERSED` gets `edge.reverse(graph, false)`
  (`L/graph/LEdge.java:58-92`): swap source/target, swap HEAD↔TAIL label placement,
  toggle the flag, **reverse the bend point list**. Output bend points therefore always
  run from the original source to the original target. Without `feedbackEdges`, a
  reversed edge was given ports by `PortSideProcessor` *after* cycle breaking (before P3:
  output side EAST on the new source = original target), so in the drawing it is a plain
  right-to-left polyline: leaves the original source's WEST side, enters the original
  target's EAST side; only the arrowhead reveals it.
- **`feedbackEdges=true`** (`L/GraphConfigurator.java:214`): `PortSideProcessor` runs
  before P1, port sides are fixed from the *original* direction (net flow: EAST if more
  outgoing). After reversal the edge has an input port on EAST (source node) and an
  output port on WEST (target node) → `InvertedPortProcessor` (always added with this
  option, `OrthogonalEdgeRouter.java:183-186`) builds dummies on both ends → the edge
  leaves the original source's EAST side, loops through the right channel, travels
  leftwards across the intermediate layers as a long edge, loops through the left channel
  and enters the original target's WEST side: the classic "wrap around" feedback route.
  Cost: two extra in-layer loops per feedback edge, two extra slots.
- **`LongEdgeJoiner`** (`L/intermediate/LongEdgeJoiner.java:70-126`, after P5, baseline):
  per LONG_EDGE dummy, pairs the i-th incoming and i-th outgoing edge (the splitter and
  the merger keep index correspondence): survivor = incoming edge; `survivor.target =
  dropped.target` inserted at the dropped edge's index; bend points = survivor's +
  (`unnecessaryBendpoints` ? the dummy's port anchor : nothing) + dropped's; labels and
  junction points concatenated. Because straight pieces emit nothing, a long edge that is
  straight across several channels has *no* bend points in the middle.
- **`unnecessaryBendpoints=true`**: one bend point per long-edge dummy (and at hierarchy
  crossings, `CompoundGraphPostprocessor`), i.e. the polyline records where the edge
  crosses each layer. Off by default; useful if a renderer needs per-layer anchor points.
- **`HyperedgeDummyMerger`** (`L/intermediate/HyperedgeDummyMerger.java`, before P4, only
  when the graph has `HYPEREDGES` = some port has >1 incoming or >1 outgoing edge,
  `ElkGraphImporter.java:1195-1198`, or hypernodes): `identifyHyperedges` labels ports by
  DFS over `connectedPorts` and over the two ports of each long-edge dummy; then within
  each layer, two *adjacent* LONG_EDGE dummies merge if (no label dummies on either edge
  and same hyperedge id) or (same `LONG_EDGE_SOURCE` and both are before their label
  dummy) or (same `LONG_EDGE_TARGET` and both after). Merging reroutes the second dummy's
  edges onto the first's ports; P5 then sees one port with several edges → one segment →
  one shared trunk with junction points. `LabelDummySwitcher` sets
  `LONG_EDGE_BEFORE_LABEL_DUMMY` so that a hyperedge is never merged across a label (the
  label would become ambiguous). `mergeEdges` (default false) is what usually *creates*
  hyperedges for port-less graphs: collector ports per node and direction.
- **`mergeHierarchyEdges`** (default true): hierarchy-crossing edges of one hyperedge
  share external ports — compound agent's scope.

### 5. Self loops

Self loops are removed from the graph before phase 1, routed *relative to their node*
before phase 4 (so node margins can reserve space), and re-attached after phase 5. The
whole thing lives in `L/intermediate/SelfLoop*.java` and `L/intermediate/loops/**`.
`DummySelfLoopProcessor` is dead code (only referenced from javadoc).

#### 5.1 Model (`loops/SelfLoopHolder.java`, `SelfHyperLoop.java`, `SelfLoopPort.java`, `SelfLoopEdge.java`)

`SelfLoopPreProcessor` (before P1) installs a `SelfLoopHolder` on each NORMAL node with a
self loop: one `SelfLoopPort` per involved port (`hadOnlySelfLoops` remembered), one
`SelfLoopEdge` per loop edge, and **SelfHyperLoops** = connected components of loop edges
over shared ports (BFS, `SelfLoopHolder.java:96-122`). Then it hides every loop edge
(`source = target = null`) and, unless port order is fixed or the node is a compound with
external ports, removes ports that carried only self loops from the node
(`SelfLoopPreProcessor.java:54-84`), so layering/ordering never see them.

`SelfLoopType` (`loops/SelfLoopType.java`) from the set of port sides of the hyperloop:
`ONE_SIDE`, `TWO_SIDES_CORNER` (adjacent), `TWO_SIDES_OPPOSING` (N+S or E+W),
`THREE_SIDES`, `FOUR_SIDES`.

#### 5.2 Port sides and order (`SelfLoopPortRestorer`, before P4)

If ports were hidden: for original constraints FREE/UNDEFINED, `PortSideAssigner`
(`loops/ordering/PortSideAssigner.java`) assigns sides by `edgeRouting.selfLoopDistribution`:
- `NORTH` (default): every hidden loop port → NORTH.
- `NORTH_SOUTH`: per hyperloop, greedily send all its hidden ports to whichever side has
  fewer ports so far.
- `EQUALLY`: hyperloops sorted by port count descending, round-robin over targets
  `N, S, E, W, NW-corner, NE, SW, SE`; for a corner target, ports sorted by net flow
  (more outgoing first), first half on the first side, second half on the second — so most
  loops run clockwise.
Then `computePortsPerSide` (type), then `PortRestorer.restorePorts`
(`loops/ordering/PortRestorer.java`): each side has three areas START/MIDDLE/END
(clockwise: N's start is its left end, E's start is its top). Fill order:
1. ONE_SIDE loops (in list order; reversed for `REVERSE_STACKED`): ports sorted by
   self-loop net flow (sources left); `STACKED` (default): split at the first port with
   positive net flow (fallbacks: first non-negative, then the middle), *prepend* the
   first group to MIDDLE and *append* the second → successive loops nest around earlier
   ones; `SEQUENCED`: append all → loops sit side by side.
2. corner loops: prepend to the first side's END, append to the second side's START.
3. three-side: END of the start side, MIDDLE of the middle side, START of the end side.
4. four-side: MIDDLE of every side.
5. opposing: like corner.
Then the node's port list is rebuilt clockwise, interleaving the regular ports:
N-START, regular N ports with WEST connections, N-MIDDLE, remaining N, N-END, E-START,
E-MIDDLE, regular E, E-END, S-START, regular S ports with EAST connections, S-MIDDLE,
remaining S, S-END, W-START, regular W, W-MIDDLE, W-END (`:253-307`).

#### 5.3 Routing (`SelfLoopRouter`, before P4, after `InnermostNodeMarginCalculator`)

Port ids = index in the (clockwise) port list. Per node, four steps:

**a. `RoutingDirector.determineLoopRoutes`** (`loops/routing/RoutingDirector.java`):
for each hyperloop choose `leftmostPort`/`rightmostPort`; the trunk leaves the leftmost
port and runs *clockwise* to the rightmost. ONE_SIDE: lowest/highest id on that side.
CORNER: lowest id on the first side (clockwise order, W-N corner handled), highest on the
second. OPPOSING: two candidate routes (via the side to the right of side A, or of side B);
pick the lower *penalty*, where penalty of running clockwise from port a to port b = sum
over ports passed of 1 (unconnected port) or 3 (connected) (`:224-269`, prefix sums with
wrap-around). THREE_SIDES: forced by the missing side (missing N → E…W etc.). FOUR_SIDES:
find the adjacent pair (by id, including the wrap pair) with the *highest* penalty and
route the other way around. `occupiedPortSides` = sides from leftmost's side clockwise
to rightmost's side.

**b. `LabelPlacer.placeLabels`** (`loops/routing/LabelPlacer.java`): per hyperloop with
labels choose a side + alignment: ONE_SIDE E/W → that side, TOP-aligned to the topmost
port; ONE_SIDE N/S stacked → CENTER on that side; `SEQUENCED` N/S one-siders are paired
outer-to-inner and aligned RIGHT/LEFT away from each other; CORNER → N or S side, aligned
to the port on that side; OPPOSING/THREE → centered on the uncovered side if that is N or
S, else N side aligned LEFT/RIGHT (inline labels: centered on the uncovered E/W side);
FOUR → centered on the fully covered N or S side. Then label management (if configured)
with target width = node width (+margins) for CENTER, the distance from the reference
port to the node's edge for LEFT/RIGHT, 60 for TOP; then the along-side coordinate
(`computeCoordinates`). The other coordinate is set by the router.

**c. `RoutingSlotAssigner.assignRoutingSlots`** (`loops/routing/RoutingSlotAssigner.java`):
reuses the orthogonal machinery. One `HyperEdgeSegment` per hyperloop; `activity[loop][portId]`
= true for every port from leftmost to rightmost (wrapping). For each pair:
`crossings(upper, lower)` = number of *upper*'s ports at which *lower* is active (upper's
branches must cross lower's trunk). Dependency `a → b` = a farther from the node than b
(here "above" = outer), weight = difference; equal non-zero crossings or overlapping labels
(same N/S side, x-ranges intersect) → zero-weight 2-cycle. `breakNonCriticalCycles`, then
reverse-Kahn from sinks (`outWeight == 0` → slot 0 = nearest): `source.slot = max(source.slot,
target.slot + 1)`. The raw slot applies to every occupied side, then `shiftTowardsNode`
compacts per side (N, E, S, W): loops sorted by slot; if the side has no ports, slots
0,1,2,…; else `lowest = max(nextFree[port])` over the loop's active ports within the side's
port index range, bumped past slots holding a conflicting label; assign; `nextFree[port] =
lowest+1` for the active ports. `holder.routingSlotCount[side]` tracks the maximum.

**d. `OrthogonalSelfLoopRouter.routeSelfLoops`** (`loops/routing/OrthogonalSelfLoopRouter.java`),
coordinates relative to the node origin. Spacings: `spacing.edgeEdge` (10),
`spacing.edgeLabel` (2), `spacing.nodeSelfLoop` (10). Slot positions per side:
baseline = `-(margin.top + nodeSelfLoop)` for N, `size.x + margin.right + nodeSelfLoop` for
E, `size.y + margin.bottom + nodeSelfLoop` for S, `-(margin.left + nodeSelfLoop)` for W;
slot k sits at the baseline advanced by Σ over previous slots of
`(maxLabelHeightInSlot + edgeLabel if a label lives there) + edgeEdge`, negative direction
for N and W (`:149-225`). Per loop edge: direction = CLOCKWISE if `target.side ==
source.side.right()`, COUNTER_CLOCKWISE if `.left()`, same side → by port id, opposite
side → CW if the hyperloop occupies `source.side.right()` else CCW. Bend points:
outer point at the source (`(anchor.x, slotPos[N])` for a N port, `(slotPos[E], anchor.y)`
for E…), one corner per side transition = (current side's slot coordinate) + (next side's
slot coordinate), outer point at the target; the exporter adds the two anchors. With an
inline label the label side's coordinate is shifted by half the label size so the label is
centered on the trunk. Node margins are enlarged to the bounding box of all bend points
and labels (`updateNewNodeMargins`) — this is how loops reserve space in node placement
and layer width. Labels: N → `y = slotPos - edgeLabel - h`, S → `slotPos + edgeLabel`, W/E
analogous (inline: no edgeLabel gap).

`PolylineSelfLoopRouter`: same, then cut every corner by 10 (capped at half the adjacent
segment). `SplineSelfLoopRouter`: insert a midpoint pushed outward by `edgeLabel` between
consecutive orthogonal points and fit a NUB spline → Bezier control points.

`SelfLoopPostProcessor` (after P5): re-attach each loop edge to its ports, offset its bend
points by the node position, apply label placement.

**`insideSelfLoops.activate`** (node) + **`insideSelfLoops.yo`** (edge): the loop is not
handled by any of the above. The importer treats it as an edge *inside* the node's child
graph between two external ports (the node becomes a compound node, `ElkGraphImporter.java:268-300, 920`),
and it is routed by the external-port machinery of the inner layout.

### 6. Edge labels

Three placements (`edgeLabels.placement`: CENTER default, HEAD, TAIL); `edgeLabels.inline`
(default false) applies to center labels only.

#### 6.1 Center labels → label dummy nodes

`LabelDummyInserter` (`L/intermediate/LabelDummyInserter.java`, before P2, on the
*unlayered* graph): for every non-self-loop edge with a CENTER label, create a `LABEL`
dummy node (FIXED_POS, `ORIGIN = edge`, `REPRESENTED_LABELS`, `LONG_EDGE_SOURCE/TARGET`),
split the edge through it (`LongEdgeSplitter.splitEdge`), and size it, horizontal layout:
`w = max(label.w)`, `h = Σ label.h + (n-1)*labelLabel + edgeLabel + thickness` (vertical
layout transposed); ports at `y = floor(thickness/2)` (edge along the top, labels below).
Consequences that the project measured as "labels inflate the layout":
- the dummy is a **real node for the layering**: source and target end up ≥ 2 layers
  apart even if adjacent otherwise, and a long edge gets an extra dummy in its chain;
- `LayerSizeAndGraphHeightCalculator` counts dummies, so the layer's width becomes at
  least the widest label passing through it — every node in that layer moves right of it;
- node placement stacks the dummy's height into the layer like a node.

`LabelDummySwitcher` (`L/intermediate/LabelDummySwitcher.java`, before P4, after
crossing minimization): moves the label dummy along its long edge to a better layer by
*swapping* it with the long-edge dummy there (layer positions preserved,
`swapNodes :424-461`). Strategy `edgeLabels.centerLabelPlacementStrategy` (graph default
`MEDIAN_LAYER`; a label may override): `MEDIAN_LAYER` = leftmost + (n-1)/2 of the n
layers the edge spans; `CENTER_LAYER` = first layer where the accumulated estimated width
(`layerWidth[i]` = widest NORMAL node; gap estimate `max(2*edgeNodeBetweenLayers,
nodeNodeBetweenLayers)`) reaches half the total; `WIDEST_LAYER`; `HEAD_LAYER`/`TAIL_LAYER`
= the layer next to the head/tail (honouring `REVERSED`) with node `alignment` RIGHT/LEFT
so the label hugs the node; `SPACE_EFFICIENT_LAYER` = heuristic: first assign labels
with one candidate layer or a layer already wide enough, then remaining labels largest
first to the layer with the largest *potential* width (max of current width and the
widest still-unassigned label that could go there). Size-based strategies run after the
others. Also sets `LONG_EDGE_BEFORE_LABEL_DUMMY` on preceding long-edge dummies (hyperedge
merge guard, section 4).

`LabelSideSelector` (`L/intermediate/LabelSideSelector.java`, before P4) — for center
*and* end labels, option `edgeLabels.sideSelection` (default `SMART_DOWN`):
`ALWAYS_UP/DOWN`; `DIRECTION_UP/DOWN`: edges pointing right (not `REVERSED`) get that
side, others the opposite; `SMART_UP/DOWN` (`:98-226`): walk each layer collecting runs
of consecutive LABEL/LONG_EDGE dummies: run at the top of the layer whose only label
dummy is its first node → ABOVE (keeps the edge short); mirrored at the bottom → BELOW;
run of exactly 2 dummies → first ABOVE, second BELOW; otherwise the default side, except
exactly two consecutive label dummies connecting the same node pair (tight A⇄B loops) →
ABOVE/BELOW. For a regular node's end labels: per port side, exactly two ports with
labels → split ABOVE/BELOW (N/E first above, S/W first below), else default.
`applyLabelSide` on a dummy (`:284-313`) stores `LABEL_SIDE` (INLINE if all its labels
are inline) and moves the ports: ABOVE → `port.y = size.y - ceil(thickness/2)` (edge along
the bottom); INLINE → `size.y -= edgeLabel + thickness`, `port.y = ceil(size.y - edgeLabel
- thickness)/2` (edge through the middle); BELOW → unchanged (top).

`LabelDummyRemover` (`L/intermediate/LabelDummyRemover.java`, after P5): label block origin
= dummy position (+`thickness + edgeLabel` in y for BELOW); available box = `(size.x, size.y
- thickness - edgeLabel)` (inline: full height); horizontal layout: each label centered
horizontally in the box, stacked with `labelLabel` spacing; vertical layout: side by side,
top/bottom/center-aligned (inline). Labels go back onto the original edge; the dummy is
joined out with `LongEdgeJoiner.joinAt(dummy, addUnnecessary = (edgeRouting == POLYLINE))`
— polylines need the bend point so the edge actually passes the label; orthogonal edges
are already horizontal at `dummy.y + port.y`.

`LabelManagementProcessor` (`L/intermediate/LabelManagementProcessor.java`, only if
`org.eclipse.elk.labels.labelManager` is set): before P4, one instance shortens node
labels (min width 40), port labels (20), end labels and comments (60); a second instance
(after the switcher) resizes center labels to `max(60, widest NORMAL node in the layer)`
and re-sizes the dummy. The hook is `ILabelManager.manageLabelSize(origin, targetWidth) →
new size` (truncate/wrap; ELK ships soft-wrapping and "…" truncation managers).

#### 6.2 Head/tail labels → node margins

`EndLabelPreprocessor` (`L/intermediate/EndLabelPreprocessor.java`, before P4): for every
node, per port gather TAIL labels of outgoing edges and HEAD labels of incoming edges
(following `PORT_DUMMY` for N/S ports; inverted-port dummies already moved head labels
onto the stub edge), remember `MAX_EDGE_THICKNESS`; one `LabelCell` per port (labels
stacked vertically in horizontal layouts). Cell position relative to the node origin
(`:185-267`): EAST port → `x = size.x + margin.right + edgeLabel`, `y = anchor.y -
thickness - edgeLabel - cell.h` if `LABEL_SIDE == ABOVE` else `anchor.y + thickness +
edgeLabel`; WEST → `x = -margin.left - edgeLabel - cell.w`, same y rule; NORTH → `y =
-margin.top - edgeLabel - cell.h`, `x = anchor.x ∓ (thickness + edgeLabel [+ cell.w])`;
SOUTH mirrored. Then a strip overlap removal among N cells and among S cells (gap
`2*labelLabel`). Finally the node margin becomes the union of the old margin box and all
cells — so end labels widen the layer and push neighbours in the layer apart; the
orthogonal router routes to the port anchor as usual and the label sits in the margin
beside the stub. `EndLabelSorter` (after P5) reorders labels within a cell by source
port id, target node id, target port id (desc) so multi-edge ports read in drawing order.
`EndLabelPostprocessor` (after P5) offsets the cells by the node position and applies.

#### 6.3 Labels and reversed edges

`LEdge.reverse` swaps HEAD↔TAIL placement, so end labels stay at the visually correct end.
`LabelDummySwitcher`/`LabelSideSelector` consult `REVERSED` for HEAD/TAIL_LAYER and
DIRECTION_* decisions. Inverted-port dummies carry the head label on the stub edge next
to the real port, `END_LABEL_EDGE` remembers the original edge for sorting.

### 7. Polyline and spline routers (brief)

`PolylineEdgeRouter` (`L/p5edges/PolylineEdgeRouter.java`): always adds
`InvertedPortProcessor`. Layer loop: place nodes at `xpos`; for each node, in-layer edges
first get one extra bend point at `layerBoundary ± 0.4 * min(1, edgeEdge/nodeNode) * |Δy|`
at mid-y (`processInLayerEdge`); then `processNode`: for each EAST/WEST port, a bend
point at the layer boundary x (right edge of the layer strip for EAST, left for WEST) at
the port's y, only if the port is farther than `edgeRouting.polyline.slopedEdgeZoneWidth`
(2.0) from that boundary (or the node is an in-layer dummy) and the far end's y differs by
more than 1; junction point if the port carries >1 edge. Layer spacing =
`0.4 * min(1, edgeEdge/nodeNode) * maxΔy + nodeNode`. Result: horizontal stub inside the
layer strip, straight slanted line across the channel. No slots, no crossings
minimization between channels. Splines "sloppy" is a *spline* mode, not polyline.

`SplineEdgeRouter` (`L/p5edges/splines/SplineEdgeRouter.java`): x placement mirrors the
orthogonal scheme (own `SplineSegment` ranking, `slotCount`, width `max(nodeNode,
2*edgeNode + (slots-1)*edgeEdge)`, but trunks centered via `xSegmentDelta`), with
`edgeRouting.splines.mode = SLOPPY` (default) possibly widening the channel by
`computeSloppySpacing` (factor `sloppy.layerSpacingFactor` 0.2). It emits *no* bend points;
`FinalSplineBendpointsCalculator` (`L/intermediate/FinalSplineBendpointsCalculator.java`,
after P5, after joiner/label remover/compaction) turns segment chains into NUB control
points (straight / in-layer / hyperedge / conservative vs sloppy cases; CONSERVATIVE adds
straightening control points 5 units from the anchors, SLOPPY uses fewer with a 0.4
center multiplier and may overlap nodes) and then Bezier control points, which become the
edge's bend points; the edge is marked `edgeRouting = SPLINES` so consumers interpret them
as control points.

### 8. External ports (high level)

Edges to WEST/EAST external ports end at external-port dummies that form the first/last
layer; the router skips the `edgeNode`/`nodeNode` padding on the outer side of such a
layer (`isLeftLayerExternal`). NORTH/SOUTH external ports are routed after P5 by
`HierarchicalPortOrthogonalEdgeRouter` with `OrthogonalRoutingGenerator(NORTH_TO_SOUTH /
SOUTH_TO_NORTH)` in a strip above/below the drawing; details in the compound section.

### 9. Options and defaults

Core (`plugins/org.eclipse.elk.core/src/org/eclipse/elk/core/Core.melk`) unless marked L
(`L/Layered.melk`); layered overrides `edgeRouting` to ORTHOGONAL.

| option | default | used by |
|---|---|---|
| `edgeRouting` | ORTHOGONAL (core UNDEFINED) | router choice; `POLYLINE`, `SPLINES` |
| `spacing.edgeEdge` | 10 | in-layer dummy–dummy gaps (P4), self-loop slot gap |
| `spacing.edgeNode` | 10 | in-layer node–dummy gaps (P4) |
| `spacing.nodeNode` | 20 | in-layer node–node gaps (P4) |
| L `spacing.edgeEdgeBetweenLayers` | 10 | slot pitch in the channel; `conflictThreshold` = half |
| L `spacing.edgeNodeBetweenLayers` | 10 | layer ↔ first/last slot |
| L `spacing.nodeNodeBetweenLayers` | 20 | minimum channel width |
| `spacing.edgeLabel` | 2 | label ↔ edge, all label kinds |
| `spacing.labelLabel` | 0 | between stacked labels |
| `spacing.nodeSelfLoop` | 10 | node margin ↔ first loop slot |
| `spacing.portPort` | 10 | port spacing (P4) |
| L `spacing.baseValue` | unset | scales the other spacings when set |
| `edge.thickness` | 1 | label dummy height, end-label offsets |
| `edgeLabels.placement` | CENTER | CENTER / HEAD / TAIL |
| `edgeLabels.inline` | false | center label on the line |
| L `edgeLabels.sideSelection` | SMART_DOWN | section 6.1 |
| L `edgeLabels.centerLabelPlacementStrategy` | MEDIAN_LAYER | on graph or label |
| L `feedbackEdges` | false | reversed edges wrap around nodes |
| L `mergeEdges` | false | collector ports → hyperedge trunks |
| L `mergeHierarchyEdges` | true | share external ports |
| L `unnecessaryBendpoints` | false | bend point per long-edge dummy |
| `junctionPoints` | output only | T-junction positions per edge |
| L `edgeRouting.selfLoopDistribution` | NORTH | NORTH / NORTH_SOUTH / EQUALLY (FREE ports only) |
| L `edgeRouting.selfLoopOrdering` | STACKED | STACKED / REVERSE_STACKED / SEQUENCED |
| L `edgeRouting.splines.mode` | SLOPPY | CONSERVATIVE / SLOPPY |
| L `edgeRouting.splines.sloppy.layerSpacingFactor` | 0.2 | |
| L `edgeRouting.polyline.slopedEdgeZoneWidth` | 2.0 | |
| `insideSelfLoops.activate` / `.yo` | false | route a loop inside its (compound) node |
| L `allowNonFlowPortsToSwitchSides` | false | N/S dummies not pinned to their node |
| `randomSeed` | 1 | tie-breaks in cycle detection |

### 10. For our engine

Geometry model: integer cells; a channel between layer i and i+1 is `T` track *rows*
(vertical layout: tracks are horizontal rows between node bands; ELK's "slot" = our
track); edges are drawn with box glyphs; crossings are legal and become `┼`; a T-junction
is `┬`/`┤`; labels are text on the line.

**Adopt as-is (it is the whole value of the phase):**
1. The segment model: per channel, one trunk per hyperedge = connected component of
   ports via edges (section 2.2). With port-less flowchart nodes, decide up front whether
   all edges out of a node share a port (ELK `mergeEdges`; gives fan-out trunks with
   junctions, fewer tracks) or one port per edge (parallel stubs). For terminals
   `mergeEdges`-style sharing is attractive: one exit cell per node side, junction glyphs
   for free.
2. Straight edges take no track and emit no bend: `sx == tx` (integers → exact equality,
   no TOLERANCE).
3. The dependency graph with *exactly* ELK's cost: crossings ×16, conflicts ×1, critical
   overlaps forbidden; longest-path slot numbering; the `rightwardTargets` compaction for
   in-layer loops on the target side. This is ~150 lines and is what makes multi-edge
   channels readable.
4. Eades greedy FAS for non-critical cycles (or any FAS: the graph is tiny per channel).
5. Junction-point rule (strictly inside the trunk extent, or at an extent end where a
   through-connection joins) → `┬ ┴ ├ ┤` selection; everything else at an intersection
   is `┼`.
6. `placeNodesHorizontally`'s alignment ratio (sinks hug the incoming side, sources the
   outgoing side) — in our vertical layout: node y inside its band by
   `outEdges/(in+out)`. Cheap, shortens stubs.
7. In-layer edges via same-layer dummies for inverted ports and feedback edges (section 3);
   the router needs no special case beyond the two `createHyperEdgeSegments` calls.
8. Self loops: the `SelfHyperLoop` type table + clockwise trunk from leftmost to rightmost
   port + per-side slots + margin expansion. Start with ONE_SIDE (distribution NORTH, i.e.
   for vertical layout: loops on the node's *east* side with all ports there) and
   CORNER; skip OPPOSING/THREE/FOUR until ports on all sides exist.
9. End labels as node-margin cells (section 6.2): simple and it composes with everything.

**Simplify away:**
- `conflictThreshold`/`criticalConflictThreshold` continuum. With integer tracks two
  stubs either share a row (`|y1-y2| == 0` → CRITICAL) or don't; there is no "too close"
  band. Conflicts collapse into: `countConflicts` returns CRITICAL iff an outgoing y of A
  equals an incoming y of B (merge walk on sorted ints). Keep `CONFLICT_PENALTY` code path
  out entirely; the dependency is then `crossings` only, with the critical case forbidden.
- Segment splitting (2.5) is the most intricate part and exists only because two
  straight-through stubs at the same y cannot share a track in ELK. In a terminal, two
  horizontal runs on the same row *can* coexist if they don't overlap in x… but in a
  channel every incoming stub spans `[layerEnd, trunk]` and every outgoing stub
  `[trunk, nextLayer]`, so equal-row stubs of two different trunks *do* overlap in
  general. Two options: (a) implement the splitter (jog: trunk A → row r → trunk B); (b)
  refuse the critical 2-cycle by forcing the two segments' stubs onto different rows,
  which we *can* do cheaply because our port rows are ours to nudge (ELK cannot move ports
  in P5). Recommend (b) first: on a critical 2-cycle, bump one port's row by 1 within its
  node side (re-run dependency creation for that channel). Fall back to (a) later. Note the
  splitter also needs `findFreeAreas` rows: in integer space a free area is any row not
  used by a stub in that channel, trivially enumerable.
- Direction strategies: one implementation for our single flow axis; transpose the
  result for LR/RL rendering as ELK does.
- The `LabelDummySwitcher` strategies except MEDIAN (or none: see labels below).
- Polyline/spline routers: not applicable to box glyphs.
- `unnecessaryBendpoints`, `mergeHierarchyEdges`, `insideSelfLoops`, label management hook,
  `allowNonFlowPortsToSwitchSides`, N/S "old approach".

**What changes with integer tracks:**
- Channel height `H = T` rows if `T > 0`, plus the edge–node gap. ELK's
  `2*edgeNode + (T-1)*edgeEdge` becomes `T + 2*g` with `g` = 0 or 1 (a stub needs no gap
  from a node, it *touches* it); minimum `nodeNodeBetweenLayers` = 1 row (a straight `│`
  needs at least one cell to be visible; with `T = 0` and all edges straight, one row of `│`
  is still needed for arrowheads — ELK has no such constraint).
- Track position = `channelTop + g + slot`. Slot 0 nearest the upper layer. ELK hugs the
  left when the `nodeNode` minimum is larger than the routing width; we should center
  tracks in the channel (as the spline router does with `xSegmentDelta`) — cheaper to read.
- Port anchors are cells; stubs run through cell centers. Two stubs on the same row of
  the same channel with overlapping x-ranges = overlap (CRITICAL). Same row, disjoint
  x-ranges (e.g. left and right of one trunk) = fine and is exactly a junction/turn.
- Crossing counting stays on integer y; `countCrossings` boundary case `pos == start`
  means the stub meets the trunk's corner cell — glyph-wise that is a `┬`/`┴` merge, not
  a `┼`, so either count it (ELK) or not; counting it is conservative.
- Node x placement: with widths forced even (existing engine) centers are integers; ELK's
  ratio placement rounds to a cell.

**Crossings are legal (junction glyphs):**
- ELK still minimizes crossings inside a channel because it cannot tell a crossing from
  a junction visually; we can, so weight 16 is not sacred. Keep crossings as the primary
  cost anyway: two trunks crossing produce a `┼` that reads as a junction *unless* the
  renderer distinguishes them (it does not). Consider weight 4 and tune on the corpus.
- A crossing of a stub and a trunk lands on a cell that is already part of the trunk: our
  canvas' direction-bit glyph merging handles it (`canvas.ts`). Junction points from
  section 2.8 are what selects `┬`/`├` over `┼`; emit them per edge as ELK does or, simpler,
  recompute from the final cell map (a cell touched by ≥3 arms of the *same* edge id is a
  junction; arms of different edges → crossing `┼`). The cell-map approach removes the
  bookkeeping entirely and is what a glyph renderer needs anyway.
- Hyperedge trunks (shared ports) *depend* on junctions being drawable; with shared exit
  ports the fan-out becomes `┬` rows rather than parallel stubs, which saves tracks.

**Labels drawn as text on the line:**
- Do not port label dummies. ELK's dummy is a node in the layering because it must
  reserve *space along the flow axis* for a label beside the edge. Our labels sit *on*
  the edge: on a vertical trunk the label needs `len(text)` cells horizontally — that is
  channel *width* between neighbouring trunks, not extra layers — and on a horizontal run
  it needs `len(text)` cells of run length. So the cost moves from the layering (extra
  layers, wider layers) to two local constraints: (1) track pitch — a labelled trunk needs
  `ceil(len/2)` free columns on each side in its channel rows, or the label is placed on
  a horizontal stub instead; (2) horizontal-run length — the existing post-route placement
  (into horizontal runs, straddling verticals, ellipsis last resort) already does this.
  Keep that; feed it ELK's `LabelSideSelector` idea only as a tiebreak (prefer the run
  nearest the median layer of the edge; prefer ABOVE for the top run of a layer).
- The one thing to take from `LabelDummyInserter` is the *layer-count* effect: if a label
  is longer than any horizontal run available, ELK's answer is "make the edge longer"
  (a dummy layer). Our fallback should be widening the channel (more rows so the trunk
  gets a horizontal jog with room for text), never an extra layer.
- Inline labels are the default for us; `edgeLabel`/`labelLabel` spacings are 0/0.
- Head/tail labels: put them in node margins as ELK does (section 6.2); in cells that
  means the node band grows by one row per labelled side — acceptable, and the margin
  union rule composes with self-loop margins.

**Pitfalls seen in ELK's code worth avoiding:**
- Dependency creation is pairwise over *all* segments, including pairs whose extents do
  not overlap; harmless but O(S²). Pre-filter by extent overlap (a crossing requires the
  stub y to lie inside the other's extent; a conflict requires equal rows).
- Zero-weight 2-cycles rely on "only 2-cycles have weight 0"; keep that invariant or use a
  proper FAS.
- The splitter never re-checks for new critical cycles after splitting.
- `insertSorted` de-dups by exact float equality; with ints use a Set.
- Straight-edge detection uses the *port anchors*, so a port that moved (N/S dummy,
  label dummy port y) silently turns a straight edge into a bent one; recompute after
  every port move.
- Bend point lists are mutated by four processors after P5 in a fixed order; if we keep
  ELK's "route = anchors + bends" convention, the final concatenation order is: N/S
  prefix, channel bends per layer pair in flow order, N/S suffix, then reversal for
  reversed edges. Easier: build the route once per original edge from the chain of its
  segment routes after all dummies are resolved.

---

## 6. Compound graphs

Scope: `hierarchyHandling=INCLUDE_CHILDREN` in ELK Layered (commit 8aaa3c14). `L/` =
`plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/`,
`core/` = `plugins/org.eclipse.elk.core/src/org/eclipse/elk/core/`.

### 0. Mental model in one paragraph

ELK does **not** layer or place a compound graph globally. Every nesting level is its own
`LGraph` with its own five phases, its own processor list and its own coordinate system.
Hierarchy is stitched together by exactly three mechanisms:

1. **Cutting** every hierarchy-crossing edge into per-level *segments* that end at
   *external-port dummy nodes* sitting just outside the child's content area
   (`CompoundGraphPreprocessor`). A child graph therefore looks like a flat graph with a few
   extra source/sink nodes pinned to its border.
2. **Interleaving** the per-graph processor lists bottom-up so a parent only places a
   compound node after the child has computed its final size and its border-port positions
   (`ElkLayered.hierarchicalLayout`, `HierarchicalNodeResizingProcessor`). The single
   phase that is genuinely hierarchy-wide is crossing minimization (`LayerSweepCrossingMinimizer`);
   even that is mostly "bottom-up: child decides its exits' order, parent obeys".
3. **Reassembling** the segments into the original edge, converting every segment's bend points
   into the coordinate system of the edge's ELK container (`CompoundGraphPostprocessor`,
   `ElkGraphLayoutTransferrer`).

Everything else (cycle breaking, layering, node placement, edge routing) is per-graph and
oblivious to the levels above/below except through the dummies.

### 1. `hierarchyHandling` semantics and the core engine

`core/options/HierarchyHandling.java:35-55`: `INHERIT` (default), `INCLUDE_CHILDREN`,
`SEPARATE_CHILDREN`. The core `RecursiveGraphLayoutEngine` resolves `INHERIT` to the parent's
value, root `INHERIT` -> `SEPARATE_CHILDREN` (`RecursiveGraphLayoutEngine.java:512-527`).
Algorithms only ever see the two concrete values (`GraphConfigurator.java:204-207` relies on it).

`RecursiveGraphLayoutEngine.layoutRecursively` (`:132-216`):

1. Node has children (or inside self-loops) -> it is a "layout node".
2. If `INCLUDE_CHILDREN` **and** the algorithm declares `GraphFeature.COMPOUND` (Layered does):
   BFS over descendants; a descendant with `SEPARATE_CHILDREN` or a *different* `elk.algorithm`
   is laid out first by a separate recursive call and then forced to `SEPARATE_CHILDREN`
   (`:201-211`); everything else is left to the one big algorithm run.
3. Otherwise plain bottom-up recursion: children first (each an independent run), then this node.
4. `executeAlgorithm` -> `LayeredLayoutProvider.layout` (`L/LayeredLayoutProvider.java:49-68`):
   `importGraph`, then `doCompoundLayout` if root has `INCLUDE_CHILDREN`, else `doLayout`,
   then `applyLayout`.

Consequences:

- Under `SEPARATE_CHILDREN` (the default!) a subgraph is laid out in isolation and a
  cross-boundary edge is **silently dropped** by the flat importer: `importFlatGraph` only
  transforms edges with `connectsSiblings || connectsToGraph` (`L/graph/transform/ElkGraphImporter.java:274-282`).
  The edge gets no route at all.
- Under `INCLUDE_CHILDREN`, a descendant that opts out (`SEPARATE_CHILDREN` / other algorithm)
  is opaque: an edge from outside into *its* interior throws
  `UnsupportedGraphException("The source or the target of edge ... could not be found ...")`
  (`ElkGraphImporter.java:1129-1135`), because its children were never imported.
- Topdown layout and `INCLUDE_CHILDREN` are mutually exclusive (`RecursiveGraphLayoutEngine.java:179-182`).

### 2. Import: `ElkGraphImporter.importHierarchicalGraph`

Entry: `importGraph` (`:96-141`) creates the root `LGraph`, transforms the root's own
external ports (a root node that itself has ports; `transformExternalPort :720-810`), then
branches on `HIERARCHY_HANDLING` (`:134-138`) to `importHierarchicalGraph` (`:309-464`).

Data structure: there is no `NESTED_LGRAPH`/`PARENT_LNODE` property any more (the ElkLayered
javadoc at `L/ElkLayered.java:81` is stale); it is two plain fields:
`LNode.nestedGraph` and `LGraph.parentNode` (`L/graph/LGraph.java:76,155-166`). Root graph:
`parentNode == null` (`ElkLayered.isRoot :361`).

```ts
interface LGraph { nodes: LNode[]; layers: Layer[]; parentNode: LNode|null;
                   size: Vec; padding: {l,t,r,b}; offset: Vec; props: Map }
interface LNode  { graph: LGraph; nestedGraph: LGraph|null; type: 'NORMAL'|'EXTERNAL_PORT'|...;
                   pos: Vec; size: Vec; ports: LPort[]; props: Map }
```

Procedure (nodes, BFS over the whole ELK tree, `:318-379`):

1. Pop `elknode`. Assign `MODEL_ORDER = index++` if the *direct parent's* options need model
   order (`needsModelOrder :472-476` -> `needsModelOrderBasedOnParent :484-506`). The counter is
   **global across all levels** (one BFS index space).
2. Create a nested `LGraph` for it only if it uses ELK Layered, has `INCLUDE_CHILDREN`, and has
   children or inside self-loops (`:335-344`). `createLGraph` (`:592-629`) copies all ELK
   properties of the node onto the graph, then sets
   `lPadding = elk.padding + insideNodeLabelPadding` (`:617-626`, label padding computed with a
   hard-coded `Direction.RIGHT`).
3. **Direction override is discarded**: `nestedGraph.setProperty(DIRECTION, parentGraphDirection)`
   (`:345`). Every nested graph is forced to the root's direction. See section 9.
4. Minimum size from ports/labels if `nodeSize.constraints` non-empty (`:355-360`,
   `calculateMinimumGraphSize :193-224` adds `MINIMUM_SIZE`).
5. `transformNode` into the parent's `LGraph` (`:364-369`); `COMPOUND_NODE=true` if it has children
   (`:920-922`); wire `lnode.nestedGraph`/`nestedGraph.parentNode`; enqueue children (`:372-377`).
6. After the loop: `MAX_MODEL_ORDER_NODES` and `CB_NUM_MODEL_ORDER_GROUPS` are set **on the root
   graph only** (`:380-384`). This is the elkjs crash, section 7.

Procedure (edges, BFS over ELK nodes, `:389-463`):

1. For each edge contained in the current ELK node: reject hyperedges (`checkEdgeValidity`),
   assign `MODEL_ORDER` if the **root's** options need it (`:397` tests `elkgraph`, the root,
   not the current node), skip `NO_LAYOUT`.
2. Choose the `LGraph` the `LEdge` lives in (`:417-433`):
   - inside self-loop, or target is a descendant of source -> the **source's nested graph**;
   - source is a descendant of target -> the **target's nested graph**;
   - otherwise -> the current ELK node's graph (which for a properly contained edge is the LCA).
   So an edge `A -> B` with `A` in compound `g1`, `B` in `g2`, both under root, lives in the root
   graph even though its endpoints are two levels down. The preprocessor fixes that up.
3. `transformEdge` (`:1084-1240`). Endpoints without ports get ports created
   (`LGraphUtil.createPort`); for a source that is an ancestor of the target the port is
   `PortType.INPUT` (`:1163-1169`, "external source port: put it on the west side").
4. `COORDINATE_SYSTEM_ORIGIN` (`:441-442`, `findCoordinateSystemOrigin :535-579`): null for
   sibling edges and for parent->descendant edges; otherwise the `LGraph` of the edge's ELK
   containing node (= LCA). Used only at export (section 8).
5. Recurse into children that are `INCLUDE_CHILDREN` and use Layered (`:448-462`).

External ports at import time exist only for the **root** node's own ports
(`checkExternalPorts :655-708`, `EXTERNAL_PORTS`/`HYPEREDGES` graph properties). For nested
levels the preprocessor manufactures them.

### 3. `doCompoundLayout` and the interleaved run

`L/ElkLayered.java:179-199`:

```
compoundGraphPreprocessor.process(root)     // cut edges, create port dummies
hierarchicalLayout(root)                    // phases, interleaved
compoundGraphPostprocessor.process(root)    // reassemble edges
```

Note `doCompoundLayout` has **no connected-components processing** ("currently not supported",
`:173-174`); `separateConnectedComponents` is only honoured in `doLayout` (`:143-160`), i.e.
never under `INCLUDE_CHILDREN`, at any level.

`hierarchicalLayout` (`:214-298`):

1. `collectAllGraphsBottomUp` (`:308-325`): BFS, then reversed -> deepest graphs first, root last.
2. `reviewAndCorrectHierarchicalProcessors` (`:336-354`): every graph must have the same
   `crossingMinimization.strategy` as the root, else `UnsupportedGraphException`;
   `greedySwitchHierarchical.type` is copied from root to all graphs.
3. `graphConfigurator.prepareGraphForLayout(g)` for **each** graph (`:227-233`): each graph gets
   its own processor list from its own options (cycle breaker, layerer, placer, router, spacings,
   padding all per level). `GraphConfigurator.java:204-211` adds `HIERARCHICAL_NODE_RESIZER`
   (after P5) to every graph with `INCLUDE_CHILDREN`. The port-dummy processors are added by the
   phases when the graph has `GraphProperties.EXTERNAL_PORTS` (set by the preprocessor, which
   ran before configuration):
   - `OrthogonalEdgeRouter.java:131-138`: `HIERARCHICAL_PORT_CONSTRAINT_PROCESSOR` (before P3),
     `HIERARCHICAL_PORT_DUMMY_SIZE_PROCESSOR` (before P4),
     `HIERARCHICAL_PORT_ORTHOGONAL_EDGE_ROUTER` (after P5). Polyline/spline routers add none.
   - `BKNodePlacer.java:123-126`, `SimpleNodePlacer`, `InteractiveNodePlacer`:
     `HIERARCHICAL_PORT_POSITION_PROCESSOR` (before P5).
   - `InteractiveLayerer.java:49-51`: `INTERACTIVE_EXTERNAL_PORT_POSITIONER` (before P1).
4. The scheduler (`:238-288`): loop until the root's iterator is exhausted; in each round walk
   graphs deepest-first and run processors until one implements
   `IHierarchyAwareLayoutProcessor`. Non-root graphs *consume* that processor and pause; the root
   *executes* it (it gets the whole hierarchy) and pauses. The only such processor is
   `LayerSweepCrossingMinimizer` (`L/p3order/LayerSweepCrossingMinimizer.java:87-88`).

Resulting order for root R containing compound P containing child C:

```
round 1: C[pre-P3: P1 cycle break, P2 layer, port-dummy constraint proc, long-edge split, ...]
         P[pre-P3]   R[pre-P3]   R[P3 = hierarchical sweep over C,P,R]
round 2: C[post-P3: in-layer constraints, P4 place, port position, P5 route,
                    port edge router, long-edge join, reversed-edge restore,
                    HIERARCHICAL_NODE_RESIZER (sets P.size + P's port positions),
                    DIRECTION_POSTPROCESSOR]
         P[post-P3 ... resizer sets R's node for P]   R[post-P3 ... root resize]
```

So: cycle breaking and layering happen for all levels **before** any crossing minimization;
placement and routing happen child-before-parent so `P` has its final size when `R` places it.
`HIERARCHICAL_NODE_RESIZER` is second-to-last in the after-P5 slot
(`L/intermediate/IntermediateProcessorStrategy.java:170-176`), right before
`DIRECTION_POSTPROCESSOR`, so it works in the internal left-to-right frame like everyone else.

### 4. `CompoundGraphPreprocessor`: cutting cross-hierarchy edges

File `L/compound/CompoundGraphPreprocessor.java`. `process` (`:103-121`):

```
crossHierarchyMap = Multimap<LEdge original, CrossHierarchyEdge segment>
transformHierarchyEdges(root, null)        // depth-first, deepest levels first
moveLabelsAndRemoveOriginalEdges(root)     // originals detached (source/target = null)
setSidesOfPortsToSidesOfDummyNodes()       // ports on compound nodes get FIXED_SIDE
root.CROSS_HIERARCHY_MAP = crossHierarchyMap
```

`CrossHierarchyEdge` (`L/compound/CrossHierarchyEdge.java:33-115`): `{edge: LEdge dummy,
graph: LGraph it lives in, type: INPUT|OUTPUT}`. `INPUT` = segment pointing *down* into deeper
hierarchy, `OUTPUT` = pointing *up*. `getActualSource/Target` map a dummy's port back to the real
port on the compound node via `ORIGIN`.

`transformHierarchyEdges(graph, parentNode)` (`:154-240`), per graph:

1. Recurse into every child that has a nested graph; collect the `ExternalPort` records the
   child *exported* (`containedExternalPorts`).
2. `processInsideSelfLoops(nestedGraph, child)` (`:616-684`): a self-loop with
   `insideSelfLoops.yo` on a compound node is moved into its nested graph as a dummy edge between
   two external-port dummies (one per port), `FREE` constraints, sides from the ports.
3. For every child with `EXTERNAL_PORTS`: make sure **every** port of the compound node has a
   dummy (even unconnected ones, `:178-189`), and copy port labels onto the dummy so the child
   reserves room for them (`:191-222`).
4. `processInnerHierarchicalEdgeSegments` (`:356-456`): for each external port exported by a
   child, for each original edge through it, three cases:
   - target/source is a direct child of `graph` -> `connectChild` (`:474-484`): dummy edge
     child-port <-> the external port's dummy, registered in the map.
   - both endpoints are descendants of `graph`'s children -> `connectSiblings` (`:502-522`):
     find the matching INPUT external port of the other child, dummy edge dummy->dummy
     (handled once, from the OUTPUT side; `:420-423`).
   - endpoint is `parentNode` itself or outside -> `introduceHierarchicalEdgeSegment` (below):
     the edge continues one level up.
5. `processOuterHierarchicalEdgeSegments` (`:541-610`, non-root only): for every port of every
   *direct* child, every incident edge whose other end is **not a descendant of `parentNode`**
   (i.e. leaves this compound, or ends at the compound node itself) gets
   `introduceHierarchicalEdgeSegment`. These are the "outer segments" (the ones touching the
   original source/target).
6. Return the exported `ExternalPort`s so the parent can continue the chains.

`introduceHierarchicalEdgeSegment(graph, parentNode, origEdge, oppositePort, portType, defaultExt)`
(`:731-801`):

1. `parentEndPort` = the port on `parentNode` if the edge ends at the compound node itself.
2. Reuse `defaultExt` (**mergeHierarchyEdges**, default true, `Layered.melk:1231-1241`) unless
   it is null, merging is off, or the edge ends at the parent itself. Reuse = same dummy node
   + same dummy edge for several originals (a hyperedge inside the child; `origEdges` list,
   thickness = max). Merging is per (child port, direction) - the loop variables
   `currentExternalOutputPort/InputPort` (`:552,575`) reset per child port.
3. Port side: the compound node's real port side if `parentEndPort != null`; else `WEST` for
   INPUT / `EAST` for OUTPUT if the compound has `isSideFixed()` constraints; else `UNDEFINED`
   and `createExternalPortDummy` picks from net flow and direction (`:752-762`; comment:
   "the safest thing is for people to set compound node port constraints to FREE").
4. `createExternalPortDummy` (`:889-948`): if the edge connects to `parentNode`'s own port,
   reuse/create the dummy for that port (`dummyNodeMap`); otherwise create a brand-new `LPort`
   on `parentNode` (`createPortForDummy :976-993`, side from flow direction:
   INPUT -> `fromDirection(dir).opposed()`, OUTPUT -> `fromDirection(dir)`), size (0,0),
   `PORT_BORDER_OFFSET = spacing.edgeEdge/2` ("FIXME No idea why", `:957-963`). Marks the graph
   `EXTERNAL_PORTS` and normalizes the graph's `PORT_CONSTRAINTS` to `FIXED_SIDE` or `FREE`.
5. Dummy edge (`createDummyEdge :813-818`: copy of origEdge's properties, junction points
   cleared) between `oppositePort` and the dummy's single port.
6. `ExternalPort{origEdges, newEdge, dummyNode, dummyPort (the port on the compound),
   type, exported = parentEndPort == null}` (`:1005-1046`). Not exported = the edge ended at the
   compound node itself, so the chain stops here.

Worked example, `A -> B`, `A` in `g1`, `B` in `g2`, both in root:

```
g1's graph:  A ─► [ext dummy d1 (EAST, LAST_SEPARATE)]          OUTPUT segment, in g1.nested
root graph:  g1.port(p1, EAST) ─► g2.port(p2, WEST)               OUTPUT segment (connectSiblings), in root
g2's graph:  [ext dummy d2 (WEST, FIRST_SEPARATE)] ─► B           INPUT segment, in g2.nested
```

Three levels deep (`A` in `g1a` in `g1`): one more OUTPUT segment `d(g1a) -> d(g1)` inside `g1`.
Edge from a node to its own enclosing compound (`A -> g1`): one segment `A -> d` in `g1.nested`,
`d` represents `g1`'s real port, not exported. Edge from outside to compound `g1` as a node:
ordinary edge in the parent, nothing cut. Self-loop on a compound: ordinary self-loop in the
parent unless `insideSelfLoops.activate`+`.yo`.

Labels (`moveLabelsAndRemoveOriginalEdges :249-304`): segments sorted source->target by
`CrossHierarchyEdgeComparator` (`L/compound/CrossHierarchyEdgeComparator.java:43-60`: all
OUTPUT segments first, deeper->shallower, then INPUT segments shallower->deeper). TAIL label ->
first segment, HEAD -> last, CENTER -> the shallowest segment (`getShallowestEdgeSegment :315-336`).
The label remembers `ORIGINAL_LABEL_EDGE` for the way back.

`setSidesOfPortsToSidesOfDummyNodes` (`:128-142`): for every (compound port, dummy):
`port.side = dummy.EXT_PORT_SIDE`, `INSIDE_CONNECTIONS=true`, `PORT_DUMMY=dummy`, and the
compound node's `PORT_CONSTRAINTS = FIXED_SIDE` (+ parent graph `NON_FREE_PORTS`). So after
preprocessing every compound node has fixed port sides decided by **net flow of the original
edges, before any cycle breaking** (section 7 gotcha).

### 5. External-port dummies through the pipeline

`LGraphUtil.createExternalPortDummy` (`L/graph/LGraphUtil.java:800-967`) builds the dummy:

| property | value |
|---|---|
| `type` | `NodeType.EXTERNAL_PORT` (`LNode.java:50`) |
| `PORT_CONSTRAINTS` | `FIXED_POS` (one port, at the dummy's centre/anchor) |
| side (`EXT_PORT_SIDE`) | given, or from `netFlow>=0 ? fromDirection(dir) : opposed` |
| WEST | `LAYER_CONSTRAINT=FIRST_SEPARATE`, `EDGE_CONSTRAINT=OUTGOING_ONLY`, port on EAST, size (0, port.h) |
| EAST | `LAYER_CONSTRAINT=LAST_SEPARATE`, `EDGE_CONSTRAINT=INCOMING_ONLY`, port on WEST |
| NORTH | `IN_LAYER_CONSTRAINT=TOP`, port on SOUTH, size (port.w, 0) |
| SOUTH | `IN_LAYER_CONSTRAINT=BOTTOM`, port on NORTH |
| `PORT_RATIO_OR_POSITION` | if order fixed: `port.index` (negated on SOUTH/WEST) or y (E/W) / x (N/S), divided by node size if `FIXED_RATIO` |
| `EXT_PORT_SIZE` | real port size (dummy itself is 0-wide across the border) |
| `PORT_BORDER_OFFSET` | copied; negative offset grows the dummy inward |

Direction handling: all of this is in the internal left-to-right frame; `GraphTransformer`
(`L/intermediate/GraphTransformer.java:268-270,339-341,467-469,635-637`) mirrors/transposes
`EXT_PORT_SIDE`, layer constraints and in-layer constraints of dummies along with the nodes.

Lifecycle of a WEST/EAST dummy (flow-aligned exits):

1. `EdgeAndLayerConstraintEdgeReverser` (before P1, `L/intermediate/EdgeAndLayerConstraintEdgeReverser.java:97-118`):
   `FIRST_SEPARATE` -> reverse any incoming edge, `LAST_SEPARATE` -> reverse any outgoing edge.
   Since the dummy's side came from net flow, an ext port with mixed traffic gets its minority
   edges reversed here (they become feedback edges).
2. `LayerConstraintPreprocessor` (before P2): `FIRST_SEPARATE`/`LAST_SEPARATE` nodes are
   **hidden** during layering; `LayerConstraintPostprocessor` re-inserts them into a brand-new
   first / last layer. Consequence: a child graph with exits always has one extra layer on each
   side, of zero-width nodes; edges from the dummy to a node in layer k>1 become long edges
   (`LONG_EDGE` dummies) inside the child.
3. `HierarchicalPortConstraintProcessor` (before P3, `L/intermediate/HierarchicalPortConstraintProcessor.java`):
   if the compound's constraints are at least `FIXED_ORDER`, sort the E/W dummies of the first
   and last layer by `PORT_RATIO_OR_POSITION` and chain them with
   `IN_LAYER_SUCCESSOR_CONSTRAINTS` (`:139-186`) so crossing minimization keeps the order.
4. Crossing minimization: the dummies are ordinary nodes of the first/last layer; their final
   order **defines the port order on the compound node** (section 6).
5. `HierarchicalPortPositionProcessor` (before P5, `:67-126`): only for `FIXED_RATIO`/`FIXED_POS`
   - overwrite the placed y with the ratio*graphHeight or the fixed y, then
   `borderToContentAreaCoordinates` (`LNode.java:467-481`: subtract padding+offset). Otherwise the
   node placer's y stands - the port y is wherever the placer put the dummy.
6. P5 routes to the dummy's port anchor like to any node.
7. `HierarchicalPortOrthogonalEdgeRouter` step 5 (`fixCoordinates :704-807`): x pinned to
   `-offset.x - padding.left` (WEST) / `graph.size.x + padding.right - offset.x` (EAST), i.e.
   exactly on the border, outside the content area; step 6 (`:819-869`) re-straightens the last
   segment to the (possibly moved) anchor y.
8. `HierarchicalNodeResizingProcessor.graphLayoutToNode` (`:79-107`): for every dummy whose
   `ORIGIN` is an `LPort`, `port.pos = LGraphUtil.getExternalPortPosition(...)` (`LGraphUtil.java:980-1023`:
   converts dummy centre to a port top-left relative to the compound node's corner, applying
   padding+offset and `PORT_BORDER_OFFSET`), `port.side = dummy.EXT_PORT_SIDE`. Then the compound
   node gets `PORT_CONSTRAINTS = FIXED_POS`, and `LGraphUtil.resizeNode(node, graph.actualSize, false, true)`
   (`:91-161`): size = content + padding, labels shifted, `NODE_SIZE_CONSTRAINTS = fixed`.
   `resizeGraph`/`resizeGraphNoReallyIMeanIt` (`:132-227`) first apply `nodeSize.minimum`,
   content alignment, and shift EAST/SOUTH dummies by the growth.

Lifecycle of a NORTH/SOUTH dummy (exits on the sides not aligned with flow; only arise when the
compound node has fixed port sides or from inside self-loops):

1. `IN_LAYER_CONSTRAINT TOP/BOTTOM` keeps the dummy at the top/bottom of *whatever layer* the
   layerer puts it in (it has no layer constraint), handled by `InLayerConstraintProcessor`.
2. `HierarchicalPortConstraintProcessor.processNorthernAndSouthernPortDummies` (`:197-337`):
   if sides are fixed, the original N/S dummy is taken out of its layer and replaced by one
   *temporary* dummy per (ext port, adjacent layer) where a connected node lives, re-routing
   edges to these temporaries (`createDummy :367-384`: two ports W/E, `FIXED_POS`,
   `ALIGNMENT=CENTER`, `EXT_PORT_REPLACED_DUMMY -> original`). New first/last layers may be
   created. The originals are stashed in `EXT_PORT_REPLACED_DUMMIES`.
3. `HierarchicalPortDummySizeProcessor` (before P4, `:60-129`): temporaries in one layer get
   widths `0, 2*edgeEdgeBetweenLayers, 4*...` (reversed for SOUTH) so that, centre-aligned,
   their vertical edge segments do not overlap - a placement trick to get separate channels.
4. `HierarchicalPortOrthogonalEdgeRouter` (after P5, `:100-145`): restore originals
   (`:160-200`), place them at `y = -padding.top - offset.y` (NORTH) or
   `size.y + padding.top + padding.bottom - offset.y` (SOUTH) with x = mean of connected ports'
   x for FREE/FIXED_SIDE/FIXED_ORDER (`:357-381`) then `ensureUniquePositions`/`restoreProperOrder`
   (`:415-497`, `spacing.portPort` apart, may widen the graph), ratio/fixed x otherwise; route the
   edges between the temporaries and the originals with an `OrthogonalRoutingGenerator`
   in SOUTH_TO_NORTH / NORTH_TO_SOUTH direction (`:511-586`) - this **grows the graph**
   (`offset.y += nodeSpacing + (slots-1)*edgeSpacing`, `size.y += ...`) to make a routing strip
   between the border and the first node row; then delete the temporaries splicing their bend
   points into the real edges (`:598-690`).

Root-level external ports (a root node with its own ports): `ElkGraphLayoutTransferrer:105-112`
writes the port position from the dummy; `ElkLayered.resizeGraph` (`:675-770`) handles
`nodeSize.minimum`, `NODE_SIZE_FIXED_GRAPH_SIZE`, content alignment, and shifts EAST/SOUTH dummies.

Interactive layout: `InteractiveExternalPortPositioner` (before P1, `:64-130`) invents positions
for dummies (WEST: `minX - 10`, y of its neighbour; NORTH: `minY - 10`) because interactive
cycle breaking/layering need coordinates. Throws for N/S ports with both in- and outgoing edges.

### 6. Crossing minimization across the hierarchy

`LayerSweepCrossingMinimizer` (`L/p3order/LayerSweepCrossingMinimizer.java`), the only
`IHierarchyAwareLayoutProcessor`; runs once on the root with all graphs already layered.

1. `initialize` (`:609-630`): BFS over graphs, `graph.id = index`, one `GraphInfoHolder` each
   (`L/p3order/GraphInfoHolder.java:80-124`: node-order array, crossing counter, port
   distributor, heuristic; `childGraphs` discovered from nodes' `nestedGraph`). Each holder
   decides `useBottomUp` via `LayerSweepTypeDecider.useBottomUp` (`L/p3order/LayerSweepTypeDecider.java:66-138`):
   bottom-up if `hierarchicalSweepiness < -1` (`bottomUpForced`), or root, or the compound
   node's port order is fixed (`:140-142`), or it has fewer than two ports on both EAST and
   WEST (`:177-180`); *hierarchical* (sweep-into) if the heuristic is deterministic; else a
   path-count score `(pathsToRandom - pathsToHierarchical)/all >= sweepiness` (default 0.1,
   `Layered.melk:385-392`) decides. Bottom-up graphs are collected deepest-first in
   `graphsToSweepOn`.
2. `minimizeCrossings` (`:150-160`): for each bottom-up graph run the minimizing method
   (`chooseMinimizingMethod :139-148`: randomized barycenter -> `compareDifferentRandomizedLayouts`
   with `thoroughness` restarts; note the seed reset at `:186-188` so identical child graphs get
   identical orders), then `setPortOrderOnParentGraph` (`:162-170`): reorder the compound node's
   E/W ports by the first/last layer's dummy order (`sortPortsByDummyPositionsInLastLayer :504-523`,
   only ports with `INSIDE_CONNECTIONS`) and set the compound's `PORT_CONSTRAINTS = FIXED_ORDER`.
   So **bottom-up = child decides the exit order, parent obeys**.
3. During a sweep over a graph (`sweepReducingCrossings :450-469`), each node with a nested graph
   marked *not* bottom-up is swept into (`sweepInHierarchicalNode :482-502`): the child's first
   layer (the ext-port dummies) is ordered by the parent's current port order
   (`sortPortDummiesByPortPositions :525-543`), the child is swept, then the parent's ports on the
   far side are reordered by the child's last layer. Crossings are counted over the sweep-into
   subtree (`countCurrentNumberOfCrossings :392-409`). So **hierarchical = parent's port order
   flows into the child, child's exit order flows back out**, per sweep.
4. `transferNodeAndPortOrdersToGraph` (`:632-639`) writes the best orders back.

Greedy switch under hierarchy: `greedySwitchHierarchical.type` (default OFF,
`Layered.melk:421-435`) is read only from the root and pushed to all graphs
(`ElkLayered:349-353`, `GraphConfigurator:293-305,362-372`); the processor itself is per-graph.

### 7. Cycle breaking across the hierarchy + the elkjs crash

Cycle breaking is a **per-graph phase** run before any crossing minimization (section 3). A
cycle that threads through compound nodes is seen by the parent as a cycle among its segments
(`g1 -> g2 -> g1`) and broken there; inside the children the segments are dummy->node or
node->dummy and cannot form cycles with each other. Two consequences:

- The reversal happens on a *segment*; `ReversedEdgeRestorer` (after P5) restores it per graph;
  the postprocessor concatenates. Fine.
- But port **sides** were fixed earlier by net flow (section 4, `setSidesOfPortsToSidesOfDummyNodes`)
  and the child's dummies are already `FIRST/LAST_SEPARATE` on the side matching the original
  edge direction. A hierarchy-crossing back edge therefore always leaves the child on its
  "forward" border and loops around outside the compound to enter the target's "forward" border:
  ELK never re-derives exit sides from the broken graph. (Same effect at the parent level:
  `EdgeAndLayerConstraintEdgeReverser` reverses the minority-direction edges at a mixed port.)

The crash the project hit (elkjs >= 0.11, model-order strategy set on a compound containing a
cycle) is ELK commit `80b3a2de` (2025-06-04, "Count internal variables for INCLUDE_CHILDREN
too"): `importHierarchicalGraph` now stores `MAX_MODEL_ORDER_NODES` and
`CB_NUM_MODEL_ORDER_GROUPS` but **only on the root LGraph** (`ElkGraphImporter.java:380-384`);
nested graphs never receive them (`createLGraph` copies ELK-node properties, and these are
internal). Both properties are declared without a default (`L/options/InternalProperties.java:425,430`),
so `getProperty` returns `null`. Consumers unbox them:

- `GreedyModelOrderCycleBreaker.chooseNodeWithMaxOutflow` (`L/p1cycles/GreedyModelOrderCycleBreaker.java:37-38`):
  `Math.max(size, graph.getProperty(MAX_MODEL_ORDER_NODES))` and
  `offset * graph.getProperty(CB_NUM_MODEL_ORDER_GROUPS)` -> NPE in Java, a `TypeError` in the
  GWT-compiled elkjs. `GreedyCycleBreaker.process` only calls `chooseNodeWithMaxOutflow` when a
  node that is neither source nor sink remains after peeling (`L/p1cycles/GreedyCycleBreaker.java:169-192`),
  i.e. **only when the nested graph contains a cycle** - exactly the observed trigger for
  `GREEDY_MODEL_ORDER`.
- `ModelOrderCycleBreaker.process` (`L/p1cycles/ModelOrderCycleBreaker.java:70-71`) reads the same
  two properties unconditionally -> crashes for *every* nested graph under `MODEL_ORDER`, cycle or
  not.
- `GroupModelOrderCalculator` also assumes `MODEL_ORDER` is dense per graph; with the global BFS
  index (section 2) nested graphs get sparse, large model orders, so the `offset` math for
  `FIRST/LAST` constraints (`:45-69`) is only correct on the root anyway.

Any strategy on the root is unaffected (root has the properties); setting a model-order strategy
on a compound node itself (the project's `groupOpts` case) or letting `INHERIT`ed processing pick
the root's strategy for the nested graph both crash. The project's workaround (strip the strategy
from compounds and pre-break cycles on the flat graph) is the right shape; the upstream fix is a
one-liner in the importer (set the two properties on every created nested graph).

### 8. Reassembly and export: coordinate systems

Coordinate conventions inside Layered (`LGraph.java:40-61`, `LGraphUtil.changeCoordSystem :1058-1092`):

- node positions are relative to the graph's *content area*; absolute =
  `pos + graph.offset + (padding.left, padding.top) + parentNode.pos + ...` recursively.
- `graph.offset` is a mutable accumulator that several processors add to (N/S port routing,
  content alignment); `size` excludes padding; `getActualSize()` includes it.
- external-port dummies end up at negative / beyond-size coordinates (outside the content area,
  on the border), which is why `borderToContentAreaCoordinates` exists.

`CompoundGraphPostprocessor.process` (`L/compound/CompoundGraphPostprocessor.java:75-197`), per
original edge:

1. Sort its segments source->target (comparator, section 4). Real endpoints =
   `first.getActualSource()`, `last.getActualTarget()`; restore them on the original edge (`:186-187`).
2. Reference graph (`:100-106`) = the source node's graph, or the source's *nested* graph if the
   target is its descendant.
3. For each segment: `offset = changeCoordSystem((0,0), segment.graph, referenceGraph)`; copy
   the segment's bend points shifted by `offset`; compute the shifted segment source/target
   anchors. Between segments, add the new segment's source point as a bend point only if the
   previous endpoint differs in **both** x and y by more than `OrthogonalRoutingGenerator.TOLERANCE`
   (or in either, with `unnecessaryBendpoints`) (`:132-153`). Junction points shifted and merged
   (`:163-164,204-235`); labels moved back with their position converted (`:240-257`).
4. If the last segment's target port lives in a different graph than the segment (edge ending at
   the compound node's own port), store `TARGET_OFFSET` (`:166-175`) - the transferrer adds it to
   the target anchor.
5. Dummy edges are detached (`:191-194`); **dummy nodes and the manufactured ports on compound
   nodes stay** in the graph (the transferrer skips nodes whose `ORIGIN` is not an `ElkNode`).

`ElkGraphLayoutTransferrer.applyLayout` (`L/graph/transform/ElkGraphLayoutTransferrer.java:67-149`),
recursive per graph:

1. `offset = graph.offset + (padding.left, padding.top)` (`:80-85`); write `elk.padding` back if
   `nodeSize.options` has `COMPUTE_PADDING` (`:88-95`).
2. Nodes: `elknode.xy = lnode.pos + offset`; size written only if size constraints are set,
   the node has a nested graph, or network-simplex flexible sizing (`:159-182`). Ports and labels
   are relative to the node.
3. Edges are written by the graph of their **source node**, excluding edges whose target is a
   descendant of that node (`:117-121`); those are written by the child graph's call
   (`:125-131`). `applyEdgeLayout` (`:233-314`): `edgeOffset = offset + calculateHierarchicalOffset`
   (`:326-349`: walk up from the source's graph to `COORDINATE_SYSTEM_ORIGIN`, adding each
   compound node's position + its graph's offset+padding), source point = source anchor (special
   case parent->descendant: the compound's own port, relative to the compound's corner, `:253-262`),
   target = target anchor + `TARGET_OFFSET`, all shifted, then written into **exactly one
   `ElkEdgeSection`** (`ElkGraphUtil.firstEdgeSection(edge, reset=true, removeOthers=true)`,
   `ElkGraphUtil.java:245-267`).
4. `applyParentNodeLayout` (`:357-397`): the root node gets `ElkUtil.resizeNode` (fixed-pos ports
   if it had external ports); every graph's node gets `NODE_SIZE_CONSTRAINTS = fixed`.

Net effect for the consumer (the JSON side): every edge has one section whose points are
relative to the edge's ELK **container** = LCA of source and target (the source node itself for
parent->descendant edges) - the ELK coordinate convention (`docs/.../coordinatesystem.md`), and
`JsonImporter.xtend:680` writes that node's id into the edge's `container` field. There is no
"one section per level" output; if the project saw several sections, they came from somewhere
else (elkjs' `edgeCoords` option, or the input), not from ELK Layered. Compound node coordinates
are relative to their parent's corner, children to the compound's corner (padding already inside).

### 9. Per-compound options

- **Direction**: forced to the root's (`ElkGraphImporter.java:345`). Mermaid's `direction LR`
  inside a subgraph cannot be expressed under `INCLUDE_CHILDREN`. `DIRECTION_PREPROCESSOR/
  POSTPROCESSOR` are per-graph processors, so nothing structural prevents it - but external-port
  dummies' sides are computed in the parent's frame, and the child's `GraphTransformer` would
  transpose them; the code never reconciles that, hence the override. With `SEPARATE_CHILDREN`
  a subgraph keeps its own direction but loses cross-boundary edges (section 1).
- **Padding**: `elk.padding` per node -> `LGraph.padding` (+ inside label padding). Default is
  the core default (12 each side) unless set per node; the project sets it explicitly.
- **Spacings**: `Spacings` object is built per graph from that graph's options
  (`GraphConfigurator:134-135`), so `spacing.*` must be repeated on every compound (the
  project's comment "spacing does not cascade" is correct; `spacing.baseValue` is applied per graph too, `ElkGraphImporter:348-351`).
- **Node size**: a compound node's size is the child layout + padding, `nodeSize.minimum` /
  `MINIMUM_SIZE` honoured by `resizeGraph`; `nodeSize.constraints` on the compound feed
  `calculateMinimumGraphSize` (ports/labels). After the resizer the size is `fixed`, so the
  parent's `LabelAndNodeSizeProcessor` treats it as a fixed box and just places its labels.
- **Node labels (title)**: `nodeLabels.placement` with `INSIDE` reserves space via graph padding
  at import (top row for `V_TOP`); with `OUTSIDE` the label becomes a margin in the parent
  (the project's `[H_LEFT, V_TOP, OUTSIDE]`). `HierarchicalNodeResizingProcessor` explicitly
  ignores labels (`:126`).
- **Ports on compounds**: `portConstraints` on the compound node influences where dummies go:
  `FREE`/`FIXED_SIDE` -> sides by net flow (recommended by the code comment); `FIXED_ORDER`+ ->
  E/W order enforced, N/S ports possible; `FIXED_RATIO`/`FIXED_POS` -> positions forced. The
  preprocessor overwrites the constraint to `FIXED_SIDE` after creating dummies, and the
  resizer to `FIXED_POS`.
- **Cycle breaking / layering / placement / routing strategies**: per graph (own processor list).
  Crossing minimization strategy must match the root; greedy switch type is the root's.
- **separateConnectedComponents**: ignored everywhere under `INCLUDE_CHILDREN` (section 3).
- **Model order**: node order index is one global BFS counter; edge model order is decided by the
  root's options (`:397`), node model order by the direct parent's (`:322`).

### 10. Limitations and gotchas (from code and comments)

- Hyperedges unsupported (`ElkGraphImporter:1253-1255`); inside the algorithm a port with several
  hierarchy edges is merged into one dummy edge (`mergeHierarchyEdges`), which is how "hyperedges
  can share a port".
- No connected components under `INCLUDE_CHILDREN`; a child with two disconnected islands is laid
  out as one graph (islands stacked by the placer, no packing).
- Only the orthogonal router registers the hierarchical-port processors; with `POLYLINE`/`SPLINES`
  N/S external ports are not specially handled and E/W dummies only get x/y from the placer.
- `HierarchicalPortOrthogonalEdgeRouter.correctSlantedEdgeSegments`: "TODO: The edge has no bend
  points yet, but may still be slanted" (`:847`) - a straight segment to a dummy whose y was moved
  by `fixCoordinates` stays slanted.
- `PORT_BORDER_OFFSET = spacing.edgeEdge/2` for manufactured ports: "FIXME No idea why" (`:959`).
  Ports created for a hierarchy edge sit half an edge spacing outside the border.
- N/S dummies: the width-staircase (`HierarchicalPortDummySizeProcessor`) assumes `CENTER`
  alignment and one temporary per layer; positions may be pushed right by `assignAscendingCoordinates`
  after placement, widening the graph but not re-placing nodes.
- `hierarchicalSweepiness` only matters for randomized heuristics and compound nodes with >=2
  ports on a side and non-fixed port order; in practice most compounds are bottom-up.
- The root's crossing-minimization strategy is mandatory for all levels (exception otherwise).
- Interactive layout: N/S external ports with both in- and outgoing edges throw.
- `ElkLayered.java:81` javadoc still refers to `NESTED_LGRAPH`; it does not exist.
- Model-order cycle breakers crash in nested graphs (section 7).
- `DIRECTION` per subgraph silently overridden (section 9); `Direction.RIGHT` hard-coded in the
  inside-label padding computation (`ElkGraphImporter:620`).
- Edge model order under hierarchy is global by BFS over containers, i.e. root edges first,
  then edges declared inside compounds - not declaration order across the file.

### 11. For our engine

What ELK's INCLUDE_CHILDREN actually is, stripped of ceremony: **recursive bottom-up layout where
each crossing edge is cut at each border into segments, the child sees a zero-size source/sink
node pinned to its entry/exit border (in the flow-facing first/last layer), the child's own
placement/routing decides the exact border cell and the lane to the first inner node, and the
parent then treats the frame as a fixed-size node with fixed-position ports.** Only crossing
minimization optionally couples the levels, and by default it degrades to "child orders its
exits, parent obeys".

Compare with (b), the current rule-based renderer: independent recursive layouts, then the
outer scope tries to pierce the frame via a scan for a blank corridor, falling back to attaching
at the frame. The corridor scan is exactly the information ELK obtains for free from the dummy:
the child *reserves* the lane because the dummy is a real node in its first layer with a real edge
to the inner target, so the child's node placer and router keep that column clear and the edge
enters straight.

Recommendation: **hybrid = ELK's bottom-up half, without the hierarchical sweep and without N/S
external ports**, plus global cycle breaking done before cutting.

1. **Break cycles globally on the flat leaf graph first** (the project already does this for
   model order). Then derive, per crossing edge, its direction in the *acyclic* graph and cut it.
   This avoids ELK's wrong-side loop-around for hierarchy-crossing back edges (section 7) and the
   `EdgeAndLayerConstraintEdgeReverser` reversals at mixed ports. Every child's cut edges are then
   consistently "enter through the upstream border, leave through the downstream border".
2. **Cut edges into segments per level** exactly as `CompoundGraphPreprocessor` does, but keep it
   simple: no port merging (one dummy per crossing edge, `mergeHierarchyEdges=false` semantics;
   merge only if the same source port feeds several outside targets and you want one border
   cell), no self-loop-inside machinery, no manufactured ports as first-class objects - a
   segment just records `(level, dummy, innerPort)`.
3. **Dummies are nodes in the child**, height 0 (TB frame: a border cell of width 1 on the top
   or bottom border), `FIRST_SEPARATE` / `LAST_SEPARATE`: hide during layering, then put in a new
   first/last layer of width 0 in the flow axis. Crossing minimization inside the child orders
   them; that order is the port order on the frame. Do *not* implement `IN_LAYER_CONSTRAINT`
   N/S dummies: with flow-aligned exits only, a crossing edge always pierces the top or bottom
   border (TB), which in a terminal is the cheap case (a `┬`/`┴` junction glyph on a horizontal
   border line). Piercing a vertical border needs `┤`/`├` and a horizontal run inside the frame
   competing with node rows - avoid it by construction.
4. **Border cell = port position** (integer). After the child's placement, each dummy's cross-axis
   coordinate is its column; snap to an integer cell that is (i) not the frame corner, (ii) not
   under the title text if the title lives on the border row, (iii) at least 1 cell from the next
   port (ELK: `spacing.portPort`, `assignAscendingCoordinates`). Shifting a dummy after placement
   is what ELK does too (`fixCoordinates`, `ensureUniquePositions`) and it introduces a jog; in
   cells prefer to give the dummy a 1-cell width and let the placer align it, and only shift when
   the title collides. If the title is on the top border row, either reserve that row's title span
   as unpierceable, or put the title on the right/left where exits are rare, or move the title into
   a padding row inside (costs 1 row, ELK's `INSIDE V_TOP` behaviour).
5. **Sizes bottom-up**: child content size + padding (+1 border each side, +1 title row if inside)
   = frame size; frame becomes a fixed-size node with `FIXED_POS` ports at the border cells.
   The parent lays out, then routes its segment to those exact cells. Keep ELK's rule that the
   parent does not run placement until all children are final (their processor interleaving is
   only needed because they run one global crossing-min; with no hierarchical sweep the schedule
   is plain post-order recursion: `layout(child*)` then `layout(parent)`).
6. **Coordinates**: keep every level relative to its frame's content origin and convert once at
   the end with an explicit `toAbsolute(level)` (ELK's `changeCoordSystem`). Do not replicate the
   mutable `graph.offset` accumulator; N/S routing strips are the only reason it exists.
   Integer everything: content origin = `frame.x + 1 + padding.left`, etc. Rounding happens
   nowhere because nothing is fractional; the one place ELK needs care - centring a 0-size dummy on
   a port - disappears if the dummy is 1 cell wide and the port *is* that cell.
7. **Reassembly**: concatenate segments; a junction between segments is a straight vertical run
   through the border cell (top border, TB) so no extra bend is needed; ELK's "add bend only if
   both x and y differ" rule applies verbatim. Draw the border junction glyph from the direction
   bits (the renderer already resolves crossings that way).
8. **Crossing minimization coupling**: start bottom-up only (`hierarchicalSweepiness = -2`
   equivalent). The parent must respect the child's exit order as `FIXED_ORDER` ports of the frame
   node - which is just port-order-aware barycenters on the frame node, something a
   ports-first-class engine needs anyway. Add sweep-into later only if measured crossings at
   frame borders justify it; ELK itself falls back to bottom-up for fixed port order and for
   compounds with fewer than two exits per side, i.e. for most Mermaid subgraphs.
9. **Per-subgraph direction**: ELK cannot do it; the project's current rule (honour `direction`
   only for subgraphs with no crossing edges, `crossed`) is the right compromise and composes
   with the hybrid: a closed subgraph is laid out in its own direction as an opaque fixed-size
   node with zero ports. Do not try to support an LR child inside a TB parent with crossing edges:
   that is precisely the N/S external-port case, the most fragile code in ELK's hierarchy support.
10. **Edges to the subgraph itself** (`A --> sg`): treat the frame as a node (no cut), as ELK does.
    Edges from a node to its own enclosing frame: one non-exported segment ending at a border
    cell (ELK's `exported=false`), rare in Mermaid; can be deferred.
11. **Pitfalls to design around**: (a) one global node/edge counter for declaration order across
    levels, so model-order tie-breaks stay meaningful inside subgraphs (ELK's BFS index makes
    nested orders sparse; use a per-level dense index for offsets, a global one for comparisons);
    (b) a crossing edge into a node in the child's layer k>1 is a long edge inside the child and
    takes a lane through layers 1..k-1 - budget cross-axis width for it; (c) an edge whose both
    endpoints are in different children two levels down creates a segment at the LCA level
    between two frame ports - the parent routes frame-to-frame, nothing special; (d) with no
    component packing inside frames (ELK has none either), a subgraph with disconnected content
    is stacked by the placer - acceptable; (e) the title-row/border-cell collision has no ELK
    analogue - decide it once (rule 4) and test it.

Cost of the hybrid over (b): a segment/dummy data structure and a "hide/restore separate layer"
step in layering, plus port-order handling on frame nodes. Gain: no corridor search, no
fallback-to-frame attachment, deterministic entry cells, exit order that actually minimizes
crossings, and a data flow that matches what elkjs produces today (one polyline per edge in the
container's coordinates), so the two backends stay comparable.

---

## 7. Options, node sizing, port placement, spacing

Source: eclipse/elk @ 8aaa3c14 (2026-08-05). `L/` = `plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/`,
`core/` = `plugins/org.eclipse.elk.core/src/org/eclipse/elk/core/`, `common/` = `plugins/org.eclipse.elk.alg.common/src/org/eclipse/elk/alg/common/`.
Option ids are declared in `L/Layered.melk` (layered) and `core/Core.melk` (core); the Java `LayeredOptions`/`CoreOptions`
classes are generated from these at build time and are not in the checkout. Id prefix `org.eclipse.elk.` is written `elk.` in elkjs.

Marks in the tables: ★ = tuned by the project's demo (`packages/lovely-mermaid/src/layout-elk.ts` OPTS / group options),
☆ = exposed in demo dropdowns (`/render`, `/examples`, `/learn`).

### 1. Option catalogue

#### 1.1 Core options the layered algorithm consumes (`core/Core.melk`, overrides in `L/Layered.melk:52-229`)

| id (`elk.` prefix) | type | default (layered override in bold) | targets | semantics |
|---|---|---|---|---|
| `algorithm` | String | – | parents | `layered` |
| `direction` ★ | enum UNDEFINED/RIGHT/LEFT/DOWN/UP | UNDEFINED → RIGHT if aspectRatio ≥ 1 else DOWN (`L/graph/LGraphUtil.java:1134`) | parents | flow direction; internally everything is laid out LTR and transposed back (`L/intermediate/GraphTransformer.java`) |
| `edgeRouting` ★ | enum UNDEFINED/POLYLINE/ORTHOGONAL/SPLINES | **ORTHOGONAL** | parents | phase-5 router; also decides `favorStraightEdges` default |
| `padding` ★ | ElkPadding | **12** all sides | parents, nodes | space between a parent's border and its content; added to graph size (`L/ElkLayered.java:675`) |
| `spacing.*` ★ | double | see §2 | parents (portPort also nodes) | see §2 |
| `spacing.individual` | IndividualSpacings | null | nodes, edges, ports, labels | per-element override map, string form `spacing.portPort:5;,;spacing.nodeNode:10` |
| `spacing.portsSurrounding` | ElkMargin | 0 | parents | extra space before the first / after the last port on each side |
| `aspectRatio` | double >0 | **1.6** | parents | only used for component row packing (`L/components/SimpleRowGraphPlacer.java:77`) and the default direction |
| `separateConnectedComponents` | boolean | **true** | parents | lay out components separately, pack rows (§6.9) |
| `hierarchyHandling` ★ | INHERIT/INCLUDE_CHILDREN/SEPARATE_CHILDREN | INHERIT (= SEPARATE) | parents, nodes | INCLUDE_CHILDREN = one layout run across hierarchy |
| `nodeSize.constraints` | EnumSet{PORTS, PORT_LABELS, NODE_LABELS, MINIMUM_SIZE} | **empty = fixed size** | nodes | §3 |
| `nodeSize.options` | EnumSet (§3.4) | {DEFAULT_MINIMUM_SIZE} | nodes | §3 |
| `nodeSize.minimum` | KVector | (0,0) → 20×20 with DEFAULT_MINIMUM_SIZE (`core/util/ElkUtil.java:73`) | nodes | lower bound when MINIMUM_SIZE is in constraints |
| `nodeSize.fixedGraphSize` | boolean | false | parents | don't grow the graph/compound node to fit content |
| `nodeLabels.placement` ★(groups) | EnumSet{H_LEFT,H_CENTER,H_RIGHT,V_TOP,V_CENTER,V_BOTTOM,INSIDE,OUTSIDE,H_PRIORITY} | **empty = fixed; labels are then ignored by sizing** | nodes, labels | §3.3 |
| `nodeLabels.padding` | ElkPadding | 5 | parents | padding of the inside-node-label grid |
| `portConstraints` | UNDEFINED/FREE/FIXED_SIDE/FIXED_ORDER/FIXED_RATIO/FIXED_POS | UNDEFINED (= FREE) | nodes | §4.1 |
| `port.side` | UNDEFINED/N/E/S/W | UNDEFINED | ports | required for FIXED_SIDE+ unless inferable from position |
| `port.index` | int | – | ports | order within side, clockwise from NW, for FIXED_ORDER |
| `port.borderOffset` | double | **0** | ports | +outside / −inside the border; inferred from port coords if unset and coords ≠ (0,0) |
| `port.anchor` | KVector | – | ports | edge attachment point relative to port origin; defaults to middle of the outer edge |
| `portAlignment.default` | DISTRIBUTED/JUSTIFIED/BEGIN/CENTER/END | **JUSTIFIED** (core default DISTRIBUTED) | nodes | §4.3 |
| `portAlignment.north/south/west/east` | same | – (falls back to default) | nodes | per-side override |
| `portLabels.placement` | EnumSet{OUTSIDE, INSIDE, NEXT_TO_PORT_IF_POSSIBLE, ALWAYS_SAME_SIDE, ALWAYS_OTHER_SAME_SIDE, SPACE_EFFICIENT} | {OUTSIDE} | nodes | §4.5 |
| `portLabels.treatAsGroup` | boolean | true | nodes | center all labels of an E/W port as one block vs only the first |
| `portLabels.nextToPortIfPossible` | boolean (deprecated) | false | nodes | use placement flag instead |
| `edgeLabels.placement` | CENTER/HEAD/TAIL | CENTER | labels | center labels become label dummies; end labels go into node margins |
| `edgeLabels.inline` | boolean | false | labels | label drawn on the edge line |
| `edge.thickness` | double | 1 | edges | reserved in label dummies and end-label offsets only |
| `junctionPoints` | KVectorChain | empty | edges (output) | hyperedge junctions from `LongEdgeJoiner`/`NorthSouthPortPostprocessor` |
| `priority` | int | **0** | nodes, edges | component ordering: sum of node priorities, higher first |
| `randomSeed` | int | **1** (0 = time seeded) | parents | §7 |
| `interactiveLayout` | boolean | false | parents | emit `layerId`/`positionId` (adds `ConstraintsPostprocessor`) |
| `interactive` | boolean | false | parents | not read by layered (uses per-phase INTERACTIVE strategies instead) |
| `alignment` | AUTOMATIC/LEFT/RIGHT/TOP/BOTTOM/CENTER | AUTOMATIC | nodes | in-layer x alignment of a narrow node (§5.3) |
| `contentAlignment` | EnumSet | topLeft | parents | where content goes when graph is enlarged to min size |
| `position` | KVector | – | nodes, ports, labels | input for interactive phases / semiInteractive crossing min |
| `commentBox` | boolean | false | nodes | node becomes a comment attached to its single neighbour (§6.1) |
| `hypernode` | boolean | false | nodes | §6.2 |
| `margins` | ElkMargin | 0 | nodes | *declared* supported, but the layered importer never reads it; margins are recomputed (§5) |
| `noLayout` | boolean | false | any | element skipped by importer |
| `insideSelfLoops.activate` / `.yo` | boolean | false | nodes / edges | route self-loops inside a compound node |
| `partitioning.activate` / `.partition` | boolean / Integer | false / – | parents / nodes | partitions ordered left→right by extra edges (`PartitionPreprocessor`) |
| `omitNodeMicroLayout` | boolean | false | parents | **ignored by layered** (only radial/mrtree/force/rectpacking check it); layered always runs its own sizing processor |
| `topdownLayout`, `topdown.*` | – | – | – | top-down scaling mode, out of scope |

#### 1.2 Layered options (`L/Layered.melk`; ids `elk.layered.` + name)

| id | type | default | targets | semantics |
|---|---|---|---|---|
| `cycleBreaking.strategy` ★☆ | GREEDY/DEPTH_FIRST/INTERACTIVE/MODEL_ORDER/GREEDY_MODEL_ORDER/SCC_CONNECTIVITY/SCC_NODE_TYPE/DFS_NODE_ORDER/BFS_NODE_ORDER | GREEDY | parents | demo uses DEPTH_FIRST |
| `layering.strategy` ☆ | NETWORK_SIMPLEX/LONGEST_PATH/LONGEST_PATH_SOURCE/COFFMAN_GRAHAM/INTERACTIVE/STRETCH_WIDTH/MIN_WIDTH/BF_MODEL_ORDER/DF_MODEL_ORDER | NETWORK_SIMPLEX | parents | |
| `layering.layerConstraint` | NONE/FIRST/FIRST_SEPARATE/LAST/LAST_SEPARATE | NONE | nodes | §6.4 |
| `layering.layerChoiceConstraint` | Integer ≥ −1 | null | nodes | "put me in layer i" — only honoured by `InteractiveLayeredGraphVisitor` (§6.6) |
| `layering.layerId` | int (output) | −1 | nodes | written by `ConstraintsPostprocessor` |
| `layering.minWidth.upperBoundOnWidth` / `.upperLayerEstimationScalingFactor` | int | 4 / 2 | parents | MIN_WIDTH layerer knobs (−1 = try several) |
| `layering.nodePromotion.strategy` / `.maxIterations` | NodePromotionStrategy / int | NONE / 0 | parents | dummy-reduction pass before crossing min |
| `layering.coffmanGraham.layerBound` | int | MAX | parents | max nodes per layer |
| `crossingMinimization.strategy` ☆ | LAYER_SWEEP/MEDIAN_LAYER_SWEEP/INTERACTIVE/NONE | LAYER_SWEEP | parents | |
| `crossingMinimization.forceNodeModelOrder` | boolean | false | parents | never reorder nodes vs model order |
| `crossingMinimization.hierarchicalSweepiness` | double | 0.1 | parents | INCLUDE_CHILDREN: cross-hierarchy (1) vs bottom-up (−1) sweep preference |
| `crossingMinimization.greedySwitch.activationThreshold` | int | 40 | parents | greedy switch post-pass runs if #nodes < threshold (0 = always) |
| `crossingMinimization.greedySwitch.type` | ONE_SIDED/TWO_SIDED/OFF | TWO_SIDED | parents | |
| `crossingMinimization.greedySwitchHierarchical.type` | same | OFF | parents | hierarchical variant |
| `crossingMinimization.semiInteractive` | boolean | false | parents | keep order of nodes that carry `elk.position` (by y) via in-layer constraints |
| `crossingMinimization.inLayerPredOf` / `.inLayerSuccOf` | String (node id) | null | nodes | relative in-layer constraints, visitor-only |
| `crossingMinimization.positionChoiceConstraint` | Integer | null | nodes | "i-th position in layer", visitor-only |
| `crossingMinimization.positionId` | int (output) | −1 | nodes | |
| `nodePlacement.strategy` ☆ | SIMPLE/INTERACTIVE/LINEAR_SEGMENTS/BRANDES_KOEPF/NETWORK_SIMPLEX | BRANDES_KOEPF | parents | |
| `nodePlacement.favorStraightEdges` | boolean | **null → true iff edgeRouting == ORTHOGONAL** (`L/GraphConfigurator.java:69`) | parents | BK: skip balancing of the 4 alignments; NS: weights |
| `nodePlacement.bk.edgeStraightening` | NONE/IMPROVE_STRAIGHTNESS | IMPROVE_STRAIGHTNESS | parents | |
| `nodePlacement.bk.fixedAlignment` | NONE/LEFTUP/RIGHTUP/LEFTDOWN/RIGHTDOWN/BALANCED | NONE | parents | pick one BK alignment instead of best/balanced |
| `nodePlacement.linearSegments.deflectionDampening` | double >0 | 0.3 | parents | |
| `nodePlacement.networkSimplex.nodeFlexibility` / `.default` / `.recomputeNodePlacement` | NodeFlexibility (NONE/PORT_POSITION/NODE_SIZE_WHERE_SPACE_PERMITS/NODE_SIZE) | – / NONE / null | nodes / parents / parents | NS placer may move ports or grow nodes; second placement run via `NodePlacementRepeater` |
| `edgeRouting.splines.mode` / `.sloppy.layerSpacingFactor` | CONSERVATIVE/CONSERVATIVE_SOFT/SLOPPY / double | SLOPPY / 0.2 | parents | |
| `edgeRouting.polyline.slopedEdgeZoneWidth` | double | 2.0 | parents | |
| `edgeRouting.selfLoopDistribution` / `.selfLoopOrdering` | EQUALLY/NORTH/NORTH_SOUTH ; STACKED/REVERSE_STACKED/SEQUENCED | NORTH / STACKED | nodes | only for FREE ports |
| `spacing.baseValue` | double | – | parents | scales all spacings by default ratios (§2.4) |
| `spacing.nodeNodeBetweenLayers` ★ | double | 20 | parents | §2 |
| `spacing.edgeNodeBetweenLayers` ★ | double | 10 | parents | §2 |
| `spacing.edgeEdgeBetweenLayers` ★ | double | 10 | parents | §2 |
| `priority.direction` | int ≥0 | 0 | edges | GreedyCycleBreaker: weight for keeping edge forward (`L/p1cycles/GreedyCycleBreaker.java:120`); DEPTH_FIRST ignores it |
| `priority.shortness` | int ≥0 | 0 | edges | NetworkSimplexLayerer edge weight `max(1,p)` (`L/p2layers/NetworkSimplexLayerer.java:205`) |
| `priority.straightness` | int ≥0 | 0 | edges | BK/LS/NS placers prefer straightening this edge |
| `compaction.postCompaction.strategy` ☆ / `.constraints` | NONE/LEFT/RIGHT/LEFT_RIGHT_CONSTRAINT_LOCKING/LEFT_RIGHT_CONNECTION_LOCKING/EDGE_LENGTH ; QUADRATIC/SCANLINE | NONE / SCANLINE | parents | post-P5 horizontal compaction (not with POLYLINE) |
| `compaction.connectedComponents` | boolean | false | parents | pack components tighter than rows |
| `highDegreeNodes.treatment` / `.threshold` / `.treeHeight` | boolean / int / int | false / 16 / 5 | parents | §6.3 |
| `wrapping.strategy` (+ `cutting.*`, `validify.*`, `multiEdge.*`, `additionalEdgeSpacing` 10, `correctionFactor` 1) | OFF/SINGLE_EDGE/MULTI_EDGE | OFF | parents | split the layer sequence into chunks placed side by side (covered elsewhere) |
| `layerUnzipping.strategy` / `.layerSplit` / `.minimizeEdgeLength` / `.resetOnLongEdges` | NONE/ALTERNATING / int / bool / bool | NONE / 2 / false / true | parents / nodes | split a layer into alternating sublayers after crossing min |
| `edgeLabels.sideSelection` | ALWAYS_UP/ALWAYS_DOWN/DIRECTION_UP/DIRECTION_DOWN/SMART_UP/SMART_DOWN | SMART_DOWN | parents | |
| `edgeLabels.centerLabelPlacementStrategy` | MEDIAN_LAYER/TAIL_LAYER/HEAD_LAYER/SPACE_EFFICIENT_LAYER/WIDEST_LAYER/CENTER_LAYER | MEDIAN_LAYER | parents, labels | which layer a long edge's center label dummy lands in |
| `considerModelOrder.strategy` ☆ | NONE/NODES_AND_EDGES/PREFER_EDGES/PREFER_NODES | NONE | parents | adds `SortByInputModelProcessor` before P3 |
| `considerModelOrder.portModelOrder` / `.noModelOrder` / `.components` / `.longEdgeStrategy` / `.crossingCounterNodeInfluence` / `.crossingCounterPortInfluence` / `groupModelOrder.*` | – | false / false / NONE / DUMMY_NODE_OVER / 0 / 0 / groups 0, cmEnforcedGroupOrders [1,2,6,7,10,11] | – | model-order machinery (covered elsewhere) |
| `directionCongruency` | READING_DIRECTION/ROTATION | READING_DIRECTION | parents | how DOWN/LEFT/UP drawings relate to the internal LTR drawing |
| `feedbackEdges` ☆ | boolean | false | parents | `PortSideProcessor` before P1 → reversed edges leave/enter on the "wrong" side and are routed around (inverted ports) |
| `interactiveReferencePoint` | CENTER/TOP_LEFT | CENTER | parents | which node point interactive phases compare |
| `mergeEdges` ☆ | boolean | false | parents | port-less edges share one in / one out port per node |
| `mergeHierarchyEdges` | boolean | true | parents | |
| `allowNonFlowPortsToSwitchSides` | boolean | false | ports | N/S port (in LTR) may flip to the other non-flow side if it reduces crossings (`L/intermediate/NorthSouthPortPreprocessor.java:236`) |
| `portSortingStrategy` | INPUT_ORDER/PORT_DEGREE | INPUT_ORDER | parents | FIXED_SIDE only: keep input order per side, or sort E by out-degree / W by in-degree |
| `thoroughness` ☆ | int ≥1 | 7 | parents | §7 |
| `unnecessaryBendpoints` | boolean | false | parents | emit a bend at every dummy even if collinear |
| `generatePositionAndLayerIds` | boolean | false | parents | same effect as interactiveLayout on outputs |

### 2. Spacing semantics

#### 2.1 The options

All spacing values are "minimum distance between the bounding boxes (incl. margins) of the two things". Internally
the graph is always laid out left-to-right; "vertical" below = along a layer (y in LTR), "horizontal" = across layers (x in LTR).
After `GraphTransformer` transposes for DOWN/UP, in-layer spacings become horizontal on screen and between-layers spacings vertical.
**The option names refer to the layer role, not the screen axis.**

| option | default | role | consumed at |
|---|---|---|---|
| `spacing.nodeNode` | 20 | two nodes in the same layer | node placement (`Spacings` vertical matrix), BK class separation (`L/p4nodes/bk/BKCompactor.java:273`), compaction |
| `layered.spacing.nodeNodeBetweenLayers` | 20 | two nodes in adjacent layers, i.e. the **minimum layer gap** | `L/p5edges/OrthogonalEdgeRouter.java:222`, Polyline/Spline routers, wrapping stats, `LabelDummySwitcher` |
| `spacing.edgeNode` | 10 | node vs a long-edge dummy (edge crossing the layer) in the same layer; also node vs N/S-port dummy and node vs external-port dummy | node placement via `Spacings` |
| `layered.spacing.edgeNodeBetweenLayers` | 10 | node border ↔ first/last vertical edge segment in the routing area between two layers | orthogonal router: added once per adjacent non-external layer |
| `spacing.edgeEdge` | 10 (clamped to ≥ 2, `L/GraphConfigurator.java:53`) | two long-edge dummies in a layer (parallel edges crossing a layer); N/S-port dummies; label dummies; self-loop segments | node placement, `OrthogonalSelfLoopRouter`, compaction |
| `layered.spacing.edgeEdgeBetweenLayers` | 10 | adjacent vertical edge segments in the routing area between two layers (routing slot pitch) | orthogonal router (`OrthogonalRoutingGenerator` edgeSpacing) |
| `spacing.componentComponent` | 20 | gap between connected components in the row packing | `L/components/SimpleRowGraphPlacer.java:79` |
| `spacing.portPort` | 10 | consecutive ports on one node side; external-port dummies of a compound parent | node sizing / port placement (§4), hierarchical port routing, NS placer |
| `spacing.portsSurrounding` | 0 | margin before first / after last port on each side | port placement cell padding; layer height for external ports |
| `spacing.labelNode` | 5 | outside node label ↔ node border; also N/S-port dummy ↔ label dummy | `NodeLabelCellCreator` outside containers, `NodeMarginCalculator` |
| `spacing.labelLabel` | 0 | between stacked labels of one element; `labelCellSpacing = 2*labelLabel` between label cells | `LabelCell` gap, node label grid gap, end-label overlap removal |
| `spacing.labelPortHorizontal` / `labelPortVertical` | 1 / 1 | port ↔ its label (x / y) | port label placement (§4.5) |
| `spacing.edgeLabel` | 2 | edge line ↔ its label | label dummies (added to dummy size), end-label preprocessor, self-loop labels |
| `spacing.nodeSelfLoop` | 10 | node border ↔ self-loop segment | `OrthogonalSelfLoopRouter` |
| `spacing.commentComment` / `commentNode` | 10 / 10 | comment boxes of one node; comment ↔ node | `CommentNodeMarginCalculator`, `CommentPostprocessor` |

#### 2.2 Pair resolution: `L/options/Spacings.java`

Built once per graph (`GraphConfigurator.configureGraphProperties`) as two `NodeType × NodeType` matrices of *option handles*:

```
                    vertical (in layer)        horizontal (between layers)
NORMAL–NORMAL       nodeNode                   nodeNodeBetweenLayers
NORMAL–LONG_EDGE    edgeNode                   edgeNodeBetweenLayers
NORMAL–NS_PORT      edgeNode                   –
NORMAL–EXTERNAL     edgeNode                   –
NORMAL–LABEL        nodeNode                   nodeNodeBetweenLayers
LONG–LONG           edgeEdge                   edgeEdgeBetweenLayers
LONG–NS_PORT        edgeEdge                   –
LONG–EXTERNAL       edgeEdge                   –
LONG–LABEL          edgeNode                   edgeNodeBetweenLayers
NS–NS               edgeEdge                   –
NS–EXTERNAL         edgeEdge                   –
NS–LABEL            labelNode                  –
EXTERNAL–EXTERNAL   portPort                   –
EXTERNAL–LABEL      labelPortVertical          labelPortHorizontal
LABEL–LABEL         edgeEdge                   edgeEdge
BREAKING_POINT–*    edgeEdge / edgeNode ...    ...BetweenLayers
```

`getVerticalSpacing(n1, n2) = max(individualOrDefault(n1, opt), individualOrDefault(n2, opt))` (`Spacings.java:210`), where
`individualOrDefault` reads the node's `spacing.individual` map if it has the option, else the **graph's** value.
A spacing option set directly on a node (not via `spacing.individual`) is not consulted. Vertical matrix is used by all node
placers (`BKAlignedLayout.java:202`, `LinearSegmentsNodePlacer.java:543`, `NetworkSimplexPlacer.java:404`, `SimpleNodePlacer.java:76`,
`InteractiveNodePlacer.java:114`); the horizontal matrix only by `HorizontalGraphCompactor` — routers read the graph-level
between-layers values directly. Layered.melk:66 admits: "Most parts of the algorithm do not support [individual spacing] yet."

#### 2.3 Where the numbers land geometrically

- Node placement: distance between two stacked nodes in a layer = `a.margin.bottom + spacing(a,b) + b.margin.top`
  (`L/p4nodes/bk/BKCompactor.java:230-240`). Margins (§5) are *outside* the spacing, never overlapped.
- Layer gap, orthogonal router (`L/p5edges/OrthogonalEdgeRouter.java:216-300`), between layers L and R with `slots` vertical routing slots:
  ```
  layerWidth(L) = max over nodes (w + margin.left + margin.right)         // LayerSizeAndGraphHeightCalculator
  if slots > 0: gap = (slots-1)*edgeEdgeBetweenLayers + edgeNodeBetweenLayers*(L?1:0) + edgeNodeBetweenLayers*(R?1:0)
                gap = max(gap, nodeNodeBetweenLayers)      // only if neither side is an external-port layer
  else:         gap = nodeNodeBetweenLayers
  ```
  Slot 0 is at `x = layerEnd + edgeNodeBetweenLayers`. Straight (no-bend) edges need no slot.
  Conflict threshold for slot sharing = 0.5 × edgeEdgeBetweenLayers (`OrthogonalRoutingGenerator.java:72`).
- Polyline/spline routers use `nodeNodeBetweenLayers` and `edgeEdgeBetweenLayers` similarly (spline additionally `edgeNodeBetweenLayers`).
- Node x inside its layer: `L/graph/LGraphUtil.java:223 placeNodesHorizontally` — ratio = `outports/(inports+outports)` for
  `alignment=AUTOMATIC` (LEFT 0, CENTER .5, RIGHT 1); `x = (layerWidth − w) * ratio`, then shifted by the layer's max
  left/right margins and clamped by the node's own margins. So a source-only node hugs the right of its layer,
  a sink-only node the left — nodes of different widths in one layer are **not** centered by default.
- Graph size: height from `LayerSizeAndGraphHeightCalculator` (min/max over layers of `y − margin.top` … `y+h+margin.bottom`, plus
  `portsSurrounding` for external-port dummies), width = final `xpos` of the router; then `ElkLayered.resizeGraph` applies
  `nodeSize.minimum` (if MINIMUM_SIZE on the graph), `contentAlignment`, and `padding` is added on all sides (`LGraph.getActualSize`).

#### 2.4 `spacing.baseValue` and `LayeredSpacings`

`L/options/LayeredSpacings.java` (and `core/util/ElkSpacings.java`) is a configurator: given a base value `b` it sets every dependent
spacing option to `b × (optionDefault / nodeNodeDefault)`, i.e. `b × default/20`. Applied only through the Java API
(`LayeredSpacings.withBaseValue(b).build().accept(graph)`) — the `spacing.baseValue` melk option is declared but no processor reads it.
With `withOverwrite(false)` explicit values win.

### 3. Node sizing: `common/nodespacing/NodeLabelAndSizeCalculator.java`

#### 3.1 When and why

`L/intermediate/LabelAndNodeSizeProcessor.java` runs in the **before-P4** slot (baseline config, `L/GraphConfigurator.java:19-20`),
i.e. after crossing minimization, before node placement. Preconditions: layered, crossing min finished, port constraints
≥ FIXED_ORDER, port lists sorted clockwise from the NW corner. Reason: port *order* on FREE/FIXED_SIDE nodes is an output of crossing
minimization (`L/p3order/SweepCopy.java:122` promotes them to FIXED_ORDER), and port positions/labels need that order; crossing min
itself only needs port order, not coordinates or sizes. Node placement (P4) needs final sizes and margins, so this is the last
possible slot. Only `NodeType.NORMAL` nodes are processed. For compound nodes with non-empty `nodeSize.constraints` the importer already
ran the same calculator with `applyStuff=false` to get a *minimum* size that is stored into `nodeSize.minimum` and MINIMUM_SIZE is
added (`L/graph/transform/ElkGraphImporter.java:200-224`).

`InnermostNodeMarginCalculator` runs in the same slot right after it (§5). `NodePlacementRepeater` (node flexibility) reruns both.

#### 3.2 The cell system (`common/nodespacing/cellsystem/`)

```
nodeContainer (vertical strip)
 ├─ BEGIN : AtomicCell  insidePortLabelCells[NORTH]   width = space needed by N ports (+labels)
 ├─ CENTER: nodeContainerMiddleRow (horizontal strip)
 │    ├─ BEGIN : AtomicCell insidePortLabelCells[WEST]  height = space needed by W ports
 │    ├─ CENTER: GridContainerCell insideNodeLabelContainer  3×3 label cells, padding = nodeLabels.padding
 │    └─ END   : AtomicCell insidePortLabelCells[EAST]
 └─ END   : AtomicCell  insidePortLabelCells[SOUTH]
outsideNodeLabelContainers[N,S] horizontal strips, [E,W] vertical strips; padding toward node = labelNode
```
Every `Cell` has padding, a min size, `contributesToMinimumWidth/Height` flags and a rectangle. Strip containers: outer cells get their
min size (equalised if `symmetrical` = not ASYMMETRICAL), center gets the rest but never less than its min. Grid: same in 2D; tabular
mode (FORCE_TABULAR_NODE_LABELS) locks column widths across rows. Gaps between cells = `labelCellSpacing = 2 × labelLabel` (0 by default).
`LabelCell` stacks labels vertically (horizontal layout mode; vertical mode for DOWN/UP graphs stacks them side by side),
min size = max width × Σ heights + gaps.

#### 3.3 Algorithm (`NodeLabelAndSizeCalculator.process`, lines 51-174)

1. **Contexts.** `NodeContext` copies flags and spacings (`labelNode`, `labelLabel`, `portPort`, `labelPortH/V`, `portsSurrounding`,
   `nodeLabels.padding`, all via `IndividualSpacings.getIndividualOrInherited`: node's `spacing.individual` → parent graph → option default).
   `PortContextCreator` assigns volatile ids, sorts ports left→right / top→bottom per side, creates a `LabelCell` per port with labels
   (unless port label placement is fixed = neither INSIDE nor OUTSIDE). Ports with side UNDEFINED throw.
2. **Node label cells.** For each label: placement = label's own `nodeLabels.placement` if set else the node's; mapped to one of
   9 inside / 12 outside `NodeLabelLocation`s (`common/nodespacing/internal/NodeLabelLocation.java`). Needs exactly one of INSIDE/OUTSIDE,
   one H_*, one V_*; `H_PRIORITY` decides for outside corners whether the label sits above/below (H_PRIORITY absent: `OUT_T_L` = above the
   node, left-aligned) or beside (present: `OUT_L_T` = left of node, top-aligned). **Empty placement (the default) → UNDEFINED → label
   ignored entirely: not sized, not moved.** Inside port label cells get paddings: N/S top/bottom = `labelPortVertical`, E/W width = widest
   inside port label + `labelPortHorizontal`, plus `portsSurrounding` on the other axis.
3. **Client area / negative offsets.** If MINIMUM_SIZE ∧ MINIMUM_SIZE_ACCOUNTS_FOR_PADDING, the grid's center cell gets `nodeSize.minimum`
   as min size. Ports with negative `borderOffset` (or fixed port labels reaching inside) enlarge `nodeContainer` padding on that side.
4. **Space required by ports** (§4.4 for the formulas): per side, `insidePortLabelCells[side].minContent` = width/height required;
   for FIXED_POS = rightmost/bottommost port border; FIXED_RATIO = `max over consecutive pairs of requiredSpace/(r2−r1)`;
   otherwise Σ(port margins + size) + (n−1)·portPort (+2·portPort for DISTRIBUTED), cell padding = `portsSurrounding`.
   Port margins include label space only if PORT_LABELS is a size constraint.
5. **Contribution flags** (`CellSystemConfigurator`): PORTS → N/S cells contribute width, E/W cells contribute height (unless FIXED_RATIO/POS);
   PORT_LABELS (only with PORTS) → N/S contribute height, E/W width; NODE_LABELS → grid contributes both, outside label cells too unless
   OUTSIDE_NODE_LABELS_OVERHANG; MINIMUM_SIZE + ACCOUNTS_FOR_PADDING → grid center cell contributes.
   Empty constraints → nothing contributes.
6. **Width** (`NodeSizeCalculator.setNodeWidth`): fixed (empty or `{PORT_LABELS}` only) → keep; else `nodeContainer.getMinimumWidth()`,
   `max` with N/S outside-label containers (NODE_LABELS ∧ ¬overhang), `max` with `nodeSize.minimum` (MINIMUM_SIZE ∧ ¬ACCOUNTS_FOR_PADDING;
   (0,0) → 20×20 when DEFAULT_MINIMUM_SIZE). `fixedGraphSize` → only grow. Then lay out cells horizontally, **place N/S ports** and their labels
   (S ports at y relative to 0, shifted by height later).
7. **Height** (`setNodeHeight`): same, plus for FIXED_RATIO/POS with PORTS the E/W cell heights are max'ed in manually. Lay out vertically,
   shift S ports by height, place E/W ports and labels.
8. **Labels & apply**: outside label containers positioned (`LabelPlacer`: width = max(minWidth, nodeWidth) centred on the node, clipped
   to node width unless overhang), all label cells assign positions, `COMPUTE_PADDING` writes `padding` = node rect − grid center rect,
   node size and port positions applied.

#### 3.4 Flags

`nodeSize.constraints` (`core/options/SizeConstraint.java`, `core/docs/sizeconstraints.md`):

| flag | effect |
|---|---|
| (empty) | size untouched; ports/labels still placed inside the given size |
| `NODE_LABELS` | node grows to fit inside labels (+ `nodeLabels.padding`), and outside labels unless overhang allowed |
| `PORTS` | node grows to fit ports with `portPort` spacing and `portsSurrounding` |
| `PORT_LABELS` | with PORTS: port labels count toward port margins (space between a label and the next port). Alone = fixed size |
| `MINIMUM_SIZE` | `nodeSize.minimum` is a lower bound (whole node, or client area with ACCOUNTS_FOR_PADDING) |

`nodeSize.options` (`core/options/SizeOptions.java`, `core/docs/sizeoptions.md`):

| flag | effect |
|---|---|
| `DEFAULT_MINIMUM_SIZE` (default on) | minimum (0,0) → 20×20 |
| `MINIMUM_SIZE_ACCOUNTS_FOR_PADDING` | minimum applies to the grid's center cell (client area) instead of the whole node |
| `COMPUTE_PADDING` | write back `padding` (node rect minus client area) |
| `OUTSIDE_NODE_LABELS_OVERHANG` | outside labels may exceed node width/height and don't contribute to size |
| `PORTS_OVERHANG` | keep `portPort` even if ports then stick out; otherwise ports are crammed (spacing reduced, may go negative) |
| `UNIFORM_PORT_SPACING` | all port margins on a side = max margins (equal pitch when labels differ) |
| `SPACE_EFFICIENT_PORT_LABELS` | deprecated → `portLabels.placement: SPACE_EFFICIENT` |
| `FORCE_TABULAR_NODE_LABELS` | 3×3 inside grid uses common column widths |
| `ASYMMETRICAL` | outer strip/grid cells not equalised; center labels may be off-center |

### 4. Port placement

#### 4.1 `portConstraints` levels (`core/options/PortConstraints.java`)

| level | side | order | position | notes |
|---|---|---|---|---|
| UNDEFINED / FREE | algorithm | algorithm | algorithm | importer maps UNDEFINED→FREE. Side by net flow: in LTR, `netFlow>0` (more in than out) → WEST else EAST (`ElkGraphImporter.ensureDefinedPortSide`, `PortSideProcessor.setPortSide`); later `PortSideProcessor` sets FIXED_SIDE |
| FIXED_SIDE | user (`port.side`, or inferred from port coords via `ElkUtil.calcPortSide`) | algorithm | algorithm | crossing min orders ports; `portSortingStrategy` applies |
| FIXED_ORDER | user | user (`port.index`, else by coordinates) | algorithm | `PortListSorter` sorts clockwise from NW; S and W run backwards in coordinates |
| FIXED_RATIO | user | user | ratio kept: `pos/nodeSize` on the side axis (`InternalProperties.PORT_RATIO_OR_POSITION`, `LGraphUtil.initializePort`) | node may grow so ratios respect `portPort` |
| FIXED_POS | user | user | user | only the border-axis coordinate is (re)set from `borderOffset`; node sizes to the farthest port |

`isSideFixed()` = not FREE/UNDEFINED; `isOrderFixed()` = FIXED_ORDER/RATIO/POS. `GraphConfigurator.copyPortConstraints` saves the
original level in `ORIGINAL_PORT_CONSTRAINTS` (used by NS node flexibility).
`allowNonFlowPortsToSwitchSides` (on a port) lets a N/S port's dummy be placed above or below during crossing min and the side is
corrected afterwards (`SweepCopy.transferNodeAndPortOrdersToGraph`).

#### 4.2 Sides, offsets, anchors

- `ElkUtil.calcPortSide(port, direction)` (`core/util/ElkUtil.java:100`): if `x<0` → WEST, `x+w>nodeW` → EAST (LTR; N/S analog for
  vertical), else by which triangle of the node the port center falls in. Zero-size node → UNDEFINED → falls back to `PortSide.fromDirection`.
- `borderOffset` (`Core.melk:811`): 0 = port's inner edge touches the node border, outside the node. Inferred by `ElkUtil.calcPortOffset`
  from port coords when unset and coords ≠ (0,0); (0,0) → 0 "to make the common case frustration-free" (`ElkGraphImporter.java:735`).
  Placement: N `y = −h − off`, S `y = nodeH + off`, W `x = −w − off`, E `x = nodeW + off` (`PortPlacementCalculator.java:186,362`).
- Anchor (`L/graph/LPort.java:125`, `LGraphUtil.initializePort:704`): edges attach at `node.pos + port.pos + anchor`. Default per side:
  N `(w/2, 0)`, E `(w, h/2)`, S `(w/2, h)`, W `(0, h/2)`; side undecided → `(w/2, h/2)`. Explicit `port.anchor` is marked
  `explicitlySuppliedPortAnchor` and never changed. Edges without ports get a synthetic port per edge (`mergeEdges=false`) or one shared
  in/out port (`mergeEdges=true`) via `LGraphUtil.createPort`.

#### 4.3 `portAlignment` (`core/options/PortAlignment.java`, `PortPlacementCalculator.placeHorizontalFreePorts:82`)

With `avail = cellWidth − portsSurrounding.left − portsSurrounding.right`, `req` = space from step 4 of §3.3, `n` ports, `s = portPort`:

| alignment | start offset | pitch |
|---|---|---|
| BEGIN | 0 | s |
| CENTER | (avail − req)/2 | s |
| END | avail − req | s |
| JUSTIFIED (layered default) | 0 | s + max(0, (avail − req)/(n−1)) → first port at start, last at end |
| DISTRIBUTED (core default) | s + max(0,(avail−req)/(n+1)) | same → equal gaps including to the borders (req already includes 2s) |

Single port: DISTRIBUTED/JUSTIFIED → CENTER. If `avail < req` and no `PORTS_OVERHANG`: pitch is *reduced* by `(avail−req)/(n−1)`
(DISTRIBUTED: `/(n+1)` and start shifted) — ports overlap rather than overhang. Port x = `cursor + margin.left`;
cursor += `margin.left + w + margin.right + pitch`.

#### 4.4 Required space per side (`HorizontalPortPlacementSizeCalculator.java`, vertical analog)

- Free: `req = Σ_i (m_i.left + w_i + m_i.right) + (n−1)·s`, `+2s` if DISTRIBUTED. Cell padding l/r = `portsSurrounding`.
- Port margins `m_i` (only when PORT_LABELS in size constraints): label next to port → `(labelW − portW)/2` each side if wider;
  otherwise `m.right = labelPortH + labelW` (label to the right/below the port). Outside labels: leftmost/rightmost port lose their
  outer margin; with exactly 2 ports or SPACE_EFFICIENT the first port's label goes to its *left*, so its right margin is dropped too.
  UNIFORM_PORT_SPACING equalises margins.
- FIXED_RATIO: for consecutive ports `req_pair = w_prev + m_prev.right + s + m_cur.left`, node size ≥ `req_pair/(r_cur − r_prev)`
  (`minSizeRequiredToRespectSpacing`), plus surrounding margins vs ratio 0 and 1.
- FIXED_POS: `max(pos + w)`.
- `CellSystemConfigurator.updateVerticalInsidePortLabelCellPadding` makes E/W ports start below the N inside-port-label band
  (only for free placement).

#### 4.5 Port labels (`PortLabelPlacementCalculator.java`)

`labelsNextToPort` (`PortContext.java:54`): INSIDE on a non-compound node → always centred on the port; INSIDE on compound → only with
NEXT_TO_PORT_IF_POSSIBLE and no inside connections; OUTSIDE → only with NEXT_TO_PORT_IF_POSSIBLE and the port has no edges.
Otherwise inside labels go right of / below the port at `labelPortH/V` from the border padding; outside labels go right of / below the
port at `labelPortH/V` distance, except the first port on a side when `isFirstOutsidePortLabelPlacedDifferently` (2 ports or
SPACE_EFFICIENT, not ALWAYS_SAME_SIDE) or ALWAYS_OTHER_SAME_SIDE → left/above. "Constrained" placement (no PORT_LABELS constraint or
FIXED_POS) on N/S sides with >2 ports runs a `RectangleStripOverlapRemover` that stacks overlapping labels away from the node.
External-port dummies of a compound node get labels placed separately in `LabelAndNodeSizeProcessor.placeExternalPortDummyLabels`.

### 5. Margins (`L/graph/LMargin`, an `ElkMargin` t/r/b/l)

Layered builds margins in layers, all in the before-P4 slot (order fixed by `IntermediateProcessorStrategy` enum, `L/intermediate/IntermediateProcessorStrategy.java:74-85`):

1. `InnermostNodeMarginCalculator` → `common/nodespacing/NodeMarginCalculator` with `excludeEdgeHeadTailLabels()`: margin = bounding
   box of node ∪ node labels ∪ ports ∪ port labels, minus node rect, clamped ≥ 0. (The generic calculator would also add a rough
   estimate for head/tail edge labels using `labelNode` spacing; layered does that exactly later.)
2. `SelfLoopRouter` extends margins for self-loop segments and their labels (`nodeSelfLoop`, `edgeEdge`, `edgeLabel`).
3. `CommentNodeMarginCalculator` (only if the graph has comment boxes): `margin.top += maxCommentHeight + commentNode`, same bottom;
   comments wider than the node protrude symmetrically into left/right margins.
4. `EndLabelPreprocessor` (only with head/tail labels): places end-label cells at `edgeLabel` distance outside the current margin box
   and unions them in (`updateNodeMargins`, `EndLabelPreprocessor.java:420`).

Consumers: node placers (§2.3: margins bracket the spacing), `LayerSizeAndGraphHeightCalculator` (layer width and graph height include
margins), `placeNodesHorizontally` (x alignment), `CommentPostprocessor` (comments placed inside `margin.top/bottom`).
Dummy nodes have zero margins; long-edge dummies have size (0, edgeThickness-ish) so `edgeEdge` alone separates parallel edges.
`elk.margins` from the input is not read by the layered importer — margins are always derived.

### 6. Remaining intermediate processors

Baseline (always on, `L/GraphConfigurator.java:17-23`): `INNERMOST_NODE_MARGIN_CALCULATOR`, `LABEL_AND_NODE_SIZE_PROCESSOR` (before P4),
`LAYER_SIZE_AND_GRAPH_HEIGHT_CALCULATOR` (before P5), `END_LABEL_SORTER` (after P5), plus `PORT_SIDE_PROCESSOR` before P3 (before P1 with
`feedbackEdges`), `DIRECTION_PRE/POSTPROCESSOR` for non-RIGHT directions, `HIERARCHICAL_NODE_RESIZER` for INCLUDE_CHILDREN. Everything
else is added by phases or graph properties (`GraphProperties`: COMMENTS, HYPERNODES, EXTERNAL_PORTS, NON_FREE_PORTS, NORTH_SOUTH_PORTS,
SELF_LOOPS, CENTER_LABELS, END_LABELS, PARTITIONS; computed in `ElkGraphImporter`/`LGraphUtil.computeGraphProperties`).

#### 6.1 Comment boxes (`CommentPreprocessor` before P1, `CommentNodeMarginCalculator` before P4, `CommentPostprocessor` after P5)

A node with `commentBox=true` that has exactly one edge, to a port of degree 1 on a non-comment node, is **removed from the graph**
(`CommentPreprocessor.java:44`) and stored in the target's `TOP_COMMENTS`/`BOTTOM_COMMENTS`. Top vs bottom: if the node has fixed sides
and real edges only on S (only N) → top (bottom); else by node label centroid (labels in lower half → comment on top); ties alternate to
balance counts. Comments with other connectivity stay regular nodes but edges from a comment into a node that already has outgoing edges
are reversed (comment becomes a source). Postprocessor reinserts them centred over/under the node inside the margin, `commentComment` apart,
and reconnects the edge to a synthetic port at `nodeWidth·k/(n+1)` on the N/S border — the connecting edge is a plain straight stub, not
routed. Only the internal `TOP/BOTTOM` lists exist; no left/right placement.

#### 6.2 `HypernodesProcessor` (after P5, only with `hypernode` nodes)

A hypernode (`hypernode=true`, forced to FREE ports, gets one in/out port if none) with ≤2 ports and no N/S edges is moved horizontally onto
the first orthogonal bend of its edges (`bendx − w/2`) when that bend is more than half the node away, replacing the bend by new N/S ports;
junction points at that bend are dropped. Purpose: draw a net/junction symbol at the fan-out point.

#### 6.3 `HighDegreeNodeLayeringProcessor` (before P3, `highDegreeNodes.treatment`)

Per layer: nodes with degree ≥ `threshold` (16); each neighbour that is the root of a tree hanging only off this node with height ≤
`treeHeight` (5; 0 = unbounded) is moved into fresh layers inserted directly before/after the hub layer (one new layer per tree level, shared
by all hubs in that layer). Empty layers are removed afterwards. Reduces layer height for star-like graphs at the cost of extra layers.

#### 6.4 Layer constraints (`EdgeAndLayerConstraintEdgeReverser` before P1, `LayerConstraintPreprocessor` before P2, `LayerConstraintPostprocessor` before P3)

`layering.layerConstraint` FIRST/LAST: all incident edges are reversed so the node has only outgoing / only incoming edges (never
un-reversing an already reversed edge, never reversing an edge to a label dummy or into a `*_SEPARATE` node). FIRST_SEPARATE/LAST_SEPARATE
(used for external-port dummies) are hidden from layering and restored into dedicated first/last layers. Also: a node whose fixed-side ports
are *all* reversed (inputs on E, outputs on W) gets all edges reversed so it behaves like a normal node instead of a feedback node.

#### 6.5 Interactive modes (per-phase `INTERACTIVE` strategies)

Each phase has an INTERACTIVE implementation that reads the node's *input coordinates* (`interactiveReferencePoint`: node center or top-left,
`LNode.getInteractiveReferencePoint`): cycle breaker reverses edges pointing left (`InteractiveCycleBreaker`), layerer groups nodes into
layers by overlapping x-spans (`InteractiveLayerer`), crossing minimizer orders by y (`InteractiveCrossingMinimizer`), node placer keeps y and
only pushes overlapping nodes down (`InteractiveNodePlacer`). `crossingMinimization.semiInteractive` is the light version: nodes carrying
`elk.position` get pairwise in-layer successor constraints by y (`SemiInteractiveCrossMinProcessor`), the rest is free; greedy switch is
disabled then (`GraphConfigurator.activateGreedySwitchFor`). The `elk.interactive` core flag is not consulted by layered.

#### 6.6 `InteractiveLayeredGraphVisitor` + `ConstraintsPostprocessor`

`ConstraintsPostprocessor` (after P5, with `interactiveLayout` or `generatePositionAndLayerIds`): writes `layering.layerId` and
`crossingMinimization.positionId` (0-based, counting NORMAL nodes only; layers without normal nodes don't increment).
`L/InteractiveLayeredGraphVisitor.java` is an ELK-graph visitor for a *second* layout run: it turns `layerChoiceConstraint`,
`positionChoiceConstraint`, `inLayerPredOf/SuccOf` (and FIRST/LAST layer constraints) into pseudo x/y positions (spacing
`Integer.MAX_VALUE`) using the previous run's `layerId`/`positionId`, and switches all four phases to INTERACTIVE. Not part of the pipeline.

#### 6.7 `PortSideProcessor`, `PortListSorter`

`PortSideProcessor`: nodes without fixed sides get every port a side by net flow (W input, E output in LTR; external-port dummies copy
`EXT_PORT_SIDE`) and are promoted to FIXED_SIDE. Runs before P3 by default (after cycle breaking → reversed edges get a sane side) or before
P1 with `feedbackEdges=true` (reversed edges then use inverted ports and are routed around nodes = visible feedback loops).
`PortListSorter` (before P3, only with NON_FREE_PORTS): sorts `node.getPorts()` clockwise N→E→S→W; FIXED_ORDER by `port.index` then
coordinates, FIXED_POS by coordinates, FIXED_SIDE keeps input order per side (S/W reversed so clockwise holds) or `PORT_DEGREE`.

#### 6.8 Others (brief)

- `NodePlacementRepeater` (after P4, NS node flexibility): freezes flexible node sizes, reruns sizing + margins + a second placer.
- `HierarchicalNodeResizingProcessor` (after P5, INCLUDE_CHILDREN): applies the child graph's size (incl. padding, min size) to its
  compound node, external port dummies back to ports. `LGraph.padding` = client `padding` + inside-node-label padding of the compound node.
- `LayerSizeAndGraphHeightCalculator` (before P5): described in §2.3.
- Components: `ComponentsProcessor.split` before P1 (only with `separateConnectedComponents`; components with external ports on
  several sides stay together), `combine` after P5 via `SimpleRowGraphPlacer` (sort by Σ`priority` desc then area asc; rows of width
  `max(maxComponentWidth, sqrt(totalArea)·aspectRatio)`, `componentComponent` gaps) or the port-side-group placers; optional
  `compaction.connectedComponents`.

### 7. Thoroughness, randomness, determinism

`randomSeed` default 1 for layered → `new Random(1)` in `InternalProperties.RANDOM` (`L/GraphConfigurator.java:63`); 0 → `new Random()`
(nondeterministic). Random is consumed by: `GreedyCycleBreaker` (tie-break among max-outflow nodes, `:232`), `LayerSweepCrossingMinimizer`
(direction of the first sweep per restart `:174,234,280`, barycenter/median tie-break jitter `BarycenterHeuristic.java:115,174,275`,
port distributor; the seed is re-drawn once and `random.setSeed` reset per graph so nested graphs are reproducible `:188,612`),
`OrthogonalRoutingGenerator` (breaking cycles in the hyperedge-segment dependency graph `:202`), `SplineEdgeRouter:349`,
self-loop `RoutingSlotAssigner:64`. `DEPTH_FIRST` cycle breaking is deterministic by edge order. Given a fixed seed and identical input
order, output is deterministic; model iteration order (`getLayerlessNodes`) is input order.

`thoroughness` (7): LayerSweep → number of randomized restarts, keep best crossing count, stop early at 0 (`LayerSweepCrossingMinimizer.java:201-230`);
NetworkSimplexLayerer → iteration-limit factor `4 × thoroughness` (`:229,248`); NetworkSimplexPlacer → `thoroughness × #auxNodes` iterations
(`:255`); LinearSegments pendulum termination threshold `20/thoroughness` (`:578-604`). BK ignores it.

### 8. Defaults worth memorising (spacing/size, layered algorithm)

| option | default | option | default |
|---|---|---|---|
| spacing.nodeNode | 20 | layered.spacing.nodeNodeBetweenLayers | 20 |
| spacing.edgeNode | 10 | layered.spacing.edgeNodeBetweenLayers | 10 |
| spacing.edgeEdge | 10 (min 2) | layered.spacing.edgeEdgeBetweenLayers | 10 |
| spacing.portPort | 10 | spacing.portsSurrounding | 0 |
| spacing.labelNode | 5 | spacing.labelLabel | 0 |
| spacing.labelPortHorizontal/Vertical | 1 / 1 | spacing.edgeLabel | 2 |
| spacing.nodeSelfLoop | 10 | spacing.componentComponent | 20 |
| spacing.commentNode / commentComment | 10 / 10 | padding | 12 |
| nodeSize.constraints | {} (fixed) | nodeSize.options | {DEFAULT_MINIMUM_SIZE} |
| nodeSize.minimum | (0,0) → 20×20 | nodeLabels.padding | 5 |
| nodeLabels.placement | {} (labels ignored) | portLabels.placement | {OUTSIDE} |
| portConstraints | UNDEFINED→FREE | portAlignment.default | JUSTIFIED |
| port.borderOffset | 0 | edge.thickness | 1 |
| direction | UNDEFINED→RIGHT | edgeRouting | ORTHOGONAL |
| aspectRatio | 1.6 | separateConnectedComponents | true |
| randomSeed | 1 | thoroughness | 7 |

Demo currently: nodeNode 6, edgeNode 3, edgeEdge 2, edgeLabel 1, nodeNodeBetweenLayers 4, edgeNodeBetweenLayers 2,
edgeEdgeBetweenLayers 1, padding 2, ORTHOGONAL, DEPTH_FIRST, INCLUDE_CHILDREN, group labels `[H_LEFT, V_TOP, OUTSIDE]`.

### 9. elkjs

elkjs (demo pins 0.12.0) is a GWT transpilation of the same Java; all options above are passed as strings in `layoutOptions`, keyed by the
full id with either prefix (`elk.spacing.nodeNode` or `org.eclipse.elk.spacing.nodeNode`); enum sets as `[A, B]`, padding as
`[top=2,left=2,bottom=2,right=2]`, KVector as `(x,y)`, individual spacings as `spacing.portPort:5;,;spacing.nodeNode:10`. Node
`width/height`, port `x/y/width/height`, label `width/height` are plain JSON fields. Blocks marked `elkjs-exclude-start/end` (debug graph
dumps) are stripped; behaviour is otherwise identical, including the FIXED_ORDER promotion and the 20×20 default minimum.

### 10. For our engine

**Minimal option set.** Everything the demo tunes plus the few that change semantics:
`direction`, `edgeRouting` (only ORTHOGONAL), `cycleBreaking` (DEPTH_FIRST), the six spacings (nodeNode / edgeNode / edgeEdge and their
BetweenLayers twins), `padding` (per compound), `portConstraints` (FREE, FIXED_SIDE, FIXED_ORDER — FIXED_RATIO/POS are not needed for
Mermaid), `portAlignment` (one value: DISTRIBUTED semantics, see below), `nodeLabels.placement` reduced to {inside-center, outside-top-left
for compounds}, `edgeLabels.placement` CENTER only, `randomSeed` (or no randomness at all), `thoroughness` (restart count).
Skip: `spacing.individual`, `baseValue`, size options other than a fixed minimum, port labels, comment boxes (unless state-diagram notes are
modelled as comments — ELK's model fits them exactly: one edge, placed above/below inside the margin), hypernodes, partitions, wrapping,
compaction, interactive modes, priorities (Mermaid has no per-edge weights; `priority.shortness` could later express `-->` vs `~~~`).

**Spacing model in cells.** ELK spacings are scalars applied on whichever screen axis the layer role lands on after the direction transform,
so a single number set cannot be visually correct for both DOWN and RIGHT: with DOWN, `nodeNode` is horizontal (cells) and
`nodeNodeBetweenLayers` vertical (rows); with RIGHT it is the reverse. The demo's fixed 6/4, 3/2, 2/1 are therefore right only for DOWN/UP.
Do it the other way round: store one value per *axis* (`gapX` in cells, `gapY` in rows with `gapY ≈ gapX/2`) and derive the role-based
values from the direction — or define spacings in a virtual square unit and round to cells/rows per axis (`ceil(v)` for x, `ceil(v/2)` for y)
at the point of use. Keep ELK's structural rules: (1) between two stacked boxes: `m1 + spacing + m2`, margins outside spacing;
(2) layer gap = `max(nodeNodeBetweenLayers, 2·edgeNodeBetweenLayers + (slots−1)·edgeEdgeBetweenLayers)` — the first term is the
no-bend case, the second guarantees each routing slot its own row/column; (3) `edgeEdge` never below 1 cell (ELK clamps to 2 px for
the same overlap reason); (4) spacing between a real node and a dummy is `edgeNode`, between dummies `edgeEdge` — the pair matrix is
the whole "individual spacing" mechanism worth keeping (a 4×4 table by node kind, `max` of the two sides).

**Port capacity.** A w-wide box has `w−2` border cells per horizontal side (corners excluded) and `h−2` per vertical side. n unit ports with
pitch `s` (empty cells between ports) fit iff `n + (n−1)·s ≤ w−2`, i.e. `n ≤ (w−2+s)/(1+s)`; with `s=1`: `n ≤ (w−1)/2`. That is ELK's
`req = Σw + (n−1)·portPort ≤ avail` with `portsSurrounding = 1` on each side (never put a port on a corner cell) and `portPort = s`.
For placement use DISTRIBUTED semantics with integer arithmetic: `gap = (avail − n) / (n+1)` distributed with the remainder spread from
the middle, so a single port lands on the centre cell (`x + (w−1)/2` — force even widths or accept the bias; the demo already forces even
node widths so centres are integers). Avoid JUSTIFIED (ELK's layered default): with zero surrounding it puts ports on the first and last
usable cell, which reads badly in a 1-cell frame. Never let ports be "crammed" (ELK's negative pitch): if `n > w−2`, grow the node
(ELK does this only with the PORTS size constraint) — for our engine PORTS sizing should be unconditional, since a port cell must be
unique. Port order: sorted per side by the crossing-min result (ELK's FIXED_ORDER promotion), clockwise list is unnecessary — keep
per-side arrays ordered left→right / top→bottom.

**Node sizing from wrapped labels.** ELK's cell system collapses, for a leaf node with one centred label and no port labels, to
`w = max(labelW + 2·padX, portsNeeded, minW)`, `h = max(labelH + 2·padY, minH)`; that is all a terminal box needs, plus the 1-cell border:
`w = labelWidth + 2·(border=1) + 2·padX` with `padX = 1`, `padY = 0`, `h = lines + 2`. Wrap first (label width from a target aspect), then
size, then check port capacity, then widen. Do NOT copy the 20×20 default minimum; use `minW = 3 + ports`, `minH = 3`. For compounds keep
ELK's two-level padding: outer `padding` (content ↔ border) plus the outside-top-left title band (`OUT_T_L` / `IN_T_L`), which ELK
implements by growing the compound's `LGraph.padding.top` by the label height + `labelNode`; a title inside the frame is the terminal
idiom (`┌ title ┐`) and costs 0 extra rows.

**Margins.** Keep the concept even if only self-loops and end labels ever populate it: placement and layer width read
`size + margin`, sizing reads `size`. Comments/notes fit here for free.

**Pitfalls seen in ELK that will bite a port.**
- `nodeLabels.placement` empty means "don't touch", so `NODE_LABELS` sizing silently does nothing; make label placement a required field.
- Node x inside a layer follows `outports/(in+out)`; a source hugs the right of its layer. In a terminal, centring within the layer
  (or aligning to the incoming edge column) reads better; ELK's behaviour exists to shorten edges for LTR flow.
- `nodeNodeBetweenLayers` is a floor, not the gap: with many routing slots the gap grows by `edgeEdgeBetweenLayers` per slot — budget rows
  for slots, otherwise vertical runs of orthogonal edges collide.
- Spacing pairs resolve with `max`, never sum; a dummy next to a node uses `edgeNode`, so parallel edges passing a node consume
  `edgeNode + (k−1)·edgeEdge`, not `k·edgeNode`.
- Port anchors are the middle of the port's outer edge; with 1×1 ports the anchor is the cell itself, so `borderOffset` and anchors can
  be dropped entirely.
- Determinism: seed everything or avoid RNG; ELK's crossing-min restarts differ only by the random first-sweep direction and jitter — a
  deterministic alternative is to try both sweep directions and both tie-break orders, which is what `thoroughness` buys in practice.

---

## 8. What we take: decisions for the lovely-mermaid engine

This chapter consolidates the seven "For our engine" sections into one
set of decisions. Where a chapter argues the case, this one states the
outcome. Chapter numbers in parentheses point at the argument.

### Pipeline shape (1)

- One flat processor list per graph: `{ name, slot, when(g), run(g) }`,
  filtered by feature flags computed once at import, stably ordered by a
  single declaration array. Slots: before P1 … after P5. "Run until step
  k" and a snapshot before every step are then trivial — the trace the
  lab consumes is exactly ELK's debug dump.
- Internal direction is **DOWN** (layers are rows; cross axis = columns).
  LR/RL/BT are transposes/mirrors of nodes, ports, sides, bend points
  applied before P1 and after P5; no inner phase knows the direction.
- Order of the default run, in our orientation:
  1. `reverseForLayerConstraints` (only if FIRST/LAST constraints exist)
  2. **P1** cycle breaking → `edge.reversed`
  3. **P2** layering → `node.layer`
  4. `splitLongEdges` (one dummy per skipped layer) · `assignPortSides`
     (net flow, *after* P1) · `sortPorts`
  5. **P3** ordering → `node.order`, per-side port order · `greedySwitch`
     for graphs under ~40 nodes
  6. `sizeNodes` (label wrap, ports, capacity) · `margins` (self-loops,
     end labels)
  7. **P4** placement → `node.x` (cross axis)
  8. `layerExtents` (band heights, including dummies)
  9. **P5** routing → tracks per channel, **then** `layer.y` and
     `node.y`, port cells, routes
  10. `joinLongEdges` · `restoreReversed` · `placeLabels` (post-hoc) ·
      `untransform` · export
- The finished graph is exported as geometry only; the drawer (terminal or
  SVG) owns tees, arrowheads, junction glyphs, and text.

### Data model (1, 3)

```ts
type Kind = 'node' | 'dummy' | 'extPort' | 'compound'
LNode  { id, kind, origin?: string /* edge id for dummies, port id for extPort */,
         w, h, layer, order, x, y, ports: LPort[], margin: {t,r,b,l}, children?: LGraph }
LPort  { id, node, side: 'N'|'S'|'E'|'W', order, pos /* border cell offset */,
         in: LEdge[], out: LEdge[] }
LEdge  { id, src: LPort, dst: LPort, reversed: boolean, origin?: string /* for split segments */,
         route?: Pt[], label?: {...} }
LGraph { nodes, edges, layers: LNode[][], dir, parent?: LNode }
```

- Ids are stable strings assigned at import; dummies carry `origin` so the
  lab can highlight a chain. Never use a shared scratch integer the way
  ELK's `node.id` is used — per-pass local arrays instead.
- Every edge end is a port. A port-less flowchart gets one port per edge
  end at import (ELK's default); merging into one shared port per side is
  a later, per-node decision (ELK `mergeEdges`), made in P4/P5 when the
  side's capacity is exceeded — never in P3.
- Long-edge dummy: `w = 1` (one column), `h = 0`, one N in-port and one S
  out-port at offset 0. Label dummies: **not used** (labels are post-hoc,
  see P5). External-port dummies: only with compound graphs (chapter 6).
- Spacing is a 2×2 matrix by kind pair `{node, dummy}²`, resolved with
  `max`, margins outside the spacing. Values are stored **per axis**
  (`gapX` in columns, `gapY` in rows, ≈ 1:2), and the role-based values
  ELK names (`nodeNode` vs `nodeNodeBetweenLayers`) are derived from the
  direction — the demo's fixed table was wrong for LR.

### P1 cycle breaking (2)

- Greedy Eades–Lin–Smyth with **deterministic** tie-break (first in
  declaration order); weighted degrees via an optional per-edge
  `directionPriority` (free, useful for constraints). No bucket lists.
- Reversal = swap endpoints + toggle `reversed`; port sides are assigned
  *after* this step, so reversed edges attach to flow sides like any
  other edge (decision already in `PLAN.md`: a down edge and its return
  sit side by side; no E/W special case, no inverted-port dummies).
- FIRST/LAST layer constraints: pre-reverse incident edges (ELK's
  `EdgeAndLayerConstraintEdgeReverser`), then move the node to layer
  0 / L−1 after layering. `*_SEPARATE` only appears with compound graphs.
- Skip: model-order, SCC and BFS/DFS-order breakers, `feedbackEdges`.

### P2 layering (2)

- Network simplex as in chapter 2 §2.2, integer throughout: `delta = 1`,
  `weight = max(1, shortnessPriority)`, initial layering = longest path
  from sources (Kahn), tight tree by min-slack growth, leaf-peeled cut
  values, first-negative leave edge, min-slack enter edge over all edges,
  pivot cap `4·thoroughness·⌊√n⌋`, then normalize and **balance**.
  Include `removeSubtrees` (trees are the common flowchart shape). Split
  connected components or add an artificial root — NS on a disconnected
  graph is undefined.
- Longest path falls out of the NS initialization; expose it as the
  "fast" strategy for the lab A/B.
- Long edges: splitter before P3 (walk layers, insert one dummy per
  skipped layer; the original edge object survives as the first segment;
  the joiner pairs the i-th in with the i-th out). Dummy chains are what
  BK straightens and what the router routes through.
- Width-limited output (terminal columns): do **not** port ELK wrapping.
  Reuse only its MSD cut computation with a hard `maxColumns` rule
  (`>` not `≥`), then lay each row out as its own subgraph and draw the
  wrap edge as an explicit backward edge between rows. MinWidth's
  accounting (`Σ node widths + #spanning edges·1 + gaps`) is the exact row
  width in cells — reuse the formula, not the heuristic.
- Skip: Coffman–Graham, MinWidth, StretchWidth, node promotion,
  unzipping, partitions (until a rank-constraint feature needs them —
  then use one hub dummy per partition, not ELK's `|a|·|b|` edges).

### P3 crossing minimization (3)

- State = `order: LNode[][]` plus per-node per-side port arrays; snapshot
  the best `(order, ports)` pair, not just node order.
- Barycenter over **port ranks** (LayerTotal flavour: integer ranks 1..k
  per fixed layer), interleaved with port distribution: after sorting a
  free layer, re-sort its facing ports by the ranks they connect to, then
  re-sort the fixed layer's facing ports against the new order. Rank
  arrays must be recomputed before and after each layer — forgetting the
  second recompute silently degrades port order.
- Ratios as `(num, den)` integer pairs or fixed-point; stable sort; no
  jitter. Unconnected nodes keep their slot between neighbours after the
  first sweep (`fillInUnknownBarycenters` behaviour).
- Restarts: `thoroughness` deterministic variants (both first-sweep
  directions × tie orders) instead of random shuffles; alternate sweeps
  until the exact crossing count stops improving. Try the input order as
  restart #1 and keep it if it is crossing-minimal — that is all the
  model-order machinery is worth to us.
- Exact counting with the Fenwick-tree counter (fold the lower layer,
  `size()` trick for in-layer edges). Edges sharing a port do not cross;
  self-loops are removed before P3.
- Forster constraint resolver as soon as any in-layer constraint exists
  (compound port chains, "keep A above B"); merged group value = mean of
  the two barycenters, like ELK.
- Two-sided greedy switch as a post-pass for graphs under ~40 nodes —
  after node and port order are fixed; it only improves.
- Port capacity is **not** P3's business: P3 produces an order; P4/P5 map
  it onto border cells, merging adjacent same-direction ports into one
  cell when `n > (w−2+s)/(1+s)`, or growing the node.
- Compound: bottom-up only (child fixes its exit order; the frame node
  carries `FIXED_ORDER` ports in the parent). No sweep-into.
- Skip: median heuristic, interactive/semi-interactive, group model
  order, `portSortingStrategy`, north/south port dummies, inverted-port
  dummies (not needed with FREE ports and sides assigned after P1).

### Node sizing, ports, margins (7)

- Leaf node: `w = labelWidth + 2·border + 2·padX`, `h = lines + 2·border`
  (+ vertical padding 0), then `max(w, portsNeeded)`. No 20×20 default
  minimum: `minW = 3 + ports`, `minH = 3`. PORTS sizing is unconditional
  — a port cell must be unique.
- Port cells on a horizontal side: `w−2` usable cells (corners excluded);
  `n` ports with pitch `s` fit iff `n ≤ (w−2+s)/(1+s)`. Placement
  DISTRIBUTED in integers: `gap = (avail − n) / (n+1)` with the remainder
  spread from the middle so one port lands on the centre cell (top-biased
  `(w−1)>>1` for even widths). Avoid JUSTIFIED (ELK's layered default
  puts ports on the first/last usable cell).
- A port *is* its border cell: anchor = cell; `borderOffset` and anchor
  vectors disappear. Routes run port cell to port cell; the drawer paints
  the tee in that cell and the head in the cell before it.
- Margins: `{t,r,b,l}` per node, integer, computed once before P4 from
  self-loops and end labels (and later notes/comments); placement and
  layer extents read `size + margin`, sizing reads `size`.
- Compound titles: ELK grows the child graph's top padding by the label
  height; the terminal idiom `┌ title ┐` costs 0 rows but makes the title
  span unpierceable — decide per rule in chapter 6 §11.4.

### P4 node placement (4)

- Brandes–Köpf, ELK's version: four layouts, **pick the smallest extent**
  (ELK's real default), ties in RIGHTDOWN-first order; `insideBlockShift`
  with **integer port anchors** (block straight at anchor cells, margins
  folded into block extent); `placeBlock` with the `initial` replacement
  (no `max(0, …)`); class shifts via the **class graph** propagation, not
  the paper's `min` recurrence (that is where the erratum bugs live);
  per-candidate order/overlap validation with `>=` (touching boxes are
  fine in cells); normalize `x -= minLeft` immediately after placement.
  Only type-1 conflicts are marked; the neighbour lists drop self-loops
  and in-layer edges.
- Threshold straightening: implement the in-`placeBlock` threshold (five
  lines); defer the post-process queue until measured.
- Second strategy: the network-simplex placer — inherently integer
  (`ceil` on every delta), weights 4/8/32, `favorStraightEdges` path
  weighting. Reuse the NS core from P2. Known stair-case artefact; BK
  stays the default.
- Skip: balanced BK (halves), linear segments (fractional pendulum),
  post-compaction (an x-axis pass after routing — revisit only if channel
  gaps look wasteful; the scanline core is ~150 integer-safe lines).

### P5 edge routing (5)

- **Routing assigns the flow-axis coordinates**: channel height
  `H = T + 2g` rows for `T` tracks (`g` = 0 or 1 node–edge gap), minimum
  1 row even when every edge is straight (arrowheads need a cell — ELK has
  no such floor). Tracks centred in the channel (ELK hugs one side; the
  spline router centres — centred reads better). Then `layer.y`, `node.y`.
- Node position inside its band: ELK's `outports/(in+out)` ratio shortens
  stubs; for a terminal, centre-or-align-to-incoming reads better. Lab A/B.
- Segment model: one trunk per connected component of ports over all
  edges in the channel; straight edges (`srcCol == dstCol`, exact) take no
  track and emit no bends. Dependency graph between trunks: crossing cost
  (start at ELK's 16, tune — crossings become `┼` and read as junctions),
  **critical = equal row** (no "too close" continuum in integer rows),
  Eades greedy FAS on the dependency graph, longest-path slot numbering,
  the `rightwardTargets` compaction for loops on the far side.
- Critical 2-cycles: **nudge a port's row by one within its side and
  rebuild that channel's dependencies** (we own port cells; ELK cannot
  move ports in P5). Implement ELK's segment splitter (trunk → jog row →
  trunk) only if nudging proves insufficient; free rows are trivially
  enumerable in cells.
- Junctions: derive from the final cell map (≥ 3 arms of the *same* edge
  in a cell = `┬/┴/├/┤`; different edges = `┼`) rather than carrying
  ELK's junction-point bookkeeping.
- Labels: **post-hoc, on the line**, exactly the placer already proven in
  `layout-elk.ts` (longest horizontal run → straddle a vertical run →
  ellipsis), promoted into the engine as geometry queries. Cost moves
  from the layering to two local constraints: track pitch for labelled
  trunks, and horizontal-run length; the fallback when no run fits is a
  **wider channel** (a jog with room), never an extra layer. Head/tail
  labels live in node margins (one row per labelled side).
- Self-loops: hidden before P1, routed relative to the node before P4
  (margins reserve the space), re-attached after P5. Start with ONE_SIDE
  and CORNER types on the E side (our non-flow sides are E/W); reuse the
  trunk/slot machinery per side.
- Feedback edges as wrap-arounds (`feedbackEdges`) are **not** used:
  reversed edges attach to flow sides and route like everything else.
- Skip: polyline/spline routers, `unnecessaryBendpoints`, label dummies
  and switcher, N/S external-port routing strips, `mergeHierarchyEdges`.

### Compound graphs (6)

The hybrid, in order:

1. Break cycles **globally on the flat leaf graph** first (we already do
   this for model order); cut every crossing edge afterwards, so each
   segment enters through the upstream border and leaves through the
   downstream one. This avoids ELK's wrong-side loop-arounds for
   hierarchy-crossing back edges.
2. Cut crossing edges into per-level segments (ELK's
   `CompoundGraphPreprocessor` shape): each level sees an external-port
   dummy — a 1-cell node on the top or bottom border — hidden during
   layering and restored into a new first/last layer (ELK's
   `FIRST_SEPARATE`/`LAST_SEPARATE`). One dummy per crossing edge; merge
   only when one source port feeds several outside targets and one border
   cell is wanted.
3. Flow-aligned exits only (top/bottom border in TB): a pierced
   horizontal border is a `┬`/`┴` on a line; piercing a vertical border
   is ELK's most fragile machinery (N/S external ports) — avoid by
   construction.
4. Border cell = port position after the child's placement; snap to a
   non-corner cell, at least one cell from the next port, and not under
   the title span if the title sits on the border row (no ELK analogue —
   decide once, test it).
5. Sizes bottom-up: content + padding + border (+ title row if inside) →
   the frame is a fixed-size node with `FIXED_POS` ports in the parent;
   the parent lays out only after all children are final. Plain post-order
   recursion — the interleaving ELK needs exists only for its one global
   crossing-minimization pass, which we do not run.
6. Coordinates relative to each frame's content origin, converted once
   at the end (`toAbsolute(level)`); no mutable offset accumulator.
7. Reassembly: concatenate segments; add a bend between segments only if
   both coordinates differ (ELK's rule). Border junction glyphs come from
   the direction bits.
8. Per-subgraph `direction`: only for subgraphs with no crossing edges
   (the current `crossed` rule) — laid out in their own direction as an
   opaque fixed-size node. ELK cannot do better either.
9. Edges to the subgraph itself: the frame is a node (no cut). Edges from
   a node to its own enclosing frame: deferred.
10. Global declaration-order index across levels for tie-breaks
    (ELK's BFS index makes nested orders sparse).

### Options (7)

Minimal set: `direction`; `cycleBreaking` (greedy / DFS); `layering`
(network simplex / longest path); `ordering` thoroughness; `placement`
(BK / NS); per-axis spacings `gapX`, `gapY`, `trackGap`, `nodeEdgeGap`;
`padding` per compound; `portConstraints` FREE / FIXED_SIDE / FIXED_ORDER;
label placement (inline only). No RNG anywhere. Everything else is a
consumer concern (even widths, aspect) or a later feature.

### Corrections to our existing notes

- "A hierarchical edge carries one section per crossed level"
  (`layout-elk.ts` comment, CODE.md, lesson 6): ELK writes **one**
  section per edge in the LCA container's coordinates; `container` is per
  edge. The drawer's chain-concatenation still works because there is
  only one section — the comment is just wrong about why.
- The demo's fixed spacing table (6/4, 3/2, 2/1) is aspect-correct only
  for DOWN/UP; for LR/RL the roles flip (chapter 7 §2).
- "Model-order strategy on a compound containing a cycle crashes elkjs
  ≥ 0.11" — root cause is ELK `80b3a2de` (properties set on the root
  graph only, unboxed in nested graphs). Our workaround (strip the
  strategy from compounds, pre-break cycles) is the right shape; the
  upstream fix is a one-liner in the importer.
- "Giving ELK the labels reserved corridor space and inflated everything"
  — because center labels become nodes in the layering (extra layer,
  wider layer, stacked height), not because of corridor reservation.
- Primer/lesson claim that ELK's BK is "the balanced average of four
  alignments": ELK's default picks the smallest of the four; balancing
  only with `fixedAlignment=BALANCED` or non-orthogonal routing.
- "ELK's default layout is nondeterministic": no — `randomSeed` defaults
  to 1 for layered; only an explicit 0 un-seeds. (Two chapter drafts
  above say otherwise at the greedy-breaker paragraph; the seed logic in
  `GraphConfigurator.java:117-122` is correct as quoted, the default is
  not.)

### Reading order for the milestones

| milestone | read before |
|---|---|
| engine skeleton, trace, import | chapter 1 (§2, §4, §5, §10), chapter 7 §3–§5 (sizing, ports, margins) |
| cycles + layering + dummies | chapter 2 §1, §2.2, §4 |
| ordering | chapter 3 §1–§7 |
| placement | chapter 4 §0, §1, §3 |
| routing + labels + self-loops | chapter 5 §1–§5, §6.2, §10 |
| compound | chapter 6 §0, §3–§5, §8, §11 |
| width-limited output | chapter 2 §6 |

### References

- Gansner, Koutsofios, North, Vo 1993 — network simplex layering and x-coordinates.
- Eades, Lin, Smyth 1993 — greedy feedback arc set (cycle breaking; also ELK's routing-dependency cycle breaker).
- Sugiyama, Tagawa, Toda 1981 — layer sweep; Forster 2004 — constrained barycenter (the in-layer constraint resolver).
- Schulze, Spönemann, von Hanxleden 2014 — "Drawing layered graphs with port constraints" (the port model, N/S port dummies, hyperedge crossing counting); Spönemann's dissertation 2015 — the architecture in prose.
- Brandes, Köpf 2002 — node placement; Brandes, Walter, Zink 2020 — erratum (compare with chapter 4 §1.9).
- Sander 1996/2003 — linear segments; orthogonal hyperedge routing (the trunk/segment model).
- Nikolov, Tarassov, Branke 2005 — MinWidth layering and node promotion.
