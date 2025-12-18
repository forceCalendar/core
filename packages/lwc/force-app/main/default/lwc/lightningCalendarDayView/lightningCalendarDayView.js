import { LightningElement, api } from 'lwc';

export default class LightningCalendarDayView extends LightningElement {
    @api viewData;

    get dayTitle() {
        if (!this.viewData?.date) return '';
        return this.viewData.dayName || '';
    }

    get dateDisplay() {
        if (!this.viewData?.date) return '';
        return this.viewData.date.toLocaleDateString();
    }

    get allDayEvents() {
        if (!this.viewData?.allDayEvents) return [];
        return this.viewData.allDayEvents.map(event => ({
            ...event,
            classes: this.getEventClasses(event)
        }));
    }

    get hasAllDayEvents() {
        return this.allDayEvents.length > 0;
    }

    get hours() {
        if (!this.viewData?.hours) return [];

        return this.viewData.hours.map(hourSlot => ({
            ...hourSlot,
            events: hourSlot.events.map(event => ({
                ...event,
                classes: this.getEventClasses(event),
                timeDisplay: this.formatEventTime(event)
            }))
        }));
    }

    getEventClasses(event) {
        const classes = ['day-event'];
        if (event.metadata?.colorClass) {
            classes.push(event.metadata.colorClass);
        }
        return classes.join(' ');
    }

    formatEventTime(event) {
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
        event.stopPropagation();
        const eventId = event.currentTarget.dataset.eventId;
        if (eventId) {
            this.dispatchEvent(new CustomEvent('eventclick', {
                bubbles: true,
                composed: true,
                detail: { eventId }
            }));
        }
    }

    handleTimeSlotClick(event) {
        const hour = event.currentTarget.dataset.hour;
        if (hour && this.viewData?.date) {
            this.dispatchEvent(new CustomEvent('dateclick', {
                bubbles: true,
                composed: true,
                detail: { date: this.viewData.date, hour }
            }));
        }
    }
}
