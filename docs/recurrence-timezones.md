# V2 recurrence timezone contract

RecurrenceEngineV2 uses options.timezone, then event.timeZone, then UTC to
interpret its calendar steps. The timestamp in event.start anchors the series.
Returned start and end values are occurrence instants. Identical timestamps,
rules and event zones produce identical occurrence instants on different hosts.

Daily, weekly, monthly, yearly and subdaily rules retain their existing calendar
setter behavior in the recurrence zone. Across a forward clock change, a missing
local time advances by the gap; that adjusted time carries into later steps.
Across a backward change, an ambiguous local time uses the earlier instant.
These are native Date setter semantics, including when the event zone is the
host zone. Subdaily rules are calendar increments, not a guarantee of constant
elapsed durations across a transition. Each occurrence's duration remains the
original end minus start in milliseconds.

Seeking uses transitions in the recurrence zone. Range bounds and iterator
bounds compare the resulting instants, without a second DST correction. Floating
UNTIL and EXDATE values in RRULE strings use the recurrence zone; values ending
in Z remain UTC. Existing date-based exception and modification matching uses
the occurrence's calendar date in that zone. The default event zone participates
in expansion cache keys.

The handleDST option remains accepted for compatibility. It previously enabled
an additional correction after calendar stepping, which could move occurrences
outside a queried range. Stepping already resolves transitions, so true and false
now produce the same instants. false was never an elapsed-duration stepping API.

## Limits of this correction

This change does not redefine Event's documented wall-clock carrier conventions,
or the legacy TimezoneManager.toUTC/fromUTC conversions. V2's startUTC/endUTC
metadata still uses those conversions and can depend on the host timezone. Use
start/end for the occurrence instants covered by this contract. This is not a
claim that every timezone API is host-independent.

The supported RRULE fields and their existing selection behavior are retained;
this change does not add RFC 5545 feature completeness or redefine month-end
selection. The legacy RecurrenceEngine remains unchanged apart from an optional
internal transition lookup used by V2's shared arithmetic seek.

## Regression coverage

The cross-host test generates expectations with native Date setters in six event
zones, then checks them on UTC, America/Los_Angeles, Asia/Kolkata and
Australia/Melbourne hosts. It covers all recurrence frequencies, DST gaps and
folds, half-hour transitions, supported monthly/yearly selection, millisecond
precision, bounds, COUNT, UNTIL, exceptions, modifications, iteration, and
seeking independently of a walk from DTSTART. The original 365-day UTC recurrence
queried through 2034 is also checked directly.
