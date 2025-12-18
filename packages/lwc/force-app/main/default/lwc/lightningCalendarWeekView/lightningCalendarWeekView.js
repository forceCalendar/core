import { LightningElement, api } from 'lwc';

export default class LightningCalendarWeekView extends LightningElement {
    @api viewData;

    get dayHeaders() {
        if (!this.viewData?.days) return [];

        return this.viewData.days.map(day => ({
            ...day,
            dayName: day.dayName?.slice(0, 3) || '',
            dayNumber: day.date.getDate(),
            isToday: day.isToday,
            headerClass: day.isToday ? 'day-header today' : 'day-header'
        }));
    }

    get hours() {
        const hours = [];
        for (let hour = 0; hour < 24; hour++) {
            hours.push({
                hour,
                label: this.formatHour(hour),
                days: this.viewData?.days?.map(day => ({
                    date: day.date,
                    hour,
                    events: this.getEventsForHour(day, hour)
                })) || []
            });
        }
        return hours;
    }

    formatHour(hour) {
        if (hour === 0) return '12 AM';
        if (hour < 12) return `${hour} AM`;
        if (hour === 12) return '12 PM';
        return `${hour - 12} PM`;
    }

    getEventsForHour(day, hour) {
        if (!day.events) return [];

        return day.events.filter(event => {
            if (event.allDay) return false;
            const eventHour = event.start.getHours();
            return eventHour === hour;
        }).map(event => ({
            ...event,
            classes: this.getEventClasses(event)
        }));
    }

    getEventClasses(event) {
        const classes = ['week-event'];
        if (event.metadata?.colorClass) {
            classes.push(event.metadata.colorClass);
        }
        return classes.join(' ');
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

    handleTimeSlotClick(event) {
        const date = event.currentTarget.dataset.date;
        const hour = event.currentTarget.dataset.hour;
        if (date && hour) {
            this.dispatchEvent(new CustomEvent('dateclick', {
                bubbles: true,
                composed: true,
                detail: { date, hour }
            }));
        }
    }
}
