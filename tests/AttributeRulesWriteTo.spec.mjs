import { test, expect } from '@playwright/test';
test('AttributeRulesWriteTo', async ({ page }) => {
    await page.goto('./tests/AttributeRulesWriteTo.html');
    const target = page.locator('#target');
    await expect(target).toHaveAttribute('ready', '');
    await page.locator('#subject').setInputFiles('demo/home-school-transcript-example.pdf');
    await expect(target).toHaveAttribute('mark', 'good');
    const {courses} = await page.evaluate(() => window.stored);
    // 8 (grade 9) + 7 (grade 10) + 9 (grade 11) + 7 (grade 12)
    expect(courses).toHaveLength(31);
    const byLevel = level => courses.filter(c => c.gradeLevel === level).map(c => c.course);
    expect(byLevel('9')).toHaveLength(8);
    expect(byLevel('10')).toHaveLength(7);
    expect(byLevel('11')).toHaveLength(9);
    expect(byLevel('12')).toHaveLength(7);
    // Left column inherits "Grade 9"; the right column, on the same lines, inherits "Grade 10".
    expect(courses[0]).toEqual({student: 'Albert Smith', gradeLevel: '9', course: 'Honors Eng 9: World Lit', grade: 'A', credits: '1'});
    expect(courses[1]).toEqual({student: 'Albert Smith', gradeLevel: '10', course: 'Advanced Writing', grade: 'A', credits: '1'});
    expect(byLevel('11')).toContain("Driver's Ed");
    // "sets": "document" applies across columns.
    expect(courses.every(c => c.student === 'Albert Smith')).toBe(true);
});
