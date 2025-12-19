/**
 * VanillaDOMRenderer - Pure JavaScript DOM renderer
 * No framework dependencies, Locker Service compatible
 */
export class VanillaDOMRenderer {
  constructor(container, calendar) {
    if (!container) {
      throw new Error('Container element is required');
    }

    this.container = container;
    this.calendar = calendar;

    // Bind methods for event listeners
    this.handleEventClick = this.handleEventClick.bind(this);
    this.handleDateClick = this.handleDateClick.bind(this);
    this.handleNavigation = this.handleNavigation.bind(this);

    // Set up calendar listeners
    this.setupListeners();

    // Initial render
    this.render();
  }

  /**
   * Set up calendar event listeners
   */
  setupListeners() {
    // Only re-render on significant changes
    this.calendar.on('navigate', () => this.render());
    this.calendar.on('viewChange', () => this.render());
    this.calendar.on('eventStoreChange', (change) => {
      // Only re-render for significant event changes
      if (change.type !== 'update' || this.shouldRerender(change)) {
        this.render();
      }
    });

    // Handle selection changes without full re-render
    this.calendar.on('eventSelect', (data) => this.highlightEvent(data.event.id));
    this.calendar.on('dateSelect', (data) => this.highlightDate(data.date));
  }

  /**
   * Determine if a change requires full re-render
   */
  shouldRerender(change) {
    if (!change.oldEvent || !change.event) return true;

    // Check if visual properties changed
    return change.oldEvent.title !== change.event.title ||
           change.oldEvent.start.getTime() !== change.event.start.getTime() ||
           change.oldEvent.end.getTime() !== change.event.end.getTime();
  }

  /**
   * Main render method
   */
  render() {
    const viewData = this.calendar.getViewData();

    // Clear container
    this.container.innerHTML = '';

    // Add calendar wrapper
    const wrapper = this.createElement('div', 'calendar-wrapper');

    // Render header
    wrapper.appendChild(this.renderHeader());

    // Render view based on type
    switch (viewData.type) {
      case 'month':
        wrapper.appendChild(this.renderMonthView(viewData));
        break;
      case 'week':
        wrapper.appendChild(this.renderWeekView(viewData));
        break;
      case 'day':
        wrapper.appendChild(this.renderDayView(viewData));
        break;
      case 'list':
        wrapper.appendChild(this.renderListView(viewData));
        break;
    }

    this.container.appendChild(wrapper);

    // Set up event delegation
    this.setupEventDelegation();
  }

  /**
   * Render calendar header with navigation
   */
  renderHeader() {
    const header = this.createElement('div', 'calendar-header');

    // Navigation controls
    const navigation = this.createElement('div', 'calendar-navigation');

    // Previous button
    const prevBtn = this.createElement('button', 'calendar-nav-btn');
    prevBtn.innerHTML = '<span class="nav-icon">←</span> Previous';
    prevBtn.setAttribute('data-action', 'previous');
    prevBtn.setAttribute('aria-label', 'Previous');
    navigation.appendChild(prevBtn);

    // Today button
    const todayBtn = this.createElement('button', 'calendar-nav-btn calendar-nav-today', 'Today');
    todayBtn.setAttribute('data-action', 'today');
    navigation.appendChild(todayBtn);

    // Next button
    const nextBtn = this.createElement('button', 'calendar-nav-btn');
    nextBtn.innerHTML = 'Next <span class="nav-icon">→</span>';
    nextBtn.setAttribute('data-action', 'next');
    nextBtn.setAttribute('aria-label', 'Next');
    navigation.appendChild(nextBtn);

    header.appendChild(navigation);

    // Title
    const title = this.createElement('h2', 'calendar-title');
    const viewData = this.calendar.getViewData();

    if (viewData.type === 'month') {
      title.textContent = `${viewData.monthName} ${viewData.year}`;
    } else if (viewData.type === 'week') {
      const startDate = viewData.startDate;
      const endDate = viewData.endDate;
      title.textContent = `Week ${viewData.weekNumber}`;
    } else if (viewData.type === 'day') {
      title.textContent = viewData.date.toLocaleDateString();
    }

    header.appendChild(title);

    // View switcher
    const viewSwitcher = this.createElement('div', 'calendar-view-switcher');
    const views = ['month', 'week', 'day', 'list'];

    views.forEach(view => {
      const btn = this.createElement('button', 'calendar-view-btn', view);
      btn.setAttribute('data-view', view);
      if (view === this.calendar.getView()) {
        btn.classList.add('active');
      }
      viewSwitcher.appendChild(btn);
    });

    header.appendChild(viewSwitcher);

    return header;
  }

  /**
   * Render month view
   */
  renderMonthView(viewData) {
    const monthGrid = this.createElement('div', 'calendar-month-grid');

    // Day headers
    const dayHeaders = this.createElement('div', 'calendar-day-headers');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    dayNames.forEach(dayName => {
      const header = this.createElement('div', 'calendar-day-header', dayName);
      dayHeaders.appendChild(header);
    });

    monthGrid.appendChild(dayHeaders);

    // Weeks
    const weeksContainer = this.createElement('div', 'calendar-weeks');

    viewData.weeks.forEach(week => {
      const weekRow = this.createElement('div', 'calendar-week');

      week.days.forEach(day => {
        const dayCell = this.createElement('div', 'calendar-day');

        // Add classes
        if (!day.isCurrentMonth) {
          dayCell.classList.add('other-month');
        }
        if (day.isToday) {
          dayCell.classList.add('today');
        }
        if (day.isWeekend) {
          dayCell.classList.add('weekend');
        }

        // Set data attributes - use local date string to avoid timezone issues
        const year = day.date.getFullYear();
        const month = String(day.date.getMonth() + 1).padStart(2, '0');
        const dayOfMonth = String(day.date.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${dayOfMonth}`;

        // DEBUG: Log date rendering info
        console.log(`[RENDER] Day ${day.dayOfMonth}: date object =`, day.date, `stored as data-date="${dateStr}"`);

        dayCell.setAttribute('data-date', dateStr);

        // DEBUG: Log mismatch
        if (day.dayOfMonth !== day.date.getDate()) {
          console.warn(`Date mismatch! dayOfMonth: ${day.dayOfMonth}, date.getDate(): ${day.date.getDate()}, stored: ${dateStr}`);
        }

        // Day number
        const dayNumber = this.createElement('div', 'calendar-day-number', day.dayOfMonth.toString());
        dayCell.appendChild(dayNumber);

        // Events
        if (day.events.length > 0) {
          const eventsContainer = this.createElement('div', 'calendar-day-events');

          // Show max 3 events, then "+X more"
          const visibleEvents = day.events.slice(0, 3);
          const moreCount = day.events.length - 3;

          visibleEvents.forEach(event => {
            const eventEl = this.createElement('div', 'calendar-event');
            eventEl.textContent = event.title;
            eventEl.setAttribute('data-event-id', event.id);

            // Apply color class from metadata or use default colors
            if (event.metadata && event.metadata.colorClass) {
              eventEl.classList.add(event.metadata.colorClass);
            } else if (event.backgroundColor) {
              eventEl.style.backgroundColor = event.backgroundColor;
            }
            if (event.textColor) {
              eventEl.style.color = event.textColor;
            }

            // Add all-day class if applicable
            if (event.allDay) {
              eventEl.classList.add('all-day');
            }

            eventsContainer.appendChild(eventEl);
          });

          if (moreCount > 0) {
            const moreEl = this.createElement('div', 'calendar-event-more', `+${moreCount} more`);
            eventsContainer.appendChild(moreEl);
          }

          dayCell.appendChild(eventsContainer);
        }

        weekRow.appendChild(dayCell);
      });

      weeksContainer.appendChild(weekRow);
    });

    monthGrid.appendChild(weeksContainer);

    return monthGrid;
  }

  /**
   * Render week view
   */
  renderWeekView(viewData) {
    const weekGrid = this.createElement('div', 'calendar-week-grid');

    // Day headers
    const dayHeaders = this.createElement('div', 'calendar-week-headers');

    viewData.days.forEach(day => {
      const header = this.createElement('div', 'calendar-week-header');
      const dayName = day.dayName.slice(0, 3);
      const dayNumber = day.date.getDate();
      header.innerHTML = `<div>${dayName}</div><div class="day-number">${dayNumber}</div>`;

      if (day.isToday) {
        header.classList.add('today');
      }

      dayHeaders.appendChild(header);
    });

    weekGrid.appendChild(dayHeaders);

    // Time slots
    const timeGrid = this.createElement('div', 'calendar-time-grid');

    // Generate hourly slots
    for (let hour = 0; hour < 24; hour++) {
      const timeRow = this.createElement('div', 'calendar-time-row');

      // Time label
      const timeLabel = this.createElement('div', 'calendar-time-label');
      const hourDisplay = hour === 0 ? '12 AM' :
                         hour < 12 ? `${hour} AM` :
                         hour === 12 ? '12 PM' :
                         `${hour - 12} PM`;
      timeLabel.textContent = hourDisplay;
      timeRow.appendChild(timeLabel);

      // Day cells
      viewData.days.forEach(day => {
        const timeCell = this.createElement('div', 'calendar-time-cell');
        timeCell.setAttribute('data-date', day.date.toISOString());
        timeCell.setAttribute('data-hour', hour);

        // Add events for this hour
        const hourEvents = day.events.filter(event => {
          if (event.allDay) return false;
          return event.start.getHours() === hour;
        });

        hourEvents.forEach(event => {
          const eventEl = this.createElement('div', 'calendar-week-event');
          eventEl.textContent = event.title;
          eventEl.setAttribute('data-event-id', event.id);

          if (event.backgroundColor) {
            eventEl.style.backgroundColor = event.backgroundColor;
          }

          timeCell.appendChild(eventEl);
        });

        timeRow.appendChild(timeCell);
      });

      timeGrid.appendChild(timeRow);
    }

    weekGrid.appendChild(timeGrid);

    return weekGrid;
  }

  /**
   * Render day view
   */
  renderDayView(viewData) {
    const dayContainer = this.createElement('div', 'calendar-day-view');

    // Day header
    const dayHeader = this.createElement('div', 'calendar-day-header');
    dayHeader.innerHTML = `
      <h3>${viewData.dayName}</h3>
      <div class="date-display">${viewData.date.toLocaleDateString()}</div>
    `;
    if (viewData.isToday) {
      dayHeader.classList.add('today');
    }
    dayContainer.appendChild(dayHeader);

    // All-day events
    if (viewData.allDayEvents.length > 0) {
      const allDaySection = this.createElement('div', 'calendar-allday-section');
      const allDayLabel = this.createElement('div', 'calendar-allday-label', 'All Day');
      allDaySection.appendChild(allDayLabel);

      const allDayEvents = this.createElement('div', 'calendar-allday-events');
      viewData.allDayEvents.forEach(event => {
        const eventEl = this.createElement('div', 'calendar-allday-event');
        eventEl.textContent = event.title;
        eventEl.setAttribute('data-event-id', event.id);
        allDayEvents.appendChild(eventEl);
      });
      allDaySection.appendChild(allDayEvents);

      dayContainer.appendChild(allDaySection);
    }

    // Hourly timeline
    const timeline = this.createElement('div', 'calendar-day-timeline');

    viewData.hours.forEach(hour => {
      const hourRow = this.createElement('div', 'calendar-hour-row');

      // Time label
      const timeLabel = this.createElement('div', 'calendar-hour-label', hour.time);
      hourRow.appendChild(timeLabel);

      // Events container
      const eventsContainer = this.createElement('div', 'calendar-hour-events');

      hour.events.forEach(event => {
        const eventEl = this.createElement('div', 'calendar-hour-event');
        eventEl.textContent = `${event.title} (${this.formatEventTime(event)})`;
        eventEl.setAttribute('data-event-id', event.id);

        if (event.backgroundColor) {
          eventEl.style.backgroundColor = event.backgroundColor;
        }

        eventsContainer.appendChild(eventEl);
      });

      hourRow.appendChild(eventsContainer);
      timeline.appendChild(hourRow);
    });

    dayContainer.appendChild(timeline);

    return dayContainer;
  }

  /**
   * Render list view
   */
  renderListView(viewData) {
    const listContainer = this.createElement('div', 'calendar-list-view');

    // Summary
    const summary = this.createElement('div', 'calendar-list-summary');
    summary.textContent = `${viewData.totalEvents} events in the next 30 days`;
    listContainer.appendChild(summary);

    // Days list
    const daysList = this.createElement('div', 'calendar-list-days');

    viewData.days.forEach(day => {
      const daySection = this.createElement('div', 'calendar-list-day');

      // Day header
      const dayHeader = this.createElement('div', 'calendar-list-day-header');
      dayHeader.innerHTML = `
        <div class="day-name">${day.dayName}</div>
        <div class="day-date">${day.date.toLocaleDateString()}</div>
      `;
      if (day.isToday) {
        dayHeader.classList.add('today');
      }
      daySection.appendChild(dayHeader);

      // Events
      const eventsList = this.createElement('div', 'calendar-list-events');

      day.events.forEach(event => {
        const eventItem = this.createElement('div', 'calendar-list-event');
        eventItem.setAttribute('data-event-id', event.id);

        const timeSpan = this.createElement('span', 'event-time', this.formatEventTime(event));
        const titleSpan = this.createElement('span', 'event-title', event.title);

        eventItem.appendChild(timeSpan);
        eventItem.appendChild(titleSpan);

        if (event.location) {
          const locationSpan = this.createElement('span', 'event-location', event.location);
          eventItem.appendChild(locationSpan);
        }

        eventsList.appendChild(eventItem);
      });

      daySection.appendChild(eventsList);
      daysList.appendChild(daySection);
    });

    listContainer.appendChild(daysList);

    return listContainer;
  }

  /**
   * Set up event delegation
   */
  setupEventDelegation() {
    // Remove previous listener if exists
    if (this.clickHandler) {
      this.container.removeEventListener('click', this.clickHandler);
    }

    // Create new click handler
    this.clickHandler = (e) => {
      const target = e.target;

      // Navigation buttons
      const navBtn = target.closest('[data-action]');
      if (navBtn) {
        const action = navBtn.getAttribute('data-action');
        this.handleNavigation(action);
        return;
      }

      // View switcher
      const viewBtn = target.closest('[data-view]');
      if (viewBtn) {
        const view = viewBtn.getAttribute('data-view');
        this.calendar.setView(view);
        return;
      }

      // Event click
      const eventEl = target.closest('[data-event-id]');
      if (eventEl) {
        const eventId = eventEl.getAttribute('data-event-id');
        this.handleEventClick(eventId);
        return;
      }

      // Date click
      const dateEl = target.closest('[data-date]');
      if (dateEl && !eventEl) {
        const dateStr = dateEl.getAttribute('data-date'); // YYYY-MM-DD format
        console.log('[CLICK] Clicked data-date attribute value:', dateStr);

        // Parse date in local timezone to avoid UTC conversion issues
        const [year, month, day] = dateStr.split('-').map(Number);
        const localDate = new Date(year, month - 1, day);
        console.log('[CLICK] Split into parts - year:', year, 'month:', month, 'day:', day);
        console.log('[CLICK] Created Date object:', localDate);
        console.log('[CLICK] Date.getDate():', localDate.getDate(), 'Date.getMonth():', localDate.getMonth(), 'Date.getFullYear():', localDate.getFullYear());

        this.handleDateClick(localDate);
        return;
      }
    };

    this.container.addEventListener('click', this.clickHandler);
  }

  /**
   * Handle navigation actions
   */
  handleNavigation(action) {
    switch (action) {
      case 'previous':
        this.calendar.previous();
        break;
      case 'next':
        this.calendar.next();
        break;
      case 'today':
        this.calendar.today();
        break;
    }
  }

  /**
   * Handle event click
   */
  handleEventClick(eventId) {
    const event = this.calendar.getEvent(eventId);
    if (!event) return;

    // Don't select and log, show event details
    this.showEventDetails(event);
  }

  /**
   * Handle date click
   */
  handleDateClick(date) {
    // Show create event dialog for this date
    this.showCreateEventDialog(date);
  }

  /**
   * Highlight an event without re-rendering
   */
  highlightEvent(eventId) {
    // Remove previous highlights
    this.container.querySelectorAll('.calendar-event.selected').forEach(el => {
      el.classList.remove('selected');
    });

    // Add highlight to selected event
    this.container.querySelectorAll(`[data-event-id="${eventId}"]`).forEach(el => {
      el.classList.add('selected');
    });
  }

  /**
   * Highlight a date without re-rendering
   */
  highlightDate(date) {
    // Remove previous highlights
    this.container.querySelectorAll('.calendar-day.selected').forEach(el => {
      el.classList.remove('selected');
    });

    // Add highlight to selected date
    const dateStr = date.toISOString();
    this.container.querySelectorAll(`[data-date="${dateStr}"]`).forEach(el => {
      el.classList.add('selected');
    });
  }

  /**
   * Show event details in a modal
   */
  showEventDetails(event) {
    // Remove existing modal if any
    this.removeModal();

    const modal = this.createElement('div', 'calendar-modal');
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3>Event Details</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="event-detail">
            <label>Title</label>
            <div class="event-detail-value">${event.title}</div>
          </div>
          <div class="event-detail">
            <label>Date & Time</label>
            <div class="event-detail-value">
              ${event.allDay ? 'All Day' : ''}
              ${event.start.toLocaleDateString()}
              ${!event.allDay ? `${event.start.toLocaleTimeString()} - ${event.end.toLocaleTimeString()}` : ''}
            </div>
          </div>
          ${event.location ? `
            <div class="event-detail">
              <label>Location</label>
              <div class="event-detail-value">${event.location}</div>
            </div>
          ` : ''}
          ${event.description ? `
            <div class="event-detail">
              <label>Description</label>
              <div class="event-detail-value">${event.description}</div>
            </div>
          ` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-action="edit">Edit</button>
          <button class="btn btn-danger" data-action="delete">Delete</button>
          <button class="btn btn-primary" data-action="close">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event handlers
    modal.querySelector('.modal-close').onclick = () => this.removeModal();
    modal.querySelector('.modal-backdrop').onclick = () => this.removeModal();

    modal.querySelector('[data-action="close"]').onclick = () => this.removeModal();

    modal.querySelector('[data-action="delete"]').onclick = () => {
      if (confirm('Are you sure you want to delete this event?')) {
        this.calendar.removeEvent(event.id);
        this.removeModal();
      }
    };

    modal.querySelector('[data-action="edit"]').onclick = () => {
      this.removeModal();
      this.showEditEventDialog(event);
    };
  }

  /**
   * Show create event dialog
   */
  showCreateEventDialog(date) {
    console.log('[MODAL] showCreateEventDialog called with date:', date);
    console.log('[MODAL] date.getFullYear():', date.getFullYear());
    console.log('[MODAL] date.getMonth():', date.getMonth(), '(0-indexed, so add 1 for display)');
    console.log('[MODAL] date.getDate():', date.getDate());

    const inputValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    console.log('[MODAL] Input field value will be set to:', inputValue);

    // Remove existing modal if any
    this.removeModal();

    const modal = this.createElement('div', 'calendar-modal');
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3>New Event</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <form id="create-event-form">
            <div class="form-group">
              <label for="event-title">Title *</label>
              <input type="text" id="event-title" class="form-control" required>
            </div>
            <div class="form-group">
              <label for="event-date">Date *</label>
              <input type="date" id="event-date" class="form-control" value="${inputValue}" required>
            </div>
            <div class="form-group">
              <label>
                <input type="checkbox" id="event-allday"> All Day Event
              </label>
            </div>
            <div class="form-row" id="time-inputs">
              <div class="form-group">
                <label for="event-start">Start Time</label>
                <input type="time" id="event-start" class="form-control" value="09:00">
              </div>
              <div class="form-group">
                <label for="event-end">End Time</label>
                <input type="time" id="event-end" class="form-control" value="10:00">
              </div>
            </div>
            <div class="form-group">
              <label for="event-location">Location</label>
              <input type="text" id="event-location" class="form-control" placeholder="Optional">
            </div>
            <div class="form-group">
              <label for="event-description">Description</label>
              <textarea id="event-description" class="form-control" rows="3" placeholder="Optional"></textarea>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-action="cancel">Cancel</button>
          <button class="btn btn-primary" data-action="save">Create Event</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Handle all-day toggle
    const allDayCheckbox = modal.querySelector('#event-allday');
    const timeInputs = modal.querySelector('#time-inputs');

    allDayCheckbox.onchange = () => {
      timeInputs.style.display = allDayCheckbox.checked ? 'none' : 'flex';
    };

    // Event handlers
    modal.querySelector('.modal-close').onclick = () => this.removeModal();
    modal.querySelector('.modal-backdrop').onclick = () => this.removeModal();
    modal.querySelector('[data-action="cancel"]').onclick = () => this.removeModal();

    modal.querySelector('[data-action="save"]').onclick = () => {
      const form = modal.querySelector('#create-event-form');
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const title = modal.querySelector('#event-title').value;
      const dateStr = modal.querySelector('#event-date').value;
      const allDay = modal.querySelector('#event-allday').checked;
      const location = modal.querySelector('#event-location').value;
      const description = modal.querySelector('#event-description').value;

      let start, end;

      if (allDay) {
        start = new Date(dateStr);
        start.setHours(0, 0, 0, 0);
        end = new Date(dateStr);
        end.setHours(23, 59, 59, 999);
      } else {
        const startTime = modal.querySelector('#event-start').value;
        const endTime = modal.querySelector('#event-end').value;

        start = new Date(`${dateStr}T${startTime}`);
        end = new Date(`${dateStr}T${endTime}`);
      }

      const newEvent = {
        id: `event-${Date.now()}`,
        title,
        start,
        end,
        allDay,
        location,
        description,
        metadata: {
          colorClass: 'event-blue'
        }
      };

      this.calendar.addEvent(newEvent);
      this.removeModal();
    };

    // Focus on title input
    modal.querySelector('#event-title').focus();
  }

  /**
   * Show edit event dialog
   */
  showEditEventDialog(event) {
    // Similar to create but pre-filled
    this.showCreateEventDialog(event.start);

    // Pre-fill the form
    setTimeout(() => {
      const modal = document.querySelector('.calendar-modal');
      if (modal) {
        modal.querySelector('h3').textContent = 'Edit Event';
        modal.querySelector('#event-title').value = event.title;
        modal.querySelector('#event-allday').checked = event.allDay;

        if (event.location) {
          modal.querySelector('#event-location').value = event.location;
        }

        if (event.description) {
          modal.querySelector('#event-description').value = event.description;
        }

        if (!event.allDay) {
          modal.querySelector('#event-start').value = event.start.toTimeString().slice(0, 5);
          modal.querySelector('#event-end').value = event.end.toTimeString().slice(0, 5);
        }

        // Change save button to update
        const saveBtn = modal.querySelector('[data-action="save"]');
        saveBtn.textContent = 'Update Event';
        saveBtn.onclick = () => {
          const form = modal.querySelector('#create-event-form');
          if (!form.checkValidity()) {
            form.reportValidity();
            return;
          }

          const updates = {
            title: modal.querySelector('#event-title').value,
            location: modal.querySelector('#event-location').value,
            description: modal.querySelector('#event-description').value,
            allDay: modal.querySelector('#event-allday').checked
          };

          this.calendar.updateEvent(event.id, updates);
          this.removeModal();
        };
      }
    }, 0);
  }

  /**
   * Remove modal from DOM
   */
  removeModal() {
    const modal = document.querySelector('.calendar-modal');
    if (modal) {
      modal.remove();
    }
  }

  /**
   * Format event time
   */
  formatEventTime(event) {
    if (event.allDay) {
      return 'All day';
    }

    const startTime = event.start.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit'
    });

    const endTime = event.end.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit'
    });

    return `${startTime} - ${endTime}`;
  }

  /**
   * Create an element with class and optional content
   */
  createElement(tag, className, content) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (content !== undefined) {
      element.textContent = content;
    }
    return element;
  }

  /**
   * Destroy the renderer
   */
  destroy() {
    if (this.clickHandler) {
      this.container.removeEventListener('click', this.clickHandler);
    }
    this.container.innerHTML = '';
  }
}