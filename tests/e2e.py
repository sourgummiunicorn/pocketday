# Browser test: python3 tests/e2e.py  (serves the folder, drives a phone-sized Chromium)
import http.server, threading, functools, os, sys, datetime
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else ROOT
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_port}/index.html"

results = []
def check(name, cond):
    results.append((name, bool(cond)))
    print(("  ✓ " if cond else "  ✗ ") + name)

NOW = datetime.datetime(2026, 10, 20, 16, 30)  # Tuesday afternoon

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 375, "height": 667}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    # Google Fonts may be blocked in a sandbox; that is not an app error
    page.on("console", lambda m: m.type == "error" and "ERR_TUNNEL" not in m.text and errors.append(m.text))
    # Optional: serve Google Fonts from local files when the network blocks them
    FONTS = os.environ.get("FONTS_DIR")
    if FONTS:
        css = "".join(
            f"@font-face{{font-family:'{fam}';font-weight:{w};src:url(/__fonts/{f}) format('woff2')}}"
            for fam, w, f in [("Bagel Fat One", 400, "bagel-fat-one-latin-400-normal.woff2")] +
            [("Nunito", w, f"nunito-latin-{w}-normal.woff2") for w in (500, 600, 700, 800, 900)])
        page.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body=css, content_type="text/css"))
        def font_file(r):
            name = r.request.url.rsplit("/", 1)[1]
            for root, _, files in os.walk(FONTS):
                if name in files:
                    return r.fulfill(path=os.path.join(root, name), content_type="font/woff2")
            r.abort()
        page.route("**/__fonts/*", font_file)
    page.clock.install(time=NOW)
    page.goto(URL)
    t = lambda sel: page.locator(sel).inner_text().strip()

    print("First visit")
    check("sample pill shows", page.locator("#samplePill").is_visible())
    check("today total = $4.25 + $3.50 = $7.75", t("#todayAmount") == "$7.75")
    # Sample week (Sun reset): Sun 9.25 + Mon 14.99 + Tue 7.75 = 31.99 spent, 5.00 saved -> 50 - 31.99 - 5 = 13.01
    check("left this week = $13.01", t("#weekLeft") == "$13.01")
    check("3 recent purchases", page.locator("#recentList .item").count() == 3)
    check("insight is shown", len(t("#insight")) > 10)
    check("buddy is happy with 26% left", page.get_attribute("#buddy", "data-mood") == "happy")
    # Key info above the fold: amount, week card, recent list top all within 667px minus tab bar
    last = page.locator("#recentList li").last.bounding_box()
    fab_top = page.locator("#fab").bounding_box()["y"]
    check(f"all of Home fits above the + button (last row ends {last['y']+last['height']:.0f}px, + starts {fab_top:.0f}px)",
          last["y"] + last["height"] <= fab_top)
    page.screenshot(path=os.path.join(OUT, "shot-home.png"))

    print("Add an expense in a few taps")
    page.click("#fab")
    expect(page.locator("#expAmount")).to_be_focused()
    page.click("#expSave")  # blank
    check("blank amount shows an error", "Enter an amount" in t("#expAmountErr"))
    page.fill("#expAmount", "-3")
    page.click("#expSave")
    check("negative amount rejected", "negative" in t("#expAmountErr"))
    page.fill("#expAmount", "abc")
    page.keyboard.press("Enter")
    check("junk amount rejected", "numbers only" in t("#expAmountErr"))
    page.fill("#expAmount", "5.50")
    page.locator('.cat-opt:has(input[value="drinks"])').click()
    page.screenshot(path=os.path.join(OUT, "shot-add.png"))
    page.keyboard.press("Enter")
    check("sheet closes after save", not page.locator("#expenseSheet").is_visible())
    check("today updates to $13.25", t("#todayAmount") == "$13.25")
    check("left updates to $7.51", t("#weekLeft") == "$7.51")
    check("newest purchase is first in Recent", "$5.50" in page.locator("#recentList .item").first.inner_text())
    check("toast offers Undo", page.locator("#toastUndo").is_visible())

    print("Future date blocked, past date allowed")
    page.click("#fab")
    page.fill("#expAmount", "2")
    page.fill("#expDate", "2026-10-25")
    page.click("#expSave")
    check("future date rejected", "hasn't happened" in t("#expDateErr"))
    page.fill("#expDate", "2026-10-18")
    page.fill("#expNote", "Gum")
    page.click("#expSave")
    check("Sunday purchase counts this week (left $5.51)", t("#weekLeft") == "$5.51")
    check("today unchanged by backdated purchase", t("#todayAmount") == "$13.25")

    print("Persistence")
    page.reload()
    check("today total survives reload", t("#todayAmount") == "$13.25")
    check("week left survives reload", t("#weekLeft") == "$5.51")

    print("History: edit, delete, undo, weeks")
    page.click('.tab[data-go="history"]')
    check("history spent = $39.49", t("#hSpent") == "$39.49")
    check("chart has 7 days", page.locator(".chart-col").count() == 7)
    check("category list populated", page.locator("#catList .cat-row").count() >= 3)
    page.screenshot(path=os.path.join(OUT, "shot-history.png"), full_page=True)
    # Edit: Gum 2.00 -> 3.00
    page.locator('#dayGroups .item:has-text("Gum")').click()
    check("edit sheet prefilled", page.input_value("#expAmount") == "2")
    page.fill("#expAmount", "3")
    page.click("#expSave")
    check("edit updates history total to $40.49", t("#hSpent") == "$40.49")
    # Delete via row button, then undo
    page.locator('#dayGroups .list-row:has-text("Gum") .item-del').click()
    check("delete lowers total to $37.49", t("#hSpent") == "$37.49")
    page.click("#toastUndo")
    check("undo brings it back ($40.49)", t("#hSpent") == "$40.49")
    # Delete from inside the edit sheet
    page.locator('#dayGroups .item:has-text("Gum")').click()
    page.click("#expDelete")
    check("delete from sheet works ($37.49)", t("#hSpent") == "$37.49")
    page.click("#prevWeek")
    check("previous week shows Last week", t("#weekTag") == "Last week")
    check("last week total = $17.20 (Oct 10 belongs to the week before)", t("#hSpent") == "$17.20")
    check("next arrow enabled on last week", page.locator("#nextWeek").is_enabled())
    page.click("#nextWeek")
    check("next arrow disabled on this week", page.locator("#nextWeek").is_disabled())

    print("Goals and savings")
    page.click('.tab[data-go="goals"]')
    check("two sample goals", page.locator(".goal").count() == 2)
    page.click('[data-action="new-goal"]')
    page.click("#goalForm button[type=submit]")
    check("goal needs a name", "name" in t("#goalNameErr"))
    page.fill("#goalName", "Bike lights")
    page.fill("#goalTarget", "20")
    page.locator('#emojiGrid label:has(input[value="🛹"])').click()
    page.click("#goalForm button[type=submit]")
    check("goal created", page.locator('.goal:has-text("Bike lights")').count() == 1)
    goal = page.locator('.goal:has-text("Bike lights")')
    goal.locator("[data-goal-add]").click()
    check("budget is the default source when money is left",
          page.locator('input[name=depSource][value=budget]').is_checked())
    page.fill("#depAmount", "10")
    page.click("#depositForm button[type=submit]")
    check("can't save more than is left this week", "You have $7.51 left" in t("#depAmountErr"))
    page.fill("#depAmount", "6")
    page.click("#depositForm button[type=submit]")
    check("goal shows 30%", "30%" in goal.inner_text())
    goal.locator("[data-goal-add]").click()
    page.locator('.seg label:has(input[value="other"])').click()
    page.fill("#depAmount", "25")
    page.click("#depositForm button[type=submit]")
    check("can't save more than the goal needs", "Only $14.00" in t("#depAmountErr"))
    page.fill("#depAmount", "2")
    page.click("#depositForm button[type=submit]")
    check("goal shows $8 of $20", "$8 of $20" in goal.inner_text())
    check("goal shows 40%", "40%" in goal.inner_text())
    page.click('.tab[data-go="home"]')
    # 7.51 - 6 from budget = 1.51; the 2 of other money changes nothing
    check("only budget savings lower what's left ($1.51)", t("#weekLeft") == "$1.51")
    check("saved legend shows $11 (5 sample + 6 new)", t("#legendSaved") == "$11")
    check("buddy gets nervous when money is thin", page.get_attribute("#buddy", "data-mood") == "ok")

    print("Vibes")
    page.click('.tab[data-go="settings"]')
    page.locator('.vibe:has(input[value="matcha"])').click()
    check("picking a vibe recolors the app", page.evaluate("document.documentElement.dataset.vibe") == "matcha")
    page.reload()
    check("vibe survives reload", page.evaluate("document.documentElement.dataset.vibe") == "matcha")
    page.screenshot(path=os.path.join(OUT, "shot-settings.png"))

    print("Goal reached")
    page.click('.tab[data-go="goals"]')
    page.locator('.goal:has-text("Bike lights") [data-goal-add]').click()
    page.locator('.seg label:has(input[value="other"])').click()
    page.fill("#depAmount", "12")
    page.click("#depositForm button[type=submit]")
    check("finished goal gets a Got it! sticker", page.locator('.goal:has-text("Bike lights") .stamp').count() == 1)
    check("finished goal hides Add money", page.locator('.goal:has-text("Bike lights") [data-goal-add]').count() == 0)
    page.wait_for_timeout(400)
    page.screenshot(path=os.path.join(OUT, "shot-goals.png"))

    print("Settings: budget, reset day, currency")
    page.click('.tab[data-go="settings"]')
    page.fill("#setBudget", "")
    page.click("#settingsForm button[type=submit]")
    check("blank budget rejected", "Enter an amount" in t("#setBudgetErr"))
    page.fill("#setBudget", "60")
    page.select_option("#setReset", "2")      # Tuesday: today starts a fresh week
    page.select_option("#setCurrency", "EUR")
    page.click("#settingsForm button[type=submit]")
    page.click('.tab[data-go="home"]')
    # New week = today only: 60 - 13.25 spent today - 6 saved from budget today = 40.75
    check("Tuesday reset: week left = €40.75", t("#weekLeft") == "€40.75")
    check("chip says Resets Tue", t("#resetChip") == "Resets Tue")
    page.screenshot(path=os.path.join(OUT, "shot-home-eur.png"))

    print("Reset day crossing in real time")
    page.clock.set_system_time(datetime.datetime(2026, 10, 27, 9, 0))  # next Tuesday
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    check("new week: today €0.00", t("#todayAmount") == "€0.00")
    check("new week: full budget left (€60)", t("#weekLeft") == "€60")

    print("Reminder nudge")
    page.click('.tab[data-go="settings"]')
    page.locator("#setReminders").check()
    page.fill("#setReminderTime", "08:00")
    page.locator("#setReminderTime").dispatch_event("change")
    page.click('.tab[data-go="home"]')
    check("nudge shows when nothing logged after check-in time", page.locator("#reminderNotice").is_visible())

    print("Clear sample, erase, recover")
    page.click('#samplePill')
    page.reload()
    state = page.evaluate("JSON.parse(localStorage.getItem('pocketday:v1'))")
    check("sample rows removed, own rows kept",
          not any(e.get("sample") for e in state["expenses"]) and any(e["amount"] == 550 for e in state["expenses"]))
    check("own goal kept after clearing sample", [g["name"] for g in state["goals"]] == ["Bike lights"])
    page.click('.tab[data-go="settings"]')
    page.click("#resetAllBtn")
    page.click("#resetYes")
    check("erase leaves an empty app", page.evaluate("JSON.parse(localStorage.getItem('pocketday:v1')).expenses.length") == 0)
    page.click("#toastUndo")
    check("undo restores after erase", page.evaluate("JSON.parse(localStorage.getItem('pocketday:v1')).expenses.length") > 0)

    print("Broken storage")
    page.evaluate("localStorage.setItem('pocketday:v1', '{not json')")
    page.reload()
    check("corrupt data doesn't crash the app", t("#todayAmount").startswith("$"))

    print("Layout")
    for w in (320, 375, 768, 1280):
        page.set_viewport_size({"width": w, "height": 800})
        sw = page.evaluate("document.documentElement.scrollWidth")
        check(f"no sideways scroll at {w}px", sw <= w)
    page.screenshot(path=os.path.join(OUT, "shot-desktop.png"))
    page.emulate_media(color_scheme="dark")
    page.set_viewport_size({"width": 375, "height": 667})
    page.evaluate("localStorage.clear()")
    page.reload()
    page.screenshot(path=os.path.join(OUT, "shot-dark.png"))

    check("no JavaScript errors", not errors)
    if errors: print(errors)
    b.close()

ok = sum(1 for _, c in results if c)
print(f"\n{ok}/{len(results)} checks passed")
sys.exit(0 if ok == len(results) else 1)
