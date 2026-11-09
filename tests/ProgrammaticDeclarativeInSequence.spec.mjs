import { test, expect } from '@playwright/test';
test('ProgrammaticDeclarativeInSequence', async ({ page }) => {
    await page.goto('./tests/ProgrammaticDeclarativeInSequence.html');
    const target = page.locator('#target');
    await expect(target).toHaveAttribute('ready', '');
    await page.locator('#subject').setInputFiles('demo/home-school-transcript-example.pdf');
    await expect(target).toHaveAttribute('mark', 'good');
    const {courses} = await page.evaluate(() => window.stored);
    expect(courses).toHaveLength(31);
    expect(courses[1]).toEqual({gradeLevel: '10', course: 'Advanced Writing', grade: 'A', credits: '1'});
});
