/* =====================================================================
   app.js — UI: rendering, events, modals, settings.
   Talks only to TaskService / SettingsService / Dashboard / Database
   (Database is used here only for export / import / reset).
   ===================================================================== */

/* ---------- tiny helpers ---------- */
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  upcoming: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  week: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  flame: '<path d="M12 2c1 4.5 6 6 6 11.5a6 6 0 01-12 0c0-2.2 1-3.6 2.4-4.8.1 2 .9 3 2 3.3C10.3 8.6 10.6 5.2 12 2z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevL: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>'
};
const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const Fmt = {
  time(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
  },
  dateLong: (s) => DateUtil.parse(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
  dateShort: (s) => DateUtil.parse(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
  dayLabel(s, today) {
    if (s === today) return 'Today';
    if (s === DateUtil.addDays(today, 1)) return 'Tomorrow';
    return Fmt.dateLong(s);
  }
};

const RING_CIRC = 2 * Math.PI * 52;

/* ===================================================================== */
const App = {
  state: { view: 'today', weekStart: null, filters: { q: '', status: 'all', category: '', priority: '' }, editingTaskId: null },
  settings: null,
  ctx: null,
  _token: 0,
  _prevPercent: null,
  _lastRatio: 0,
  _popId: null,
  _toastTimer: null,

  /* ---------- startup ---------- */
  async init() {
    Database.onError((msg) => this.toast(msg, 'error'));
    await Database.init();
    this.settings = await SettingsService.load();
    this.applyAppearance();
    $$('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
    const cat = $('#f-cat');
    CATEGORIES.forEach((c) => cat.insertAdjacentHTML('beforeend', `<option value="${esc(c.name)}">${esc(c.name)}</option>`));
    this.bind();
    await this.render();
    setInterval(() => this.refreshIfIdle(), 60000);
  },

  refreshIfIdle() {
    const a = document.activeElement;
    const typing = a && a.matches && a.matches('input, textarea, select');
    if (!$('dialog[open]') && !typing) this.render();
  },

  applyAppearance() {
    const root = document.documentElement;
    if (this.settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.dataset.theme = this.settings.theme;
    root.dataset.accent = this.settings.accent;
  },

  /* ---------- events ---------- */
  bind() {
    $$('[data-view]').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));
    $('#newTaskBtn').addEventListener('click', () => this.openTaskModal());
    $('#fab').addEventListener('click', () => this.openTaskModal());

    const view = $('#view');
    view.addEventListener('click', (e) => this.onViewClick(e));
    view.addEventListener('submit', (e) => this.onViewSubmit(e));
    view.addEventListener('input', (e) => this.onViewInput(e));
    view.addEventListener('change', (e) => this.onViewChange(e));

    const dlg = $('#taskDialog');
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
    $('#taskForm').addEventListener('submit', (e) => this.onTaskSubmit(e));
    $('#taskForm').addEventListener('input', () => this.updateFormDynamics());
    $('#taskForm').addEventListener('change', () => this.updateFormDynamics());
    $('#deleteBtn').addEventListener('click', () => this.onDeleteFromModal());

    $('#importFile').addEventListener('change', (e) => this.importData(e.target.files[0]));

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const typing = t && t.matches && t.matches('input, textarea, select');
      if (typing || $('dialog[open]')) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); this.openTaskModal(); }
      if (e.key === '/') { e.preventDefault(); this.setView('all').then(() => { const s = $('#q'); if (s) s.focus(); }); }
    });
  },

  async setView(view) {
    this.state.view = view;
    if (view === 'week' && !this.state.weekStart) this.state.weekStart = DateUtil.weekStart(DateUtil.today());
    window.scrollTo({ top: 0 });
    await this.render();
  },

  async safe(fn) {
    try { return await fn(); }
    catch (err) {
      if (err && err.code === 'VALIDATION') throw err;
      console.error(err);
      this.toast('Something went wrong. Please try again.', 'error');
    }
  },

  /* ---------- rendering ---------- */
  async render() {
    const token = ++this._token;
    const today = DateUtil.today();
    const [todayOccs, carry, completedDates] = await Promise.all([
      TaskService.getDay(today), TaskService.getCarryOver(today), TaskService.getCompletedDates()
    ]);
    if (token !== this._token) return;

    const stats = Dashboard.computeStats(todayOccs, carry);
    const streak = Dashboard.streak(completedDates, today);
    this.ctx = { today, todayOccs, carry, stats, streak };

    document.documentElement.style.setProperty('--p', stats.ratio.toFixed(3));

    const html = await this.views[this.state.view].call(this);
    if (token !== this._token) return;

    const el = $('#view');
    el.innerHTML = html;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    $$('.nav-item').forEach((b) => {
      if (b.dataset.view === this.state.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.title = (stats.total ? `${stats.percent}% · ` : '') + 'Sundial';

    // Animate the ring from the previous value
    const bar = $('.ring-bar');
    if (bar) {
      bar.style.strokeDashoffset = RING_CIRC * (1 - this._lastRatio);
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.strokeDashoffset = RING_CIRC * (1 - stats.ratio); }));
    }
    this._lastRatio = stats.ratio;
    if (stats.allDone && this._prevPercent !== null && this._prevPercent < 100) this.celebrate();
    this._prevPercent = stats.percent;
    this._popId = null;
  },

  /* ----- shared row builders ----- */
  taskRow(o, opts = {}) {
    const { today } = this.ctx;
    const done = o.status === 'completed';
    const late = !done && ((o.scheduledDate < today && !o.isRecurring) || (o.scheduledDate === today && o.dueTime && o.dueTime < DateUtil.nowTime()));
    const cat = CATEGORY_MAP[o.category];
    const meta = [];
    if (opts.showDate) meta.push(`<span class="${late ? 'late' : ''}">${Fmt.dateShort(o.scheduledDate)}</span>`);
    if (o.dueTime) meta.push(`<span class="${late && !opts.showDate ? 'late' : ''}">${Fmt.time(o.dueTime)}</span>`);
    if (cat) meta.push(`<span class="cat" style="--c:${cat.color}">${esc(cat.name)}</span>`);
    if (o.priority) meta.push(`<span class="prio prio-${o.priority}">${PRIORITY_LABEL[o.priority]}</span>`);
    if (o.isRecurring) meta.push(`<span class="rep" title="Repeats">${icon('repeat')}</span>`);
    return `<li class="task${done ? ' is-done' : ''}${this._popId === o.id ? ' pop' : ''}">
      <button class="check" type="button" role="checkbox" aria-checked="${done}" aria-label="${done ? 'Mark as not done' : 'Mark as done'}: ${esc(o.title)}" data-act="toggle" data-occ="${o.id}">${icon('check')}</button>
      <button class="task-main" type="button" data-act="edit" data-task="${o.taskId}">
        <span class="task-title">${esc(o.title)}</span>
        ${meta.length ? `<span class="task-meta">${meta.join('')}</span>` : ''}
      </button>
    </li>`;
  },

  emptyState(title, text, withButton = true) {
    return `<div class="empty">
      <svg viewBox="0 0 120 72" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M20 56a40 40 0 0 1 80 0" opacity=".5"/><path d="M6 56h108"/><path d="M60 6v8M26 20l5 5M94 20l-5 5M8 40l7 2M112 40l-7 2" opacity=".6"/>
      </svg>
      <h3>${esc(title)}</h3><p>${esc(text)}</p>
      ${withButton ? '<button class="btn-primary" type="button" data-act="new">Add a task</button>' : ''}
    </div>`;
  },

  /* ----- views ----- */
  views: {
    async today() {
      const { today, todayOccs, carry, stats, streak } = this.ctx;
      const hour = new Date().getHours();
      const name = this.settings.name.trim();
      const pending = todayOccs.filter((o) => o.status === 'pending');
      const done = todayOccs.filter((o) => o.status === 'completed');
      const groups = Dashboard.groupByPartOfDay(pending);

      const segs = stats.total && stats.total <= 30
        ? `<div class="segments" aria-hidden="true">${Array.from({ length: stats.total }, (_, i) => `<span class="seg${i < stats.done ? ' on' : ''}"></span>`).join('')}</div>`
        : `<div class="bar" aria-hidden="true"><span style="width:${stats.percent}%"></span></div>`;

      return `
      <section class="hero">
        <div>
          <p class="eyebrow">${Fmt.dateLong(today)}</p>
          <h1>${Dashboard.greeting(hour)}${name ? ', ' + esc(name) : ''}.</h1>
          <p class="lede">${esc(Dashboard.message(stats, today))}</p>
          ${this.settings.showStreak && streak > 0 ? `<p class="streak" title="Consecutive days with at least one completed task">${icon('flame', 'fill')}<b>${streak}</b> day${streak === 1 ? '' : 's'} in a row</p>` : ''}
        </div>
        <div class="ring-wrap" id="ringWrap">
          <div class="ring" role="img" aria-label="${stats.percent}% of today's tasks complete">
            <svg viewBox="0 0 120 120"><circle class="ring-track" cx="60" cy="60" r="52"/><circle class="ring-bar" cx="60" cy="60" r="52" stroke-dasharray="${RING_CIRC.toFixed(2)}" stroke-dashoffset="${RING_CIRC.toFixed(2)}"/></svg>
            <div class="ring-label"><strong>${stats.percent}<small>%</small></strong><span>${stats.done} of ${stats.total} done</span></div>
          </div>
        </div>
      </section>

      <div class="stats" role="list">
        <div class="stat" role="listitem"><b>${stats.total}</b><span>Scheduled</span></div>
        <div class="stat" role="listitem"><b>${stats.done}</b><span>Completed</span></div>
        <div class="stat" role="listitem"><b>${stats.pending}</b><span>Pending</span></div>
        <div class="stat${stats.overdue ? ' warn' : ''}" role="listitem"><b>${stats.overdue}</b><span>Overdue</span></div>
      </div>
      ${segs}
      <div class="elapsed"><span class="elapsed-track" aria-hidden="true"><i style="width:${Dashboard.dayElapsedPercent()}%"></i></span><span>Day so far: ${Dashboard.dayElapsedPercent()}% elapsed</span></div>

      <form class="quick" id="quickAdd" autocomplete="off">
        <label class="sr-only" for="quickInput">Quick add a task for today</label>
        <input id="quickInput" type="text" placeholder="Add a task for today and press Enter" maxlength="120">
        <button class="btn-primary" type="submit">Add</button>
      </form>

      ${stats.allDone && !carry.length ? `<div class="done-banner">${icon('check')}<div><strong>All done for today.</strong><br><span style="color:var(--muted)">Every scheduled task is complete. Your progress is saved.</span></div></div>` : ''}

      ${carry.length ? `<section class="section"><h2 class="section-title late">Overdue <em>${carry.length}</em></h2><ul class="tasks">${carry.map((o) => this.taskRow(o, { showDate: true })).join('')}</ul></section>` : ''}

      ${groups.map((g) => `<section class="group"><h2 class="group-title">${g.label} <em>${g.items.length}</em></h2><ul class="tasks">${g.items.map((o) => this.taskRow(o)).join('')}</ul></section>`).join('')}

      ${stats.total === 0 && !carry.length ? this.emptyState('A clear day', 'Nothing is scheduled for today. Add a task above, or set up a daily routine.') : ''}

      ${done.length ? `<details class="section done-details" ${pending.length ? '' : 'open'}><summary class="section-title">Completed <em>${done.length}</em></summary><ul class="tasks">${done.map((o) => this.taskRow(o)).join('')}</ul></details>` : ''}`;
    },

    async upcoming() {
      const { today } = this.ctx;
      const start = DateUtil.addDays(today, 1), end = DateUtil.addDays(today, 7);
      const [occs, later] = await Promise.all([TaskService.getRange(start, end), TaskService.getLater(end)]);
      const byDay = DateUtil.range(start, 7).map((d) => ({ d, items: occs.filter((o) => o.scheduledDate === d) })).filter((x) => x.items.length);
      return `<h1 class="page-title">Upcoming</h1><p class="page-sub">The next seven days.</p>
        ${byDay.map((x) => `<section class="group"><h2 class="group-title">${Fmt.dayLabel(x.d, today)} <em>${x.items.length}</em></h2><ul class="tasks">${x.items.map((o) => this.taskRow(o)).join('')}</ul></section>`).join('')}
        ${later.length ? `<section class="group"><h2 class="group-title">Later <em>${later.length}</em></h2><ul class="tasks">${later.map((o) => this.taskRow(o, { showDate: true })).join('')}</ul></section>` : ''}
        ${!byDay.length && !later.length ? this.emptyState('Nothing coming up', 'Your next seven days are open.') : ''}`;
    },

    async week() {
      const { today } = this.ctx;
      const start = this.state.weekStart, dates = DateUtil.range(start, 7);
      const occs = await TaskService.getRange(dates[0], dates[6]);
      const days = Dashboard.summarizeDays(occs, dates);
      const total = days.reduce((a, d) => a + d.total, 0), done = days.reduce((a, d) => a + d.done, 0);
      const label = Fmt.dateShort(dates[0]).replace(/^\w+,? /, '') + ' – ' + Fmt.dateShort(dates[6]).replace(/^\w+,? /, '');
      return `<div class="week-head">
          <div><h1 class="page-title">Week</h1><p class="page-sub" style="margin:0">${total ? `${done} of ${total} done (${Math.round((done / total) * 100)}%)` : 'No tasks scheduled this week'}</p></div>
          <div class="week-nav">
            <button class="icon-btn" data-act="week-prev" aria-label="Previous week">${icon('chevL')}</button>
            <span class="label">${label}</span>
            <button class="icon-btn" data-act="week-next" aria-label="Next week">${icon('chevR')}</button>
            <button class="btn-ghost" data-act="week-today" type="button">This week</button>
          </div>
        </div>
        <div class="week-grid">
        ${days.map((s) => {
          const items = occs.filter((o) => o.scheduledDate === s.date);
          const dt = DateUtil.parse(s.date);
          return `<section class="day${s.date === today ? ' is-today' : ''}" aria-label="${Fmt.dateLong(s.date)}">
            <header><span class="dow">${dt.toLocaleDateString(undefined, { weekday: 'short' })}</span><span class="dnum">${dt.getDate()}</span></header>
            <div class="bar" aria-hidden="true"><span style="width:${Math.round(s.ratio * 100)}%"></span></div>
            <p class="day-count">${s.total ? `${s.done}/${s.total} done` : 'Free'}</p>
            <ul>${items.map((o) => `<li><button class="mini${o.status === 'completed' ? ' is-done' : ''}" type="button" data-act="toggle" data-occ="${o.id}" aria-label="${esc(o.title)}, ${o.status === 'completed' ? 'done' : 'not done'}"><i></i><span>${esc(o.title)}</span></button></li>`).join('')}</ul>
          </section>`;
        }).join('')}
        </div>`;
    },

    async all() {
      const f = this.state.filters;
      return `<h1 class="page-title">All tasks</h1><p class="page-sub">Every task and routine you have created.</p>
        <div class="toolbar">
          <div class="grow"><label class="sr-only" for="q">Search</label><input id="q" class="grow" style="width:100%" type="search" placeholder="Search tasks" value="${esc(f.q)}"></div>
          <select id="fStatus" aria-label="Status">${[['all', 'All'], ['active', 'Active'], ['paused', 'Paused'], ['done', 'Done']].map(([v, l]) => `<option value="${v}"${f.status === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <select id="fCat" aria-label="Category"><option value="">Any category</option>${CATEGORIES.map((c) => `<option${f.category === c.name ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          <select id="fPrio" aria-label="Priority">${[['', 'Any priority'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['none', 'No priority']].map(([v, l]) => `<option value="${v}"${f.priority === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div id="allList">${await this.allListHtml()}</div>`;
    },

    async routines() {
      const { today } = this.ctx;
      const tasks = (await TaskService.getTasks()).filter((t) => t.recurrence.type !== 'none')
        .sort((a, b) => (a.dueTime || '99').localeCompare(b.dueTime || '99') || a.title.localeCompare(b.title));
      const dates = DateUtil.range(DateUtil.addDays(today, -6), 7);
      const occs = await TaskService.getRange(dates[0], today);
      return `<h1 class="page-title">Routines</h1><p class="page-sub">Tasks that repeat on their own. The dots show the last seven days.</p>
        ${tasks.length ? `<ul class="tasks">${tasks.map((t) => {
          const dots = dates.map((d) => {
            const o = occs.find((x) => x.taskId === t.id && x.scheduledDate === d);
            const cls = o ? (o.status === 'completed' ? 'done' : 'missed') : 'none';
            const text = o ? (o.status === 'completed' ? 'done' : 'not done') : 'not scheduled';
            return `<span class="dot ${cls}${d === today ? ' today' : ''}" title="${Fmt.dateShort(d)}: ${text}" aria-label="${Fmt.dateShort(d)}: ${text}"></span>`;
          }).join('');
          const sched = dates.map((d) => occs.find((x) => x.taskId === t.id && x.scheduledDate === d)).filter(Boolean);
          const rate = sched.length ? Math.round((sched.filter((o) => o.status === 'completed').length / sched.length) * 100) : null;
          const cat = CATEGORY_MAP[t.category];
          return `<li class="task" style="align-items:center${t.isActive ? '' : ';opacity:.6'}">
            <button class="task-main" type="button" data-act="edit" data-task="${t.id}">
              <span class="task-title">${esc(t.title)}</span>
              <span class="task-meta"><span>${esc(TaskService.scheduleLabel(t))}</span>${t.dueTime ? `<span>${Fmt.time(t.dueTime)}</span>` : ''}${cat ? `<span class="cat" style="--c:${cat.color}">${esc(cat.name)}</span>` : ''}${rate !== null ? `<span>${rate}% last 7 days</span>` : ''}${t.isActive ? '' : '<span class="badge">Paused</span>'}</span>
              <span class="dots" aria-hidden="false">${dots}</span>
            </button>
            <div class="routine-side"><label class="sr-only" for="sw_${t.id}">Active</label><input class="switch" id="sw_${t.id}" type="checkbox" data-act="toggle-active" data-task="${t.id}" ${t.isActive ? 'checked' : ''}></div>
          </li>`;
        }).join('')}</ul>` : this.emptyState('No routines yet', 'Create a task and choose how it repeats: every day, on weekdays, or on days you pick.')}`;
    },

    async settings() {
      const s = this.settings;
      const sw = { clay: '#C8553D', ocean: '#2F6F8F', moss: '#4F7A52', plum: '#8A4F7D', gold: '#A9741A' };
      return `<h1 class="page-title">Settings</h1><p class="page-sub">Everything is stored on this device.</p>
        <div class="settings-row"><label for="s-name"><strong>Your name</strong><small>Used in the greeting</small></label><input id="s-name" type="text" maxlength="30" value="${esc(s.name)}" placeholder="Optional"></div>
        <div class="settings-row"><label for="s-theme"><strong>Theme</strong><small>Match your device or choose one</small></label>
          <select id="s-theme"><option value="auto"${s.theme === 'auto' ? ' selected' : ''}>Match device</option><option value="light"${s.theme === 'light' ? ' selected' : ''}>Light</option><option value="dark"${s.theme === 'dark' ? ' selected' : ''}>Dark</option></select></div>
        <div class="settings-row"><div><strong>Accent colour</strong><small>Buttons and highlights</small></div>
          <div class="swatches" role="group" aria-label="Accent colour">${Object.entries(sw).map(([k, c]) => `<button class="swatch" type="button" style="--sw:${c}" data-act="accent" data-accent="${k}" aria-pressed="${s.accent === k}" aria-label="${k}"></button>`).join('')}</div></div>
        <div class="settings-row"><label for="s-streak"><strong>Show streak</strong><small>A small count of consecutive productive days</small></label><input class="switch" id="s-streak" type="checkbox" ${s.showStreak ? 'checked' : ''}></div>
        <div class="settings-row"><div><strong>Your data</strong><small>Export a backup, restore one, or start fresh</small></div>
          <div class="settings-actions"><button class="btn-ghost" type="button" data-act="export">Export</button><button class="btn-ghost" type="button" data-act="import">Import</button><button class="btn-danger" type="button" data-act="reset">Reset all</button></div></div>
        <p class="page-sub" style="margin-top:22px">Shortcuts: <strong>N</strong> new task · <strong>/</strong> search · <strong>Esc</strong> close</p>`;
    }
  },

  /* ----- All-tasks list (re-rendered on its own while filtering) ----- */
  async allListHtml() {
    const f = this.state.filters;
    const [tasks, occs] = await Promise.all([TaskService.getTasks(), TaskService.getAllOccurrences()]);
    const doneOneOff = new Set(occs.filter((o) => !o.isRecurring && o.status === 'completed').map((o) => o.taskId));
    const q = f.q.trim().toLowerCase();
    const list = tasks.filter((t) => {
      if (q && !(t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))) return false;
      if (f.category && t.category !== f.category) return false;
      if (f.priority === 'none' ? t.priority : f.priority && t.priority !== f.priority) return false;
      const done = t.recurrence.type === 'none' && doneOneOff.has(t.id);
      if (f.status === 'active' && (!t.isActive || done)) return false;
      if (f.status === 'paused' && t.isActive) return false;
      if (f.status === 'done' && !done) return false;
      return true;
    }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    if (!tasks.length) return this.emptyState('No tasks yet', 'Everything you add will be listed here.');
    if (!list.length) return this.emptyState('No matches', 'Try a different search or filter.', false);
    return `<p class="count">${list.length} ${list.length === 1 ? 'task' : 'tasks'}</p><ul class="tasks">${list.map((t) => {
      const cat = CATEGORY_MAP[t.category];
      const done = t.recurrence.type === 'none' && doneOneOff.has(t.id);
      return `<li class="task" style="align-items:center">
        <button class="task-main" type="button" data-act="edit" data-task="${t.id}">
          <span class="task-title">${esc(t.title)}</span>
          <span class="task-meta"><span>${esc(TaskService.scheduleLabel(t))}</span>${t.dueDate ? `<span>${Fmt.dateShort(t.dueDate)}</span>` : ''}${t.dueTime ? `<span>${Fmt.time(t.dueTime)}</span>` : ''}${cat ? `<span class="cat" style="--c:${cat.color}">${esc(cat.name)}</span>` : ''}${t.priority ? `<span class="prio prio-${t.priority}">${PRIORITY_LABEL[t.priority]}</span>` : ''}${done ? '<span class="badge ok">Done</span>' : ''}${t.isActive ? '' : '<span class="badge">Paused</span>'}</span>
        </button>
        <button class="icon-btn danger" type="button" data-act="delete-task" data-task="${t.id}" aria-label="Delete ${esc(t.title)}">${icon('trash')}</button>
      </li>`;
    }).join('')}</ul>`;
  },

  /* ---------- view events ---------- */
  async onViewClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;

    if (act === 'toggle-active') return; // handled on change
    if (act === 'toggle') {
      const occ = el.dataset.occ;
      this._popId = occ;
      await this.safe(() => TaskService.toggleOccurrence(occ));
      return this.render();
    }
    if (act === 'edit') return this.openTaskModal({ taskId: el.dataset.task });
    if (act === 'new') return this.openTaskModal();
    if (act === 'delete-task') return this.deleteTaskFlow(el.dataset.task);
    if (act === 'week-prev') { this.state.weekStart = DateUtil.addDays(this.state.weekStart, -7); return this.render(); }
    if (act === 'week-next') { this.state.weekStart = DateUtil.addDays(this.state.weekStart, 7); return this.render(); }
    if (act === 'week-today') { this.state.weekStart = DateUtil.weekStart(DateUtil.today()); return this.render(); }
    if (act === 'accent') {
      this.settings = await SettingsService.save({ accent: el.dataset.accent });
      this.applyAppearance();
      return this.render();
    }
    if (act === 'export') return this.exportData();
    if (act === 'import') return $('#importFile').click();
    if (act === 'reset') return this.resetData();
  },

  async onViewSubmit(e) {
    if (e.target.id !== 'quickAdd') return;
    e.preventDefault();
    const input = $('#quickInput');
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    await this.safe(() => TaskService.createTask({ title }));
    this.toast('Task added');
    await this.render();
    const next = $('#quickInput'); if (next) next.focus();
  },

  async onViewInput(e) {
    const t = e.target;
    if (t.id === 'q') { this.state.filters.q = t.value; return this.refreshAllList(); }
  },

  async onViewChange(e) {
    const t = e.target;
    if (t.id === 'fStatus') { this.state.filters.status = t.value; return this.refreshAllList(); }
    if (t.id === 'fCat') { this.state.filters.category = t.value; return this.refreshAllList(); }
    if (t.id === 'fPrio') { this.state.filters.priority = t.value; return this.refreshAllList(); }
    if (t.dataset && t.dataset.act === 'toggle-active') {
      await this.safe(() => TaskService.setActive(t.dataset.task, t.checked));
      this.toast(t.checked ? 'Routine resumed' : 'Routine paused');
      return this.render();
    }
    if (t.id === 's-name') this.settings = await SettingsService.save({ name: t.value.trim() });
    if (t.id === 's-theme') { this.settings = await SettingsService.save({ theme: t.value }); this.applyAppearance(); }
    if (t.id === 's-streak') this.settings = await SettingsService.save({ showStreak: t.checked });
  },

  async refreshAllList() {
    const box = $('#allList');
    if (box) box.innerHTML = await this.allListHtml();
  },

  /* ---------- task modal ---------- */
  async openTaskModal({ taskId = null } = {}) {
    const form = $('#taskForm'), dlg = $('#taskDialog');
    let task = null;
    if (taskId) {
      task = await TaskService.getTask(taskId);
      if (!task) { this.toast('That task no longer exists'); return this.render(); }
    }
    form.reset();
    this.state.editingTaskId = taskId;
    $('#formError').textContent = '';
    $('#dialogTitle').textContent = task ? 'Edit task' : 'New task';
    $('#saveBtn').textContent = task ? 'Save changes' : 'Save task';
    $('#deleteBtn').hidden = !task;
    const f = form.elements;
    if (task) {
      f.title.value = task.title;
      f.description.value = task.description || '';
      f.category.value = task.category || '';
      f.priority.value = task.priority || '';
      f.dueDate.value = task.dueDate || '';
      f.dueTime.value = task.dueTime || '';
      f.repeat.value = task.recurrence.type;
      $$('input[name="dow"]', form).forEach((c) => { c.checked = task.recurrence.daysOfWeek.includes(Number(c.value)); });
      f.isActive.checked = task.isActive;
    }
    this.updateFormDynamics();
    dlg.showModal();
    f.title.focus();
  },

  readForm() {
    const f = $('#taskForm').elements;
    return {
      title: f.title.value,
      description: f.description.value,
      category: f.category.value,
      priority: f.priority.value,
      dueDate: f.dueDate.value,
      dueTime: f.dueTime.value,
      recurrence: { type: f.repeat.value, daysOfWeek: $$('input[name="dow"]:checked', $('#taskForm')).map((c) => Number(c.value)) },
      isActive: f.isActive.checked
    };
  },

  updateFormDynamics() {
    const input = this.readForm();
    const repeats = input.recurrence.type !== 'none';
    $('#dowRow').hidden = input.recurrence.type !== 'days';
    $('#dateLabel').textContent = repeats ? 'Starts on' : 'Due date';
    $('#activeRow').hidden = !(repeats && this.state.editingTaskId);
    const hint = $('#scheduleHint');
    hint.textContent = TaskService.scheduleLabel({ recurrence: input.recurrence, startDate: input.dueDate || DateUtil.today() })
      + (input.dueTime ? ' at ' + Fmt.time(input.dueTime) : '');
    hint.hidden = !repeats;
  },

  async onTaskSubmit(e) {
    e.preventDefault();
    const err = $('#formError');
    err.textContent = '';
    try {
      const input = this.readForm();
      const id = this.state.editingTaskId;
      await (id ? TaskService.updateTask(id, input) : TaskService.createTask(input));
      $('#taskDialog').close();
      this.toast(id ? 'Changes saved' : 'Task saved');
      await this.render();
    } catch (ex) {
      if (ex && ex.code === 'VALIDATION') { err.textContent = ex.message; if (/title/i.test(ex.message)) $('#f-title').focus(); }
      else { console.error(ex); err.textContent = 'Could not save. Please try again.'; }
    }
  },

  async onDeleteFromModal() {
    const id = this.state.editingTaskId;
    if (!id) return;
    if (await this.deleteTaskFlow(id)) $('#taskDialog').close();
  },

  async deleteTaskFlow(id) {
    const task = await TaskService.getTask(id);
    if (!task) return false;
    const recurring = task.recurrence.type !== 'none';
    const ok = await this.confirm({
      title: 'Delete this task?',
      text: recurring
        ? `"${task.title}" and all of its upcoming occurrences will be removed. Days you already completed stay in your history.`
        : `"${task.title}" will be removed.`,
      okLabel: 'Delete'
    });
    if (!ok) return false;
    await this.safe(() => TaskService.deleteTask(id));
    this.toast('Task deleted');
    await this.render();
    return true;
  },

  /* ---------- confirm dialog ---------- */
  confirm({ title, text, okLabel = 'Delete' }) {
    return new Promise((resolve) => {
      const dlg = $('#confirmDialog');
      $('#confirmTitle').textContent = title;
      $('#confirmText').textContent = text;
      $('#confirmOk').textContent = okLabel;
      const onClose = () => { dlg.removeEventListener('close', onClose); resolve(dlg.returnValue === 'ok'); };
      dlg.returnValue = 'cancel';
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  },

  /* ---------- export / import / reset ---------- */
  async exportData() {
    const payload = {
      app: 'sundial', schemaVersion: Database.SCHEMA_VERSION, exportedAt: new Date().toISOString(),
      collections: {
        [Collections.TASKS]: await Database.getAll(Collections.TASKS),
        [Collections.OCCURRENCES]: await Database.getAll(Collections.OCCURRENCES),
        [Collections.SETTINGS]: await Database.getAll(Collections.SETTINGS)
      }
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'sundial-backup-' + DateUtil.today() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.toast('Backup downloaded');
  },

  async importData(file) {
    $('#importFile').value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const cols = data && data.collections;
      const valid = (a) => Array.isArray(a) && a.every((r) => r && typeof r.id === 'string');
      if (!cols || data.app !== 'sundial' || !valid(cols.tasks) || !valid(cols.occurrences) || !valid(cols.settings || [])) throw new Error('bad file');
      const ok = await this.confirm({ title: 'Replace your data?', text: 'Importing replaces all current tasks and history with the contents of this backup.', okLabel: 'Import' });
      if (!ok) return;
      await Database.replaceAll(Collections.TASKS, cols.tasks);
      await Database.replaceAll(Collections.OCCURRENCES, cols.occurrences);
      if (cols.settings && cols.settings.length) await Database.replaceAll(Collections.SETTINGS, cols.settings);
      this.settings = await SettingsService.load();
      this.applyAppearance();
      this._prevPercent = null;
      this.toast('Backup imported');
      await this.render();
    } catch (err) {
      console.error(err);
      this.toast('That file is not a valid Sundial backup', 'error');
    }
  },

  async resetData() {
    const ok = await this.confirm({ title: 'Erase everything?', text: 'All tasks, routines and history on this device will be permanently deleted.', okLabel: 'Erase all' });
    if (!ok) return;
    await Database.replaceAll(Collections.TASKS, []);
    await Database.replaceAll(Collections.OCCURRENCES, []);
    await Database.replaceAll(Collections.SETTINGS, []);
    this.settings = await SettingsService.load();
    this.applyAppearance();
    this._prevPercent = null; this._lastRatio = 0;
    this.toast('Everything was erased');
    await this.render();
  },

  /* ---------- feedback ---------- */
  toast(message, type = '') {
    const t = $('#toast');
    t.textContent = message;
    t.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.className = 'toast' + (type ? ' ' + type : ''); }, 2600);
  },

  celebrate() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const wrap = $('#ringWrap');
    if (!wrap) return;
    const colors = ['var(--ring)', 'var(--accent-ui)', '#E3B04B', '#86B58A', '#E88478'];
    const box = document.createElement('div');
    box.className = 'confetti';
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, r = 70 + Math.random() * 110;
      const p = document.createElement('i');
      p.style.setProperty('--dx', Math.cos(a) * r + 'px');
      p.style.setProperty('--dy', Math.sin(a) * r + 20 + 'px');
      p.style.setProperty('--rot', Math.round(Math.random() * 540 - 270) + 'deg');
      p.style.setProperty('--col', colors[i % colors.length]);
      p.style.animationDelay = Math.random() * 120 + 'ms';
      box.appendChild(p);
    }
    wrap.appendChild(box);
    setTimeout(() => box.remove(), 1900);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());