# Lightning Calendar Core

Calendar engine for Salesforce. No dependencies, works in Locker Service.

## Why This Exists

I needed a calendar for Salesforce LWC projects. FullCalendar is great, but Locker Service blocks modern versions. The older v3 works but needs workarounds - timezone handling gets tricky, recurring events need custom logic, and every project ended up with the same patches.

So I built a calendar engine from scratch that's designed for Salesforce's constraints. Works natively in Locker Service, no hacks needed.

## What It Is

Just the calendar logic. No UI, no rendering, no DOM manipulation. You get:

- Event storage and queries
- Date calculations for month/week/day views
- Timezone conversions
- Conflict detection
- Recurring events
- Performance optimizations (cache, batch ops)

You build whatever UI you want on top. Works in LWC, Aura, Visualforce, or plain JavaScript.

The core doesn't care how you display it. It just gives you the data structure.

## Documentation

Everything's in the [wiki](https://github.com/thedhanawada/lightning-calendar-core/wiki). Read it if you want to know how this works.


## License

MIT. Use it however you want.
