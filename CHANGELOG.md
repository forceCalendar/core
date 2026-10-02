# Changelog

Notable changes to `@forcecalendar/core` are recorded here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

This is a curated backfill of significant changes, not an exhaustive list of every
historical patch or dependency update. Entries below were checked against Git tags and
commit history; dates are the corresponding GitHub release publication dates (UTC).
The version links show each listed release's changes against its preceding release;
they can include changes not summarized here. See the complete
[release archive](https://github.com/forceCalendar/core/releases) for omitted versions.

## [Unreleased]

### Added

- Contributor setup, architecture, test, benchmark and versioning guidance, plus issue
  and pull request templates.
- This curated changelog, with release-linked historical entries.

## [2.5.5] - 2026-10-02

### Fixed

- `SECONDLY` recurrence expansion in `RecurrenceEngineV2`, with regression tests for
  parity and recurrence boundaries ([#192](https://github.com/forceCalendar/core/pull/192)).

### Changed

- Consolidated development-tool and GitHub Actions updates and restored default
  Dependabot labels.

## [2.5.4] - 2026-10-02

### Fixed

- Calendar disposal now releases owned timers and pending work across calendar,
  event-store and performance components.
- Range-result declarations distinguish enhanced recurring occurrences from stored
  events, with strict consumer and lifecycle regression tests
  ([#191](https://github.com/forceCalendar/core/pull/191)).

## [2.5.3] - 2026-08-30

### Fixed

- Normalized `BYDAY` values and bounded weekday searches in recurrence expansion.

### Security

- Reject IPv6 literals that embed private addresses in ICS feed URLs.

## [2.5.2] - 2026-08-30

### Fixed

- Use the `h23` hour cycle so midnight formats as `00` on older ICU implementations.

## [2.5.1] - 2026-08-30

### Fixed

- Invalidate recurrence expansion caches on store mutations and resolve occurrence IDs
  consistently across selection, iteration and reconciliation.
- Find recurring occurrences whose calendar day differs across timezones.
- Correct weekly `BYSETPOS` period keys, month-end monthly stepping, and weekly `BYDAY`
  set handling and seeking.
- Preserve stored recurrence rules during parsing and compare colors in normalized form.

### Changed

- Extend timezone transition caches incrementally and cache timezone-ID validation.

## [2.5.0] - 2026-08-30

### Added

- Lazy `iterateOccurrences`, `nextOccurrence` and `takeOccurrences` APIs on both
  recurrence engines, with range seeking. `EventStore`, `Calendar` and `EnhancedCalendar`
  expose iteration and taking by event ID, with `getNextOccurrence` for next lookup.

### Fixed

- Expand recurring series in month/week/day view data with stable occurrence IDs.

## [2.4.0] - 2026-08-30

### Added

- Diff-based `EventStore.reconcile`, `Calendar.reconcileEvents`, reconciliation through
  `setEvents`, and event-version tracking. Unchanged events retain their identity and
  changed snapshots emit a batch notification.

### Fixed

- Batch rollback no longer calls a nonexistent optimizer method.
- Count `maxOccurrences` against returned occurrences and seek to the requested range.

## [2.3.0] - 2026-07-10

### Changed

- Use a numeric fast path for daily and weekly recurrence expansion between timezone
  transitions, retaining the general path for other rules.

### Fixed

- Avoid fractional timezone offsets caused by sub-second input timestamps.

## [2.2.0] - 2026-07-10

### Added

- Generated TypeScript declarations from JSDoc, including type exports for public package
  subpaths.
- `TimezoneManager` and `ConflictDetector` exports from the main entry point.

### Fixed

- JSDoc cross-module paths and shared event-data contracts used by declaration generation.

### Changed

- Removed unused build tooling and migrated to ESLint's flat configuration.

## [2.1.70] - 2026-07-10

### Changed

- Reworked timezone caching and reduced recurrence hot-loop allocations to avoid cache
  thrashing on long recurrence expansions.

### Added

- Public roadmap covering the forceCalendar organization.

## [2.1.69] - 2026-07-06

### Fixed

- `ReferenceError` in `AdaptiveMemoryManager.increaseCacheSizes`.

## [2.1.68] - 2026-06-24

### Changed

- Tightened integration assertions and CI test execution, sorted integration-test
  discovery, and stopped the tag-release workflow from continuing after failed tests.
  This did not add a coverage-percentage gate.

## [2.1.67] - 2026-06-24

### Fixed

- Stabilized recurring event expansion and added regression coverage.

## [2.1.66] - 2026-06-24

### Fixed

- Made event overlap indexing reliable.

## [2.1.65] - 2026-06-24

### Fixed

- Stabilized search worker indexing.

## [2.1.64] - 2026-06-24

### Fixed

- Hardened ICS import and timezone parsing.

### Security

- Added remote-feed validation for redirect targets in Node, rejected embedded URL
  credentials, and enforced response-size limits while reading streamed ICS data.

## [2.1.0] - 2026-01-13

### Added

- ESLint and Prettier configuration, quality scripts and a code-quality CI workflow.

## [2.0.0] - 2026-01-13

### Fixed

- Clone input dates during event normalization and deep-clone state history to avoid
  unintended mutation.
- Handle string `BYDAY` values in rule serialization/descriptions and improve weekly
  fallback calculation and infinite-loop protection in recurrence expansion.

### Changed

- Released these behavior corrections as a major version because applications relying
  on the previous behavior could be affected.

[Unreleased]: https://github.com/forceCalendar/core/compare/v2.5.5...HEAD
[2.5.5]: https://github.com/forceCalendar/core/compare/v2.5.4...v2.5.5
[2.5.4]: https://github.com/forceCalendar/core/compare/v2.5.3...v2.5.4
[2.5.3]: https://github.com/forceCalendar/core/compare/v2.5.2...v2.5.3
[2.5.2]: https://github.com/forceCalendar/core/compare/v2.5.1...v2.5.2
[2.5.1]: https://github.com/forceCalendar/core/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/forceCalendar/core/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/forceCalendar/core/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/forceCalendar/core/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/forceCalendar/core/compare/v2.1.70...v2.2.0
[2.1.70]: https://github.com/forceCalendar/core/compare/v2.1.69...v2.1.70
[2.1.69]: https://github.com/forceCalendar/core/compare/v2.1.68...v2.1.69
[2.1.68]: https://github.com/forceCalendar/core/compare/v2.1.67...v2.1.68
[2.1.67]: https://github.com/forceCalendar/core/compare/v2.1.66...v2.1.67
[2.1.66]: https://github.com/forceCalendar/core/compare/v2.1.65...v2.1.66
[2.1.65]: https://github.com/forceCalendar/core/compare/v2.1.64...v2.1.65
[2.1.64]: https://github.com/forceCalendar/core/compare/v2.1.63...v2.1.64
[2.1.0]: https://github.com/forceCalendar/core/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/forceCalendar/core/compare/v1.1.0...v2.0.0
