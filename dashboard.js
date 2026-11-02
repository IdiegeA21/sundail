/* =====================================================================
   dashboard.js — PROGRESS + DASHBOARD CALCULATIONS (pure functions)
   No DOM, no storage. Everything is derived from real occurrence data.
   ===================================================================== */

const Dashboard = {
  greeting(hour = new Date().getHours()) {
    if (hour < 5) return 'Still up';
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    if (hour < 21) return 'Good evening';
    return 'Good evening';
  },

  // todayOccs: today's occurrences. carryOver: overdue one-offs from earlier days.
  computeStats(todayOccs, carryOver, nowTime = DateUtil.nowTime()) {
    const total = todayOccs.length;
    const done = todayOccs.filter((o) => o.status === 'completed').length;
    const lateToday = todayOccs.filter((o) => o.status === 'pending' && o.dueTime && o.dueTime < nowTime).length;
    const ratio = total ? done / total : 0;
    return {
      total,
      done,
      pending: total - done,
      overdue: carryOver.length + lateToday,
      ratio,                         // 0..1, drives the background + ring
      percent: Math.round(ratio * 100),
      allDone: total > 0 && done === total
    };
  },

  // Split pending tasks into time-of-day groups.
  groupByPartOfDay(pending) {
    const groups = [
      { label: 'Morning', items: [] },
      { label: 'Afternoon', items: [] },
      { label: 'Evening', items: [] },
      { label: 'Anytime', items: [] }
    ];
    for (const o of pending) {
      if (!o.dueTime) groups[3].items.push(o);
      else {
        const h = Number(o.dueTime.split(':')[0]);
        groups[h < 12 ? 0 : h < 17 ? 1 : 2].items.push(o);
      }
    }
    return groups.filter((g) => g.items.length);
  },

  // Consecutive days (ending today, or yesterday if today has no completion yet)
  // with at least one completed task. Deliberately gentle: it never "breaks" mid-day.
  streak(completedDates, today = DateUtil.today()) {
    let cursor = completedDates.has(today) ? today : DateUtil.addDays(today, -1);
    let count = 0;
    while (completedDates.has(cursor)) { count++; cursor = DateUtil.addDays(cursor, -1); }
    return count;
  },

  dayElapsedPercent(now = new Date()) {
    return Math.round(((now.getHours() * 60 + now.getMinutes()) / 1440) * 100);
  },

  summarizeDays(occs, dates) {
    return dates.map((date) => {
      const list = occs.filter((o) => o.scheduledDate === date);
      const done = list.filter((o) => o.status === 'completed').length;
      return { date, total: list.length, done, ratio: list.length ? done / list.length : 0 };
    });
  },

  message(stats, dateStr = DateUtil.today()) {
    const pick = (arr) => arr[Number(dateStr.slice(-2)) % arr.length];
    if (stats.total === 0) return 'Nothing scheduled yet. A clear day is a good day.';
    if (stats.allDone) return pick(['Everything is done. Rest well.', 'All finished. Enjoy the quiet.', 'A full house of checkmarks. Well done.']);
    if (stats.ratio === 0) return pick(['Start with the smallest one.', 'One thing first. The rest will follow.', 'Pick the one you are least dreading.']);
    if (stats.ratio < 0.5) return pick(['Good start. Keep the rhythm.', 'Moving, and that is what counts.', 'Nice. One at a time.']);
    if (stats.ratio < 0.85) return pick(['More than halfway there.', 'The hard part is behind you.', 'Look at that momentum.']);
    return pick(['Almost there. Just a few left.', 'So close. Finish strong.', 'The finish line is in sight.']);
  }
};