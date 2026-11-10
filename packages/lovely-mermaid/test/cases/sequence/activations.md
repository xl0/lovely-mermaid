`+`/`-` marks thicken the receiver's lifeline between call and return.

```mermaid
sequenceDiagram
  A->>+B: call
  B-->>-A: return
```

```text
┌───┐   ┌───┐
│ A │   │ B │
└─┬─┘   └─┬─┘
  │       │
  │ call  │
  ├──────▶║
  │       ║
  │return ║
  │◀╌╌╌╌╌╌╢
  │       │
┌─┴─┐   ┌─┴─┐
│ A │   │ B │
└───┘   └───┘
```

`activate`/`deactivate` statements drive the lifeline too.

```mermaid
sequenceDiagram
  A->>B: go
  activate B
  B-->>A: done
  deactivate B
```

```text
┌───┐  ┌───┐
│ A │  │ B │
└─┬─┘  └─┬─┘
  │      │
  │  go  │
  ├─────▶║
  │      ║
  │ done ║
  │◀╌╌╌╌╌╢
  │      │
┌─┴─┐  ┌─┴─┐
│ A │  │ B │
└───┘  └───┘
```

An unclosed activation runs to the bottom.

```mermaid
sequenceDiagram
  A->>+B: go
  B->>A: hm
```

```text
┌───┐  ┌───┐
│ A │  │ B │
└─┬─┘  └─┬─┘
  │      │
  │  go  │
  ├─────▶║
  │      ║
  │  hm  ║
  │◀─────╢
  │      ║
┌─┴─┐  ┌─┴─┐
│ A │  │ B │
└───┘  └───┘
```
