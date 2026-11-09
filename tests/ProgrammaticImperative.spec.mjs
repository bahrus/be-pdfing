import { test, expect } from '@playwright/test';
test('ProgrammaticImperative', async ({ page }) => {
    await page.goto('./tests/ProgrammaticImperative.html');
    const target = page.locator('#target');
    await expect(target).toHaveAttribute('ready', '');
    await page.locator('#subject').setInputFiles('demo/sample-transcript.pdf');
    await expect(target).toHaveAttribute('loads', '1');
    const [{enh, records}] = await page.evaluate(() => window.loads);
    // README "Gotcha": programmatic attachment stamps enh === 'bePdfing'.
    expect(enh).toBe('bePdfing');
    const {courses} = records;
    // 5 terms of 5 courses down the left column + 1 term of 5 in the right column.
    expect(courses).toHaveLength(30);
    // Each column inherits its own MO/YR heading, even though they share lines.
    const english11 = courses.filter(c => c.courseCode === 'ENGL3');
    expect(english11.map(c => c.moYr)).toEqual(['06/2020', '01/2020']);
    expect(courses[0]).toEqual({
        moYr: '01/2018', gradeLevel: '09', stateCode: '00001', courseCode: 'ENGL1',
        description: 'English 9', grade: 'A', credEarn: '0.50', credAttp: '0.50', dsg: 'B',
    });
    // Optional trailing group: no DSG for PE.
    expect(courses.find(c => c.courseCode === 'PHE1').dsg).toBeUndefined();
    // Cells may contain spaces.
    expect(courses.map(c => c.courseCode)).toContain('HIST 1');
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ProgrammaticImperative-sample-transcript.pdf')));
    expect(stored.courses).toHaveLength(30);

    await page.evaluate(() => window.switchRules());
    await expect(target).toHaveAttribute('loads', '2');
    const second = await page.evaluate(() => window.loads[1].records);
    expect(second).toEqual({totals: [{credEarn: '15.00', credAttp: '15.00', gpaPts: '60.00', gpa: '4.00'}]});
});
