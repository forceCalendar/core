/**
 * Event class - represents a calendar event with timezone support
 * Pure JavaScript, no DOM dependencies
 * Locker Service compatible
 */

import { TimezoneManager } from '../timezone/TimezoneManager.js';

/**
 * Structural equality for plain event sub-values (attendees, metadata, rules...).
 * Handles primitives, Dates, arrays (order-sensitive) and plain objects
 * (key-order insensitive). Functions and symbols never compare equal unless
 * they are the same reference.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') {
    // NaN is the only primitive that is not === itself
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a).filter(k => a[k] !== undefined);
  const keysB = Object.keys(b).filter(k => b[k] !== undefined);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Timezone identifiers Intl has already accepted. Every Event construction
 * (each clone, each occurrence of a recurring series) validates its
 * timezone, and constructing an Intl.DateTimeFormat per event dominated
 * the cost of expanding a month grid.
 * @type {Set<string>}
 */
const validatedTimezones = new Set();

/**
 * Throw unless Intl accepts the timezone identifier
 * @param {string} timezone - IANA timezone identifier
 * @param {string} label - Field name for the error message
 * @throws {Error} If the timezone is not valid
 */
function assertValidTimezone(timezone, label) {
  if (validatedTimezones.has(timezone)) {
    return;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch (e) {
    throw new Error(`Invalid ${label}: ${timezone}`, { cause: e });
  }
  validatedTimezones.add(timezone);
}

export class Event {
  // Field size limits
  static FIELD_LIMITS = {
    id: 256,
    title: 1000,
    description: 10000,
    location: 500
  };
  static MAX_METADATA_SIZE = 50 * 1024; // 50KB

  /**
   * Normalize event data
   * @param {import('../types.js').EventData} data - Raw event data
   * @returns {import('../types.js').EventData} Normalized event data
   */
  static normalize(data) {
    const normalized = { ...data };

    // Always clone Date objects to avoid mutating caller's data
    if (normalized.start) {
      normalized.start = new Date(normalized.start);
    }
    if (normalized.end) {
      normalized.end = new Date(normalized.end);
    }

    // If no end date, set it to start date
    if (!normalized.end) {
      normalized.end = normalized.start ? new Date(normalized.start) : null;
    }

    // For all-day events, normalize times to midnight
    // (safe to mutate now since we cloned above)
    if (normalized.allDay && normalized.start) {
      normalized.start.setHours(0, 0, 0, 0);
      if (normalized.end) {
        normalized.end.setHours(23, 59, 59, 999);
      }
    }

    // Normalize string fields with size limits
    normalized.id = String(normalized.id || '')
      .trim()
      .slice(0, Event.FIELD_LIMITS.id);
    normalized.title = String(normalized.title || '')
      .trim()
      .slice(0, Event.FIELD_LIMITS.title);
    normalized.description = String(normalized.description || '')
      .trim()
      .slice(0, Event.FIELD_LIMITS.description);
    normalized.location = String(normalized.location || '')
      .trim()
      .slice(0, Event.FIELD_LIMITS.location);

    // Normalize arrays
    normalized.attendees = Array.isArray(normalized.attendees) ? normalized.attendees : [];
    normalized.reminders = Array.isArray(normalized.reminders) ? normalized.reminders : [];

    // Handle both 'category' (singular) and 'categories' (plural)
    if (data.category && !data.categories) {
      // If single category is provided, convert to array
      normalized.categories = [data.category];
    } else if (normalized.categories) {
      normalized.categories = Array.isArray(normalized.categories) ? normalized.categories : [];
    } else {
      normalized.categories = [];
    }

    normalized.attachments = Array.isArray(normalized.attachments) ? normalized.attachments : [];

    // Backward compatibility: support legacy "recurrence" alias.
    // Canonical fields are "recurring" + "recurrenceRule".
    if (normalized.recurrence && !normalized.recurrenceRule) {
      normalized.recurrenceRule = normalized.recurrence;
    }
    if (normalized.recurrenceRule) {
      normalized.recurring = true;
    }

    // Normalize status and visibility
    const validStatuses = ['confirmed', 'tentative', 'cancelled'];
    if (!validStatuses.includes(normalized.status)) {
      normalized.status = 'confirmed';
    }

    const validVisibilities = ['public', 'private', 'confidential'];
    if (!validVisibilities.includes(normalized.visibility)) {
      normalized.visibility = 'public';
    }

    // Normalize colors
    if (normalized.color && !normalized.backgroundColor) {
      normalized.backgroundColor = normalized.color;
    }
    if (normalized.color && !normalized.borderColor) {
      normalized.borderColor = normalized.color;
    }

    return normalized;
  }

  /**
   * Validate event data
   * @param {import('../types.js').EventData} data - Normalized event data
   * @throws {Error} If validation fails
   */
  static validate(data) {
    // Required fields
    if (!data.id) {
      throw new Error('Event must have an id');
    }
    if (!data.title) {
      throw new Error('Event must have a title');
    }
    if (!data.start) {
      throw new Error('Event must have a start date');
    }

    // Validate dates
    if (!(data.start instanceof Date) || isNaN(data.start.getTime())) {
      throw new Error('Invalid start date');
    }
    if (data.end && (!(data.end instanceof Date) || isNaN(data.end.getTime()))) {
      throw new Error('Invalid end date');
    }

    // Validate date order
    if (data.end && data.start && data.end < data.start) {
      throw new Error('Event end time cannot be before start time');
    }

    // Validate recurrence
    if (data.recurring && !data.recurrenceRule) {
      throw new Error('Recurring events must have a recurrence rule');
    }

    // Validate attendees
    if (data.attendees && data.attendees.length > 0) {
      data.attendees.forEach((attendee, index) => {
        if (!attendee.email || !attendee.name) {
          throw new Error(`Attendee at index ${index} must have email and name`);
        }
        // Validate email format (linear-time regex, no backtracking)
        const emailRegex = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
        if (!emailRegex.test(attendee.email)) {
          throw new Error(`Invalid email for attendee: ${attendee.email}`);
        }
      });
    }

    // Validate reminders
    if (data.reminders && data.reminders.length > 0) {
      data.reminders.forEach((reminder, index) => {
        if (!reminder.method || reminder.minutesBefore == null) {
          throw new Error(`Reminder at index ${index} must have method and minutesBefore`);
        }
        if (reminder.minutesBefore < 0) {
          throw new Error('Reminder minutesBefore must be non-negative');
        }
      });
    }

    // Validate timezones if provided (memoised per identifier)
    if (data.timeZone) {
      assertValidTimezone(data.timeZone, 'timezone');
    }
    if (data.endTimeZone) {
      assertValidTimezone(data.endTimeZone, 'end timezone');
    }
  }

  /**
   * Create a new Event instance
   * @param {import('../types.js').EventData} eventData - Event data object
   * @throws {Error} If required fields are missing or invalid
   */
  constructor({
    id,
    title,
    start,
    end,
    allDay = false,
    description = '',
    location = '',
    color = null,
    backgroundColor = null,
    borderColor = null,
    textColor = null,
    recurring = false,
    recurrenceRule = null,
    recurrence = null, // Backward-compatible alias for recurrenceRule
    timeZone = null,
    endTimeZone = null,
    status = 'confirmed',
    visibility = 'public',
    organizer = null,
    attendees = [],
    reminders = [],
    category, // Support singular category (no default)
    categories, // Support plural categories (no default)
    attachments = [],
    conferenceData = null,
    metadata = {},
    ...rest // Capture any extra properties
  }) {
    // Normalize and validate input
    const normalized = Event.normalize({
      id,
      title,
      start,
      end,
      allDay,
      description,
      location,
      color,
      backgroundColor,
      borderColor,
      textColor,
      recurring,
      recurrenceRule,
      recurrence,
      timeZone,
      endTimeZone,
      status,
      visibility,
      organizer,
      attendees,
      reminders,
      category, // Pass category to normalize
      categories, // Pass categories to normalize
      attachments,
      conferenceData,
      metadata,
      ...rest // Pass any extra properties
    });

    // Validate normalized data
    Event.validate(normalized);

    this.id = normalized.id;
    this.title = normalized.title;

    // Use shared timezone manager singleton to avoid memory bloat
    // (previously each Event created its own TimezoneManager instance)
    this._timezoneManager = TimezoneManager.getInstance();

    // Timezone handling
    // Store the timezone the event was created in (wall-clock time)
    this.timeZone = normalized.timeZone || this._timezoneManager.getSystemTimezone();
    this.endTimeZone = normalized.endTimeZone || this.timeZone; // Different end timezone for flights etc.

    // Store dates as provided (wall-clock time in event timezone)
    this.start = normalized.start;
    this.end = normalized.end;

    // Store UTC versions for efficient querying and comparison
    this.startUTC = this._timezoneManager.toUTC(this.start, this.timeZone);
    this.endUTC = this._timezoneManager.toUTC(this.end, this.endTimeZone);

    this.allDay = normalized.allDay;
    this.description = normalized.description;
    this.location = normalized.location;

    // Styling
    this.color = normalized.color;
    this.backgroundColor = normalized.backgroundColor;
    this.borderColor = normalized.borderColor;
    this.textColor = normalized.textColor;

    // Recurrence
    this.recurring = normalized.recurring;
    this.recurrenceRule = normalized.recurrenceRule;

    // Occurrence identity. Set by EventStore.expandRecurringEvent on the
    // instances it derives from a recurring series; stored events keep the
    // defaults. The id of an occurrence is Event.occurrenceId(master, start).
    /** @type {boolean} True when this instance is one occurrence of a recurring series */
    this.isOccurrence = false;
    /** @type {string|null} Id of the recurring master this occurrence belongs to */
    this.recurringEventId = null;
    /** @type {Date|null} Start of this occurrence as generated by the recurrence rule */
    this.occurrenceStart = null;

    // Store original timezone from system if not provided
    this._originalTimeZone = normalized.timeZone || null;

    // Event status and visibility
    this.status = normalized.status;
    this.visibility = normalized.visibility;

    // People
    this.organizer = normalized.organizer;
    this.attendees = [...normalized.attendees];

    // Reminders
    this.reminders = [...normalized.reminders];

    // Categories/Tags
    this.categories = normalized.categories ? [...normalized.categories] : [];

    // Attachments
    this.attachments = [...normalized.attachments];

    // Conference/Virtual meeting
    this.conferenceData = normalized.conferenceData;

    // Custom metadata for extensibility (with size/type validation)
    this.metadata = Event._sanitizeMetadata(normalized.metadata);

    // Computed properties cache
    this._cache = {};

    // Validate complex properties
    this._validateAttendees();
    this._validateReminders();
  }

  /**
   * Get event duration in milliseconds
   * @returns {number} Duration in milliseconds
   */
  get duration() {
    if (!this._cache.duration) {
      // Use UTC times for accurate duration calculation
      this._cache.duration = this.endUTC.getTime() - this.startUTC.getTime();
    }
    return this._cache.duration;
  }

  /**
   * Get start date in a specific timezone
   * @param {string} timezone - Target timezone
   * @returns {Date} Start date in specified timezone
   */
  getStartInTimezone(timezone) {
    if (timezone === this.timeZone) {
      return new Date(this.start);
    }
    return this._timezoneManager.fromUTC(this.startUTC, timezone);
  }

  /**
   * Get end date in a specific timezone
   * @param {string} timezone - Target timezone
   * @returns {Date} End date in specified timezone
   */
  getEndInTimezone(timezone) {
    if (timezone === this.endTimeZone) {
      return new Date(this.end);
    }
    return this._timezoneManager.fromUTC(this.endUTC, timezone);
  }

  /**
   * Update event times preserving the timezone
   * @param {Date} start - New start date
   * @param {Date} end - New end date
   * @param {string} [timezone] - Timezone for the new dates
   */
  updateTimes(start, end, timezone) {
    this.start = start instanceof Date ? start : new Date(start);
    this.end = end instanceof Date ? end : new Date(end);

    if (timezone) {
      this.timeZone = timezone;
      this.endTimeZone = timezone;
    }

    // Update UTC versions
    this.startUTC = this._timezoneManager.toUTC(this.start, this.timeZone);
    this.endUTC = this._timezoneManager.toUTC(this.end, this.endTimeZone);

    // Clear cache
    this._cache = {};

    // Validate
    if (this.endUTC < this.startUTC) {
      throw new Error('Event end time cannot be before start time');
    }
  }

  /**
   * Get event duration in minutes
   * @returns {number} Duration in minutes
   */
  get durationMinutes() {
    return Math.floor(this.duration / (1000 * 60));
  }

  /**
   * Get event duration in hours
   * @returns {number} Duration in hours
   */
  get durationHours() {
    return this.duration / (1000 * 60 * 60);
  }

  /**
   * Check if this is a multi-day event
   * @returns {boolean} True if event spans multiple days
   */
  get isMultiDay() {
    if (!Object.prototype.hasOwnProperty.call(this._cache, 'isMultiDay')) {
      const startDay = this.start.toDateString();
      const endDay = this.end.toDateString();
      this._cache.isMultiDay = startDay !== endDay;
    }
    return this._cache.isMultiDay;
  }

  /**
   * Check if event is recurring
   * @returns {boolean} True if event is recurring
   */
  isRecurring() {
    return this.recurring && this.recurrenceRule !== null;
  }

  /**
   * Backward-compatible alias for recurrenceRule
   * @returns {import('../types.js').RecurrenceRule|string|null}
   */
  get recurrence() {
    return this.recurrenceRule;
  }

  /**
   * Check if event occurs on a specific date
   * @param {Date|string} date - The date to check
   * @returns {boolean} True if event occurs on the given date
   */
  occursOn(date) {
    if (!(date instanceof Date)) {
      date = new Date(date);
    }

    const dateString = date.toDateString();
    const startString = this.start.toDateString();
    const endString = this.end.toDateString();

    // For all-day events, check if date falls within range
    if (this.allDay) {
      return date >= new Date(startString) && date <= new Date(endString);
    }

    // For timed events, check if any part of the event occurs on this date
    if (this.isMultiDay) {
      // Multi-day event: check if date is within range
      const dayStart = new Date(dateString);
      const dayEnd = new Date(dateString);
      dayEnd.setHours(23, 59, 59, 999);

      return this.start <= dayEnd && this.end >= dayStart;
    }
    // Single day event: check if it's on the same day
    return startString === dateString;
  }

  /**
   * Check if this event overlaps with another event
   * @param {Event|{start: Date, end: Date}} otherEvent - The other event or time range to check
   * @returns {boolean} True if events overlap
   * @throws {Error} If otherEvent is not an Event instance or doesn't have start/end
   */
  overlaps(otherEvent) {
    if (!otherEvent || (!otherEvent.start && !(otherEvent instanceof Event))) {
      throw new Error('Parameter must be an Event instance or have start/end properties');
    }

    const thisStart = this.start;
    let thisEnd = this.end;
    const otherStart = otherEvent.start;
    let otherEnd = otherEvent.end;

    // Normalize all-day event boundaries for consistent comparison.
    // All-day events use end=23:59:59.999, but a timed event ending at
    // exactly midnight (00:00:00) of the next day should overlap with
    // an all-day event on the previous day.
    if (this.allDay) {
      thisEnd = new Date(thisEnd);
      thisEnd.setDate(thisEnd.getDate() + 1);
      thisEnd.setHours(0, 0, 0, 0);
    }
    if (otherEvent.allDay) {
      otherEnd = new Date(otherEnd);
      otherEnd.setDate(otherEnd.getDate() + 1);
      otherEnd.setHours(0, 0, 0, 0);
    }

    // Standard interval overlap: NOT (one ends before or when the other starts)
    return !(thisEnd <= otherStart || thisStart >= otherEnd);
  }

  /**
   * Check if event contains a specific datetime
   * @param {Date|string} datetime - The datetime to check
   * @returns {boolean} True if the datetime falls within the event
   */
  contains(datetime) {
    if (!(datetime instanceof Date)) {
      datetime = new Date(datetime);
    }
    return datetime >= this.start && datetime <= this.end;
  }

  /**
   * Clone the event with optional updates
   * @param {Partial<import('../types.js').EventData>} [updates={}] - Properties to update in the clone
   * @returns {Event} New Event instance with updated properties
   */
  clone(updates = {}) {
    return new Event({
      id: this.id,
      title: this.title,
      start: new Date(this.start),
      end: new Date(this.end),
      allDay: this.allDay,
      description: this.description,
      location: this.location,
      color: this.color,
      backgroundColor: this.backgroundColor,
      borderColor: this.borderColor,
      textColor: this.textColor,
      recurring: this.recurring,
      recurrenceRule: this.recurrenceRule,
      recurrence: this.recurrenceRule,
      timeZone: this.timeZone,
      status: this.status,
      visibility: this.visibility,
      organizer: this.organizer ? { ...this.organizer } : null,
      attendees: this.attendees.map(a => ({ ...a })),
      reminders: this.reminders.map(r => ({ ...r })),
      categories: [...this.categories],
      attachments: this.attachments.map(a => ({ ...a })),
      conferenceData: this.conferenceData ? { ...this.conferenceData } : null,
      metadata: { ...this.metadata },
      ...updates
    });
  }

  /**
   * Convert event to plain object
   * @returns {import('../types.js').EventData} Plain object representation of the event
   */
  toObject() {
    return {
      id: this.id,
      title: this.title,
      start: this.start.toISOString(),
      end: this.end.toISOString(),
      allDay: this.allDay,
      description: this.description,
      location: this.location,
      color: this.color,
      backgroundColor: this.backgroundColor,
      borderColor: this.borderColor,
      textColor: this.textColor,
      recurring: this.recurring,
      recurrenceRule: this.recurrenceRule,
      timeZone: this.timeZone,
      status: this.status,
      visibility: this.visibility,
      organizer: this.organizer,
      attendees: this.attendees,
      reminders: this.reminders,
      categories: this.categories,
      attachments: this.attachments,
      conferenceData: this.conferenceData,
      metadata: { ...this.metadata }
    };
  }

  /**
   * Create Event from plain object
   * @param {import('../types.js').EventData} obj - Plain object with event properties
   * @returns {Event} New Event instance
   */
  static fromObject(obj) {
    return new Event(obj);
  }

  /**
   * Compare events for equality
   * @param {Event} other - The other event
   * @returns {boolean} True if events are equal
   */
  equals(other) {
    if (!(other instanceof Event)) return false;

    return (
      this.id === other.id &&
      this.title === other.title &&
      this.start.getTime() === other.start.getTime() &&
      this.end.getTime() === other.end.getTime() &&
      this.allDay === other.allDay &&
      this.description === other.description &&
      this.location === other.location &&
      this.recurring === other.recurring &&
      this.recurrenceRule === other.recurrenceRule &&
      this.status === other.status
    );
  }

  /**
   * Fields compared by {@link Event.isEquivalent}, in comparison order.
   * Scalars are compared with strict equality, dates by timestamp and
   * structured fields (recurrence rule, organizer, attendees, reminders,
   * categories, attachments, conference data, metadata) structurally.
   * The `color` shorthand is not listed: normalization copies it into
   * `backgroundColor` and `borderColor`, which are compared instead.
   * @type {ReadonlyArray<string>}
   */
  static EQUIVALENCE_FIELDS = Object.freeze([
    'id',
    'title',
    'start',
    'end',
    'allDay',
    'timeZone',
    'endTimeZone',
    'description',
    'location',
    'backgroundColor',
    'borderColor',
    'textColor',
    'recurring',
    'recurrenceRule',
    'status',
    'visibility',
    'organizer',
    'attendees',
    'reminders',
    'categories',
    'attachments',
    'conferenceData',
    'metadata'
  ]);

  /**
   * Deep equivalence check over the full event data surface.
   *
   * Unlike {@link Event#equals} (which only looks at identity, title, dates,
   * description, location, recurrence and status) this compares every field
   * that can be supplied through {@link EventData}: timezones, all-day flag,
   * colours, visibility, organizer, attendees, reminders, categories,
   * attachments, conference data and metadata. Dates are compared by
   * timestamp; structured fields are compared structurally (arrays are
   * order-sensitive, object key order is ignored). Plain event data objects
   * are normalized through the {@link Event} constructor before comparison so
   * that `{ color: 'red' }` and `{ backgroundColor: 'red', borderColor: 'red' }`
   * describe the same event. Two events with different ids are never
   * equivalent.
   *
   * Two things to know when building snapshots for `reconcile()`:
   * - `attendees`, `reminders`, `categories` and `attachments` are compared
   *   in order, so the same attendees listed in a different order count as
   *   a change.
   * - Only the top-level dates are normalized. Values inside `metadata` are
   *   compared as given, so a `Date` and its ISO string are not equivalent
   *   there; keep metadata in one representation.
   *
   * This is the default comparator used by `EventStore.reconcile()` to decide
   * whether an incoming snapshot entry replaces the stored event.
   *
   * @example
   * Event.isEquivalent(stored, { ...stored.toObject(), backgroundColor: '#f00' }); // false
   * Event.isEquivalent(stored, stored.clone()); // true
   *
   * @param {Event|import('../types.js').EventData} a - First event or raw event data
   * @param {Event|import('../types.js').EventData} b - Second event or raw event data
   * @returns {boolean} True when both describe the same event data
   * @throws {Error} If raw event data fails {@link Event.validate}
   */
  static isEquivalent(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;

    const left = a instanceof Event ? a : new Event(a);
    const right = b instanceof Event ? b : new Event(b);

    for (const field of Event.EQUIVALENCE_FIELDS) {
      if (!deepEqual(left[field], right[field])) {
        return false;
      }
    }
    return true;
  }

  /**
   * Build the id of one occurrence of a recurring series.
   *
   * The id is `<recurringEventId>_<startMs>` where `startMs` is the
   * occurrence start as returned by `Date.prototype.getTime()`. It is
   * deterministic, so the same occurrence gets the same id no matter which
   * range it was expanded for, and it matches the ids generated by
   * `RecurrenceEngineV2`. Use {@link Event.parseOccurrenceId} to get the
   * master id back.
   *
   * @example
   * Event.occurrenceId('standup', new Date(2025, 5, 16, 9)); // 'standup_1750028400000'
   *
   * @param {string} recurringEventId - Id of the recurring master event
   * @param {Date|number|string} occurrenceStart - Start of the occurrence
   * @returns {string} Occurrence id
   * @throws {TypeError} If occurrenceStart is not a valid date
   */
  static occurrenceId(recurringEventId, occurrenceStart) {
    const start = occurrenceStart instanceof Date ? occurrenceStart : new Date(occurrenceStart);
    const startMs = start.getTime();
    if (Number.isNaN(startMs)) {
      throw new TypeError('Event.occurrenceId: occurrenceStart must be a valid Date or timestamp');
    }
    return `${recurringEventId}_${startMs}`;
  }

  /**
   * Split an occurrence id built by {@link Event.occurrenceId} into the master
   * id and the occurrence start.
   *
   * Returns `null` for ids that do not have the `<id>_<startMs>` shape. A
   * positive result only means the id is well-formed; whether the master
   * exists is for the caller (see `EventStore.getEvent`) to check.
   *
   * @param {string} id - Candidate occurrence id
   * @returns {{recurringEventId: string, occurrenceStart: Date}|null} Parsed parts or null
   */
  static parseOccurrenceId(id) {
    if (typeof id !== 'string') {
      return null;
    }
    const separator = id.lastIndexOf('_');
    if (separator <= 0 || separator === id.length - 1) {
      return null;
    }
    const time = id.slice(separator + 1);
    if (!/^-?\d+$/.test(time)) {
      return null;
    }
    return {
      recurringEventId: id.slice(0, separator),
      occurrenceStart: new Date(Number(time))
    };
  }

  // ============ Attendee Management Methods ============

  /**
   * Add an attendee to the event
   * @param {import('../types.js').Attendee} attendee - Attendee to add
   * @returns {boolean} True if attendee was added, false if already exists
   */
  addAttendee(attendee) {
    if (!attendee || !attendee.email) {
      throw new Error('Attendee must have an email');
    }

    // Validate email format (matches constructor validation)
    if (!this._isValidEmail(attendee.email)) {
      throw new Error(`Invalid email for attendee: ${attendee.email}`);
    }

    // Check if attendee already exists
    if (this.hasAttendee(attendee.email)) {
      return false;
    }

    // Generate ID if not provided
    if (!attendee.id) {
      attendee.id = `attendee_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Set defaults
    attendee.responseStatus = attendee.responseStatus || 'needs-action';
    attendee.role = attendee.role || 'required';

    this.attendees.push(attendee);
    return true;
  }

  /**
   * Remove an attendee from the event
   * @param {string} emailOrId - Email or ID of the attendee to remove
   * @returns {boolean} True if attendee was removed
   */
  removeAttendee(emailOrId) {
    const index = this.attendees.findIndex(a => a.email === emailOrId || a.id === emailOrId);

    if (index !== -1) {
      this.attendees.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Update an attendee's response status
   * @param {string} email - Attendee's email
   * @param {import('../types.js').AttendeeResponseStatus} responseStatus - New response status
   * @returns {boolean} True if attendee was updated
   */
  updateAttendeeResponse(email, responseStatus) {
    const attendee = this.getAttendee(email);
    if (attendee) {
      attendee.responseStatus = responseStatus;
      attendee.responseTime = new Date();
      return true;
    }
    return false;
  }

  /**
   * Get an attendee by email
   * @param {string} email - Attendee's email
   * @returns {import('../types.js').Attendee|null} The attendee or null
   */
  getAttendee(email) {
    return this.attendees.find(a => a.email === email) || null;
  }

  /**
   * Check if an attendee exists
   * @param {string} email - Attendee's email
   * @returns {boolean} True if attendee exists
   */
  hasAttendee(email) {
    return this.attendees.some(a => a.email === email);
  }

  /**
   * Get attendees by response status
   * @param {import('../types.js').AttendeeResponseStatus} status - Response status to filter by
   * @returns {import('../types.js').Attendee[]} Filtered attendees
   */
  getAttendeesByStatus(status) {
    return this.attendees.filter(a => a.responseStatus === status);
  }

  /**
   * Get count of attendees by response status
   * @returns {Object.<string, number>} Count by status
   */
  getAttendeeCounts() {
    return this.attendees.reduce((counts, attendee) => {
      const status = attendee.responseStatus || 'needs-action';
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
  }

  // ============ Reminder Management Methods ============

  /**
   * Add a reminder to the event
   * @param {import('../types.js').Reminder} reminder - Reminder to add
   * @returns {boolean} True if reminder was added
   */
  addReminder(reminder) {
    if (!reminder || typeof reminder.minutesBefore !== 'number') {
      throw new Error('Reminder must have minutesBefore property');
    }

    // Generate ID if not provided
    if (!reminder.id) {
      reminder.id = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Set defaults
    reminder.method = reminder.method || 'popup';
    reminder.enabled = reminder.enabled !== false;

    // Check for duplicate
    const duplicate = this.reminders.some(
      r => r.method === reminder.method && r.minutesBefore === reminder.minutesBefore
    );

    if (duplicate) {
      return false;
    }

    this.reminders.push(reminder);
    return true;
  }

  /**
   * Remove a reminder from the event
   * @param {string} reminderId - ID of the reminder to remove
   * @returns {boolean} True if reminder was removed
   */
  removeReminder(reminderId) {
    const index = this.reminders.findIndex(r => r.id === reminderId);
    if (index !== -1) {
      this.reminders.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get active reminders
   * @returns {import('../types.js').Reminder[]} Active reminders
   */
  getActiveReminders() {
    return this.reminders.filter(r => r.enabled !== false);
  }

  /**
   * Get reminder trigger times
   * @returns {Date[]} Array of dates when reminders should trigger
   */
  getReminderTriggerTimes() {
    return this.getActiveReminders().map(reminder => {
      const triggerTime = new Date(this.start);
      triggerTime.setMinutes(triggerTime.getMinutes() - reminder.minutesBefore);
      return triggerTime;
    });
  }

  // ============ Category Management Methods ============

  /**
   * Add a category to the event
   * @param {string} category - Category to add
   * @returns {boolean} True if category was added
   */
  addCategory(category) {
    if (!category || typeof category !== 'string') {
      throw new Error('Category must be a non-empty string');
    }

    const normalizedCategory = category.trim().toLowerCase();
    if (!this.hasCategory(normalizedCategory)) {
      this.categories.push(normalizedCategory);
      return true;
    }
    return false;
  }

  /**
   * Remove a category from the event
   * @param {string} category - Category to remove
   * @returns {boolean} True if category was removed
   */
  removeCategory(category) {
    const normalizedCategory = category.trim().toLowerCase();
    const index = this.categories.findIndex(c => c.toLowerCase() === normalizedCategory);

    if (index !== -1) {
      this.categories.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get primary category (first in array) for backward compatibility
   * @returns {string|null} Primary category or null
   */
  get category() {
    return this.categories && this.categories.length > 0 ? this.categories[0] : null;
  }

  /**
   * Check if event has a specific category
   * @param {string} category - Category to check
   * @returns {boolean} True if event has the category
   */
  hasCategory(category) {
    const normalizedCategory = category.trim().toLowerCase();
    return this.categories.some(c => c.toLowerCase() === normalizedCategory);
  }

  /**
   * Check if event has any of the specified categories
   * @param {string[]} categories - Categories to check
   * @returns {boolean} True if event has any of the categories
   */
  hasAnyCategory(categories) {
    return categories.some(category => this.hasCategory(category));
  }

  /**
   * Check if event has all of the specified categories
   * @param {string[]} categories - Categories to check
   * @returns {boolean} True if event has all of the categories
   */
  hasAllCategories(categories) {
    return categories.every(category => this.hasCategory(category));
  }

  // ============ Metadata Sanitization ============

  /**
   * Sanitize metadata to enforce size limits and reject unsafe types
   * @param {Object} metadata - Raw metadata object
   * @returns {Object} Sanitized metadata
   * @private
   */
  static _sanitizeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      return {};
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(metadata)) {
      // Reject functions and symbols
      if (typeof value === 'function' || typeof value === 'symbol') {
        continue;
      }
      sanitized[key] = value;
    }

    // Enforce serialized size limit
    let serialized;
    try {
      serialized = JSON.stringify(sanitized);
    } catch {
      // If metadata can't be serialized (circular refs, etc.), return empty
      return {};
    }

    if (serialized.length > Event.MAX_METADATA_SIZE) {
      throw new Error(
        `Event metadata exceeds maximum size of ${Event.MAX_METADATA_SIZE / 1024}KB when serialized`
      );
    }

    return sanitized;
  }

  // ============ Validation Methods ============

  /**
   * Validate attendees
   * @private
   * @throws {Error} If attendees are invalid
   */
  _validateAttendees() {
    for (const attendee of this.attendees) {
      if (!attendee.email) {
        throw new Error('All attendees must have an email address');
      }
      if (!attendee.name) {
        attendee.name = attendee.email; // Use email as fallback name
      }
      if (!this._isValidEmail(attendee.email)) {
        throw new Error(`Invalid attendee email: ${attendee.email}`);
      }
    }
  }

  /**
   * Validate reminders
   * @private
   * @throws {Error} If reminders are invalid
   */
  _validateReminders() {
    for (const reminder of this.reminders) {
      if (typeof reminder.minutesBefore !== 'number' || reminder.minutesBefore < 0) {
        throw new Error('Reminder minutesBefore must be a positive number');
      }

      const validMethods = ['email', 'popup', 'sms'];
      if (!validMethods.includes(reminder.method)) {
        throw new Error(`Invalid reminder method: ${reminder.method}`);
      }
    }
  }

  /**
   * Validate email address
   * @private
   * @param {string} email - Email to validate
   * @returns {boolean} True if email is valid
   */
  _isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // ============ Enhanced Getters ============

  /**
   * Check if the event is cancelled
   * @returns {boolean} True if event is cancelled
   */
  get isCancelled() {
    return this.status === 'cancelled';
  }

  /**
   * Check if the event is tentative
   * @returns {boolean} True if event is tentative
   */
  get isTentative() {
    return this.status === 'tentative';
  }

  /**
   * Check if the event is confirmed
   * @returns {boolean} True if event is confirmed
   */
  get isConfirmed() {
    return this.status === 'confirmed';
  }

  /**
   * Check if the event is private
   * @returns {boolean} True if event is private
   */
  get isPrivate() {
    return this.visibility === 'private';
  }

  /**
   * Check if the event is public
   * @returns {boolean} True if event is public
   */
  get isPublic() {
    return this.visibility === 'public';
  }

  /**
   * Check if the event has attendees
   * @returns {boolean} True if event has attendees
   */
  get hasAttendees() {
    return this.attendees.length > 0;
  }

  /**
   * Check if the event has reminders
   * @returns {boolean} True if event has reminders
   */
  get hasReminders() {
    return this.reminders.length > 0;
  }

  /**
   * Check if the event is a meeting (has attendees or conference data)
   * @returns {boolean} True if event is a meeting
   */
  get isMeeting() {
    return this.hasAttendees || this.conferenceData !== null;
  }

  /**
   * Check if the event is virtual (has conference data)
   * @returns {boolean} True if event is virtual
   */
  get isVirtual() {
    return this.conferenceData !== null;
  }
}
