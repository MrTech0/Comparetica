/* src/js/components/date_range_picker.js */

export class M3DateRangePicker {
  constructor(containerId, onChangeCallback) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.input = this.container.querySelector('input');
    this.onChangeCallback = onChangeCallback;

    this.startDate = null;
    this.endDate = null;

    const today = new Date();
    this.currentMonth = today.getMonth();
    this.currentYear = today.getFullYear();

    this.isOpen = false;

    // Attach picker instance to container to reference it globally if needed
    this.container._picker = this;

    this.initDOM();
    this.bindEvents();
    this.render();
  }

  initDOM() {
    // Create dropdown element
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'm3-calendar-dropdown';
    this.dropdown.style.display = 'none';

    this.dropdown.innerHTML = `
      <div class="m3-calendar-header">
        <button class="m3-calendar-nav-btn prev-btn" type="button">
          <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        <div class="m3-calendar-selectors">
          <div class="m3-calendar-custom-select month-select-container">
            <button class="m3-calendar-select-trigger month-trigger" type="button">
              <span></span>
              <svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:currentColor;transition: transform var(--transition-fast);"><path d="M7 10l5 5 5-5z"/></svg>
            </button>
            <div class="m3-calendar-select-options month-options"></div>
          </div>
          <div class="m3-calendar-custom-select year-select-container">
            <button class="m3-calendar-select-trigger year-trigger" type="button">
              <span></span>
              <svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:currentColor;transition: transform var(--transition-fast);"><path d="M7 10l5 5 5-5z"/></svg>
            </button>
            <div class="m3-calendar-select-options year-options"></div>
          </div>
        </div>
        <button class="m3-calendar-nav-btn next-btn" type="button">
          <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </button>
      </div>
      <div class="m3-calendar-weekdays">
        <span>Lu</span><span>Ma</span><span>Mi</span><span>Ju</span><span>Vi</span><span>Sá</span><span>Do</span>
      </div>
      <div class="m3-calendar-days"></div>
      <div class="m3-calendar-footer">
        <button class="m3-btn m3-btn-text btn-clear" type="button" style="font-size: 12px; height: 28px; padding: 0 12px;">Limpiar</button>
        <button class="m3-btn btn-apply" type="button" style="font-size: 12px; height: 28px; padding: 0 12px;">Aplicar</button>
      </div>
    `;

    this.container.appendChild(this.dropdown);

    this.monthTrigger = this.dropdown.querySelector('.month-trigger span');
    this.monthOptions = this.dropdown.querySelector('.month-options');
    this.monthSelectContainer = this.dropdown.querySelector('.month-select-container');

    this.yearTrigger = this.dropdown.querySelector('.year-trigger span');
    this.yearOptions = this.dropdown.querySelector('.year-options');
    this.yearSelectContainer = this.dropdown.querySelector('.year-select-container');

    this.daysGrid = this.dropdown.querySelector('.m3-calendar-days');
    this.prevBtn = this.dropdown.querySelector('.prev-btn');
    this.nextBtn = this.dropdown.querySelector('.next-btn');
    this.clearBtn = this.dropdown.querySelector('.btn-clear');
    this.applyBtn = this.dropdown.querySelector('.btn-apply');
  }

  bindEvents() {
    // Toggle dropdown
    this.input.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    });

    // Prev/Next month
    this.prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.changeMonth(-1);
    });

    this.nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.changeMonth(1);
    });

    // Clear selection
    this.clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clear();
    });

    // Apply selection
    this.applyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.apply();
    });

    // Custom month/year selectors toggle
    const monthTriggerBtn = this.dropdown.querySelector('.month-trigger');
    const yearTriggerBtn = this.dropdown.querySelector('.year-trigger');

    monthTriggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.yearSelectContainer.classList.remove('open');
      this.monthSelectContainer.classList.toggle('open');
    });

    yearTriggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.monthSelectContainer.classList.remove('open');
      this.yearSelectContainer.classList.toggle('open');
    });

    // Prevent closing dropdown when clicking inside it
    this.dropdown.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Close dropdown on click outside
    document.addEventListener('click', () => {
      this.closeDropdown();
    });
  }

  toggleDropdown() {
    if (this.isOpen) {
      this.closeDropdown();
    } else {
      // Close other instances
      document.querySelectorAll('.m3-calendar-dropdown').forEach(d => {
        d.style.display = 'none';
        const p = d.parentNode;
        if (p && p._picker) p._picker.isOpen = false;
      });

      this.dropdown.style.display = 'block';
      this.isOpen = true;
      this.render();
    }
  }

  closeDropdown() {
    this.dropdown.style.display = 'none';
    this.isOpen = false;
    this.monthSelectContainer.classList.remove('open');
    this.yearSelectContainer.classList.remove('open');
  }

  changeMonth(direction) {
    this.currentMonth += direction;
    if (this.currentMonth < 0) {
      this.currentMonth = 11;
      this.currentYear--;
    } else if (this.currentMonth > 11) {
      this.currentMonth = 0;
      this.currentYear++;
    }
    this.render();
  }

  clear() {
    this.startDate = null;
    this.endDate = null;
    this.input.value = '';
    this.render();
    this.closeDropdown();
    if (this.onChangeCallback) {
      this.onChangeCallback(null, null);
    }
  }

  apply() {
    if (this.startDate && !this.endDate) {
      this.endDate = new Date(this.startDate);
    }
    this.updateInputText();
    this.closeDropdown();
    if (this.onChangeCallback) {
      this.onChangeCallback(this.startDate, this.endDate);
    }
  }

  updateInputText() {
    if (this.startDate && this.endDate) {
      const format = (d) => {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      };
      this.input.value = `${format(this.startDate)} - ${format(this.endDate)}`;
    } else {
      this.input.value = '';
    }
  }

  render() {
    // Render month custom options list
    this.monthOptions.innerHTML = '';
    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    monthNames.forEach((m, idx) => {
      const optEl = document.createElement('div');
      optEl.className = 'm3-calendar-select-option';
      if (idx === this.currentMonth) optEl.classList.add('active');
      optEl.textContent = m;
      optEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.currentMonth = idx;
        this.monthSelectContainer.classList.remove('open');
        this.render();
      });
      this.monthOptions.appendChild(optEl);
    });
    this.monthTrigger.textContent = monthNames[this.currentMonth];

    // Render year custom options list (from current selection - 5 to current system year)
    this.yearOptions.innerHTML = '';
    const currentYearNum = new Date().getFullYear();
    const years = [];
    const startYear = this.currentYear - 5;
    const endYear = Math.max(this.currentYear, currentYearNum);
    for (let y = startYear; y <= endYear; y++) {
      years.push(y);
    }

    years.forEach(y => {
      const optEl = document.createElement('div');
      optEl.className = 'm3-calendar-select-option';
      if (y === this.currentYear) optEl.classList.add('active');
      optEl.textContent = y;
      optEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.currentYear = y;
        this.yearSelectContainer.classList.remove('open');
        this.render();
      });
      this.yearOptions.appendChild(optEl);
    });
    this.yearTrigger.textContent = this.currentYear;

    this.daysGrid.innerHTML = '';

    // Calculate total days in current month
    const totalDays = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();

    // Calculate starting weekday (Mon = 0, Tue = 1 ... Sun = 6)
    let startDay = new Date(this.currentYear, this.currentMonth, 1).getDay();
    let startDayShifted = startDay === 0 ? 6 : startDay - 1;

    // Render padding cells for first week offset
    for (let i = 0; i < startDayShifted; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'm3-calendar-day empty';
      this.daysGrid.appendChild(emptyCell);
    }

    // Render active days
    const today = new Date();
    today.setHours(0,0,0,0);

    for (let day = 1; day <= totalDays; day++) {
      const dayEl = document.createElement('div');
      dayEl.className = 'm3-calendar-day';
      dayEl.textContent = day;

      const date = new Date(this.currentYear, this.currentMonth, day);
      date.setHours(0,0,0,0);

      // Check states
      const isToday = date.getTime() === today.getTime();
      if (isToday) dayEl.classList.add('is-today');

      const isStart = this.startDate && date.getTime() === this.startDate.getTime();
      const isEnd = this.endDate && date.getTime() === this.endDate.getTime();
      const inRange = this.startDate && this.endDate && date.getTime() > this.startDate.getTime() && date.getTime() < this.endDate.getTime();

      if (isStart) {
        dayEl.classList.add('active-start');
        if (this.endDate) dayEl.classList.add('has-range-end');
      }
      if (isEnd) {
        dayEl.classList.add('active-end');
        if (this.startDate) dayEl.classList.add('has-range-start');
      }
      if (inRange) {
        dayEl.classList.add('in-range');
      }

      dayEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectDate(date);
      });

      this.daysGrid.appendChild(dayEl);
    }
  }

  selectDate(date) {
    if (!this.startDate || (this.startDate && this.endDate)) {
      this.startDate = date;
      this.endDate = null;
    } else {
      if (date < this.startDate) {
        this.startDate = date;
      } else {
        this.endDate = date;
        // Auto-apply when range is complete
        this.apply();
        return;
      }
    }
    this.render();
  }
}
