import { test, expect } from '@playwright/test';
test('ProgrammaticHandler', async ({ page }) => {
    await page.goto('./tests/ProgrammaticHandler.html');
    const target = page.locator('#target');
    await expect(target).toHaveAttribute('ready', '');
    await page.locator('#subject').setInputFiles('demo/home-school-transcript-example.pdf');
    await expect(target).toHaveAttribute('loads', '1');

    const calls = await page.evaluate(() => window.handlerCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({name: 'home-school-transcript-example.pdf', numPages: 1});
    expect(calls[0].lineCount).toBeGreaterThan(30);
    expect(calls[0].records).toBeUndefined(); // no rules

    const [{enh, records}] = await page.evaluate(() => window.loads);
    expect(enh).toBe('bePdfing');
    expect(records.student).toBe('Albert Smith');
    expect(records.courses).toHaveLength(31);
    // One table at a time:  all of Grade 9, then Grade 10, ... (not interleaved).
    expect(records.courses.slice(0, 8).every(c => c.gradeLevel === 9)).toBe(true);
    expect(records.courses[0]).toEqual({gradeLevel: 9, course: 'Honors Eng 9: World Lit', grade: 'A', credits: 1});
    expect(records.courses[8]).toEqual({gradeLevel: 10, course: 'Advanced Writing', grade: 'A', credits: 1});

    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ProgrammaticHandler-home-school-transcript-example.pdf')));
    expect(stored).toEqual(records);
    // No spurious error events.
    expect(await page.evaluate(() => window.errors)).toEqual([]);

    await page.evaluate(() => window.switchHandler());
    await expect(target).toHaveAttribute('loads', '2');
    expect(await page.evaluate(() => window.loads[1].records)).toEqual({evaluator: 'Dr. Stan Albertson'});

    // A handler that throws:  an error event, and the file's records are left undefined.
    await page.evaluate(() => window.throwingHandler());
    await expect(target).toHaveAttribute('loads', '3');
    expect(await page.evaluate(() => window.errors)).toEqual(['Error: oops']);
    expect(await page.evaluate(() => window.loads[2].records)).toBeUndefined();
});
