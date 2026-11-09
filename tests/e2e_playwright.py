"""End-to-end check of the public page in a fresh browser context (no storage, no login).
Run: python3 tests/e2e_playwright.py http://127.0.0.1:8765/   (add --shots DIR to save screenshots)
"""
import base64, json, sys, os
from playwright.sync_api import sync_playwright

args = [a for a in sys.argv[1:] if not a.startswith("--")]
url = args[0] if args else "http://127.0.0.1:8765/"
shots = None
if "--shots" in sys.argv:
    shots = sys.argv[sys.argv.index("--shots") + 1]
    os.makedirs(shots, exist_ok=True)
errors = []
checks = 0

def ok(cond, msg):
    global checks
    assert cond, msg
    checks += 1

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    ctx = browser.new_context(accept_downloads=True)  # fresh: no cookies, no localStorage
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    dialogs = []
    accept_next = {"on": False}
    def on_dialog(d):
        dialogs.append(d.message)
        d.accept() if accept_next["on"] else d.dismiss()
    page.on("dialog", on_dialog)
    page.goto(url, wait_until="networkidle")
    ok("Capture" in page.inner_text("nav"), "nav missing")
    page.wait_for_selector(".entry")
    ok(page.locator(".entry").count() == 3, "three demo entries")
    ok("RELAYPROOF" in page.inner_text("footer"), "footer names the team RELAYPROOF")
    ok("Tab x Akshay" not in page.content(), "old team name is gone")
    if shots:
        page.screenshot(path=os.path.join(shots, "1-capture.png"), full_page=False)

    page.click("nav button[data-view=brief]")
    page.wait_for_selector("h2:has-text('Handover brief')")
    ok("Quote check" in page.inner_text("main"), "quote check line")
    ok(page.locator("text=The sources name different owners").count() == 1, "conflict question shown")
    ok(page.locator(".due").count() >= 1, "deadline shown on a claim")
    ok(page.locator(".badge[title]").count() >= 1, "status badges carry a tooltip")
    page.fill("input[data-gap^='gap:conflict']", "Ravi")
    page.click("button[data-act=answer] >> nth=0")
    page.wait_for_timeout(300)
    ok(page.locator("text=The sources name different owners").count() == 0, "conflict resolved by leader answer")
    ok(page.locator("text=Who owns").count() >= 1, "unrelated question still open after the answer")
    if shots:
        page.screenshot(path=os.path.join(shots, "2-brief.png"), full_page=False)

    # Review: accept changes the button state; undo returns it.
    first_accept = page.locator("button[data-act=accept]").first
    first_accept.click()
    page.wait_for_timeout(200)
    ok(page.locator("button[data-act=accept].on").count() >= 1, "accepted button shows its state")
    ok(page.locator("button[data-act=undo]").count() >= 1, "undo offered after a review")
    page.locator("button[data-act=undo]").first.click()
    page.wait_for_timeout(200)
    ok(page.locator("button[data-act=undo]").count() == 0, "undo clears the review")
    page.locator("button[data-act=reject]").first.click()
    page.wait_for_timeout(200)
    ok(page.locator("button[data-act=reject].on").count() >= 1, "rejected button shows its state")
    page.locator("button[data-act=undo]").first.click()
    page.wait_for_timeout(200)
    ok(page.locator("button[data-act=reject].on").count() == 0, "undo puts a rejected claim back")

    page.click("nav button[data-view=owner]")
    page.wait_for_selector("h2:has-text('New owner')")
    body = page.inner_text("main").lower()
    ok("who owns what" in body and "still open" in body, "owner sections")
    ok(page.locator("#view blockquote").count() >= 3, "New owner view quotes its sources")
    if shots:
        page.screenshot(path=os.path.join(shots, "3-new-owner.png"), full_page=False)

    page.click("nav button[data-view=capture]")
    page.fill("#author", "Tester")
    page.fill("#text", "Decided to ship the CSV export first. Risk: no tests cover empty files.")
    page.click("button.primary[type=submit]")
    page.wait_for_timeout(200)
    ok(page.locator(".entry").count() == 5, "new entry added (3 demo + 1 leaver answer + 1 new)")
    ok("5 entries" in page.inner_text("#status"), "status reads 'entries' in the plural")

    # Clear all asks first; a dismissed confirm keeps the entries.
    page.click("button[data-act=clear]")
    page.wait_for_timeout(200)
    ok(len(dialogs) == 1 and "Clear all" in dialogs[0], "clear all asks to confirm")
    ok(page.locator(".entry").count() == 5, "dismissing the confirm keeps the entries")

    # Share link: the link opens the same handover in a fresh browser.
    page.click("button[data-act=share]")
    page.wait_for_selector("#share-url")
    share = page.input_value("#share-url")
    ok("#h=" in share, "share link carries the handover in its hash")
    page2 = ctx.new_page()
    page2.on("pageerror", lambda e: errors.append(str(e)))
    page2.goto(share, wait_until="networkidle")
    page2.wait_for_selector(".entry")
    ok(page2.locator(".entry").count() == 5, "the share link opens all five entries in a fresh context")
    ok("share link" in page2.inner_text("#status").lower(), "status says it was opened from a share link")
    page2.close()

    # Export and import the .json handover in a fresh context.
    with page.expect_download() as d:
        page.click("button[data-act=export-json]")
    dl = d.value
    ok(dl.suggested_filename == "handover-ledger.json", "json export filename")
    path = dl.path()
    page3 = browser.new_context().new_page()
    page3.on("pageerror", lambda e: errors.append(str(e)))
    page3.goto(url, wait_until="networkidle")
    page3.wait_for_selector(".entry")
    page3.click("nav button[data-view=capture]")
    page3.set_input_files("#import", path)
    page3.wait_for_timeout(400)
    ok(page3.locator(".entry").count() == 5, "imported .json restores five entries")
    ok("Imported " in page3.inner_text("#status"), "import is announced")

    # Brief .md export carries the state; importing it restores the handover.
    page3.click("nav button[data-view=brief]")
    with page3.expect_download() as d2:
        page3.click("button[data-act=export]")
    md_path = d2.value.path()
    ok(d2.value.suggested_filename == "handover-brief.md", "brief export filename")
    page4 = browser.new_context().new_page()
    page4.on("pageerror", lambda e: errors.append(str(e)))
    page4.goto(url, wait_until="networkidle")
    page4.wait_for_selector(".entry")
    page4.click("nav button[data-view=capture]")
    page4.set_input_files("#import", md_path)
    page4.wait_for_timeout(400)
    ok(page4.locator(".entry").count() == 5, "imported brief .md restores the handover")
    page4.click("nav button[data-view=capture]")
    page4.close(); page3.close()

    # Clear all after confirming in a fresh page: accept the confirm this time.
    accept_next["on"] = True
    page.click("button[data-act=clear]")
    page.wait_for_timeout(300)
    ok(page.locator(".entry").count() == 0, "confirmed clear empties the page")
    browser.close()

ok(not [e for e in errors if "favicon" not in e], errors)
print(f"e2e ok: {checks} checks")
