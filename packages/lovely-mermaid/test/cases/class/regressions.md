# Class-diagram regressions

`class Agent focus` is the assignment form (a class name carries no spaces),
not a malformed declaration — no warning, and the spans carry the class
(pinned in parse.test.ts).

```mermaid
classDiagram
  class Agent {
    +run()
  }
  class Agent focus
  Tool <|-- Agent
  classDef focus fill:#ff9966
```

```text
 ┌──────┐
 │ Tool │
 └───△──┘
     │
     │
┌────────┐
│ Agent  │
├────────┤
│ +run() │
└────────┘
```

A quoted cardinality containing `..` on the left side never reads as a
dotted-link operator.

```mermaid
classDiagram
  Customer "0..*" --> Order
```

```text
┌──────────┐
│ Customer │
└─────┬────┘
      │0..*
      │
      ▼
  ┌───────┐
  │ Order │
  └───────┘
```

`class A["Label"]` (mermaid ≥10.1) titles the box with the label; the id
keys relations. Previously the spaced form silently nulled the diagram and
the compact form forked into two nodes.

```mermaid
classDiagram
  class Animal["A labelled animal"] {
    +int age
  }
  Animal --> Zoo
```

```text
 ┌───────────────────┐
 │ A labelled animal │
 ├───────────────────┤
 │ +int age          │
 └─────────┬─────────┘
           │
           ▼
        ┌─────┐
        │ Zoo │
        └─────┘
```

`direction BT` keeps compartments in order: title on top, attributes above
methods, separators between.

```mermaid
classDiagram
  direction BT
  class Animal {
    +int age
    +eat()
  }
  Animal --> Zoo
```

```text
   ┌─────┐
   │ Zoo │
   └─────┘
      ▲
      │
┌─────┴────┐
│  Animal  │
├──────────┤
│ +int age │
├──────────┤
│ +eat()   │
└──────────┘
```

Horizontal inheritance heads stay hollow when using the matching solid
arrowhead pair (#8), including after an RL flip.

```mermaid
classDiagram
  direction LR
  Animal <|-- Duck
```

```text
┌────────┐    ┌──────┐
│ Animal ◁────│ Duck │
└────────┘    └──────┘
```

```mermaid
classDiagram
  direction RL
  Animal <|-- Duck
```

```text
┌──────┐    ┌────────┐
│ Duck │────▷ Animal │
└──────┘    └────────┘
```
