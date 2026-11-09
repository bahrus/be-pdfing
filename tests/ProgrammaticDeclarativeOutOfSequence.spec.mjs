import { test, expect } from '@playwright/test';
test('ProgrammaticDeclarativeOutOfSequence', async ({ page }) => {
    await page.goto('./tests/ProgrammaticDeclarativeOutOfSequence.html');
    const target = page.locator('#target');
    await expect(target).toHaveAttribute('ready', '');
    await page.locator('#subject').setInputFiles('demo/sample-transcript.pdf');
    await expect(target).toHaveAttribute('mark', 'good');
    // No rules:  the lines themselves are written.
    const stored = await page.evaluate(() => window.stored);
    expect(Array.isArray(stored)).toBe(true);
    expect(stored.map(line => line.text)).toContain('MO/YR: 01/2018\tGRD LEV: 09\tMO/YR: 06/2020\tLEV: 11');
});
