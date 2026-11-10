The same chain in all four directions. LR/RL is far shorter than TD/BT;
BT and RL flip the order.

```mermaid
graph TD
  A[first] --> B[second] --> C[third]
```

```text
 ┌───────┐
 │ first │
 └───┬───┘
     │
     ▼
┌────────┐
│ second │
└────┬───┘
     │
     ▼
 ┌───────┐
 │ third │
 └───────┘
```

```mermaid
flowchart LR
  A[first] --> B[second] --> C[third]
```

```text
┌───────┐    ┌────────┐    ┌───────┐
│ first ├───▶│ second ├───▶│ third │
└───────┘    └────────┘    └───────┘
```

```mermaid
flowchart BT
  A[first] --> B[second] --> C[third]
```

```text
 ┌───────┐
 │ third │
 └───────┘
     ▲
     │
┌────┴───┐
│ second │
└────────┘
     ▲
     │
 ┌───┴───┐
 │ first │
 └───────┘
```

```mermaid
flowchart RL
  A[first] --> B[second] --> C[third]
```

```text
┌───────┐    ┌────────┐    ┌───────┐
│ third │◀───┤ second │◀───┤ first │
└───────┘    └────────┘    └───────┘
```
