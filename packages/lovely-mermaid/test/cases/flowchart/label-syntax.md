A quoted label with inner brackets or parens is one node.

```mermaid
flowchart TD
  A["Tokenizer (BPE / WordPiece)"] --> B["[ 464, 3797 ] seq_len d_model"]
```

```text
   ┌──────────────────┐
   │ Tokenizer (BPE / │
   │    WordPiece)    │
   └─────────┬────────┘
             │
             ▼
 ┌───────────────────────┐
 │ [ 464, 3797 ] seq_len │
 │        d_model        │
 └───────────────────────┘
```

An unquoted label with an embedded quote closes at the bracket.

```mermaid
flowchart TD
  A[5" pipe] --> B[24" display]
```

```text
   ┌─────────┐
   │ 5" pipe │
   └────┬────┘
        │
        ▼
 ┌─────────────┐
 │ 24" display │
 └─────────────┘
```

A semicolon and a `%%` survive inside a quoted label; comments outside
quotes are stripped.

```mermaid
graph TD %% main flow
  A["wait; 50%% done"] --> B %% trailing
  %% full line
```

```text
 ┌─────────────────┐
 │ wait; 50%% done │
 └────────┬────────┘
          │
          ▼
        ┌───┐
        │ B │
        └───┘
```

An HTML entity's `;` ends the entity, not the statement, so an unquoted
label may contain `&quot;`, `&amp;` or a numeric entity.

```mermaid
flowchart LR
  A[&quot;Please log in&quot;] --> B[a &amp; b]; B --> C[x&#40;y&#41;]
```

```text
┌─────────────────┐    ┌───────┐    ┌──────┐
│ "Please log in" ├───▶│ a & b ├───▶│ x(y) │
└─────────────────┘    └───────┘    └──────┘
```
