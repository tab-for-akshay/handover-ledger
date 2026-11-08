"""End-to-end check of the public page in a fresh browser context (no storage, no login).
Run: python3 tests/e2e_playwright.py http://127.0.0.1:8765/
"""
import sys
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    ctx = browser.new_context()  # fresh: no cookies, no localStorage
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(url, wait_until="networkidle")
    assert "Capture" in page.inner_text("nav"), "nav missing"
    page.wait_for_selector(".entry")
    assert page.locator(".entry").count() == 3, "three demo entries"
    page.click("nav button[data-view=brief]")
    page.wait_for_selector("h2:has-text('Handover brief')")
    assert "Quote check" in page.inner_text("main"), "quote check line"
    assert page.locator("text=Two sources name different owners").count() == 1, "conflict question shown"
    page.fill("input[data-gap^='gap:conflict']", "Ravi")
    page.click("button[data-act=answer] >> nth=0")
    page.wait_for_timeout(300)
    assert page.locator("text=Two sources name different owners").count() == 0, "conflict resolved by leaver answer"
    page.click("nav button[data-view=owner]")
    page.wait_for_selector("h2:has-text('New owner')")
    body = page.inner_text("main").lower()
    assert "who owns what" in body and "still open" in body
    page.click("nav button[data-view=capture]")
    page.fill("#author", "Tester")
    page.fill("#text", "Decided to ship the CSV export first. Risk: no tests cover empty files.")
    page.click("button.primary[type=submit]")
    page.wait_for_timeout(200)
    assert page.locator(".entry").count() == 5, "new entry added (3 demo + 1 leaver answer + 1 new)"
    page.click("nav button[data-view=brief]")
    page.wait_for_timeout(200)
    page.click("button[data-act=accept] >> nth=0")
    page.wait_for_timeout(200)
    assert "accepted" in page.inner_text("#view"), "review logged"
    with page.expect_download() as d:
        page.click("button[data-act=export]")
    dl = d.value
    assert dl.suggested_filename == "handover-brief.md"
    page.screenshot(path="/dev/shm/brief.png", full_page=False)
    browser.close()

assert not [e for e in errors if "favicon" not in e], errors
print("e2e ok")
