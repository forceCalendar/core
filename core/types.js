/**
 * Type definitions for Lightning Calendar Core
 * @module types
 */

/**
 * @typedef {Object} EventData
 * @property {string} id - Unique identifier for the event
 * @property {string} title - Event title
 * @property {Date|string} start - Start date/time of the event
 * @property {Date|string} [end] - End date/time of the event
 * @property {boolean} [allDay=false] - Whether this is an all-day event
 * @property {string} [description=''] - Event description
 * @property {string} [location=''] - Event location
 * @property {string} [color=null] - Event color (applies to all color properties if set)
 * @property {string} [backgroundColor=null] - Background color for the event
 * @property {string} [borderColor=null] - Border color for the event
 * @property {string} [textColor=null] - Text color for the event
 * @property {boolean} [recurring=false] - Whether this is a recurring event
 * @property {RecurrenceRule|string} [recurrenceRule=null] - Recurrence rule (RRULE string or object)
 * @property {string} [timeZone=null] - IANA timezone for the event
 * @property {string} [endTimeZone=null] - IANA timezone for the event end (cross-timezone events)
 * @property {RecurrenceRule|string} [recurrence=null] - Backward-compatible alias for recurrenceRule
 * @property {string} [category=null] - Single category (alias for a one-element categories array)
 * @property {EventStatus} [status='confirmed'] - Event status
 * @property {EventVisibility} [visibility='public'] - Event visibility
 * @property {Organizer} [organizer=null] - Event organizer
 * @property {Attendee[]} [attendees=[]] - Event attendees
 * @property {Reminder[]} [reminders=[]] - Event reminders
 * @property {string[]} [categories=[]] - Event categories/tags
 * @property {Attachment[]} [attachments=[]] - Event attachments
 * @property {ConferenceData} [conferenceData=null] - Virtual meeting information
 * @property {Object.<string, any>} [metadata={}] - Custom metadata for extensibility
 */

/**
 * @typedef {('confirmed'|'tentative'|'cancelled')} EventStatus
 */

/**
 * @typedef {('public'|'private'|'confidential')} EventVisibility
 */

/**
 * @typedef {('needs-action'|'accepted'|'declined'|'tentative'|'delegated')} AttendeeResponseStatus
 */

/**
 * @typedef {('required'|'optional'|'resource')} AttendeeRole
 */

/**
 * @typedef {('email'|'popup'|'sms')} ReminderMethod
 */

/**
 * @typedef {Object} Organizer
 * @property {string} [id] - Unique identifier for the organizer
 * @property {string} name - Organizer's name
 * @property {string} email - Organizer's email
 * @property {string} [phoneNumber] - Organizer's phone number
 * @property {string} [photoUrl] - URL to organizer's photo
 */

/**
 * @typedef {Object} Attendee
 * @property {string} [id] - Unique identifier for the attendee
 * @property {string} name - Attendee's name
 * @property {string} email - Attendee's email
 * @property {string} [phoneNumber] - Attendee's phone number
 * @property {string} [photoUrl] - URL to attendee's photo
 * @property {AttendeeResponseStatus} [responseStatus='needs-action'] - Response status
 * @property {AttendeeRole} [role='required'] - Attendee role
 * @property {boolean} [optional=false] - Whether attendance is optional
 * @property {boolean} [resource=false] - Whether attendee is a resource (room, equipment)
 * @property {string} [comment] - Attendee's comment or note
 * @property {Date} [responseTime] - When the attendee responded
 */

/**
 * @typedef {Object} Reminder
 * @property {string} [id] - Unique identifier for the reminder
 * @property {ReminderMethod} method - Reminder method
 * @property {number} minutesBefore - Minutes before event to trigger reminder
 * @property {string} [message] - Custom reminder message
 * @property {boolean} [enabled=true] - Whether reminder is active
 */

/**
 * @typedef {Object} Attachment
 * @property {string} [id] - Unique identifier for the attachment
 * @property {string} fileName - File name
 * @property {string} [fileUrl] - URL to the file
 * @property {string} [mimeType] - MIME type of the file
 * @property {number} [size] - File size in bytes
 * @property {string} [iconUrl] - URL to file type icon
 */

/**
 * @typedef {Object} ConferenceData
 * @property {string} [id] - Unique identifier for the conference
 * @property {string} [solution] - Conference solution (e.g., 'zoom', 'teams', 'meet')
 * @property {string} [url] - Conference URL
 * @property {string} [phone] - Conference phone number
 * @property {string} [accessCode] - Access code or meeting ID
 * @property {string} [password] - Meeting password
 * @property {string} [notes] - Additional conference notes
 */

/**
 * @typedef {Object} RecurrenceRule
 * @property {('DAILY'|'WEEKLY'|'MONTHLY'|'YEARLY')} freq - Frequency of recurrence
 * @property {number} [interval=1] - Interval between occurrences
 * @property {number} [count=null] - Number of occurrences
 * @property {Date} [until=null] - End date for recurrence
 * @property {string[]} [byDay=[]] - Days of week (MO, TU, WE, TH, FR, SA, SU)
 * @property {number[]} [byMonthDay=[]] - Days of month (1-31)
 * @property {number[]} [byMonth=[]] - Months (1-12)
 * @property {number[]} [bySetPos=[]] - Position in set (-1 for last)
 * @property {Date[]} [exceptions=[]] - Exception dates to exclude
 */

/**
 * @typedef {Object} CalendarConfig
 * @property {ViewType} [view='month'] - Initial view type
 * @property {Date} [date=new Date()] - Initial date to display
 * @property {number} [weekStartsOn=0] - Day week starts on (0=Sunday, 6=Saturday)
 * @property {string} [locale='en-US'] - Locale for formatting
 * @property {string} [timeZone] - IANA timezone
 * @property {boolean} [showWeekNumbers=false] - Show week numbers
 * @property {boolean} [showWeekends=true] - Show weekend days
 * @property {boolean} [fixedWeekCount=true] - Always show 6 weeks in month view
 * @property {BusinessHours} [businessHours] - Business hours configuration
 * @property {EventData[]} [events=[]] - Initial events to load
 */

/**
 * @typedef {('month'|'week'|'day'|'list')} ViewType
 */

/**
 * @typedef {Object} BusinessHours
 * @property {string} start - Start time (HH:MM format)
 * @property {string} end - End time (HH:MM format)
 */

/**
 * @typedef {Object} ViewData
 * @property {ViewType} type - Type of view
 * @property {Date} [startDate] - Start date of the view
 * @property {Date} [endDate] - End date of the view
 */

/**
 * @typedef {Object} MonthViewData
 * @property {ViewType} type - Always 'month'
 * @property {number} year - Year being displayed
 * @property {number} month - Month being displayed (0-11)
 * @property {string} monthName - Localized month name
 * @property {WeekData[]} weeks - Array of weeks in the month
 * @property {Date} startDate - First date in the view
 * @property {Date} endDate - Last date in the view
 */

/**
 * @typedef {Object} WeekData
 * @property {number} weekNumber - Week number in the year
 * @property {DayData[]} days - Array of days in the week
 */

/**
 * @typedef {Object} DayData
 * @property {Date} date - Date object for the day
 * @property {number} dayOfMonth - Day of the month (1-31)
 * @property {boolean} isCurrentMonth - Whether this day is in the current month
 * @property {boolean} isToday - Whether this is today
 * @property {boolean} isWeekend - Whether this is a weekend day
 * @property {import('./events/Event.js').Event[]} events - Events for this day
 */

/**
 * @typedef {Object} WeekViewData
 * @property {ViewType} type - Always 'week'
 * @property {number} weekNumber - Week number in the year
 * @property {Date} startDate - First day of the week
 * @property {Date} endDate - Last day of the week
 * @property {WeekDayData[]} days - Array of days with detailed event data
 */

/**
 * @typedef {Object} WeekDayData
 * @property {Date} date - Date object for the day
 * @property {number} dayOfWeek - Day of week (0-6)
 * @property {string} dayName - Localized day name
 * @property {boolean} isToday - Whether this is today
 * @property {boolean} isWeekend - Whether this is a weekend day
 * @property {import('./events/Event.js').Event[]} events - All events for this day
 * @property {Array<import('./events/Event.js').Event[]>} overlapGroups - Groups of overlapping events
 * @property {(events: import('./events/Event.js').Event[]) => Map<string, EventPosition>} getEventPositions - Function to calculate positions
 */

/**
 * @typedef {Object} EventPosition
 * @property {number} column - Column index for rendering
 * @property {number} totalColumns - Total number of columns
 */

/**
 * @typedef {Object} DayViewData
 * @property {ViewType} type - Always 'day'
 * @property {Date} date - Date being displayed
 * @property {string} dayName - Localized day name
 * @property {boolean} isToday - Whether this is today
 * @property {import('./events/Event.js').Event[]} allDayEvents - All-day events
 * @property {HourSlot[]} hours - Hourly time slots
 */

/**
 * @typedef {Object} HourSlot
 * @property {number} hour - Hour (0-23)
 * @property {string} time - Formatted time string
 * @property {import('./events/Event.js').Event[]} events - Events in this hour
 */

/**
 * @typedef {Object} ListViewData
 * @property {ViewType} type - Always 'list'
 * @property {Date} startDate - Start of the list range
 * @property {Date} endDate - End of the list range
 * @property {ListDayData[]} days - Days with events
 * @property {number} totalEvents - Total event count
 */

/**
 * @typedef {Object} ListDayData
 * @property {Date} date - Date object
 * @property {string} dayName - Localized day name
 * @property {boolean} isToday - Whether this is today
 * @property {import('./events/Event.js').Event[]} events - Events for this day
 */

/**
 * @typedef {Object} CalendarState
 * @property {ViewType} view - Current view type
 * @property {Date} currentDate - Currently displayed date
 * @property {string|null} selectedEventId - Selected event ID
 * @property {Date|null} selectedDate - Selected date
 * @property {string|null} hoveredEventId - Hovered event ID
 * @property {Date|null} hoveredDate - Hovered date
 * @property {number} weekStartsOn - Week start day
 * @property {boolean} showWeekNumbers - Show week numbers
 * @property {boolean} showWeekends - Show weekends
 * @property {boolean} fixedWeekCount - Fixed week count in month view
 * @property {string} timeZone - IANA timezone
 * @property {string} locale - Locale string
 * @property {('12h'|'24h')} hourFormat - Hour format
 * @property {BusinessHours} businessHours - Business hours
 * @property {FilterState} filters - Active filters
 * @property {boolean} isDragging - Dragging state
 * @property {boolean} isResizing - Resizing state
 * @property {boolean} isCreating - Creating state
 * @property {boolean} isLoading - Loading state
 * @property {string} loadingMessage - Loading message
 * @property {string|null} error - Error message
 * @property {Object.<string, any>} metadata - Custom metadata
 */

/**
 * @typedef {Object} FilterState
 * @property {string} searchTerm - Search term
 * @property {string[]} categories - Selected categories
 * @property {boolean} showAllDay - Show all-day events
 * @property {boolean} showTimed - Show timed events
 */

/**
 * @typedef {Object} EventStoreChange
 * @property {('add'|'update'|'remove'|'clear'|'batch')} type - Type of change
 * @property {import('./events/Event.js').Event} [event] - Affected event
 * @property {import('./events/Event.js').Event} [oldEvent] - Previous event state (for updates)
 * @property {import('./events/Event.js').Event[]} [oldEvents] - Previous events (for clear)
 * @property {EventStoreChange[]} [changes] - Individual changes (for batch)
 * @property {number} [count] - Number of individual changes (for batch)
 * @property {number} version - Store version number
 */

/**
 * @typedef {(a: import('./events/Event.js').Event, b: import('./events/Event.js').Event) => boolean} EventEquivalenceFn
 */

/**
 * @typedef {Object} ReconcileOptions
 * @property {boolean} [removeMissing=true] - Remove stored events that are absent from the snapshot
 * @property {EventEquivalenceFn} [isEquivalent] - Comparator deciding whether a stored event is unchanged (defaults to Event.isEquivalent)
 */

/**
 * @typedef {Object} ReconciledUpdate
 * @property {import('./events/Event.js').Event} event - Event now in the store
 * @property {import('./events/Event.js').Event} oldEvent - Event it replaced
 */

/**
 * @typedef {Object} ReconcileResult
 * @property {import('./events/Event.js').Event[]} added - Events that were not in the store before
 * @property {ReconciledUpdate[]} updated - Events whose data changed
 * @property {import('./events/Event.js').Event[]} removed - Events removed from the store
 * @property {import('./events/Event.js').Event[]} unchanged - Stored events left untouched (same instances)
 */

/**
 * @typedef {Object} SetEventsOptions
 * @property {boolean} [reconcile=false] - Apply only the differences instead of clearing and re-adding
 * @property {boolean} [removeMissing=true] - Reconcile only: remove stored events absent from the snapshot
 * @property {EventEquivalenceFn} [isEquivalent] - Reconcile only: custom equivalence comparator
 */

/**
 * @typedef {Object} EventsSetPayload
 * @property {import('./events/Event.js').Event[]} events - All events after the operation
 * @property {import('./events/Event.js').Event[]} added - Events added by the operation
 * @property {ReconciledUpdate[]} updated - Events replaced by the operation
 * @property {import('./events/Event.js').Event[]} removed - Events removed by the operation
 * @property {import('./events/Event.js').Event[]} unchanged - Events left untouched
 */

/**
 * Payload of the Calendar `eventSelect` event
 * @typedef {Object} EventSelectPayload
 * @property {import('./events/Event.js').Event} event - The stored event (the master for an occurrence id)
 * @property {string} eventId - Id of the stored event, as kept in the state's selectedEventId
 * @property {string|null} occurrenceId - The occurrence id that was selected, or null for a stored event's id
 * @property {import('./events/Event.js').Event|null} occurrence - The selected occurrence as in view data, or null
 */

/**
 * @typedef {Object} QueryFilters
 * @property {Date} [start] - Start date for range query
 * @property {Date} [end] - End date for range query
 * @property {Date} [date] - Specific date to query
 * @property {number} [month] - Month (0-11)
 * @property {number} [year] - Year
 * @property {boolean} [allDay] - Filter by all-day events
 * @property {boolean} [recurring] - Filter by recurring events
 * @property {EventStatus} [status] - Filter by event status
 * @property {string[]} [categories] - Filter by categories
 * @property {boolean} [matchAllCategories=false] - Whether to match all categories (AND) or any (OR)
 * @property {boolean} [hasAttendees] - Filter by events with/without attendees
 * @property {string} [organizerEmail] - Filter by organizer email
 * @property {('start'|'end'|'duration'|'title')} [sort] - Sort field
 */

/**
 * @typedef {Object} EventOccurrence
 * @property {Date} start - Occurrence start date
 * @property {Date} end - Occurrence end date
 * @property {string} recurringEventId - ID of the parent recurring event
 * @property {string} [timezone] - Timezone the occurrence was expanded in
 * @property {Date} [originalStart] - Start of the series (DTSTART)
 */

/**
 * Window for lazy occurrence iteration. Both bounds are exclusive unless
 * `inclusive` is set: an occurrence starting exactly at `after` or `before`
 * is skipped by default, so iterating from a known occurrence's start
 * continues the series without repeating it. Omit a bound to leave that
 * end of the window open.
 * @typedef {Object} OccurrenceIteratorOptions
 * @property {Date|number} [after] - Only occurrences starting after this instant (Date or timestamp)
 * @property {Date|number} [before] - Only occurrences starting before this instant (Date or timestamp)
 * @property {boolean} [inclusive=false] - Treat `after` and `before` as closed bounds
 * @property {string} [timezone] - Timezone for expansion (defaults to the event's)
 */

/**
 * Options for lazy occurrence iteration through RecurrenceEngineV2,
 * EventStore and Calendar: the OccurrenceIteratorOptions window plus the
 * expansion switches RecurrenceEngineV2.expandEvent accepts.
 * @typedef {Object} ExpandedOccurrenceIteratorOptions
 * @property {Date|number} [after] - Only occurrences starting after this instant (Date or timestamp)
 * @property {Date|number} [before] - Only occurrences starting before this instant (Date or timestamp)
 * @property {boolean} [inclusive=false] - Treat `after` and `before` as closed bounds
 * @property {string} [timezone] - Timezone for expansion (defaults to the event's)
 * @property {boolean} [includeModified=true] - Apply stored instance modifications
 * @property {boolean} [includeCancelled=false] - Yield exception dates as cancelled occurrences
 * @property {boolean} [handleDST=true] - Adjust occurrences across DST transitions
 */

/**
 * Occurrence produced by RecurrenceEngineV2 (and therefore by EventStore
 * and Calendar occurrence queries)
 * @typedef {Object} ExpandedOccurrence
 * @property {string} id - Occurrence ID (`<eventId>_<startTimestamp>` for recurring events)
 * @property {string} [recurringEventId] - ID of the parent recurring event
 * @property {string} title - Event title
 * @property {Date} start - Occurrence start date
 * @property {Date} end - Occurrence end date
 * @property {Date} [startUTC] - Occurrence start in UTC
 * @property {Date} [endUTC] - Occurrence end in UTC
 * @property {string} timezone - Timezone the occurrence was expanded in
 * @property {Date} [originalStart] - Start of the series (DTSTART)
 * @property {boolean} allDay - Whether the event is all-day
 * @property {string} [description] - Event description
 * @property {string} [location] - Event location
 * @property {string[]} [categories] - Event categories
 * @property {EventStatus} [status] - 'confirmed', or 'cancelled' for exception dates yielded with includeCancelled
 * @property {string} [cancellationReason] - Reason recorded for a cancelled occurrence
 * @property {boolean} isRecurring - Whether the occurrence belongs to a recurring series
 * @property {boolean} [isModified] - Whether a stored instance modification was applied
 */

/**
 * @typedef {Object} CalendarPlugin
 * @property {(calendar: import('./calendar/Calendar.js').Calendar) => void} install - Installation function
 * @property {(calendar: import('./calendar/Calendar.js').Calendar) => void} [uninstall] - Cleanup function
 */

/**
 * @typedef {(payload: any) => void} EventListener
 */

/**
 * @typedef {() => void} UnsubscribeFn
 */

/**
 * @typedef {('time'|'attendee'|'resource'|'location')} ConflictType
 */

/**
 * @typedef {('critical'|'high'|'medium'|'low')} ConflictSeverity
 */

/**
 * @typedef {Object} ConflictDetails
 * @property {string} id - Unique identifier for the conflict
 * @property {ConflictType} type - Type of conflict
 * @property {ConflictSeverity} severity - Severity level
 * @property {string} eventId - ID of the event with conflict
 * @property {string} conflictingEventId - ID of the conflicting event
 * @property {string} description - Human-readable description
 * @property {Date} [overlapStart] - Start of overlap period
 * @property {Date} [overlapEnd] - End of overlap period
 * @property {number} [overlapMinutes] - Duration of overlap in minutes
 * @property {string[]} [conflictingAttendees] - Email addresses of conflicting attendees
 * @property {string} [conflictingResource] - Resource that has conflict
 * @property {Object.<string, any>} [metadata] - Additional conflict information
 */

/**
 * @typedef {Object} ConflictCheckOptions
 * @property {boolean} [checkAttendees=true] - Check for attendee conflicts
 * @property {boolean} [checkResources=true] - Check for resource conflicts
 * @property {boolean} [checkLocation=true] - Check for location conflicts
 * @property {boolean} [ignoreAllDay=false] - Ignore all-day events in conflict check
 * @property {string[]} [excludeEventIds=[]] - Event IDs to exclude from check
 * @property {EventStatus[]} [includeStatuses=['confirmed', 'tentative']] - Event statuses to include
 * @property {number} [bufferMinutes=0] - Buffer time between events in minutes
 */

/**
 * @typedef {Object} ConflictSummary
 * @property {boolean} hasConflicts - Whether any conflicts exist
 * @property {number} totalConflicts - Total number of conflicts
 * @property {ConflictDetails[]} conflicts - Array of conflict details
 * @property {Object.<ConflictType, number>} conflictsByType - Count by type
 * @property {Object.<ConflictSeverity, number>} conflictsBySeverity - Count by severity
 * @property {string[]} affectedEventIds - All event IDs involved
 * @property {string[]} affectedAttendees - All attendee emails involved
 */

export {};
