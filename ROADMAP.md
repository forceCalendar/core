# forceCalendar Roadmap

This roadmap covers the whole forceCalendar organization, maintained in the flagship `core` repo. It states direction, not promises — items ship when they're ready. Feedback belongs in [issues](https://github.com/forceCalendar/core/issues); PRs against any item are welcome.

## Principles (non-negotiable)

1. **Zero runtime dependencies** in `core` and `interface`.
2. **Locker Service / LWS and strict-CSP compatibility** — no `eval`, no dynamic code, no DOM in the engine.
3. **Honest engineering** — we publish [benchmarks](https://github.com/forceCalendar/benchmark) and [security findings](https://github.com/forceCalendar/audit) even when they're unflattering.

## Now (next 1–2 releases)

### Recurrence performance parity
Our own benchmarks show RRULE expansion is slower than the `rrule` library across all five published scenarios. This is the top engineering priority:
- Profile `RecurrenceEngineV2` expansion paths; eliminate per-occurrence allocation and redundant timezone conversions
- Memoize expanded windows in the existing LRU layer, keyed by (rule, range)
- Add a lazy occurrence iterator so callers can take N occurrences without expanding the full window
- Target: within 2× of `rrule` on every published scenario, tracked publicly on the benchmark dashboard

### TypeScript declarations
Types today are JSDoc-only. Generate and ship `.d.ts` files from JSDoc (`tsc --emitDeclarationOnly` with `allowJs`/`checkJs`) so TypeScript consumers get first-class autocompletion without the project converting to TS.

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
