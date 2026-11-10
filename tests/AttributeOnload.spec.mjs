import { test, expect } from '@playwright/test';
test('AttributeOnload', async ({ page }) => {
    await page.goto('./tests/AttributeOnload.html');
    const target = page.locator('#target');
    await expect(target).toHaveAttribute('ready', '');
    await page.locator('#subject').setInputFiles(['demo/home-school-transcript-example.pdf', 'demo/sample-transcript.pdf']);
    await expect(target).toHaveAttribute('mark', 'good');
    // One load event for the whole selection.
    expect(await page.evaluate(() => window.loadCount)).toBe(1);
    const stored = await page.evaluate(() => window.stored);
    // Written after the waitUntil promise settled, so `checked` is there.
    expect(stored).toEqual([
        {student: 'Albert Smith', tableCount: 4, checked: true},
        {student: 'Cougar, Butch The', tableCount: 2, checked: true},
    ]);
    // The instance's results carry the listener's records too.
    const records = await page.evaluate(() => document.querySelector('#subject').enh.bePdfing.results.map(r => r.records));
    expect(records).toEqual(stored);
});
