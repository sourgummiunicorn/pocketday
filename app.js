/* ==========================================================
   PocketDay — app.js
   Everything the user sees and touches.

   The pattern is simple and worth teaching:
     1. One `state` object holds all the data.
     2. Every change goes through a small function that edits
        `state`, saves it, and calls render().
     3. render() redraws the screens from `state`.
   Because the screen is always rebuilt from the data, Home and
   History can never disagree with each other.
   ========================================================== */
(function () {
  'use strict';

  const PD = window.PD;
  const STORAGE_KEY = 'pocketday:v1';
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------- Saving and loading ----------
     localStorage can be missing or blocked (private windows, some
     embedded views). Every access is wrapped in try/catch, and the
     app keeps working in memory if storage isn't available. */
  let storageWorks = true;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return PD.sanitize(JSON.parse(raw));
    } catch (e) {
      storageWorks = false;
    }
    return null; // first visit
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      if (storageWorks) toast("Can't save on this device. Changes last until you close the page.");
      storageWorks = false;
    }
  }

  const today = () => PD.toKey(new Date());
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* First visit: start with sample data so there's something to explore */
  let state = load();
  if (!state) {
    state = PD.defaultState();
    addSample();
    save();
  }

  function addSample() {
    removeSample();
    const s = PD.sampleData(today(), state.settings.resetDay);
    state.expenses.push(...s.expenses);
    state.goals.push(...s.goals);
    state.deposits.push(...s.deposits);
    state.hasSample = true;
  }
  function removeSample() {
    state.expenses = state.expenses.filter((e) => !e.sample);
    state.goals = state.goals.filter((g) => !g.sample);
    state.deposits = state.deposits.filter((d) => !d.sample);
    state.hasSample = false;
  }
  const hasSampleRows = () =>
    state.expenses.some((e) => e.sample) || state.goals.some((g) => g.sample);

  /* ---------- Formatting helpers ---------- */
  const money = (c, compact) => PD.formatMoney(c, state.settings.currency, { compact });
  const catById = (id) => PD.CATEGORIES.find((c) => c.id === id) || PD.CATEGORIES[5];
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function currencySymbol() {
    try {
      const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency }).formatToParts(0);
      return (parts.find((p) => p.type === 'currency') || {}).value || '$';
    } catch (e) { return '$'; }
  }

  function dayLabel(key) {
    const t = today();
    if (key === t) return 'Today';
    if (key === PD.addDays(t, -1)) return 'Yesterday';
    return PD.fromKey(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const shortDate = (key, opts) => PD.fromKey(key).toLocaleDateString(undefined, opts);

  function catIcon(id) {
    return `<span class="cat-icon c-${id}" aria-hidden="true"><svg><use href="#i-${id}"/></svg></span>`;
  }

  // Newest first: by date, then by when it was entered
  const newestFirst = (a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1);

  /* ==========================================================
     RENDER
     ========================================================== */
  let view = 'home';
  let historyRef = today(); // any date inside the week shown in History

  function render() {
    const t = today();
    document.documentElement.dataset.vibe = state.settings.vibe;
    $('#todayLabel').textContent = PD.fromKey(t).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    $$('[data-cur-symbol]').forEach((el) => (el.textContent = currencySymbol()));
    renderHome(t);
    renderHistory(t);
    renderGoals();
    renderSettings();
  }

  /* ---------- Home ---------- */
  function renderHome(t) {
    const w = PD.weekSummary(state, t);
    const { budget } = state.settings;

    $('#todayAmount').textContent = money(PD.spentOn(state.expenses, t));

    const over = w.remaining < 0;
    $('.week-card').classList.toggle('over', over);
    $('#weekLeft').textContent = money(Math.abs(w.remaining), true);
    $('#weekLeftLabel').textContent = over ? 'over budget' : 'left this week';
    $('#weekOf').textContent = `of ${money(budget, true)} weekly budget`;
    $('#resetChip').textContent = 'Resets ' + PD.DAY_NAMES[state.settings.resetDay].slice(0, 3);

    // Bar widths: spent first, then saved, never past 100% in total
    const spentPct = budget > 0 ? Math.min(w.spent / budget, 1) * 100 : 0;
    const savedPct = budget > 0 ? Math.min(w.savedFromBudget / budget, 1 - spentPct / 100) * 100 : 0;
    $('#barSpent').style.width = spentPct + '%';
    $('#barSaved').style.width = Math.max(savedPct, 0) + '%';
    $('#weekBar').setAttribute('aria-label',
      `${money(w.spent)} spent and ${money(w.savedFromBudget)} saved out of ${money(budget)} this week`);
    $('#legendSpent').textContent = money(w.spent, true);
    $('#legendSaved').textContent = money(w.savedFromBudget, true);
    $('#legendSavedWrap').hidden = w.savedFromBudget === 0;

    $('#insight').textContent = PD.insight(state, t);
    $('#buddy').dataset.mood = PD.mood(state, t);

    const recent = [...state.expenses].sort(newestFirst).slice(0, 3);
    $('#recentList').innerHTML = recent.length
      ? recent.map((e) => `<li>${itemButton(e)}</li>`).join('')
      : '<li class="empty">Nothing logged yet. Tap + after your next purchase.</li>';

    const sample = hasSampleRows();
    $('#samplePill').hidden = !sample;
    $('#todayLabel').hidden = sample; // the pill takes the date's place while sample data is showing

    // Reminder: only if turned on, nothing logged today, and it's past the chosen time
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    $('#reminderNotice').hidden = !(state.settings.reminders &&
      !state.expenses.some((e) => e.date === t) && hhmm >= state.settings.reminderTime);
  }

  // inGroup: inside a History day group the day is already the heading,
  // so the row only needs the category
  function itemButton(e, inGroup) {
    const c = catById(e.category);
    const title = e.note ? escapeHtml(e.note) : c.label;
    const sub = inGroup ? (e.note ? c.label : 'No note')
      : (e.note ? `${c.label} · ${dayLabel(e.date)}` : dayLabel(e.date));
    return `<button type="button" class="item" data-edit="${e.id}" aria-label="${escapeHtml(title)}, ${money(e.amount)}, ${sub}. Edit">
      ${catIcon(c.id)}
      <span class="item-main"><span class="item-title">${title}</span><span class="item-sub">${sub}</span></span>
      <span class="item-amount">${money(e.amount)}</span>
    </button>`;
  }

  /* ---------- History ---------- */
  function renderHistory(t) {
    const w = PD.weekSummary(state, historyRef);
    const { budget } = state.settings;
    const thisWeekStart = PD.weekStart(t, state.settings.resetDay);
    const weeksAgo = Math.round((PD.fromKey(thisWeekStart) - PD.fromKey(w.first)) / (7 * 864e5));

    const sameMonth = w.first.slice(0, 7) === w.last.slice(0, 7);
    $('#weekRange').textContent =
      shortDate(w.first, { month: 'short', day: 'numeric' }) + ' – ' +
      shortDate(w.last, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
    $('#weekTag').textContent = weeksAgo === 0 ? 'This week' : weeksAgo === 1 ? 'Last week' : `${weeksAgo} weeks ago`;
    $('#nextWeek').disabled = weeksAgo <= 0;

    $('#hSpent').textContent = money(w.spent, true);
    $('#hSaved').textContent = money(w.savedFromBudget + w.savedOther, true);
    const left = $('#hLeft');
    left.textContent = (w.remaining < 0 ? '−' : '') + money(Math.abs(w.remaining), true);
    left.classList.toggle('neg', w.remaining < 0);
    left.previousElementSibling.textContent = w.remaining < 0 ? 'Over' : 'Left';

    // Chart: one scale for bars AND the daily pace line
    const pace = budget > 0 ? Math.round(budget / 7) : 0;
    const max = Math.max(pace, ...w.perDay.map((d) => d.amount), 1);
    const LABEL_SPACE = 34; // px reserved under the track for the day letter + value
    const chart = $('#chart');
    chart.innerHTML = w.perDay.map((d) => {
      const h = (d.amount / max) * 100;
      const letter = shortDate(d.date, { weekday: 'narrow' });
      return `<div class="chart-col${d.date === t ? ' is-today' : ''}">
        <span class="chart-val">${d.amount ? money(d.amount, true) : ''}</span>
        <div class="chart-track"><div class="chart-bar${d.amount ? '' : ' zero'}" style="height:${d.amount ? h : 2}%"></div></div>
        <span class="chart-day">${letter}</span>
      </div>`;
    }).join('');
    if (pace > 0) {
      // Place the pace line at the same height a bar of `pace` would reach
      const line = document.createElement('div');
      line.className = 'chart-pace';
      const track = chart.querySelector('.chart-track');
      const trackTop = track.offsetTop, trackH = track.offsetHeight;
      line.style.top = trackTop + trackH * (1 - pace / max) + 'px';
      line.innerHTML = `<span>${money(pace, true)}/day</span>`;
      chart.appendChild(line);
    }
    chart.setAttribute('aria-label', 'Spending per day: ' +
      w.perDay.map((d) => `${shortDate(d.date, { weekday: 'long' })} ${money(d.amount)}`).join(', '));

    // Categories
    $('#catList').innerHTML = w.perCategory.length
      ? w.perCategory.map((c) => `<li class="cat-row">
          ${catIcon(c.id)}
          <div class="cat-meta"><span>${c.label}</span>
            <div class="cat-track c-${c.id}" style="background:var(--surface-2)"><div class="cat-fill" style="width:${(c.amount / w.perCategory[0].amount) * 100}%"></div></div>
          </div>
          <span class="cat-amt">${money(c.amount)}</span>
        </li>`).join('')
      : '<li class="muted small">Nothing spent this week.</li>';

    // Day groups, newest day first
    const byDay = [...w.days].reverse().map((k) => ({
      key: k, items: w.expenses.filter((e) => e.date === k).sort(newestFirst)
    })).filter((g) => g.items.length);

    $('#dayGroups').innerHTML = byDay.length ? byDay.map((g) => `
      <section class="day-group">
        <div class="day-head"><h3>${dayLabel(g.key)}</h3><span>${money(g.items.reduce((s, e) => s + e.amount, 0))}</span></div>
        <ul class="list">${g.items.map((e) => `<li class="list-row">${itemButton(e, true)}
          <button type="button" class="item-del" data-delete="${e.id}" aria-label="Delete ${escapeHtml(e.note || catById(e.category).label)}, ${money(e.amount)}"><svg><use href="#i-close"/></svg></button></li>`).join('')}
        </ul>
      </section>`).join('')
      : '<p class="empty">No purchases this week. A quiet one!</p>';
  }

  /* ---------- Goals ---------- */
  function renderGoals() {
    const list = $('#goalList');
    if (!state.goals.length) {
      list.innerHTML = '<li class="empty">No goals yet. Concert? Sneakers? A trip? Tap New goal.</li>';
      return;
    }
    list.innerHTML = state.goals.map((g) => {
      const saved = PD.goalSaved(state, g.id);
      const pct = Math.min(saved / g.target, 1);
      const done = saved >= g.target;
      return `<li class="card goal${done ? ' done' : ''}">${done ? '<span class="stamp">Got it!</span>' : ''}
        <div class="goal-top">
          <span class="goal-emoji" aria-hidden="true">${g.emoji ? escapeHtml(g.emoji) : '⭐'}</span>
          <div class="goal-info">
            <p class="goal-name">${escapeHtml(g.name)}</p>
            <p class="goal-sub">${money(saved, true)} of ${money(g.target, true)}${done ? '' : ` · ${money(g.target - saved, true)} to go`}</p>
          </div>
          <span class="goal-pct">${Math.floor(pct * 100)}%</span>
        </div>
        <div class="bar" role="progressbar" aria-label="${escapeHtml(g.name)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(pct * 100)}">
          <span class="bar-fill bar-saved" style="width:${pct * 100}%"></span>
        </div>
        <div class="goal-actions">
          <button type="button" class="btn btn-ghost" data-goal-edit="${g.id}">Edit</button>
          ${done ? '' : `<button type="button" class="btn" data-goal-add="${g.id}">Add money</button>`}
        </div>
      </li>`;
    }).join('');
  }

  /* ---------- Settings ---------- */
  function renderSettings() {
    const s = state.settings;
    const budgetInput = $('#setBudget');
    if (document.activeElement !== budgetInput) budgetInput.value = PD.centsToInput(s.budget);
    $('#setReset').value = String(s.resetDay);
    $('#setCurrency').value = s.currency;
    $$('input[name="vibe"]').forEach((r) => (r.checked = r.value === s.vibe));
    $('#setReminders').checked = s.reminders;
    $('#setReminderTime').value = s.reminderTime;
    $('#reminderTimeField').hidden = !s.reminders;
    const sample = hasSampleRows();
    $('#clearSampleBtn').hidden = !sample;
    $('#loadSampleBtn').hidden = sample;
  }

  /* ==========================================================
     NAVIGATION
     ========================================================== */
  function go(name) {
    view = name;
    $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + name));
    $$('.tab').forEach((t) => {
      if (t.dataset.go === name) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    if (name === 'history') { historyRef = today(); renderHistory(today()); }
    window.scrollTo(0, 0);
  }

  /* ==========================================================
     TOAST + UNDO
     One undo slot: the last change can be taken back for 6 seconds.
     ========================================================== */
  let toastTimer = null;
  let undoFn = null;

  function toast(message, undo) {
    $('#toastText').textContent = message;
    undoFn = undo || null;
    $('#toastUndo').hidden = !undo;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 6000 : 2600);
  }
  function hideToast() { $('#toast').hidden = true; undoFn = null; }

  $('#toastUndo').addEventListener('click', () => {
    if (undoFn) { undoFn(); save(); render(); }
    hideToast();
  });

  // Take a copy of the data now, so Undo can put it all back exactly
  function snapshot() { return JSON.parse(JSON.stringify(state)); }
  function restore(snap) { return () => { state = snap; }; }

  /* ==========================================================
     FORM HELPERS
     ========================================================== */
  function showError(input, errEl, message) {
    errEl.textContent = message || '';
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function openSheet(dialog, focusEl) {
    dialog.showModal();
    // Focus after the sheet is on screen, so phones open the number keypad
    requestAnimationFrame(() => focusEl && focusEl.focus());
  }

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  // Tapping the dark area outside a sheet closes it
  $$('dialog').forEach((d) => d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); }));

  /* ==========================================================
     ADD / EDIT PURCHASE
     ========================================================== */
  const expSheet = $('#expenseSheet');
  const expAmount = $('#expAmount');
  const expDate = $('#expDate');
  let editingId = null;

  // Build the six category choices once
  $('#catGrid').innerHTML = PD.CATEGORIES.map((c) => `
    <label class="cat-opt c-${c.id}">
      <input type="radio" name="expCat" value="${c.id}">
      <span><svg aria-hidden="true"><use href="#i-${c.id}"/></svg>${c.label === 'Transportation' ? 'Transport' : c.label}</span>
    </label>`).join('');

  function openExpense(id) {
    const e = id ? state.expenses.find((x) => x.id === id) : null;
    editingId = e ? e.id : null;
    $('#expenseTitle').textContent = e ? 'Edit purchase' : 'Add a purchase';
    $('#expSave').textContent = e ? 'Save changes' : 'Save';
    $('#expDelete').hidden = !e;
    expAmount.value = e ? PD.centsToInput(e.amount) : '';
    $('#expNote').value = e ? e.note : '';
    expDate.value = e ? e.date : today();
    expDate.max = today();
    const cat = e ? e.category : state.settings.lastCategory;
    $$('input[name="expCat"]').forEach((r) => (r.checked = r.value === cat));
    showError(expAmount, $('#expAmountErr'), '');
    showError(expDate, $('#expDateErr'), '');
    openSheet(expSheet, expAmount);
  }

  // Clear the error as soon as the person starts fixing it
  expAmount.addEventListener('input', () => showError(expAmount, $('#expAmountErr'), ''));

  $('#expenseForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const parsed = PD.parseAmount(expAmount.value);
    if (parsed.error) { showError(expAmount, $('#expAmountErr'), parsed.error); expAmount.focus(); return; }

    const date = expDate.value || today(); // a cleared date field just means today
    if (!PD.isValidKey(date)) { showError(expDate, $('#expDateErr'), 'Pick a valid date.'); return; }
    if (date > today()) { showError(expDate, $('#expDateErr'), "That date hasn't happened yet."); return; }
    showError(expDate, $('#expDateErr'), '');

    const category = ($('input[name="expCat"]:checked') || {}).value || 'other';
    const note = $('#expNote').value.trim().slice(0, 60);
    const snap = snapshot();

    if (editingId) {
      const e = state.expenses.find((x) => x.id === editingId);
      Object.assign(e, { amount: parsed.cents, category, note, date });
      delete e.sample; // once edited, it's the user's own entry
      toast('Changes saved', restore(snap));
    } else {
      state.expenses.push({ id: uid(), amount: parsed.cents, category, note, date, createdAt: Date.now() });
      toast(`Added ${money(parsed.cents)} for ${catById(category).label}`, restore(snap));
    }
    state.settings.lastCategory = category;
    save();
    expSheet.close();
    render();
    bump($('#todayAmount'));
  });

  function deleteExpense(id) {
    const e = state.expenses.find((x) => x.id === id);
    if (!e) return;
    const snap = snapshot();
    state.expenses = state.expenses.filter((x) => x.id !== id);
    save();
    render();
    toast(`Deleted ${e.note || catById(e.category).label} (${money(e.amount)})`, restore(snap));
  }

  $('#expDelete').addEventListener('click', () => {
    const id = editingId;
    expSheet.close();
    deleteExpense(id);
  });

  /* ==========================================================
     GOALS
     ========================================================== */
  const goalSheet = $('#goalSheet');
  const EMOJIS = ['', '🎧', '👟', '🎮', '📱', '🎁', '✈️', '🎸', '🛹', '📚', '🎨', '🐶'];
  let editingGoalId = null;

  $('#emojiGrid').innerHTML = EMOJIS.map((em, i) => `
    <label><input type="radio" name="goalEmoji" value="${em}" ${i === 0 ? 'checked' : ''} aria-label="${em || 'No emoji'}">
    <span aria-hidden="true">${em || '<small class="muted">None</small>'}</span></label>`).join('');

  function openGoal(id) {
    const g = id ? state.goals.find((x) => x.id === id) : null;
    editingGoalId = g ? g.id : null;
    $('#goalTitle').textContent = g ? 'Edit goal' : 'New goal';
    $('#goalDelete').hidden = !g;
    $('#goalName').value = g ? g.name : '';
    $('#goalTarget').value = g ? PD.centsToInput(g.target) : '';
    const em = g ? g.emoji || '' : '';
    $$('input[name="goalEmoji"]').forEach((r) => (r.checked = r.value === em));
    showError($('#goalName'), $('#goalNameErr'), '');
    showError($('#goalTarget'), $('#goalTargetErr'), '');
    openSheet(goalSheet, $('#goalName'));
  }

  $('#goalForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('#goalName').value.trim();
    const parsed = PD.parseAmount($('#goalTarget').value);
    showError($('#goalName'), $('#goalNameErr'), name ? '' : 'Give your goal a name.');
    showError($('#goalTarget'), $('#goalTargetErr'), parsed.error || '');
    if (!name) { $('#goalName').focus(); return; }
    if (parsed.error) { $('#goalTarget').focus(); return; }

    const emoji = ($('input[name="goalEmoji"]:checked') || {}).value || '';
    const snap = snapshot();
    if (editingGoalId) {
      Object.assign(state.goals.find((g) => g.id === editingGoalId), { name, target: parsed.cents, emoji });
      toast('Goal updated', restore(snap));
    } else {
      state.goals.push({ id: uid(), name, target: parsed.cents, emoji, createdAt: Date.now() });
      toast('Goal created', restore(snap));
    }
    save();
    goalSheet.close();
    render();
  });

  $('#goalDelete').addEventListener('click', () => {
    const g = state.goals.find((x) => x.id === editingGoalId);
    if (!g) return;
    const snap = snapshot();
    // Removing a goal removes its savings too, so nothing is left counted twice
    state.goals = state.goals.filter((x) => x.id !== g.id);
    state.deposits = state.deposits.filter((d) => d.goalId !== g.id);
    save();
    goalSheet.close();
    render();
    toast(`Deleted "${g.name}"`, restore(snap));
  });

  /* ---------- Add money to a goal ---------- */
  const depSheet = $('#depositSheet');
  const depAmount = $('#depAmount');
  let depositGoalId = null;

  function openDeposit(id) {
    const g = state.goals.find((x) => x.id === id);
    if (!g) return;
    depositGoalId = id;
    $('#depositTitle').textContent = `Add to ${g.name}`;
    depAmount.value = '';
    const left = PD.weekSummary(state, today()).remaining;
    $('#depLeftHint').textContent = left > 0 ? `${money(left)} left` : 'Nothing left this week';
    $('input[name="depSource"][value="' + (left > 0 ? 'budget' : 'other') + '"]').checked = true;
    showError(depAmount, $('#depAmountErr'), '');
    openSheet(depSheet, depAmount);
  }
  depAmount.addEventListener('input', () => showError(depAmount, $('#depAmountErr'), ''));

  $('#depositForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const g = state.goals.find((x) => x.id === depositGoalId);
    const parsed = PD.parseAmount(depAmount.value);
    const fail = (msg) => { showError(depAmount, $('#depAmountErr'), msg); depAmount.focus(); };
    if (parsed.error) return fail(parsed.error);

    const toGo = g.target - PD.goalSaved(state, g.id);
    if (parsed.cents > toGo) return fail(`Only ${money(toGo)} more reaches this goal.`);

    const source = $('input[name="depSource"]:checked').value;
    const left = PD.weekSummary(state, today()).remaining;
    if (source === 'budget' && parsed.cents > left) {
      return fail(left > 0
        ? `You have ${money(left)} left this week. Try less, or choose Other money.`
        : 'Nothing is left in this week\'s budget. Choose Other money instead.');
    }

    const snap = snapshot();
    state.deposits.push({ id: uid(), goalId: g.id, amount: parsed.cents, date: today(), source, createdAt: Date.now() });
    save();
    depSheet.close();
    render();
    const reached = PD.goalSaved(state, g.id) >= g.target;
    toast(reached ? `You did it! ${g.name} is fully saved.` : `Saved ${money(parsed.cents)} for ${g.name}`, restore(snap));
    if (reached) confetti();
  });

  /* ==========================================================
     SETTINGS
     ========================================================== */
  /* ---------- Vibe picker ---------- */
  $('#vibeGrid').innerHTML = PD.VIBES.map((v) => `
    <label class="vibe">
      <input type="radio" name="vibe" value="${v.id}">
      <span class="swatch" style="--sw:${v.color}" aria-hidden="true"><svg><use href="#i-check"/></svg></span>
      <span>${v.label}</span>
    </label>`).join('');
  $('#vibeGrid').addEventListener('change', (ev) => {
    if (ev.target.name !== 'vibe') return;
    state.settings.vibe = ev.target.value;
    save(); render();
  });

  /* ---------- Little moments ----------
     Two small celebrations, both skipped for people who turn
     off motion in their device settings. */
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function bump(el) {
    if (calm()) return;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  function confetti() {
    if (calm()) return;
    const box = document.createElement('div');
    box.className = 'confetti';
    const colors = [PD.VIBES.find((v) => v.id === state.settings.vibe).color, '#FFD45C', '#4FD9A3', '#74BEFF', '#FFFFFF'];
    for (let i = 0; i < 36; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
      p.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
      p.style.animationDelay = Math.random() * 0.25 + 's';
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1800);
  }

  $('#setReset').innerHTML = PD.DAY_NAMES.map((d, i) => `<option value="${i}">${d}</option>`).join('');

  $('#settingsForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = $('#setBudget');
    const parsed = PD.parseAmount(input.value);
    if (parsed.error) { showError(input, $('#setBudgetErr'), parsed.error); input.focus(); return; }
    showError(input, $('#setBudgetErr'), '');
    const snap = snapshot();
    state.settings.budget = parsed.cents;
    state.settings.resetDay = Number($('#setReset').value);
    state.settings.currency = $('#setCurrency').value;
    save();
    input.blur();
    render();
    toast('Settings saved', restore(snap));
  });
  $('#setBudget').addEventListener('input', () => showError($('#setBudget'), $('#setBudgetErr'), ''));

  $('#setReminders').addEventListener('change', (ev) => {
    state.settings.reminders = ev.target.checked;
    save(); render();
    toast(ev.target.checked ? 'Daily check-in is on' : 'Daily check-in is off');
  });
  $('#setReminderTime').addEventListener('change', (ev) => {
    if (/^\d{2}:\d{2}$/.test(ev.target.value)) { state.settings.reminderTime = ev.target.value; save(); render(); }
  });

  // Erase everything: a two-step confirm built into the page
  $('#resetAllBtn').addEventListener('click', () => { $('#resetConfirm').hidden = false; $('#resetAllBtn').hidden = true; });
  $('#resetCancel').addEventListener('click', () => { $('#resetConfirm').hidden = true; $('#resetAllBtn').hidden = false; });
  $('#resetYes').addEventListener('click', () => {
    const snap = snapshot();
    state = PD.defaultState();
    save();
    $('#resetConfirm').hidden = true; $('#resetAllBtn').hidden = false;
    render();
    toast('Everything erased', restore(snap));
  });

  /* ==========================================================
     ONE CLICK HANDLER FOR THE WHOLE PAGE
     Buttons say what they do with data- attributes, and this
     single listener routes them. New buttons need no new wiring.
     ========================================================== */
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-go],[data-action],[data-edit],[data-delete],[data-goal-edit],[data-goal-add]');
    if (!el) return;
    const d = el.dataset;
    if (d.go) return go(d.go);
    if (d.edit) return openExpense(d.edit);
    if (d.delete) return deleteExpense(d.delete);
    if (d.goalEdit) return openGoal(d.goalEdit);
    if (d.goalAdd) return openDeposit(d.goalAdd);
    switch (d.action) {
      case 'open-add': return openExpense(null);
      case 'new-goal': return openGoal(null);
      case 'clear-sample': {
        const snap = snapshot();
        removeSample(); save(); render();
        return toast('Sample data cleared. Everything here is yours now.', restore(snap));
      }
      case 'load-sample': {
        const snap = snapshot();
        addSample(); save(); render();
        return toast('Sample data added', restore(snap));
      }
    }
  });

  $('#prevWeek').addEventListener('click', () => { historyRef = PD.addDays(historyRef, -7); renderHistory(today()); });
  $('#nextWeek').addEventListener('click', () => {
    const next = PD.addDays(historyRef, 7);
    if (next <= today() || PD.inWeek(next, today(), state.settings.resetDay)) historyRef = next;
    renderHistory(today());
  });

  /* When the app comes back to the front (maybe the next day, maybe a
     new budget week), redraw so "today" and the week are current.
     That's all a weekly reset needs: the week is worked out from
     the date, so there's nothing to wipe. */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  setInterval(render, 60 * 1000); // keeps the reminder and midnight rollover current

  // Another tab changed the data? Pick it up.
  window.addEventListener('storage', (ev) => {
    if (ev.key === STORAGE_KEY) { const s = load(); if (s) { state = s; render(); } }
  });

  render();
  window.addEventListener('resize', () => { if (view === 'history') renderHistory(today()); });
})();
