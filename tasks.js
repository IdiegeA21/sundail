/* =====================================================================
   tasks.js — TASK + RECURRENCE LOGIC (no DOM, no localStorage)
   ---------------------------------------------------------------------
   Two collections:

   tasks        The reusable definition ("Morning Prayer, every day").
   occurrences  One row per task per scheduled calendar date. Completion
                lives here, so completing today never touches tomorrow.

   Occurrences carry a small snapshot of the task (title, category, ...)
   so history is never rewritten when the task is edited later.
   ===================================================================== */

const Collections = { TASKS: 'tasks', OCCURRENCES: 'occurrences', SETTINGS: 'settings' };

const CATEGORIES = [
  { name: 'Personal', color: '#C8553D' },
  { name: 'Work', color: '#2F6F8F' },
  { name: 'Health', color: '#4F7A52' },
  { name: 'Faith', color: '#8A4F7D' },
  { name: 'Learning', color: '#B8801A' },
  { name: 'Home', color: '#6B7A8F' }
];
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.name, c]));
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ---------- Local calendar dates as "YYYY-MM-DD" strings ---------- */
const DateUtil = {
  toStr(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },
  parse(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  },
  today() { return this.toStr(new Date()); },
  nowTime() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  },
  addDays(s, n) {
    const d = this.parse(s);
    d.setDate(d.getDate() + n);
    return this.toStr(d);
  },
  weekStart(s) { // Monday of the week containing s
    return this.addDays(s, -((this.parse(s).getDay() + 6) % 7));
  },
  range(start, count) {
    return Array.from({ length: count }, (_, i) => this.addDays(start, i));
  },
  localDateOfTimestamp(iso) { return this.toStr(new Date(iso)); }
};

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ---------- Settings (single record) ---------- */
const SettingsService = {
  ID: 'user_settings',
  defaults: { name: '', theme: 'auto', accent: 'clay', showStreak: true },
  async load() {
    let rec = await Database.getById(Collections.SETTINGS, this.ID);
    if (!rec) rec = await Database.insert(Collections.SETTINGS, { id: this.ID, ...this.defaults });
    return { ...this.defaults, ...rec };
  },
  async save(updates) {
    const rec = await Database.update(Collections.SETTINGS, this.ID, updates);
    return { ...this.defaults, ...rec };
  }
};

/* ---------- Tasks & occurrences ---------- */
const TaskService = {
  _queue: Promise.resolve(),

  // Serialises writes so refreshes / rapid clicks can never create duplicates.
  _enqueue(fn) {
    const run = this._queue.then(fn);
    this._queue = run.catch(() => {});
    return run;
  },

  /* ----- recurrence rules ----- */

  // Does this task have an occurrence on this local date?
  occursOn(task, dateStr) {
    if (!task.isActive) return false;
    if (dateStr < task.startDate) return false;
    const d = DateUtil.parse(dateStr);
    const dow = d.getDay();
    const rec = task.recurrence || { type: 'none', daysOfWeek: [] };
    switch (rec.type) {
      case 'none': return dateStr === task.startDate;
      case 'daily': return true;
      case 'weekdays': return dow >= 1 && dow <= 5;
      case 'days': return (rec.daysOfWeek || []).includes(dow);
      case 'weekly': return DateUtil.parse(task.startDate).getDay() === dow;
      case 'monthly': {
        const wanted = DateUtil.parse(task.startDate).getDate();
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        return d.getDate() === Math.min(wanted, lastDay);
      }
      default: return false;
    }
  },

  scheduleLabel(task) {
    const rec = task.recurrence || { type: 'none' };
    switch (rec.type) {
      case 'none': return 'Does not repeat';
      case 'daily': return 'Every day';
      case 'weekdays': return 'Every weekday';
      case 'days': {
        const days = [...(rec.daysOfWeek || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
        return days.length ? 'Every ' + days.map((d) => DOW_SHORT[d]).join(', ') : 'Pick at least one day';
      }
      case 'weekly': return 'Weekly on ' + DOW_LONG[DateUtil.parse(task.startDate).getDay()];
      case 'monthly': return 'Monthly on the ' + ordinal(DateUtil.parse(task.startDate).getDate());
      default: return '';
    }
  },

  /* ----- validation ----- */

  _normalize(input) {
    const title = String(input.title || '').trim();
    if (!title) throw this._validation('Please give your task a title.');
    const rtype = input.recurrence && input.recurrence.type ? input.recurrence.type : 'none';
    if (!['none', 'daily', 'weekdays', 'days', 'weekly', 'monthly'].includes(rtype)) throw this._validation('Unknown repeat option.');
    let days = rtype === 'days' ? [...new Set((input.recurrence.daysOfWeek || []).map(Number))] : [];
    if (rtype === 'days' && !days.length) throw this._validation('Pick at least one day of the week.');
    const dueDate = input.dueDate || null;
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw this._validation('That date does not look right.');
    return {
      title,
      description: String(input.description || '').trim(),
      category: CATEGORY_MAP[input.category] ? input.category : null,
      priority: PRIORITY_LABEL[input.priority] ? input.priority : null, // never auto-assigned
      dueDate,
      dueTime: input.dueTime || null,
      recurrence: { type: rtype, daysOfWeek: days },
      isActive: input.isActive === undefined ? true : !!input.isActive
    };
  },
  _validation(message) {
    const e = new Error(message);
    e.code = 'VALIDATION';
    return e;
  },

  _snapshot(task) {
    return {
      title: task.title,
      category: task.category,
      priority: task.priority,
      dueTime: task.dueTime,
      isRecurring: task.recurrence.type !== 'none'
    };
  },

  /* ----- occurrence generation (idempotent) ----- */

  // Creates any missing occurrences for the given dates. Safe to call repeatedly.
  async _ensureForDates(dates) {
    const tasks = await Database.query(Collections.TASKS, { isActive: true });
    if (!tasks.length) return;
    const occs = await Database.getAll(Collections.OCCURRENCES);
    const seen = new Set(occs.map((o) => o.taskId + '|' + o.scheduledDate));
    const hasAny = new Set(occs.map((o) => o.taskId));
    const now = new Date().toISOString();
    const toInsert = [];
    const make = (t, date) => ({
      taskId: t.id, scheduledDate: date, status: 'pending', completedAt: null, createdAt: now, ...this._snapshot(t)
    });
    for (const t of tasks) {
      if (t.recurrence.type === 'none') {
        // One-off tasks get exactly one occurrence, ever (unless it was removed on edit).
        if (!hasAny.has(t.id)) { toInsert.push(make(t, t.startDate)); hasAny.add(t.id); }
        continue;
      }
      for (const d of dates) {
        const k = t.id + '|' + d;
        if (this.occursOn(t, d) && !seen.has(k)) { toInsert.push(make(t, d)); seen.add(k); }
      }
    }
    if (toInsert.length) await Database.insertMany(Collections.OCCURRENCES, toInsert);
  },

  ensureForDates(dates) { return this._enqueue(() => this._ensureForDates(dates)); },

  // After a task is edited: drop pending occurrences that no longer match the schedule,
  // refresh the snapshot on pending / current / future ones, never touch completed past ones.
  async _reconcile(task) {
    const today = DateUtil.today();
    const occs = await Database.query(Collections.OCCURRENCES, { taskId: task.id });
    for (const o of occs) {
      if (o.status === 'pending' && !this.occursOn(task, o.scheduledDate)) {
        await Database.delete(Collections.OCCURRENCES, o.id);
      } else if (o.status === 'pending' || o.scheduledDate >= today) {
        await Database.update(Collections.OCCURRENCES, o.id, this._snapshot(task));
      }
    }
    await this._ensureForDates([today]);
  },

  /* ----- task CRUD ----- */

  createTask(input) {
    return this._enqueue(async () => {
      const data = this._normalize(input);
      const now = new Date().toISOString();
      const task = await Database.insert(Collections.TASKS, {
        ...data, startDate: data.dueDate || DateUtil.today(), createdAt: now, updatedAt: now
      });
      await this._ensureForDates([DateUtil.today()]);
      return task;
    });
  },

  updateTask(id, input) {
    return this._enqueue(async () => {
      const existing = await Database.getById(Collections.TASKS, id);
      if (!existing) throw new Error('Task not found');
      const data = this._normalize(input);
      const startDate = data.dueDate || (existing.dueDate ? DateUtil.today() : existing.startDate);
      const task = await Database.update(Collections.TASKS, id, { ...data, startDate, updatedAt: new Date().toISOString() });
      await this._reconcile(task);
      return task;
    });
  },

  setActive(id, isActive) {
    return this._enqueue(async () => {
      const task = await Database.update(Collections.TASKS, id, { isActive, updatedAt: new Date().toISOString() });
      if (task) await this._reconcile(task);
      return task;
    });
  },

  deleteTask(id) {
    return this._enqueue(async () => {
      const today = DateUtil.today();
      await Database.delete(Collections.TASKS, id);
      // Remove pending + today/future occurrences; past completed ones stay as history.
      await Database.deleteWhere(Collections.OCCURRENCES, {
        taskId: id,
        scheduledDate: (v, rec) => rec.status === 'pending' || v >= today
      });
    });
  },

  getTask(id) { return Database.getById(Collections.TASKS, id); },
  getTasks() { return Database.getAll(Collections.TASKS); },
  getAllOccurrences() { return Database.getAll(Collections.OCCURRENCES); },

  /* ----- occurrence actions & queries ----- */

  toggleOccurrence(id) {
    return this._enqueue(async () => {
      const occ = await Database.getById(Collections.OCCURRENCES, id);
      if (!occ) return null;
      const done = occ.status !== 'completed';
      return Database.update(Collections.OCCURRENCES, id, {
        status: done ? 'completed' : 'pending',
        completedAt: done ? new Date().toISOString() : null
      });
    });
  },

  sortOccurrences(list) {
    return [...list].sort((a, b) => {
      const ta = a.dueTime || '99:99', tb = b.dueTime || '99:99';
      if (ta !== tb) return ta < tb ? -1 : 1;
      const pa = a.priority ? PRIORITY_RANK[a.priority] : 3, pb = b.priority ? PRIORITY_RANK[b.priority] : 3;
      if (pa !== pb) return pa - pb;
      return a.title.localeCompare(b.title);
    });
  },

  async getDay(date) {
    await this.ensureForDates([date]);
    return this.sortOccurrences(await Database.query(Collections.OCCURRENCES, { scheduledDate: date }));
  },

  async getRange(start, end) {
    const days = [];
    for (let d = start; d <= end; d = DateUtil.addDays(d, 1)) days.push(d);
    await this.ensureForDates(days);
    return this.sortOccurrences(await Database.query(Collections.OCCURRENCES, { scheduledDate: { $gte: start, $lte: end } }));
  },

  // One-off tasks that were scheduled before today and are still pending.
  // (Missed routine days are NOT treated as overdue, so they never nag.)
  async getCarryOver(today) {
    const list = await Database.query(Collections.OCCURRENCES, { status: 'pending', scheduledDate: { $lt: today } });
    return this.sortOccurrences(list.filter((o) => !o.isRecurring));
  },

  async getLater(afterDate) {
    const list = await Database.query(Collections.OCCURRENCES, { status: 'pending', scheduledDate: { $gt: afterDate } });
    return this.sortOccurrences(list.filter((o) => !o.isRecurring)).sort((a, b) => (a.scheduledDate < b.scheduledDate ? -1 : 1));
  },

  // Local dates on which at least one task was completed (used for the streak).
  async getCompletedDates() {
    const done = await Database.query(Collections.OCCURRENCES, { status: 'completed' });
    return new Set(done.filter((o) => o.completedAt).map((o) => DateUtil.localDateOfTimestamp(o.completedAt)));
  }
};