Actors, solid and dotted messages, arrowheads both ways.

```mermaid
sequenceDiagram
  Alice->>Bob: Hello Bob
  Bob-->>Alice: Hi Alice
```

```text
┌───────┐   ┌─────┐
│ Alice │   │ Bob │
└───┬───┘   └──┬──┘
    │          │
    │Hello Bob │
    ├─────────▶│
    │          │
    │ Hi Alice │
    │◀╌╌╌╌╌╌╌╌╌┤
    │          │
┌───┴───┐   ┌──┴──┐
│ Alice │   │ Bob │
└───────┘   └─────┘
```

Participant aliases render their labels; declared order wins.

```mermaid
sequenceDiagram
  participant S as Server
  participant C as Client
  C->>S: GET /
```

```text
┌────────┐ ┌────────┐
│ Server │ │ Client │
└────┬───┘ └────┬───┘
     │          │
     │  GET /   │
     │◀─────────┤
     │          │
┌────┴───┐ ┌────┴───┐
│ Server │ │ Client │
└────────┘ └────────┘
```

A cross head marks a lost message; a long label widens the gap.

```mermaid
sequenceDiagram
  A-x B: lost
  A->>B: a very long message label that needs room
```

```text
┌───┐                                      ┌───┐
│ A │                                      │ B │
└─┬─┘                                      └─┬─┘
  │                                          │
  │                   lost                   │
  ├─────────────────────────────────────────×│
  │                                          │
  │a very long message label that needs room │
  ├─────────────────────────────────────────▶│
  │                                          │
┌─┴─┐                                      ┌─┴─┐
│ A │                                      │ B │
└───┘                                      └───┘
```
