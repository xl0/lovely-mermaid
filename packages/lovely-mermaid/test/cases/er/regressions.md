
A quoted entity name is its own identity and the quotes are not part of the
title; a streamed unclosed alias warns like flowchart's brackets do.

```mermaid
erDiagram
  "ORDER ITEM" ||--o{ LINE : contains
```

```text
┌────────────┐
│ ORDER ITEM │
└──────┬─────┘
       │1
       │contains
       │*
   ┌──────┐
   │ LINE │
   └──────┘
```

A colon inside a quoted alias is label text, not the verb separator.

```mermaid
erDiagram
  p["a:b"] ||--o{ q : rel
```

```text
 ┌─────┐
 │ a:b │
 └──┬──┘
    │1
    │rel
    │*
  ┌───┐
  │ q │
  └───┘
```
