# Gherkin Style

Scenarios exemplify criteria; they do not replace them. EARS says what must be true, Gherkin shows it happening with concrete values.

**Not every criterion needs a scenario.** Write them for flows worth walking through — multi-step interactions, anything where sequence matters, and every unwanted-behaviour criterion. A criterion like "the digest shall display entries in reverse chronological order" needs no scenario; it needs a test.

---

## Tagging is the whole point

Every scenario carries the AC IDs it covers:

```gherkin
@AC-12 @AC-13
Scenario: Timestamps flip to absolute after a week
```

This is what makes coverage mechanical. The AC coverage report walks the tags and answers "is anything unimplemented?" without a human reading anything. An untagged scenario is invisible to that report and may as well not exist.

Where a scenario rests on an assumption, tag that too: `@AC-18 @ASM-3`.

---

## Structure

```gherkin
Feature: Standup digest
  Entries teammates post between sessions, grouped for the viewer's return.

  Background:
    Given a workspace "Northwind" with members "Ada" and "Grace"
    And Ada is viewing the digest for Thursday

  @AC-12
  Scenario: Recent entries show relative time
    Given Grace posted an entry 2 hours ago
    When Ada opens the digest
    Then the entry timestamp reads "2 hours ago"

  @AC-12
  Scenario: Entries older than a week show absolute time
    Given Grace posted an entry 8 days ago
    When Ada opens the digest
    Then the entry timestamp reads an absolute date

  @AC-15
  Scenario: Concurrent edits keep the later write
    Given Grace is editing her entry
    And Ada is editing the same entry
    When Grace saves at 10:00
    And Ada saves at 10:01
    Then the entry contains Ada's text
    And no conflict is surfaced
```

---

## Rules

**Concrete values from the real data shape.** Draw names, formats, and magnitudes from the inventory's `data` section — never `foo`, `bar`, `test1`. A scenario with realistic values catches format assumptions that abstract ones hide.

**One behaviour per scenario.** If `Then` has three unrelated assertions, it's three scenarios.

**Declarative, not imperative.** `When Ada opens the digest`, not `When Ada clicks the button with id "digest-nav"`. The scenario describes intent; the step definition handles mechanics. Imperative Gherkin breaks on every UI change and tells you nothing about behaviour.

**Cover the unwanted criteria explicitly.** Every `If <condition>, then...` criterion deserves a scenario. Happy-path-only feature files are how error handling rots — the criteria exist, nothing exercises them, and nobody notices until production.

**Scenario Outline for genuine parameter variation** — boundary values especially:

```gherkin
  @AC-12
  Scenario Outline: Timestamp format by entry age
    Given Grace posted an entry <age> ago
    When Ada opens the digest
    Then the timestamp format is <format>

    Examples:
      | age     | format   |
      | 2 hours | relative |
      | 6 days  | relative |
      | 7 days  | absolute |
      | 30 days | absolute |
```

The 7-day row is the one that matters. Boundary values are where decisions get tested and where transcription errors surface.

**Glossary terms only.** If "brief" is canonical, no step says "wrap" or "post".

---

## Anti-patterns

- **Untagged scenarios** — invisible to coverage reporting
- **Scenarios asserting implementation** — `Then the wraps table contains a row` is testing storage, not behaviour
- **`And` chains past four steps** — usually two scenarios wearing one hat
- **Scenarios with no matching AC** — means either a missing criterion or an invented requirement; both go back rather than getting written
- **Abstract values** — `Given a user` hides the shape; `Given a workspace member "Ada"` doesn't
