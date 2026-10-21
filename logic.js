/* ==========================================================
   PocketDay — logic.js
   Pure functions only: no DOM, no localStorage.
   Everything about money and dates lives here so it can be
   tested on its own (see tests/logic.test.js).

   Two teaching ideas worth pointing out to students:
   1. Money is stored in CENTS (whole numbers). 0.1 + 0.2 in
      JavaScript is 0.30000000000000004, so we never add
      decimal dollars together. $3.50 is stored as 350.
   2. Dates are stored as "YYYY-MM-DD" strings in local time.
      That way "today" means the user's today, not UTC's.
   ========================================================== */
(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'food',          label: 'Food' },
    { id: 'drinks',        label: 'Drinks' },
    { id: 'shopping',      label: 'Shopping' },
    { id: 'transport',     label: 'Transportation' },
    { id: 'entertainment', label: 'Entertainment' },
    { id: 'other',         label: 'Other' }
  ];

  // Color vibes the user can pick. Only the accent changes; CSS mixes the rest.
  const VIBES = [
    { id: 'bubblegum', label: 'Bubblegum', color: '#FF6FAE' },
    { id: 'matcha',    label: 'Matcha',    color: '#8FD86A' },
    { id: 'blueberry', label: 'Blueberry', color: '#74BEFF' },
    { id: 'peach',     label: 'Peach',     color: '#FFA066' },
    { id: 'grape',     label: 'Grape',     color: '#B394FF' }
  ];

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const MAX_CENTS = 10000000; // $100,000 — anything above is almost certainly a typo

  /* ---------- Dates ---------- */

  // Date -> "2026-10-20" using the device's local calendar
  function toKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // "2026-10-20" -> Date at local noon.
  // Noon (not midnight) keeps us safe from daylight-saving jumps.
  function fromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  function addDays(key, n) {
    const dt = fromKey(key);
    dt.setDate(dt.getDate() + n);
    return toKey(dt);
  }

  function isValidKey(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    return toKey(fromKey(key)) === key; // rejects things like 2026-02-31
  }

  // The first day of the budget week that contains `key`.
  // resetDay: 0 = Sunday ... 6 = Saturday.
  // Example: resetDay = 1 (Monday) and key is a Wednesday -> go back 2 days.
  function weekStart(key, resetDay) {
    const day = fromKey(key).getDay();
    const back = (day - resetDay + 7) % 7;
    return addDays(key, -back);
  }

  // All 7 date keys of the week that contains `key`
  function weekDays(key, resetDay) {
    const start = weekStart(key, resetDay);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }

  function inWeek(dateKey, refKey, resetDay) {
    return weekStart(dateKey, resetDay) === weekStart(refKey, resetDay);
  }

  /* ---------- Amounts ---------- */

  // Turn what someone typed into cents, or explain what's wrong.
  // Returns { cents } or { error }.
  function parseAmount(input) {
    let s = String(input == null ? '' : input).trim();
    if (s === '') return { error: 'Enter an amount first.' };

    // Ignore currency symbols and spaces people sometimes type
    s = s.replace(/[\s$€£¥]/g, '');
    // "3,50" -> "3.50" (common in many countries). "1,250.00" -> "1250.00"
    if (s.includes(',') && !s.includes('.') && /,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');

    if (s.startsWith('-')) return { error: "Amounts can't be negative." };
    if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) {
      return { error: 'Use numbers only, like 4.50.' };
    }

    // Build cents from the string itself, never from float math
    const [whole, frac = ''] = s.split('.');
    const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));

    if (cents === 0) return { error: 'Enter an amount above zero.' };
    if (cents > MAX_CENTS) return { error: 'That looks too big. Check the amount.' };
    return { cents };
  }

  // cents -> "$3.50" in the chosen currency
  function formatMoney(cents, currency, opts = {}) {
    const zeroDecimals = currency === 'JPY' || currency === 'KRW';
    const showCents = !zeroDecimals && !(opts.compact && cents % 100 === 0);
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'USD',
        minimumFractionDigits: showCents ? 2 : 0,
        maximumFractionDigits: showCents ? 2 : 0
      }).format(cents / 100);
    } catch (e) {
      return (cents / 100).toFixed(showCents ? 2 : 0);
    }
  }

  // cents -> "3.50" for putting back into an input field
  function centsToInput(cents) {
    return (cents / 100).toFixed(2).replace(/\.00$/, '');
  }

  /* ---------- Budget math ---------- */

  const sum = (list) => list.reduce((t, x) => t + x.amount, 0);

  function spentOn(expenses, dateKey) {
    return sum(expenses.filter((e) => e.date === dateKey));
  }

  // Everything about one budget week, in one object.
  // Savings that came FROM the budget are subtracted from what's left,
  // but they are NOT counted as spending. Savings from other money
  // (a gift, a job) don't touch the budget at all. That's how we avoid
  // double counting: each cent lives in exactly one place.
  function weekSummary(state, refKey) {
    const { budget, resetDay } = state.settings;
    const days = weekDays(refKey, resetDay);
    const first = days[0], last = days[6];
    const within = (x) => x.date >= first && x.date <= last;

    const expenses = state.expenses.filter(within);
    const deposits = state.deposits.filter(within);

    const spent = sum(expenses);
    const savedFromBudget = sum(deposits.filter((d) => d.source === 'budget'));
    const savedOther = sum(deposits.filter((d) => d.source !== 'budget'));
    const remaining = budget - spent - savedFromBudget;

    const perDay = days.map((k) => ({ date: k, amount: spentOn(expenses, k) }));
    const perCategory = CATEGORIES.map((c) => ({
      ...c,
      amount: sum(expenses.filter((e) => e.category === c.id))
    })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);

    return { days, first, last, expenses, spent, savedFromBudget, savedOther, remaining, budget, perDay, perCategory };
  }

  function goalSaved(state, goalId) {
    return sum(state.deposits.filter((d) => d.goalId === goalId));
  }

  /* ---------- Insight ----------
     One short, kind sentence. We pick the most useful thing to say,
     in priority order, instead of piling up advice. */
  function insight(state, todayKey) {
    const cur = state.settings.currency;
    const fmt = (c) => formatMoney(c, cur, { compact: true });
    const w = weekSummary(state, todayKey);
    const today = spentOn(state.expenses, todayKey);
    const daysLeft = 7 - w.days.indexOf(todayKey); // includes today
    const resetName = DAY_NAMES[state.settings.resetDay];

    if (state.settings.budget <= 0) return 'Set your weekly budget in Settings and I\'ll keep an eye on things.';
    if (w.remaining < 0) return `Oof, ${fmt(-w.remaining)} over this week. Fresh start on ${resetName}.`;
    if (w.remaining === 0) return `Budget used up, right to the cent. Fresh start on ${resetName}.`;

    // What you could spend per day for the rest of the week
    const pace = Math.floor((w.remaining + today) / daysLeft);
    if (today > 0 && today > pace * 1.5 && daysLeft > 1) {
      return `Big spending day! Around ${fmt(Math.floor(w.remaining / (daysLeft - 1)))} a day from here keeps you on track.`;
    }
    const top = w.perCategory[0];
    if (top && w.spent > 0 && top.amount / w.spent >= 0.5 && w.expenses.length >= 3) {
      return `${top.label} is more than half of your spending this week. Interesting.`;
    }
    if (today === 0) return `Nothing spent yet today. You've got about ${fmt(pace)} a day until ${resetName}.`;
    return `Looking good. About ${fmt(Math.floor(w.remaining / daysLeft))} a day gets you to ${resetName}.`;
  }

  /* The pocket buddy's face: a tiny state machine with 3 states.
     happy: at least a fifth of the budget left
     ok:    some left, but it's getting thin
     uhoh:  nothing left or over */
  function mood(state, todayKey) {
    const { budget } = state.settings;
    const left = weekSummary(state, todayKey).remaining;
    if (budget <= 0 || left <= 0) return budget <= 0 ? 'ok' : 'uhoh';
    return left / budget >= 0.2 ? 'happy' : 'ok';
  }

  /* ---------- Saved data ----------
     Anything loaded from localStorage could be old, partial or
     edited by hand. We rebuild a clean state and drop broken rows. */
  function defaultState() {
    return {
      version: 1,
      settings: { budget: 5000, resetDay: 0, currency: 'USD', reminders: false, reminderTime: '19:00', lastCategory: 'food', vibe: 'bubblegum' },
      expenses: [],
      goals: [],
      deposits: [],
      hasSample: false
    };
  }

  function sanitize(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    const s = raw.settings || {};
    const okInt = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_CENTS;
    const catIds = CATEGORIES.map((c) => c.id);

    base.settings = {
      budget: okInt(s.budget) ? s.budget : base.settings.budget,
      resetDay: Number.isInteger(s.resetDay) && s.resetDay >= 0 && s.resetDay <= 6 ? s.resetDay : 0,
      currency: typeof s.currency === 'string' && /^[A-Z]{3}$/.test(s.currency) ? s.currency : 'USD',
      reminders: !!s.reminders,
      reminderTime: /^\d{2}:\d{2}$/.test(s.reminderTime) ? s.reminderTime : '19:00',
      lastCategory: catIds.includes(s.lastCategory) ? s.lastCategory : 'food',
      vibe: VIBES.some((v) => v.id === s.vibe) ? s.vibe : 'bubblegum'
    };
    base.expenses = (Array.isArray(raw.expenses) ? raw.expenses : []).filter((e) =>
      e && typeof e.id === 'string' && okInt(e.amount) && e.amount > 0 && catIds.includes(e.category) && isValidKey(e.date)
    ).map((e) => ({ ...e, note: typeof e.note === 'string' ? e.note.slice(0, 60) : '' }));
    base.goals = (Array.isArray(raw.goals) ? raw.goals : []).filter((g) =>
      g && typeof g.id === 'string' && typeof g.name === 'string' && okInt(g.target) && g.target > 0
    );
    const goalIds = base.goals.map((g) => g.id);
    base.deposits = (Array.isArray(raw.deposits) ? raw.deposits : []).filter((d) =>
      d && goalIds.includes(d.goalId) && okInt(d.amount) && d.amount > 0 && isValidKey(d.date)
    );
    base.hasSample = !!raw.hasSample;
    return base;
  }

  /* ---------- Sample data ----------
     Built relative to today, so the demo always looks current.
     Every sample row carries sample: true so it can be removed
     without touching anything the user added. */
  function sampleData(todayKey, resetDay) {
    const days = weekDays(todayKey, resetDay);
    const idx = days.indexOf(todayKey);
    const rows = [];
    let n = 0;
    const add = (offset, amount, category, note) => {
      const date = addDays(todayKey, offset);
      rows.push({ id: 'sample-' + (++n), amount, category, note, date, createdAt: Date.now() - (100 - n) * 60000, sample: true });
    };
    // Earlier this week (only days that have already happened)
    if (idx >= 2) add(-2, 650, 'food', 'Burrito after practice');
    if (idx >= 2) add(-2, 275, 'drinks', 'Iced tea');
    if (idx >= 1) add(-1, 1299, 'entertainment', 'Movie ticket');
    if (idx >= 1) add(-1, 200, 'transport', 'Bus fare');
    add(0, 425, 'drinks', 'Bubble tea');
    add(0, 350, 'food', 'Snack at school');
    // Last week, so the History arrows have something to show
    add(-7, 900, 'shopping', 'Phone case');
    add(-8, 520, 'food', 'Pizza slice');
    add(-9, 300, 'drinks', 'Smoothie');
    add(-10, 1500, 'entertainment', 'Bowling');

    const goals = [
      { id: 'sample-g1', name: 'Concert tickets', emoji: '🎧', target: 8500, createdAt: Date.now(), sample: true },
      { id: 'sample-g2', name: 'New sneakers', emoji: '👟', target: 12000, createdAt: Date.now(), sample: true }
    ];
    const deposits = [
      { id: 'sample-d1', goalId: 'sample-g1', amount: 3000, date: addDays(todayKey, -12), source: 'other', sample: true },
      { id: 'sample-d2', goalId: 'sample-g1', amount: 500, date: addDays(todayKey, -idx), source: 'budget', sample: true },
      { id: 'sample-d3', goalId: 'sample-g2', amount: 2000, date: addDays(todayKey, -15), source: 'other', sample: true }
    ];
    return { expenses: rows, goals, deposits };
  }

  const api = {
    CATEGORIES, VIBES, DAY_NAMES, MAX_CENTS,
    toKey, fromKey, addDays, isValidKey, weekStart, weekDays, inWeek,
    parseAmount, formatMoney, centsToInput,
    spentOn, weekSummary, goalSaved, insight, mood,
    defaultState, sanitize, sampleData
  };

  // Works in the browser (window.PD) and in Node tests (require)
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PD = api;
})(typeof window !== 'undefined' ? window : globalThis);
