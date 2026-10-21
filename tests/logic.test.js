// Run with: node tests/logic.test.js
// Tests the pure money and date logic, no browser needed.
const assert = require('assert');
const PD = require('../logic.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

function makeState(over = {}) {
  const s = PD.defaultState();
  s.settings.budget = 5000; // $50
  return Object.assign(s, over);
}
const exp = (id, amount, date, category = 'food') => ({ id, amount, date, category, note: '', createdAt: 0 });

console.log('Amount parsing');
test('plain and decimal amounts become cents', () => {
  assert.deepStrictEqual(PD.parseAmount('4'), { cents: 400 });
  assert.deepStrictEqual(PD.parseAmount('4.5'), { cents: 450 });
  assert.deepStrictEqual(PD.parseAmount('4.25'), { cents: 425 });
  assert.deepStrictEqual(PD.parseAmount('.99'), { cents: 99 });
  assert.deepStrictEqual(PD.parseAmount(' $12.00 '), { cents: 1200 });
  assert.deepStrictEqual(PD.parseAmount('3,50'), { cents: 350 });
  assert.deepStrictEqual(PD.parseAmount('1,250.75'), { cents: 125075 });
});
test('no floating point drift: 0.1 + 0.2 style values', () => {
  assert.strictEqual(PD.parseAmount('0.1').cents + PD.parseAmount('0.2').cents, 30);
  assert.strictEqual(PD.parseAmount('19.99').cents, 1999);
  assert.strictEqual(PD.parseAmount('1.15').cents, 115); // 1.15*100 = 114.999... in floats
});
test('blank, negative, zero, junk and huge amounts are rejected with a reason', () => {
  for (const bad of ['', '   ', null, undefined]) assert.ok(PD.parseAmount(bad).error.includes('Enter an amount'));
  assert.ok(PD.parseAmount('-5').error.includes('negative'));
  assert.ok(PD.parseAmount('0').error.includes('above zero'));
  assert.ok(PD.parseAmount('0.00').error.includes('above zero'));
  for (const bad of ['abc', '4.555', '1.2.3', 'e5', '5e2', 'NaN', 'Infinity', '--3'])
    assert.ok(PD.parseAmount(bad).error, bad + ' should fail');
  assert.ok(PD.parseAmount('100000.01').error.includes('too big'));
  assert.deepStrictEqual(PD.parseAmount('100000'), { cents: 10000000 });
});

console.log('Weeks and reset days');
test('week starts on the chosen reset day (Tue Oct 20, 2026)', () => {
  const t = '2026-10-20'; // a Tuesday
  assert.strictEqual(PD.fromKey(t).getDay(), 2);
  assert.strictEqual(PD.weekStart(t, 0), '2026-10-18'); // Sunday
  assert.strictEqual(PD.weekStart(t, 1), '2026-10-19'); // Monday
  assert.strictEqual(PD.weekStart(t, 2), '2026-10-20'); // Tuesday: today is day one
  assert.strictEqual(PD.weekStart(t, 3), '2026-10-14'); // Wednesday: last week's
  assert.strictEqual(PD.weekStart(t, 6), '2026-10-17'); // Saturday
});
test('every week has exactly 7 consecutive days, for every reset day', () => {
  for (let r = 0; r < 7; r++) {
    const days = PD.weekDays('2026-10-20', r);
    assert.strictEqual(days.length, 7);
    assert.ok(days.includes('2026-10-20'));
    assert.strictEqual(PD.fromKey(days[0]).getDay(), r);
  }
});
test('weeks cross month and year boundaries and DST changes correctly', () => {
  assert.deepStrictEqual(PD.weekDays('2026-12-31', 0), ['2026-12-27','2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02']);
  assert.strictEqual(PD.addDays('2026-11-01', 1), '2026-11-02'); // US DST ends Nov 1, 2026
  assert.strictEqual(PD.addDays('2026-03-08', 1), '2026-03-09'); // US DST starts
});
test('budget resets: spending last week does not reduce this week', () => {
  const s = makeState({ expenses: [exp('a', 1000, '2026-10-17'), exp('b', 300, '2026-10-19')] });
  // Sunday reset: Oct 17 (Sat) is last week, Oct 19 (Mon) is this week
  let w = PD.weekSummary(s, '2026-10-20');
  assert.strictEqual(w.spent, 300);
  assert.strictEqual(w.remaining, 4700);
  // Change reset day to Tuesday: now only today counts, both are last week
  s.settings.resetDay = 2;
  w = PD.weekSummary(s, '2026-10-20');
  assert.strictEqual(w.spent, 0);
  assert.strictEqual(w.remaining, 5000);
  // Saturday reset: both Oct 17 and Oct 19 are in this week
  s.settings.resetDay = 6;
  assert.strictEqual(PD.weekSummary(s, '2026-10-20').spent, 1300);
});

console.log('Spending and savings');
test('today and weekly totals add up', () => {
  const s = makeState({ expenses: [exp('a', 425, '2026-10-20', 'drinks'), exp('b', 350, '2026-10-20'), exp('c', 1299, '2026-10-19', 'entertainment')] });
  assert.strictEqual(PD.spentOn(s.expenses, '2026-10-20'), 775);
  const w = PD.weekSummary(s, '2026-10-20');
  assert.strictEqual(w.spent, 2074);
  assert.strictEqual(w.remaining, 5000 - 2074);
  assert.strictEqual(w.perDay.find((d) => d.date === '2026-10-20').amount, 775);
  assert.deepStrictEqual(w.perCategory.map((c) => [c.id, c.amount]), [['entertainment', 1299], ['drinks', 425], ['food', 350]]);
});
test('savings from budget lower what is left but are not counted as spending', () => {
  const s = makeState({
    expenses: [exp('a', 1000, '2026-10-20')],
    goals: [{ id: 'g', name: 'Shoes', target: 6000 }],
    deposits: [{ id: 'd1', goalId: 'g', amount: 1500, date: '2026-10-19', source: 'budget' }]
  });
  const w = PD.weekSummary(s, '2026-10-20');
  assert.strictEqual(w.spent, 1000);           // spending is only purchases
  assert.strictEqual(w.savedFromBudget, 1500);
  assert.strictEqual(w.remaining, 2500);       // 5000 - 1000 - 1500, each cent counted once
  assert.strictEqual(PD.goalSaved(s, 'g'), 1500);
});
test('savings from other money do not touch the budget', () => {
  const s = makeState({
    goals: [{ id: 'g', name: 'Shoes', target: 6000 }],
    deposits: [{ id: 'd1', goalId: 'g', amount: 2000, date: '2026-10-20', source: 'other' }]
  });
  const w = PD.weekSummary(s, '2026-10-20');
  assert.strictEqual(w.remaining, 5000);
  assert.strictEqual(w.savedOther, 2000);
  assert.strictEqual(PD.goalSaved(s, 'g'), 2000);
});
test('going over budget gives a negative remaining and a kind insight', () => {
  const s = makeState({ expenses: [exp('a', 6250, '2026-10-20')] });
  assert.strictEqual(PD.weekSummary(s, '2026-10-20').remaining, -1250);
  assert.ok(PD.insight(s, '2026-10-20').includes('over this week'));
});
test('editing and deleting an expense changes totals', () => {
  const s = makeState({ expenses: [exp('a', 500, '2026-10-20'), exp('b', 700, '2026-10-20')] });
  s.expenses.find((e) => e.id === 'a').amount = 900;              // edit
  assert.strictEqual(PD.weekSummary(s, '2026-10-20').spent, 1600);
  s.expenses.find((e) => e.id === 'b').date = '2026-10-10';       // move to an older week
  assert.strictEqual(PD.weekSummary(s, '2026-10-20').spent, 900);
  s.expenses = s.expenses.filter((e) => e.id !== 'a');            // delete
  assert.strictEqual(PD.weekSummary(s, '2026-10-20').spent, 0);
});
test('insight always returns a short sentence', () => {
  const s = makeState();
  for (const k of ['2026-10-18', '2026-10-20', '2026-10-24']) {
    const msg = PD.insight(s, k);
    assert.ok(typeof msg === 'string' && msg.length > 10 && msg.length < 120, msg);
  }
});

test('buddy mood follows the budget: happy, ok, uh-oh', () => {
  const s = makeState();
  assert.strictEqual(PD.mood(s, '2026-10-20'), 'happy');               // $50 left of $50
  s.expenses = [exp('a', 4100, '2026-10-20')];
  assert.strictEqual(PD.mood(s, '2026-10-20'), 'ok');                  // $9 left, under a fifth
  s.expenses = [exp('a', 5000, '2026-10-20')];
  assert.strictEqual(PD.mood(s, '2026-10-20'), 'uhoh');                // nothing left
  s.expenses = [exp('a', 6000, '2026-10-20')];
  assert.strictEqual(PD.mood(s, '2026-10-20'), 'uhoh');                // over
});

console.log('Saved data safety');
test('corrupted or hand-edited storage is cleaned, not crashed on', () => {
  assert.deepStrictEqual(PD.sanitize(null), PD.defaultState());
  assert.deepStrictEqual(PD.sanitize('garbage'), PD.defaultState());
  const dirty = PD.sanitize({
    settings: { budget: -50, resetDay: 9, currency: 'dollars' },
    expenses: [exp('ok', 300, '2026-10-20'), exp('neg', -300, '2026-10-20'), exp('float', 3.5, '2026-10-20'),
               exp('baddate', 300, '2026-02-31'), { id: 'x', amount: 300, date: '2026-10-20', category: 'rockets' }, null],
    goals: [{ id: 'g', name: 'Bike', target: 10000 }, { id: 'h', name: 'Bad', target: 0 }],
    deposits: [{ id: 'd', goalId: 'g', amount: 100, date: '2026-10-20' }, { id: 'e', goalId: 'missing', amount: 100, date: '2026-10-20' }]
  });
  assert.strictEqual(dirty.settings.budget, 5000);
  assert.strictEqual(dirty.settings.resetDay, 0);
  assert.strictEqual(dirty.settings.currency, 'USD');
  assert.strictEqual(dirty.settings.vibe, 'bubblegum');
  assert.deepStrictEqual(dirty.expenses.map((e) => e.id), ['ok']);
  assert.deepStrictEqual(dirty.goals.map((g) => g.id), ['g']);
  assert.deepStrictEqual(dirty.deposits.map((d) => d.id), ['d']);
});
test('sample data only lands on days that already happened', () => {
  for (let r = 0; r < 7; r++) {
    const s = PD.sampleData('2026-10-20', r);
    assert.ok(s.expenses.every((e) => e.date <= '2026-10-20' && e.sample));
    assert.ok(s.deposits.every((d) => d.date <= '2026-10-20'));
  }
});

console.log(`\n${passed} tests passed` + (process.exitCode ? ' (some failed)' : ''));
