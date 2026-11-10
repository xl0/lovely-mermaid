# Flowchart regressions

Double-border diamonds flip with the canvas: `BT` mirrors the corners and
tees vertically (`╔` up top, `╤` → `╧`), `RL` horizontally.

```mermaid
flowchart BT
  A{go?} --> B
```

```text
  ┌───┐
  │ B │
  └───┘
    ▲
    │
 ╔══╧══╗
 ║ go? ║
 ╚═════╝
```

```mermaid
flowchart RL
  B --> A{go?}
```

```text
╔═════╗    ┌───┐
║ go? ║◀───┤ B │
╚═════╝    └───┘
```

A `:::` tag glued to a link operator backs off the trailing dashes, keeping
the link (the span classes it assigns are pinned in parse.test.ts).

```mermaid
graph TD
  A:::x-->B
```

```text
 ┌───┐
 │ A │
 └─┬─┘
   │
   ▼
 ┌───┐
 │ B │
 └───┘
```

A multi-rank back edge routes around through the side lane — its endpoint
orders rightmost, so the run to the lane does not cut through `B`.
(Adjacent-rank back edges return locally instead; see back-edges.md.)

```mermaid
flowchart TD
  A --> C
  C --> D
  A --> B
  D --> A
```

```text
     ┌───┐
     │ A │◀────┐
     └─┬─┘     │
   ┌───┴───┐   │
   ▼       ▼   │
 ┌───┐   ┌───┐ │
 │ C │   │ B │ │
 └─┬─┘   └───┘ │
   │           │
   ▼           │
 ┌───┐         │
 │ D ├─────────┘
 └───┘
```

Kebab-case ids parse as one id: `-` joins when an id char follows, while
`-->`/`-.`/`==` still terminate. Previously `step-1-->step-2` self-looped
on `step`.

```mermaid
flowchart LR
  step-1-->step-2
  my-node[Label] ==> step-1
```

```text
┌───────┐    ┌────────┐    ┌────────┐
│ Label ├━━━▶│ step-1 ├───▶│ step-2 │
└───────┘    └────────┘    └────────┘
```

A quoted stretch inside a `|label|` keeps its pipes as text.

```mermaid
flowchart LR
  A -->|"a|b"| B
```

```text
┌───┐ a|b  ┌───┐
│ A ├─────▶│ B │
└───┘      └───┘
```

Arrow and box-drawing characters inside user text survive RL/BT flips —
the glyph remap applies to structure, not authored cells.

```mermaid
flowchart RL
  A[go ◀ left] -->|l ◄ r| B
```

```text
┌───┐  l ◄ r ┌───────────┐
│ B │◀───────┤ go ◀ left │
└───┘        └───────────┘
```

BT restores reading order of multi-row content: wrapped labels read
top-down, not bottom-up.

```mermaid
flowchart BT
  A[this is a fairly long label that wraps] --> B
```

```text
           ┌───┐
           │ B │
           └───┘
             ▲
             │
 ┌───────────┴───────────┐
 │ this is a fairly long │
 │   label that wraps    │
 └───────────────────────┘
```

Parallel edges ride the same cells; their labels join instead of being
silently dropped.

```mermaid
flowchart LR
  A -->|one| B
  A -->|two| B
```

```text
┌───┐ one / two  ┌───┐
│ A ├───────────▶│ B │
└───┘            └───┘
```

The fail-loop shape from the demo: `E -->|fail| C` is an adjacent-rank
back edge and returns locally beside `C --> E`. Previously it climbed the
right lane and its approach cut through `Answer directly`, fabricating
edges that were never written.

```mermaid
flowchart TD
  A[User prompt] --> B{Need tools?}
  B -->|yes| C[Inspect and edit]
  B -->|no| D[Answer directly]
  C --> E[Run checks]
  E -->|pass| F[Verified result]
  E -->|fail| C
  D --> F
```

```text
              ┌─────────────┐
              │ User prompt │
              └──────┬──────┘
                     │
                     ▼
              ╔═════════════╗
              ║ Need tools? ║
              ╚══════╤══════╝
          ┌──────────┴───────────┐
          ▼yes                   ▼no
┌──────────────────┐    ┌─────────────────┐
│ Inspect and edit │    │ Answer directly │
└─────────┬────────┘    └────────┬────────┘
          │ ▲fail                │
          │ └──────────┐         │
          └──────────┐ │         └──────────┐
                     ▼ │                    │
              ┌────────┴───┐                │
              │ Run checks │                │
              └──────┬─────┘                │
                     │    ┌─────────────────┘
                 pass▼    ▼
            ┌─────────────────┐
            │ Verified result │
            └─────────────────┘
```
