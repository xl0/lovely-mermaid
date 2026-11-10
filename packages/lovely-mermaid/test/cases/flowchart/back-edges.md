A back edge between adjacent ranks returns locally beside the forward
edge; one skipping ranks goes around through the side lane.

```mermaid
graph TD
  A --> B
  B --> C
  B --> A
  C --> A
```

```text
 ┌───┐
 │ A │◀┐
 └─┬─┘ │
   │▲  │
   ▼│  │
 ┌──┴┐ │
 │ B │ │
 └─┬─┘ │
   │   │
   ▼   │
 ┌───┐ │
 │ C ├─┘
 └───┘
```

Adjacent-rank back edges return locally at every step of a chain.

```mermaid
graph TD
  A --> B
  B --> C
  B --> A
  C --> B
```

```text
 ┌───┐
 │ A │
 └─┬─┘
   │▲
   ▼│
 ┌──┴┐
 │ B │
 └─┬─┘
   │▲
   ▼│
 ┌──┴┐
 │ C │
 └───┘
```

All three regimes in one realistic pipeline: a local `flaky` return, two
multi-rank lanes (`roll`/`notify` back to earlier ranks) and a `no` skip
edge — no crossings between the local return and its forward sibling.

```mermaid
flowchart TD
  push[Git push] --> ci{CI green?}
  ci -->|yes| build[Build image]
  ci -->|no| notify[Notify author]
  build --> stage[Deploy staging]
  stage --> smoke{Smoke tests}
  smoke -->|flaky| stage
  smoke -->|pass| prod[Deploy prod]
  smoke -->|fail| notify
  prod --> monitor[Monitor SLOs]
  monitor -->|regression| roll[Rollback]
  roll --> stage
  notify --> push
```

```text
                ┌──────────┐
                │ Git push │◀────────────┐
                └─────┬────┘             │
                      │                  │
                      ▼                  │
                ╔═══════════╗            │
                ║ CI green? ║            │
                ╚═════╤═════╝            │
                  ┌───┴───────┐          │
                  ▼yes        │          │
           ┌─────────────┐    │          │
           │ Build image │    │          │
           └──────┬──────┘    │          │
                  │           │          │
                  ▼           │          │
         ┌────────────────┐   │          │
         │ Deploy staging │◀──┼─────────┐│
         └────────┬───────┘   │         ││
                  │ ▲flaky    │         ││
                  ▼ │         │         ││
           ╔════════╧════╗    │         ││
           ║ Smoke tests ║    │         ││
           ╚══════╤══════╝    │         ││
        ┌─────────┴─────┐     │         ││
        ▼pass           ▼fail ▼no       ││
 ┌─────────────┐   ┌───────────────┐    ││
 │ Deploy prod │   │ Notify author ├────┼┘
 └──────┬──────┘   └───────────────┘    │
        │                               │
        ▼                               │
┌──────────────┐                        │
│ Monitor SLOs │                        │
└───────┬──────┘                        │
        │                               │
        ▼regression                     │
  ┌──────────┐                          │
  │ Rollback ├──────────────────────────┘
  └──────────┘
```

An LR skip whose target row is clear of intermediate boxes runs straight
through, splitting off the source's right-side fan (`┤` up/down) and
merging into the target's arrival; a same-row skip keeps the bottom lane.

```mermaid
flowchart LR
  push[Git push] --> ci{CI green?}
  ci -->|yes| build[Build image]
  ci -->|no| notify[Notify author]
  build --> stage[Deploy staging]
  stage --> smoke{Smoke}
  smoke -->|pass| prod[Ship]
  smoke -->|fail| notify
```

```text
                                                                                      pass  ┌──────┐
                                                                                     ┌─────▶│ Ship │
                              yes  ┌─────────────┐    ┌────────────────┐    ╔═══════╗│      └──────┘
┌──────────┐    ╔═══════════╗┌────▶│ Build image ├───▶│ Deploy staging ├───▶║ Smoke ╟┤
│ Git push ├───▶║ CI green? ╟┤no   └─────────────┘    └────────────────┘    ╚═══════╝│fail  ┌───────────────┐
└──────────┘    ╚═══════════╝└───────────────────────────────────────────────────────┴─────▶│ Notify author │
                                                                                            └───────────────┘
```

The full pipeline sideways: labelled lanes refuse to share a row (the
label would claim every merged edge), so `flaky` and the rollback return
ride separate rows and join only on the final ascent into their shared
target; lane labels interrupt their own line.

```mermaid
flowchart LR
  push[Git push] --> ci{CI green?}
  ci -->|yes| build[Build image]
  ci -->|no| notify[Notify author]
  build --> stage[Deploy staging]
  stage --> smoke{Smoke tests}
  smoke -->|flaky| stage
  smoke -->|pass| prod[Deploy prod]
  smoke -->|fail| notify
  prod --> monitor[Monitor SLOs]
  monitor -->|regression| roll[Rollback]
  roll --> stage
  notify --> push
```

```text
                                                                                            pass  ┌─────────────┐      ┌──────────────┐ regression  ┌──────────┐
                                                                                           ┌─────▶│ Deploy prod ├─────▶│ Monitor SLOs ├────────────▶│ Rollback │
                              yes  ┌─────────────┐    ┌────────────────┐    ╔═════════════╗│      └─────────────┘      └──────────────┘             └─────┬────┘
┌──────────┐    ╔═══════════╗┌────▶│ Build image ├───▶│ Deploy staging ├───▶║ Smoke tests ╟┤                                                              │
│ Git push ├───▶║ CI green? ╟┘     └─────────────┘    └────────────────┘    ╚══════╤══════╝│fail  ┌───────────────┐                                       │
└──────────┘    ╚═════╤═════╝                                  ▲                   │       └─────▶│ Notify author │                                       │
      ▲               │                                        │                   │              └───────┬───────┘                                       │
      │               │                                        │                   │                      ▲                                               │
      │               │                                        ├────── flaky ──────┘                      │                                               │
      │               └────────────────────────────────────────┼ no ──────────────────────────────────────┤                                               │
      │                                                        └──────────────────────────────────────────┼───────────────────────────────────────────────┘
      └───────────────────────────────────────────────────────────────────────────────────────────────────┘
```
