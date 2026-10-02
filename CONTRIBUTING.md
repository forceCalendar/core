# Contributing to @forcecalendar/core

Thanks for helping improve the calendar engine. Search [existing issues](https://github.com/forceCalendar/core/issues)
and pull requests before starting; discuss substantial API or architecture changes in an issue first.
The [roadmap](ROADMAP.md) describes the project's direction.

## Development setup

Use Git, npm, and Node.js **22.13 or later in the 22.x line, or Node.js 24+**.
The current ESLint 10 toolchain requires Node `^20.19.0 || ^22.13.0 || >=24`;
Node 22 matches the publishing workflow. The test workflow currently also runs
Node 18 and 20, but that does not make Node 18 suitable for the full development toolchain.

```sh
git clone https://github.com/forceCalendar/core.git
cd core
npm ci
git switch -c fix/describe-the-change
npm test
npm run quality
```

For contributors without push access, fork the repository and clone your fork instead.
Use `npm ci` to install the checked-in lockfile; change dependencies and the lockfile only
when that is part of your PR. There are no runtime dependencies and no bundling step:
the package ships JavaScript ES modules from `core/`.

## Architecture map

The repository directory and source directory are both named `core`; paths below are
relative to the repository root.

- [`core/index.js`](core/index.js): public entry point and `VERSION` export. The supported
  package subpaths are listed in [`package.json`](package.json).
- [`core/calendar/`](core/calendar/): `Calendar` coordinates views, events and state;
  `DateUtils` handles calendar date calculations. View data is DOM-free.
- [`core/events/`](core/events/): `Event` validation, `EventStore` indexing, batching and
  reconciliation, `RRuleParser`, and the two recurrence engines.
- [`core/state/`](core/state/): observable state and history.
- [`core/timezone/`](core/timezone/): timezone validation, offsets and transition caching.
- [`core/ics/`](core/ics/): ICS parsing, import/export and remote-feed safety checks.
- [`core/search/`](core/search/), [`core/conflicts/`](core/conflicts/) and
  [`core/performance/`](core/performance/): search/indexing, conflict checks, caches and
  resource management.
- [`core/integration/EnhancedCalendar.js`](core/integration/EnhancedCalendar.js): calendar
  integration with worker-backed search and `RecurrenceEngineV2`.
- [`core/types.js`](core/types.js): shared JSDoc contracts. `types/` is generated and ignored
  by Git; edit JSDoc in source rather than generated declarations.
- [`tests/integration/`](tests/integration/) and [`tests/declarations/`](tests/declarations/):
  executable JavaScript regression tests and a strict TypeScript consumer fixture.

Keep the engine framework-agnostic and DOM-free, preserve zero runtime dependencies,
and consider Salesforce Locker Service/LWS and strict CSP compatibility. UI components
belong in [forceCalendar/interface](https://github.com/forceCalendar/interface).

## Tests and quality checks

Run these from the repository root:

```sh
npm test                # declaration build/consumer checks, then all integration files
npm run test:types      # declarations plus the strict TypeScript consumer fixture
npm run build:types     # generate declarations only; not a full source type check
npm run test:ics        # focused ICS integration test
npm run test:search     # focused search integration test
npm run quality         # ESLint and Prettier checks for core/**/*.js
npm audit --audit-level=high
```

Run any individual integration file with Node, for example:

```sh
node tests/integration/test-secondly-recurrence.js
```

[`tests/run-all.js`](tests/run-all.js) discovers `test-*.js` files in `tests/integration/`
and fails if any exits nonzero. Add assertion-based regression tests for fixes and
features, including failure paths. Date/recurrence changes should cover relevant
boundaries, timezones/DST, recurrence limits and both engines when applicable.
Dispose calendars, workers and timers in tests so the process can finish. Public API
or JSDoc changes should also update the declaration consumer fixture.

There is currently **no enforced coverage percentage, coverage report command, or
Jest/Vitest setup**. The 80%+ line-coverage target is tracked in
[issue #31](https://github.com/forceCalendar/core/issues/31), not an existing passing gate.
Passing `npm test` does not establish that threshold or complete module coverage.

The [test workflow](.github/workflows/test.yml) runs tests and import smoke checks.
The [quality workflow](.github/workflows/code-quality.yml) runs ESLint, formatting and a
high-severity dependency audit. Its separate complexity check is advisory. Report
warnings and failures honestly in the PR; do not describe an unrun check as passing.

### Code style

Follow [`eslint.config.js`](eslint.config.js) and [`.prettierrc`](.prettierrc): two spaces,
semicolons, single quotes, no trailing commas, LF line endings and a 100-column target.
Use ES module imports/exports, prefer `const`, and keep JSDoc aligned with behavior.
ESLint errors fail the check; several rules (including unused variables and most
console calls) are warnings. These commands modify source files, so review their diff:

```sh
npm run lint:fix
npm run format
```

The package's formatting scripts cover source JavaScript, not Markdown or tests.
Keep unrelated formatting changes out of the PR.

## Benchmarks

Benchmarks live in the separate [forceCalendar/benchmark repository](https://github.com/forceCalendar/benchmark).
There is no `npm run benchmark` script in this repository. In a separate checkout:

```sh
git clone https://github.com/forceCalendar/benchmark.git
cd benchmark
npm install
npm run benchmark             # write results/latest.json
npm run benchmark:recurrence  # recurrence suite only
npm run benchmark:bundle      # installed bundle-size comparison
npm run benchmark:full        # all suites plus dashboard data update
```

Consult that repository's [README](https://github.com/forceCalendar/benchmark/blob/master/README.md)
and [package scripts](https://github.com/forceCalendar/benchmark/blob/master/package.json)
for current instructions. Its default install benchmarks the dependency versions it
installs, not your unmerged core checkout. When reporting a proposed performance change,
record exactly which core code was installed, the benchmark commit, Node/platform,
scenario, inputs and before/after results. Do not treat bundle-size or recurrence
benchmarks as rendering or memory benchmarks. Publishing core requests a benchmark
rerun through `repository_dispatch`; a dispatch failure is non-blocking in the release workflow.

## Pull requests

1. Branch from current `master`, keep the change focused, and link the issue it addresses.
2. Include a reproduction and regression test for a bug, or test cases for new behavior.
   For docs-only changes, verify links and commands and state why no behavior test was added.
3. Run the applicable checks above and record commands, results and any limits in the PR.
4. Add a user-facing entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) when relevant.
   Describe breaking changes and migration steps explicitly.
5. Use the [PR template](.github/pull_request_template.md), review the final diff, and leave
   generated `types/`, dependencies, local artifacts and credentials out of commits.
6. Open a draft while work or validation remains. Wait for maintainer review before merging.

Use the [bug report](.github/ISSUE_TEMPLATE/bug_report.md) or
[feature request](.github/ISSUE_TEMPLATE/feature_request.md) template for new issues.
Use synthetic calendar data and remove credentials and personal event details from examples.

## Commit messages and versioning

The project follows [Semantic Versioning](https://semver.org/) and uses
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) as a writing convention:

- `fix: ...` for a backwards-compatible bug fix (patch).
- `feat: ...` for a backwards-compatible feature (minor).
- `feat!: ...` or a `BREAKING CHANGE:` footer for an incompatible change (major).
- `docs: ...`, `test: ...`, `refactor: ...`, `perf: ...` and `chore: ...` for other work.

Use an imperative, specific summary. Include the reason and compatibility impact in the
body when needed. The existing automation is a small message matcher, not a complete
Conventional Commits parser. Its actual rules are important:

- It examines **only the head commit message of the push**, not every commit in a PR.
- `[major]`, `BREAKING CHANGE` or `!:` selects major first.
- Otherwise `[minor]`, `feat:` or `feature:` selects minor.
- `[patch]`, `fix:`, `bugfix:` or `hotfix:` selects patch; everything else defaults to patch.
- Matching is case-insensitive. A scoped subject such as `feat(events): ...` does not
  match `feat:`; use `feat: ...` or add `[minor]` for that feature. A breaking scoped
  subject ending its prefix with `!:` is recognized.

Before merging, maintainers must ensure the resulting head/merge message conveys the
intended bump. For a squash merge this is the final squash commit message, often based
on the PR title. Documentation-only changes also default to a patch release.

### Existing release workflow

[`npm-publish.yml`](.github/workflows/npm-publish.yml) runs on pushes to `master`/`main`
and supports a manual `patch`/`minor`/`major` choice. It installs dependencies, runs
`npm test`, checks the registry version, bumps package metadata, and runs
[`sync:version`](scripts/sync-version.js) to keep `core/index.js` in sync. It then creates
a release commit/tag, publishes to npm (with provenance) and GitHub Packages, and creates
a GitHub release. The separate [tag workflow](.github/workflows/release.yml) also handles
eligible `v*` tag pushes. Routine contributor PRs should not bump versions, create tags,
publish packages or dispatch a release manually.

The Markdown changelog is maintained manually; automation does not consume `Unreleased`
or update it. Maintainers should move applicable entries to a dated version section and
update comparison links when reconciling a verified release. Historical entries must be
checked against tags/commits and release dates, not inferred from issue creation dates.
A merge to the publishing branches can release immediately, so treat merging as a release
operation, even for documentation. No additional release tool is required by this guide.

The [roadmap's release policy](ROADMAP.md#release-policy) describes supported major versions.
