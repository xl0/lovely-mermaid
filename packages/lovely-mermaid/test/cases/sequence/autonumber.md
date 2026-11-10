`autonumber` prefixes messages.

```mermaid
sequenceDiagram
  autonumber
  A->>B: one
  B->>A: two
```

```text
┌───┐   ┌───┐
│ A │   │ B │
└─┬─┘   └─┬─┘
  │       │
  │1. one │
  ├──────▶│
  │       │
  │2. two │
  │◀──────┤
  │       │
┌─┴─┐   ┌─┴─┐
│ A │   │ B │
└───┘   └───┘
```
