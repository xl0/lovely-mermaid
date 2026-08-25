# Refusals

Unsupported diagram types return `null` — the caller shows the source box.

Upstream accepts junk header suffixes like `stateDiagramFoo` by prefix
match; mermaid proper — and this port — reject them.

```mermaid
stateDiagramFoo
  A --> B
```

(null)
