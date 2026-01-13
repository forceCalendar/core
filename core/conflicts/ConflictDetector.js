/**
 * ConflictDetector - Detects scheduling conflicts between events
 * Checks for time overlaps, attendee conflicts, and resource conflicts
 */

import { DateUtils } from '../calendar/DateUtils.js';

export class ConflictDetector {
  /**
   * Create a new ConflictDetector
   * @param {import('../events/EventStore.js').EventStore} eventStore - Event store instance
   */
  constructor(eventStore) {
    this.eventStore = eventStore;
    this.conflictIdCounter = 0;
  }

  /**
   * Check for conflicts for a specific event
   * @param {import('../events/Event.js').Event|import('../../types.js').EventData} event - Event to check
   * @param {import('../../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../../types.js').ConflictSummary} Conflict summary
   */
  checkConflicts(event, options = {}) {
    // Default options
    const opts = {
      checkAttendees: true,
      checkResources: true,
      checkLocation: true,
      ignoreAllDay: false,
      excludeEventIds: [],
      includeStatuses: ['confirmed', 'tentative'],
      bufferMinutes: 0,
      ...options
    };

    // Ensure we have an Event object
    if (!event.start || !event.end) {
      throw new Error('Event must have start and end dates');
    }

    const conflicts = [];
    const affectedEventIds = new Set();
    const affectedAttendees = new Set();

    // Get potential conflicting events in the time range
    const searchStart = new Date(event.start.getTime() - opts.bufferMinutes * 60000);
    const searchEnd = new Date(event.end.getTime() + opts.bufferMinutes * 60000);

    const potentialConflicts = this.eventStore
      .getEventsInRange(searchStart, searchEnd, false)
      .filter(e => {
        // Exclude self
        if (e.id === event.id) return false;
        // Exclude specified event IDs
        if (opts.excludeEventIds.includes(e.id)) return false;
        // Filter by status
        if (!opts.includeStatuses.includes(e.status)) return false;
        // Ignore all-day events if specified
        if (opts.ignoreAllDay && (e.allDay || event.allDay)) return false;
        // Ignore cancelled events
        if (e.status === 'cancelled') return false;
        return true;
      });

    // Check each potential conflict
    for (const conflictingEvent of potentialConflicts) {
      const eventConflicts = this._detectEventConflicts(event, conflictingEvent, opts);

      if (eventConflicts.length > 0) {
        conflicts.push(...eventConflicts);
        affectedEventIds.add(event.id);
        affectedEventIds.add(conflictingEvent.id);

        // Track affected attendees
        if (event.attendees) {
          event.attendees.forEach(a => affectedAttendees.add(a.email));
        }
        if (conflictingEvent.attendees) {
          conflictingEvent.attendees.forEach(a => affectedAttendees.add(a.email));
        }
      }
    }

    // Build summary
    return this._buildConflictSummary(conflicts, affectedEventIds, affectedAttendees);
  }

  /**
   * Check for conflicts between two specific events
   * @param {import('../events/Event.js').Event} event1 - First event
   * @param {import('../events/Event.js').Event} event2 - Second event
   * @param {import('../../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../../types.js').ConflictDetails[]} Array of conflicts
   */
  checkEventPairConflicts(event1, event2, options = {}) {
    const opts = {
      checkAttendees: true,
      checkResources: true,
      checkLocation: true,
      bufferMinutes: 0,
      ...options
    };

    return this._detectEventConflicts(event1, event2, opts);
  }

  /**
   * Get busy periods for a set of attendees
   * @param {string[]} attendeeEmails - Attendee email addresses
   * @param {Date} start - Start of period
   * @param {Date} end - End of period
   * @param {Object} [options={}] - Options
   * @returns {Array<{start: Date, end: Date, eventIds: string[]}>} Busy periods
   */
  getBusyPeriods(attendeeEmails, start, end, options = {}) {
    const opts = {
      includeStatuses: ['confirmed', 'tentative'],
      mergePeriods: true,
      ...options
    };

    const busyPeriods = [];
    const events = this.eventStore.getEventsInRange(start, end, false);

    // Find events with these attendees
    const attendeeEvents = events.filter(event => {
      if (!opts.includeStatuses.includes(event.status)) return false;
      if (event.status === 'cancelled') return false;

      return (
        event.attendees && event.attendees.some(attendee => attendeeEmails.includes(attendee.email))
      );
    });

    // Convert to busy periods
    attendeeEvents.forEach(event => {
      busyPeriods.push({
        start: event.start,
        end: event.end,
        eventIds: [event.id]
      });
    });

    // Merge overlapping periods if requested
    if (opts.mergePeriods && busyPeriods.length > 1) {
      return this._mergeBusyPeriods(busyPeriods);
    }

    return busyPeriods.sort((a, b) => a.start - b.start);
  }

  /**
   * Get free time slots
   * @param {Date} start - Start of search period
   * @param {Date} end - End of search period
   * @param {number} duration - Required duration in minutes
   * @param {Object} [options={}] - Options
   * @returns {Array<{start: Date, end: Date}>} Free time slots
   */
  getFreePeriods(start, end, duration, options = {}) {
    const opts = {
      attendeeEmails: [],
      businessHoursOnly: false,
      businessHours: { start: '09:00', end: '17:00' },
      excludeWeekends: false,
      ...options
    };

    const freePeriods = [];

    // Get busy periods
    const busyPeriods =
      opts.attendeeEmails.length > 0
        ? this.getBusyPeriods(opts.attendeeEmails, start, end)
        : this._getAllBusyPeriods(start, end);

    // Find gaps between busy periods
    let currentTime = new Date(start);

    for (const busy of busyPeriods) {
      if (currentTime < busy.start) {
        // Found a gap
        const gapDuration = (busy.start - currentTime) / 60000; // minutes
        if (gapDuration >= duration) {
          // Check if within business hours if required
          if (
            !opts.businessHoursOnly ||
            this._isWithinBusinessHours(currentTime, busy.start, opts)
          ) {
            freePeriods.push({
              start: new Date(currentTime),
              end: new Date(busy.start)
            });
          }
        }
      }
      currentTime = new Date(Math.max(currentTime.getTime(), busy.end.getTime()));
    }

    // Check final period
    if (currentTime < end) {
      const gapDuration = (end - currentTime) / 60000;
      if (gapDuration >= duration) {
        if (!opts.businessHoursOnly || this._isWithinBusinessHours(currentTime, end, opts)) {
          freePeriods.push({
            start: new Date(currentTime),
            end: new Date(end)
          });
        }
      }
    }

    return freePeriods;
  }

  /**
   * Detect conflicts between two events
   * @private
   */
  _detectEventConflicts(event1, event2, options) {
    const conflicts = [];

    // Check time overlap with buffer
    const hasTimeOverlap = this._checkTimeOverlap(event1, event2, options.bufferMinutes);

    if (hasTimeOverlap) {
      // Time conflict
      const timeConflict = this._createTimeConflict(event1, event2);
      conflicts.push(timeConflict);

      // Check attendee conflicts (only if time overlaps)
      if (options.checkAttendees) {
        const attendeeConflicts = this._checkAttendeeConflicts(event1, event2);
        conflicts.push(...attendeeConflicts);
      }

      // Check resource conflicts (only if time overlaps)
      if (options.checkResources) {
        const resourceConflicts = this._checkResourceConflicts(event1, event2);
        conflicts.push(...resourceConflicts);
      }

      // Check location conflicts (only if time overlaps)
      if (options.checkLocation) {
        const locationConflict = this._checkLocationConflict(event1, event2);
        if (locationConflict) {
          conflicts.push(locationConflict);
        }
      }
    }

    return conflicts;
  }

  /**
   * Check for time overlap between events
   * @private
   */
  _checkTimeOverlap(event1, event2, bufferMinutes = 0) {
    const buffer = bufferMinutes * 60000; // Convert to milliseconds

    const start1 = event1.start.getTime() - buffer;
    const end1 = event1.end.getTime() + buffer;
    const start2 = event2.start.getTime();
    const end2 = event2.end.getTime();

    return !(end1 <= start2 || end2 <= start1);
  }

  /**
   * Create time conflict details
   * @private
   */
  _createTimeConflict(event1, event2) {
    const overlapStart = new Date(Math.max(event1.start.getTime(), event2.start.getTime()));
    const overlapEnd = new Date(Math.min(event1.end.getTime(), event2.end.getTime()));
    const overlapMinutes = (overlapEnd - overlapStart) / 60000;

    // Determine severity based on overlap duration and event importance
    let severity = 'low';
    if (overlapMinutes >= 60) {
      severity = 'high';
    } else if (overlapMinutes >= 30) {
      severity = 'medium';
    }

    // Increase severity for confirmed events
    if (event1.status === 'confirmed' && event2.status === 'confirmed') {
      severity = severity === 'low' ? 'medium' : severity === 'medium' ? 'high' : 'critical';
    }

    return {
      id: `conflict_${++this.conflictIdCounter}`,
      type: 'time',
      severity,
      eventId: event1.id,
      conflictingEventId: event2.id,
      description: `Time overlap: ${event1.title} conflicts with ${event2.title}`,
      overlapStart,
      overlapEnd,
      overlapMinutes,
      metadata: {
        event1Title: event1.title,
        event2Title: event2.title,
        event1Status: event1.status,
        event2Status: event2.status
      }
    };
  }

  /**
   * Check for attendee conflicts
   * @private
   */
  _checkAttendeeConflicts(event1, event2) {
    const conflicts = [];

    if (!event1.attendees || !event2.attendees) {
      return conflicts;
    }

    const conflictingAttendees = [];

    for (const attendee1 of event1.attendees) {
      for (const attendee2 of event2.attendees) {
        if (attendee1.email === attendee2.email) {
          // Same attendee in both events
          conflictingAttendees.push(attendee1.email);
        }
      }
    }

    if (conflictingAttendees.length > 0) {
      // Determine severity based on attendee responses
      let severity = 'medium';

      // Check if any conflicting attendee has accepted both
      const hasAcceptedBoth = conflictingAttendees.some(email => {
        const a1 = event1.attendees.find(a => a.email === email);
        const a2 = event2.attendees.find(a => a.email === email);
        return a1?.responseStatus === 'accepted' && a2?.responseStatus === 'accepted';
      });

      if (hasAcceptedBoth) {
        severity = 'critical';
      }

      conflicts.push({
        id: `conflict_${++this.conflictIdCounter}`,
        type: 'attendee',
        severity,
        eventId: event1.id,
        conflictingEventId: event2.id,
        description: `Attendee conflict: ${conflictingAttendees.length} attendee(s) double-booked`,
        conflictingAttendees,
        metadata: {
          attendeeCount: conflictingAttendees.length,
          attendeeEmails: conflictingAttendees
        }
      });
    }

    return conflicts;
  }

  /**
   * Check for resource conflicts
   * @private
   */
  _checkResourceConflicts(event1, event2) {
    const conflicts = [];

    // Check if events have resource attendees
    const resources1 = event1.attendees?.filter(a => a.resource) || [];
    const resources2 = event2.attendees?.filter(a => a.resource) || [];

    for (const resource1 of resources1) {
      for (const resource2 of resources2) {
        if (resource1.email === resource2.email) {
          conflicts.push({
            id: `conflict_${++this.conflictIdCounter}`,
            type: 'resource',
            severity: 'critical', // Resource conflicts are always critical
            eventId: event1.id,
            conflictingEventId: event2.id,
            description: `Resource conflict: ${resource1.name} is double-booked`,
            conflictingResource: resource1.email,
            metadata: {
              resourceName: resource1.name,
              resourceEmail: resource1.email
            }
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Check for location conflicts
   * @private
   */
  _checkLocationConflict(event1, event2) {
    if (!event1.location || !event2.location) {
      return null;
    }

    // Normalize locations for comparison
    const loc1 = event1.location.trim().toLowerCase();
    const loc2 = event2.location.trim().toLowerCase();

    if (loc1 === loc2) {
      return {
        id: `conflict_${++this.conflictIdCounter}`,
        type: 'location',
        severity: 'high', // Location conflicts are typically high severity
        eventId: event1.id,
        conflictingEventId: event2.id,
        description: `Location conflict: ${event1.location} is double-booked`,
        metadata: {
          location: event1.location
        }
      };
    }

    return null;
  }

  /**
   * Build conflict summary
   * @private
   */
  _buildConflictSummary(conflicts, affectedEventIds, affectedAttendees) {
    const conflictsByType = {};
    const conflictsBySeverity = {};

    // Count by type and severity
    for (const conflict of conflicts) {
      conflictsByType[conflict.type] = (conflictsByType[conflict.type] || 0) + 1;
      conflictsBySeverity[conflict.severity] = (conflictsBySeverity[conflict.severity] || 0) + 1;
    }

    return {
      hasConflicts: conflicts.length > 0,
      totalConflicts: conflicts.length,
      conflicts,
      conflictsByType,
      conflictsBySeverity,
      affectedEventIds: Array.from(affectedEventIds),
      affectedAttendees: Array.from(affectedAttendees)
    };
  }

  /**
   * Merge overlapping busy periods
   * @private
   */
  _mergeBusyPeriods(periods) {
    if (periods.length <= 1) return periods;

    // Sort by start time
    periods.sort((a, b) => a.start - b.start);

    const merged = [periods[0]];

    for (let i = 1; i < periods.length; i++) {
      const current = periods[i];
      const last = merged[merged.length - 1];

      if (current.start <= last.end) {
        // Overlapping or adjacent, merge them
        last.end = new Date(Math.max(last.end.getTime(), current.end.getTime()));
        last.eventIds.push(...current.eventIds);
      } else {
        // No overlap, add as new period
        merged.push(current);
      }
    }

    return merged;
  }

  /**
   * Get all busy periods
   * @private
   */
  _getAllBusyPeriods(start, end) {
    const events = this.eventStore
      .getEventsInRange(start, end, false)
      .filter(e => e.status !== 'cancelled');

    return events
      .map(event => ({
        start: event.start,
        end: event.end,
        eventIds: [event.id]
      }))
      .sort((a, b) => a.start - b.start);
  }

  /**
   * Check if time period is within business hours
   * @private
   */
  _isWithinBusinessHours(start, end, options) {
    // Simple implementation - can be enhanced
    const startHour = start.getHours();
    const endHour = end.getHours();

    const businessStart = parseInt(options.businessHours.start.split(':')[0]);
    const businessEnd = parseInt(options.businessHours.end.split(':')[0]);

    return startHour >= businessStart && endHour <= businessEnd;
  }
}
