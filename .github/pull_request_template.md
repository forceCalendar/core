## Summary

<!-- What changed, why, and which issue does it address? -->

Related issue:

## Behavior and compatibility

<!-- Include reproduction, before/after behavior, and migration steps for breaking changes.
For docs-only changes, describe what you checked for accuracy. -->

## Validation

<!-- Record exact commands and results. Explain failed, blocked or unrun checks. -->

- `npm test`:
- `npm run quality`:
- `npm audit --audit-level=high` (dependency changes):
- Focused regression tests / declaration consumer checks:
- Benchmark evidence (performance changes; include versions and environment):

## Checklist

- [ ] Linked the relevant issue and kept the diff focused.
- [ ] Added or updated regression tests, or explained why they are not applicable.
- [ ] Updated JSDoc/declaration consumer tests for public API changes, if applicable.
- [ ] Updated documentation and `CHANGELOG.md` under `Unreleased`, if applicable.
- [ ] Reviewed for generated files, local artifacts, credentials and personal calendar data.
- [ ] Described compatibility impact and used a suitable commit/PR title.

<!-- See CONTRIBUTING.md for exact release-message matching. The final head/merge message
controls the version bump; even docs-only merges to master/main can publish a patch.
There is currently no enforced coverage percentage; do not claim one from npm test. -->
