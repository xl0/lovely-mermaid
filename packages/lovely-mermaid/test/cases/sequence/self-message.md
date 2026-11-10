A self message loops back to its own lifeline.

```mermaid
sequenceDiagram
  A->>A: think
```

```text
┌───┐
│ A │
└─┬─┘
  │
  ├──╮
  │  │ think
  │◀─╯
  │
┌─┴─┐
│ A │
└───┘
```
