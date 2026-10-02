---
name: Bug report
about: Report a reproducible problem in the core calendar engine
title: ''
labels: ''
assignees: ''
---

## What happened?

Describe actual behavior and what you expected instead.

## Minimal reproduction

Include steps and a small runnable example with synthetic event data.
For recurrence/date bugs, include the RRULE, start/end, query range, timezone,
all-day status, and which API or engine was used.

## Environment

- `@forcecalendar/core` version or commit:
- Node.js version and/or browser version:
- Operating system and system timezone:
- Salesforce/LWS or other host environment, if relevant:

## Evidence

Include assertion failures, sanitized error output, and any relevant regression range.
Remove access tokens, private feed URLs, attendee addresses and personal event details.

## Checks

- [ ] I searched existing issues and pull requests.
- [ ] I included a minimal reproduction and expected result.
