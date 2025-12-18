import { LightningElement, api } from 'lwc';

export default class LightningCalendarListView extends LightningElement {
    @api viewData;

    get totalEventsText() {
        const count = this.viewData?.totalEvents || 0;
        return `${count} event${count !== 1 ? 's' : ''} in the next 30 days`;
    }

    get days() {
        if (!this.viewData?.days) return [];

        return this.viewData.days.map(day => ({
            ...day,
            dayHeaderClass: day.isToday ? 'list-day-header today' : 'list-day-header',
            formattedDate: day.date.toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }),
            events: day.events.map(event => ({
                ...event,
                classes: this.getEventClasses(event),
                timeDisplay: this.formatEventTime(event),
                hasLocation: !!event.location
            }))
        }));
    }

    getEventClasses(event) {
        const classes = ['list-event'];
        if (event.metadata?.colorClass) {
            classes.push(event.metadata.colorClass);
        }
        return classes.join(' ');
    }

    formatEventTime(event) {
        if (event.allDay) {
            return 'All day';
        }

        const start = event.start.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit'
        });
        const end = event.end.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit'
        });
        return `${start} - ${end}`;
    }

    handleEventClick(event) {
        const eventId = event.currentTarget.dataset.eventId;
        if (eventId) {
            this.dispatchEvent(new CustomEvent('eventclick', {
                bubbles: true,
                composed: true,
                detail: { eventId }
            }));
        }
    }
}
