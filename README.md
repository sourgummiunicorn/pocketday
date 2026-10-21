# PocketDay

A daily spending tracker for teens (13–18). No account, no bank, no backend. Everything is saved in the browser with localStorage.

## Run it

Open `index.html` in a browser. That's it. (Some browsers limit localStorage for files opened straight from disk; if saving doesn't stick, run `python3 -m http.server` in this folder and open http://localhost:8000.)

## Files

| File | What it does |
|---|---|
| `index.html` | Structure: four screens, the tab bar, three bottom sheets (add purchase, goal, add money) |
| `styles.css` | Look and layout. All colors are tokens at the top, with a dark theme |
| `logic.js` | Pure money and date math. No DOM, so it can be tested on its own |
| `app.js` | Rendering, forms, navigation, saving, undo |
| `tests/logic.test.js` | 15 unit tests: `node tests/logic.test.js` |
| `tests/e2e.py` | 58 browser checks with Playwright: `python3 tests/e2e.py` |

## How the money works

- **Amounts are stored in cents** (whole numbers). `$4.25` is `425`. This avoids floating point errors like `0.1 + 0.2 = 0.30000000000000004`.
- **Left this week = budget − purchases − savings taken from the budget.**
- Savings are never counted as spending. Money saved from "Other money" (a gift, a job) goes to the goal without touching the budget. Each cent lives in exactly one place.
- **The weekly reset isn't a scheduled job.** The current week is worked out from today's date and the chosen reset day, so a new week starts automatically. Older weeks stay in History.
- One budget amount applies to every week, including past ones in History.

## Data and safety

- Bad input (blank, negative, zero, letters, more than 2 decimals, future dates) shows a plain message next to the field.
- Every delete, edit, save and "Erase everything" can be undone for 6 seconds.
- Saved data is checked on load. Broken or hand-edited rows are dropped instead of crashing the app.
- Sample data is tagged, so "Clear sample data" never removes the user's own entries.

## Teaching hooks

- **State and rendering:** one `state` object; every action changes it, saves, then calls `render()`. Home and History can't disagree because both are drawn from the same data.
- **Representation:** cents vs dollars, date strings vs Date objects.
- **Event delegation:** one click listener routes every `data-action` button in `app.js`.
- **Testing pure functions:** `logic.js` runs in Node without a browser.

## Known limits of this first version

- The daily check-in is an in-app nudge on Home, not a phone notification (that needs a service worker or native app).
- Changing currency changes the symbol only; it doesn't convert amounts.
- Deleting a goal also removes its savings, so money saved from this week's budget returns to "left this week".
