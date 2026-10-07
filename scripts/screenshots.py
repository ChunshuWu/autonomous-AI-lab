"""Capture the running demo. Optional: pip install playwright; playwright install chromium."""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

p = argparse.ArgumentParser()
p.add_argument('--url', default='http://127.0.0.1:8768')
p.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'docs/screenshots')
args = p.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as browser_tools:
    browser = browser_tools.chromium.launch(headless=True,args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    for route in ['research', 'map', 'meetings', 'experiments', 'library', 'timeline', 'cats']:
        page.goto(args.url + '/#' + route, wait_until='networkidle')
        expect(page.locator('#connection')).to_have_text('Saved')
        if route == 'research':
            expect(page.locator('.agent-card')).to_have_count(7)
        if route == 'map':
            expect(page.locator('#research-tech-tree')).to_be_visible()
        if route == 'cats':
            expect(page.locator('.cat-portrait')).to_have_count(12)
            for picture in page.locator('.cat-portrait').all():
                picture.scroll_into_view_if_needed()
                expect(picture).to_be_visible()
                picture.evaluate('(img) => img.decode()')
                assert not picture.get_attribute('src').endswith('.svg')
            page.evaluate('window.scrollTo(0, 0)')
        page.evaluate('document.activeElement?.blur()')
        page.screenshot(path=str(args.output / (route + '.png')), full_page=True)
        if route == 'meetings':
            page.get_by_role('button', name='Choose the smallest useful change', exact=True).click()
            expect(page.locator('#dialog .meeting-candidate')).to_have_count(3)
            page.locator('#dialog').screenshot(path=str(args.output / 'meeting-detail.png'))
            votes = page.locator('#dialog .votes-table')
            votes.scroll_into_view_if_needed()
            votes.screenshot(path=str(args.output / 'votes.png'))
            page.get_by_role('button', name='Close dialog', exact=True).click()
        if route == 'experiments':
            page.get_by_role('button', name='Can a blank reading be useful information?', exact=True).click()
            expect(page.locator('#dialog .bar-chart')).to_be_visible()
            expect(page.locator('#dialog .record-question-form textarea')).to_be_disabled()
            page.locator('#dialog').screenshot(path=str(args.output / 'experiment-detail.png'))
            page.get_by_role('button', name='Close dialog', exact=True).click()
    page.goto(args.url + '/documents/report-first-result?workspace=missing-measurements-demo', wait_until='networkidle')
    expect(page.locator('.bar-chart')).to_be_visible()
    page.screenshot(path=str(args.output / 'report.png'), full_page=True)
    # Narrow views should remain usable, including long votes and charts.
    page.set_viewport_size({'width': 390, 'height': 844})
    for route in ['research', 'map', 'meetings', 'experiments', 'library', 'timeline', 'cats']:
        page.goto(args.url + '/#' + route, wait_until='networkidle')
        expect(page.locator('#connection')).to_have_text('Saved')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), route
    assert not errors, errors
    browser.close()
print('PASS: all seven pages, meeting votes, experiment charts, report, read-only forms, and narrow screens.')
