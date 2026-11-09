import { test, expect } from '@playwright/test';
test('AttributeLines', async ({ page }) => {
    await page.goto('./tests/AttributeLines.html');
    const target = page.locator('#target');
    await expect(target).toHaveAttribute('ready', '');
    await page.locator('#subject').setInputFiles('demo/sample-transcript.pdf');
    await expect(target).toHaveAttribute('mark', 'good');
    const {enh, progress, results} = await page.evaluate(() => window.loadInfo);
    expect(enh).toBe('bePdfing');
    expect(progress).toEqual([[1, 1]]);
    expect(results).toHaveLength(1);
    const [{fileName, numPages, lines, records}] = results;
    expect(fileName).toBe('sample-transcript.pdf');
    expect(numPages).toBe(1);
    expect(records).toBeUndefined();
    const texts = lines.map(line => line.text);
    // Both columns of a two-column table land on one line, as separate (tab-delimited) cells.
    expect(texts).toContain('00001\tENGL1\tEnglish 9\tA\t0.50\t0.50\tB\t00011\tENGL3\tEnglish 11\tA\t0.50\t0.50\tB');
    // Lines come out top to bottom, even though the PDF draws the footer first.
    expect(texts[0]).toBe('High School');
    expect(texts.indexOf('***Schools Attended***')).toBeLessThan(texts.indexOf('MO/YR: 01/2020\tGRD LEV: 11'));
    const line = lines.find(line => line.text.startsWith('00001\tENGL1'));
    expect(line.page).toBe(1);
    expect(line.cells[0]).toEqual({text: '00001', x: 15.5, width: 22.8});
});
test('AttributeLines: a non-PDF file raises an error event', async ({ page }) => {
    await page.goto('./tests/AttributeLines.html');
    const target = page.locator('#target');
    await expect(target).toHaveAttribute('ready', '');
    await page.locator('#subject').setInputFiles({
        name: 'not-a.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('hello'),
    });
    await expect.poll(() => page.evaluate(() => window.pdfError)).toBeTruthy();
});
