/**
 * ICS (iCalendar) Parser
 * Converts between ICS format and Calendar events
 * RFC 5545 compliant
 */

export class ICSParser {
    constructor() {
        // ICS line folding max width
        this.maxLineLength = 75;

        // Property mappings
        this.propertyMap = {
            'SUMMARY': 'title',
            'DESCRIPTION': 'description',
            'LOCATION': 'location',
            'DTSTART': 'start',
            'DTEND': 'end',
            'UID': 'id',
            'CATEGORIES': 'category',
            'STATUS': 'status',
            'TRANSP': 'showAs',
            'ORGANIZER': 'organizer',
            'ATTENDEE': 'attendees',
            'RRULE': 'recurrence',
            'EXDATE': 'excludeDates'
        };
    }

    /**
     * Parse ICS string into events
     * @param {string} icsString - The ICS formatted string
     * @returns {Array} Array of event objects
     */
    parse(icsString) {
        const events = [];
        const lines = this.unfoldLines(icsString);
        let currentEvent = null;
        let inEvent = false;
        let inAlarm = false;

        for (let line of lines) {
            // Skip empty lines
            if (!line.trim()) continue;

            // Parse property and value
            const colonIndex = line.indexOf(':');
            const semicolonIndex = line.indexOf(';');
            const separatorIndex = semicolonIndex > -1 && semicolonIndex < colonIndex
                ? semicolonIndex
                : colonIndex;

            if (separatorIndex === -1) continue;

            const property = line.substring(0, separatorIndex);
            const value = line.substring(colonIndex + 1);

            // Handle component boundaries
            if (property === 'BEGIN') {
                if (value === 'VEVENT') {
                    inEvent = true;
                    currentEvent = this.createEmptyEvent();
                } else if (value === 'VALARM') {
                    inAlarm = true;
                }
            } else if (property === 'END') {
                if (value === 'VEVENT' && currentEvent) {
                    events.push(this.normalizeEvent(currentEvent));
                    currentEvent = null;
                    inEvent = false;
                } else if (value === 'VALARM') {
                    inAlarm = false;
                }
            } else if (inEvent && !inAlarm && currentEvent) {
                // Parse event properties
                this.parseProperty(property, value, currentEvent);
            }
        }

        return events;
    }

    /**
     * Export events to ICS format
     * @param {Array} events - Array of event objects
     * @param {string} calendarName - Name of the calendar
     * @returns {string} ICS formatted string
     */
    export(events, calendarName = 'Lightning Calendar') {
        const lines = [];

        // Calendar header
        lines.push('BEGIN:VCALENDAR');
        lines.push('VERSION:2.0');
        lines.push('PRODID:-//Force Calendar Core//EN');
        lines.push(`X-WR-CALNAME:${calendarName}`);
        lines.push('METHOD:PUBLISH');

        // Add each event
        for (const event of events) {
            lines.push(...this.eventToICS(event));
        }

        // Calendar footer
        lines.push('END:VCALENDAR');

        // Fold long lines and join
        return this.foldLines(lines).join('\r\n');
    }

    /**
     * Convert single event to ICS lines
     * @private
     */
    eventToICS(event) {
        const lines = [];
        lines.push('BEGIN:VEVENT');

        // UID (required)
        lines.push(`UID:${event.id || this.generateUID()}`);

        // Timestamps
        lines.push(`DTSTAMP:${this.formatDate(new Date())}`);

        // Start and end dates
        if (event.allDay) {
            lines.push(`DTSTART;VALUE=DATE:${this.formatDate(event.start, true)}`);
            if (event.end) {
                lines.push(`DTEND;VALUE=DATE:${this.formatDate(event.end, true)}`);
            }
        } else {
            const tzid = event.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
            lines.push(`DTSTART;TZID=${tzid}:${this.formatDate(event.start)}`);
            if (event.end) {
                lines.push(`DTEND;TZID=${tzid}:${this.formatDate(event.end)}`);
            }
        }

        // Basic properties
        if (event.title) lines.push(`SUMMARY:${this.escapeText(event.title)}`);
        if (event.description) lines.push(`DESCRIPTION:${this.escapeText(event.description)}`);
        if (event.location) lines.push(`LOCATION:${this.escapeText(event.location)}`);

        // Status
        if (event.status) {
            const statusMap = {
                'tentative': 'TENTATIVE',
                'confirmed': 'CONFIRMED',
                'cancelled': 'CANCELLED'
            };
            lines.push(`STATUS:${statusMap[event.status] || 'CONFIRMED'}`);
        }

        // Show as
        if (event.showAs) {
            const transpMap = {
                'busy': 'OPAQUE',
                'free': 'TRANSPARENT'
            };
            lines.push(`TRANSP:${transpMap[event.showAs] || 'OPAQUE'}`);
        }

        // Categories
        if (event.category) {
            lines.push(`CATEGORIES:${event.category}`);
        }

        // Organizer
        if (event.organizer) {
            const org = typeof event.organizer === 'string'
                ? event.organizer
                : event.organizer.email || event.organizer.name;
            lines.push(`ORGANIZER:mailto:${org}`);
        }

        // Attendees
        if (event.attendees && event.attendees.length > 0) {
            for (const attendee of event.attendees) {
                const email = attendee.email || attendee;
                if (email) {
                    lines.push(`ATTENDEE:mailto:${email}`);
                }
            }
        }

        // Recurrence
        if (event.recurrence) {
            if (typeof event.recurrence === 'string') {
                // Already in RRULE format
                if (event.recurrence.startsWith('RRULE:')) {
                    lines.push(event.recurrence);
                } else {
                    lines.push(`RRULE:${event.recurrence}`);
                }
            } else if (typeof event.recurrence === 'object') {
                // Convert object to RRULE
                lines.push(`RRULE:${this.objectToRRule(event.recurrence)}`);
            }
        }

        // Reminders/Alarms
        if (event.reminders && event.reminders.length > 0) {
            for (const reminder of event.reminders) {
                lines.push('BEGIN:VALARM');
                lines.push('ACTION:DISPLAY');
                lines.push(`TRIGGER:-PT${reminder.minutes || 15}M`);
                lines.push(`DESCRIPTION:${event.title || 'Reminder'}`);
                lines.push('END:VALARM');
            }
        }

        lines.push('END:VEVENT');
        return lines;
    }

    /**
     * Parse ICS property into event object
     * @private
     */
    parseProperty(property, value, event) {
        // Extract actual property name (before parameters)
        const propName = property.split(';')[0];

        // Map to event property
        const eventProp = this.propertyMap[propName];
        if (!eventProp) return;

        switch (propName) {
            case 'DTSTART':
            case 'DTEND':
                event[eventProp] = this.parseDate(value, property);
                if (property.includes('VALUE=DATE')) {
                    event.allDay = true;
                }
                break;

            case 'SUMMARY':
            case 'DESCRIPTION':
            case 'LOCATION':
                event[eventProp] = this.unescapeText(value);
                break;

            case 'UID':
                event.id = value;
                break;

            case 'CATEGORIES':
                event.category = value.split(',')[0]; // Take first category
                break;

            case 'STATUS':
                const statusMap = {
                    'TENTATIVE': 'tentative',
                    'CONFIRMED': 'confirmed',
                    'CANCELLED': 'cancelled'
                };
                event.status = statusMap[value] || 'confirmed';
                break;

            case 'TRANSP':
                event.showAs = value === 'TRANSPARENT' ? 'free' : 'busy';
                break;

            case 'ORGANIZER':
                event.organizer = value.replace('mailto:', '');
                break;

            case 'ATTENDEE':
                if (!event.attendees) event.attendees = [];
                const email = value.replace('mailto:', '');
                event.attendees.push({
                    email: email,
                    name: email.split('@')[0] // Use email prefix as name
                });
                break;

            case 'RRULE':
                event.recurrence = value;
                break;
        }
    }

    /**
     * Parse ICS date string
     * @private
     */
    parseDate(dateString, property = '') {
        // Remove timezone if present
        dateString = dateString.replace(/^TZID=[^:]+:/, '');

        // Check if it's a date-only value
        if (property.includes('VALUE=DATE') || dateString.length === 8) {
            // YYYYMMDD format
            const year = dateString.substr(0, 4);
            const month = dateString.substr(4, 2);
            const day = dateString.substr(6, 2);
            return new Date(year, month - 1, day);
        }

        // Full datetime: YYYYMMDDTHHMMSS[Z]
        const year = parseInt(dateString.substr(0, 4));
        const month = parseInt(dateString.substr(4, 2)) - 1;
        const day = parseInt(dateString.substr(6, 2));
        const hour = parseInt(dateString.substr(9, 2)) || 0;
        const minute = parseInt(dateString.substr(11, 2)) || 0;
        const second = parseInt(dateString.substr(13, 2)) || 0;

        if (dateString.endsWith('Z')) {
            // UTC time
            return new Date(Date.UTC(year, month, day, hour, minute, second));
        } else {
            // Local time
            return new Date(year, month, day, hour, minute, second);
        }
    }

    /**
     * Format date for ICS
     * @private
     */
    formatDate(date, dateOnly = false) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        if (dateOnly) {
            return `${year}${month}${day}`;
        }

        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        const second = String(date.getSeconds()).padStart(2, '0');

        return `${year}${month}${day}T${hour}${minute}${second}`;
    }

    /**
     * Unfold ICS lines (reverse line folding)
     * @private
     */
    unfoldLines(icsString) {
        return icsString
            .replace(/\r\n /g, '')
            .replace(/\n /g, '')
            .split(/\r?\n/);
    }

    /**
     * Fold long lines per ICS spec
     * @private
     */
    foldLines(lines) {
        return lines.map(line => {
            if (line.length <= this.maxLineLength) {
                return line;
            }

            const folded = [];
            let remaining = line;

            // First line
            folded.push(remaining.substr(0, this.maxLineLength));
            remaining = remaining.substr(this.maxLineLength);

            // Continuation lines (with space prefix)
            while (remaining.length > 0) {
                const chunk = remaining.substr(0, this.maxLineLength - 1);
                folded.push(' ' + chunk);
                remaining = remaining.substr(chunk.length);
            }

            return folded.join('\r\n');
        }).flat();
    }

    /**
     * Escape special characters for ICS
     * @private
     */
    escapeText(text) {
        if (!text) return '';
        return text
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');
    }

    /**
     * Unescape ICS text
     * @private
     */
    unescapeText(text) {
        if (!text) return '';
        return text
            .replace(/\\n/g, '\n')
            .replace(/\\,/g, ',')
            .replace(/\\;/g, ';')
            .replace(/\\\\/g, '\\');
    }

    /**
     * Generate unique ID
     * @private
     */
    generateUID() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 9);
        return `${timestamp}-${random}@lightning-calendar`;
    }

    /**
     * Create empty event object
     * @private
     */
    createEmptyEvent() {
        return {
            id: null,
            title: '',
            description: '',
            start: null,
            end: null,
            allDay: false,
            location: '',
            category: '',
            status: 'confirmed',
            showAs: 'busy',
            attendees: [],
            reminders: []
        };
    }

    /**
     * Normalize event object
     * @private
     */
    normalizeEvent(event) {
        // Ensure required fields
        if (!event.id) {
            event.id = this.generateUID();
        }

        if (!event.title) {
            event.title = 'Untitled Event';
        }

        // Convert dates to Date objects if needed
        if (event.start && !(event.start instanceof Date)) {
            event.start = new Date(event.start);
        }

        if (event.end && !(event.end instanceof Date)) {
            event.end = new Date(event.end);
        }

        return event;
    }

    /**
     * Convert recurrence object to RRULE string
     * @private
     */
    objectToRRule(recurrence) {
        const parts = [];

        if (recurrence.freq) parts.push(`FREQ=${recurrence.freq.toUpperCase()}`);
        if (recurrence.interval) parts.push(`INTERVAL=${recurrence.interval}`);
        if (recurrence.count) parts.push(`COUNT=${recurrence.count}`);
        if (recurrence.until) parts.push(`UNTIL=${this.formatDate(recurrence.until)}`);
        if (recurrence.byDay) parts.push(`BYDAY=${recurrence.byDay.join(',')}`);
        if (recurrence.byMonth) parts.push(`BYMONTH=${recurrence.byMonth.join(',')}`);

        return parts.join(';');
    }
}