A subgraph renders a titled frame; edges to the subgraph id attach to the
frame.

```mermaid
graph TD
  S[Start] --> one
  subgraph one [Group One]
  A --> B
  end
  one --> E[End]
```

```text
   ┌───────┐
   │ Start │
   └───┬───┘
       │
       ▼
 ┌ Group One ┐
 │   ┌───┐   │
 │   │ A │   │
 │   └─┬─┘   │
 │     │     │
 │     ▼     │
 │   ┌───┐   │
 │   │ B │   │
 │   └───┘   │
 └─────┬─────┘
       │
       ▼
    ┌─────┐
    │ End │
    └─────┘
```

An edge between two subgraphs ranks their frames.

```mermaid
graph TD
  subgraph api [API]
  A1 --> A2
  end
  subgraph db [Storage]
  B1
  end
  api --> db
```

```text
 ┌ API ───┐
 │ ┌────┐ │
 │ │ A1 │ │
 │ └──┬─┘ │
 │    │   │
 │    ▼   │
 │ ┌────┐ │
 │ │ A2 │ │
 │ └────┘ │
 └────┬───┘
      │
      ▼
 ┌ Storage ┐
 │ ┌────┐  │
 │ │ B1 │  │
 │ └────┘  │
 └─────────┘
```

Subgraphs nest.

```mermaid
graph TD
  subgraph outer [Outer]
  subgraph inner [Inner]
  X --> Y
  end
  W --> X
  end
  S --> outer
```

```text
     ┌───┐
     │ S │
     └─┬─┘
       │
       ▼
┌ Outer ─────┐
│    ┌───┐   │
│    │ W │   │
│    └─┬─┘   │
│      │     │
│      ▼     │
│ ┌ Inner ─┐ │
│ │  ┌───┐ │ │
│ │  │ X │ │ │
│ │  └─┬─┘ │ │
│ │    │   │ │
│ │    ▼   │ │
│ │  ┌───┐ │ │
│ │  │ Y │ │ │
│ │  └───┘ │ │
│ └────────┘ │
└────────────┘
```

A cross-member edge pierces the frame and attaches to the node inside when
the corridor is clear; otherwise it attaches to the frame.

```mermaid
graph LR
  S --> A
  subgraph g [Workers]
  A --> B
  end
  B --> T
```

```text
         ┌ Workers ───────┐
         │                │
┌───┐    │ ┌───┐    ┌───┐ │    ┌───┐
│ S ├────┼▶│ A ├───▶│ B ├─┼───▶│ T │
└───┘    │ └───┘    └───┘ │    └───┘
         └────────────────┘
```

A subgraph id referenced before its declaration titles the frame.

```mermaid
graph TD
  X --> two
  subgraph two
  C --> D
  end
```

```text
   ┌───┐
   │ X │
   └─┬─┘
     │
     ▼
┌ two ───┐
│  ┌───┐ │
│  │ C │ │
│  └─┬─┘ │
│    │   │
│    ▼   │
│  ┌───┐ │
│  │ D │ │
│  └───┘ │
└────────┘
```

Quoted, multi-word and entity-escaped titles.

```mermaid
graph TD
  subgraph "My Stuff"
  A
  end
  subgraph batch jobs
  B
  end
  subgraph "a &lt;b&gt;"
  C
  end
  S --> A
  S --> B
  S --> C
```

```text
                    ┌───┐
                    │ S │
                    └─┬─┘
      ┌───────────────┼──────────────┐
      ▼               ▼              ▼
┌ My Stuff ┐   ┌ batch jobs ┐   ┌ a <b> ─┐
│   ┌───┐  │   │    ┌───┐   │   │  ┌───┐ │
│   │ A │  │   │    │ B │   │   │  │ C │ │
│   └───┘  │   │    └───┘   │   │  └───┘ │
└──────────┘   └────────────┘   └────────┘
```

An empty subgraph is dropped.

```mermaid
graph TD
  subgraph ghost
  end
  A --> B
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

BT flips a frame and its contents; the title stays on the top border.

```mermaid
flowchart BT
  S --> one
  subgraph one [Up]
  A --> B
  end
```

```text
┌ Up ────┐
│  ┌───┐ │
│  │ B │ │
│  └───┘ │
│    ▲   │
│    │   │
│  ┌─┴─┐ │
│  │ A │ │
│  └───┘ │
└────────┘
     ▲
     │
   ┌─┴─┐
   │ S │
   └───┘
```

Nesting past the depth cap draws nothing.

```mermaid
graph TD
  subgraph g0
  subgraph g1
  subgraph g2
  subgraph g3
  subgraph g4
  subgraph g5
  subgraph g6
  subgraph g7
  A --> B
  end
  end
  end
  end
  end
  end
  end
  end
```

(null)

A subgraph `direction` statement overrides the layout inside its frame;
flipping values (BT/RL) are ignored, as is `direction` under a flipped root.

```mermaid
flowchart TD
  S[Start] --> W
  subgraph W [Wide part]
    direction LR
    A --> B --> C
  end
  W --> E[End]
```

```text
          ┌───────┐
          │ Start │
          └───┬───┘
              │
              ▼
 ┌ Wide part ──────────────┐
 │                         │
 │ ┌───┐    ┌───┐    ┌───┐ │
 │ │ A ├───▶│ B ├───▶│ C │ │
 │ └───┘    └───┘    └───┘ │
 └────────────┬────────────┘
              │
              ▼
           ┌─────┐
           │ End │
           └─────┘
```

A node linked from outside its subgraph voids the subgraph's `direction`
(mermaid's rule): the group inherits the parent direction instead.

```mermaid
flowchart TD
  subgraph G [Group]
    direction LR
    A
    B
    C
  end
  X --> A
```

```text
           ┌───┐
           │ X │
           └─┬─┘
             │
             ▼
┌ Group ─────────────────┐
│  ┌───┐   ┌───┐   ┌───┐ │
│  │ A │   │ B │   │ C │ │
│  └───┘   └───┘   └───┘ │
└────────────────────────┘
```
