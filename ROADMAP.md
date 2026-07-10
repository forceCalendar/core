# forceCalendar Roadmap

This roadmap covers the whole forceCalendar organization, maintained in the flagship `core` repo. It states direction, not promises — items ship when they're ready. Feedback belongs in [issues](https://github.com/forceCalendar/core/issues); PRs against any item are welcome.

## Principles (non-negotiable)

1. **Zero runtime dependencies** in `core` and `interface`.
2. **Locker Service / LWS and strict-CSP compatibility** — no `eval`, no dynamic code, no DOM in the engine.
3. **Honest engineering** — we publish [benchmarks](https://github.com/forceCalendar/benchmark) and [security findings](https://github.com/forceCalendar/audit) even when they're unflattering.

## Now (next 1–2 releases)

### Recurrence performance parity
**Status: largely achieved.** v2.1.70 removed the timezone-cache pathologies (the worst
scenario was 1,200× slower than `rrule`; it became ~5×), and the numeric-iteration fast
path brought DAILY/WEEKLY expansion to **1.8–2.2× of `rrule`** — at the published 2×
target. Remaining work:
- MONTHLY/YEARLY still use the general Date-stepping loop (~4–8× on microsecond-scale
  workloads); extend numeric iteration if profiling shows real-world need
- Add a lazy occurrence iterator so callers can take N occurrences without expanding
  the full window

### TypeScript declarations
**Status: shipped in v2.2.0.** Declarations are generated from JSDoc at publish time
and wired into every subpath export. Remaining: tighten the loosest `any`-typed
surfaces as JSDoc coverage improves.

## Next

### Accessibility (interface)
WCAG 2.2 AA for all views: full keyboard navigation of the month/week/day grids, roving tabindex, ARIA grid semantics, visible focus states, and screen-reader announcements for navigation and event changes. Add automated axe checks to CI.

### Framework adapters
Thin, optional wrappers — `@forcecalendar/react` and `@forcecalendar/vue` — that map props/events to the `<forcecal-main>` custom element. Adapters stay dependency-free apart from their peer framework.

### Docs completeness gate
CI check in `docs` that every exported symbol in `core`'s public API has a reference page, so the API docs can't silently drift from the code.

## Later (v3 horizon)

### Repository layout normalization (`core`)
Source currently lives at `core/core/`; v3 moves it to `src/` with `exports` maps preserving all public subpaths. Breaking only for consumers who deep-import outside the documented `exports`.

### First-class Salesforce package
Evaluate publishing the Salesforce distribution as an unlocked package (installable via URL/ID) in addition to the source-deploy zip.

### Streaming ICS
Parse large ICS feeds incrementally instead of the current in-memory parse with a 50 MB cap.

## Release policy

- `core` and `interface` follow [SemVer](https://semver.org/), released automatically from Conventional Commit messages on `master`.
- The latest major of each package receives fixes; security fixes are backported one major where feasible.
- Every `core` release automatically re-runs the public benchmarks.
