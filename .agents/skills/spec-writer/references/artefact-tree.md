# Artefact Tree Conventions

All specification artefacts are versioned in a **separate git tree** from the code. Every skill in the spec pipeline reads from and writes to that tree, never to the code repository.

This is not a filing preference. It gives the specification its own history, uncontaminated by code churn — which is what makes "the spec is the system, the code is a build artefact" mechanically true rather than aspirational, and what makes divergence detection a diff rather than an opinion.

---

## Layout

```
<artefact-tree>/
├── assumption-register.yaml              # project-wide, persists across features
├── source-precedence.yaml                # project-wide, declared once
├── contexts/
│   └── <context>/
│       ├── glossary.md                   # ubiquitous language
│       ├── CONSTRAINTS.md                # architecture rules
│       └── decisions/                    # ADRs
└── features/
    └── <feature>/
        ├── feature-inventory.yaml        # prototype-harvest
        ├── decisions.yaml                # gap-interrogation-*
        ├── spec.md                       # spec-writer
        ├── features/*.feature            # Gherkin
        └── contracts/openapi.yaml        # generated
```

**Never write specification artefacts into the code repo.** If a skill cannot locate the artefact tree, it stops and asks — it does not fall back to the working directory.

---

## Locating the tree

Resolve in this order:

1. `AEOS_ARTEFACT_TREE` environment variable
2. `artefactTree` in project config
3. A sibling directory matching `*-specs` or `*-artefacts`
4. **Ask the user.** Do not guess.

Record the resolved root and its branch in every output's `meta`.

---

## References are triples, never bare SHAs

A commit hash means nothing without its repository. Sources for one feature routinely live in three or four different trees — design, code, artefacts — and a bare `@abc123` is ambiguous at best and silently wrong at worst.

Every reference carries repo, commit, and path:

```yaml
ref:
  repo: standin-design
  commit: abc123def456
  path: prototype/composer-standalone-src.html
```

This applies to sources in `feature-inventory.yaml`, to the inventory reference in `decisions.yaml`, and to anything a downstream artefact points back at.

---

## Committing

Every skill commits its own output. A written-but-uncommitted artefact is invisible to everything downstream.

**Before writing:** record artefact-tree `HEAD`. **After writing:** if `HEAD` moved, re-read the affected files and merge rather than overwrite — another skill or another person may have written concurrently.

**Message format:**

```
<verb>(<feature>): <summary>

Sources: standin-design@abc123, standin@def456
Inventory: <artefact-tree sha>
Refs: CON-9, ABS-4, ABS-5
```

| Skill | Verb | Summary |
|---|---|---|
| `prototype-harvest` | `harvest` | inventory from N sources, M conflicts, K absences |
| `gap-interrogation-solo` | `decide` | M conflicts resolved, K absences closed (simulated) |
| `gap-interrogation-capture` | `decide` | M conflicts resolved, K absences closed (workshop) |
| `spec-writer` | `spec` | N acceptance criteria |

Commit; never push. Pushing is a human action.

---

## Linking code back to artefacts

The code repo carries the link, as commit trailers:

```
Spec: standin-specs@abc123
Implements: AC-12, AC-13
```

This is what makes traceability mechanical across trees: given any code commit you can resolve the exact specification revision it claims to implement, and given any specification revision you can find what implements it. Divergence detection, AC coverage reporting, and the "is anything unimplemented?" question all depend on it.

---

## Branching

- Artefact work for a feature happens on `feature/<name>` in the artefact tree
- Merged to `main` when the feature's spec is approved — **not** when the code ships
- The artefact tree's `main` is the current agreed specification of the system, always
- Tag artefact-tree commits at release so a shipped version resolves to the spec it was built from
