// The built-in-AI handler, against a fake LanguageModel, so it's deterministic and needs
// no model download.  This tests the plumbing:  what the model is asked, and what's done
// with its answer.  See AIHandlerReal.spec.mjs for the real model.
import { test, expect } from '@playwright/test';

const cannedHome = {
    student: 'Albert Smith',
    courses: [
        {gradeLevel: 9, course: 'Honors Eng 9: World Lit', grade: 'A', credits: 1},
        {gradeLevel: 10, course: 'Advanced Writing', grade: 'A', credits: 1},
    ],
};

test.beforeEach(async ({ page }) => {
    await page.addInitScript({path: 'tests/fakeLanguageModel.js'});
});

test('AIHandler: prompts the built-in model and uses its JSON as the records', async ({ page }) => {
    await page.goto('./tests/AIHandler.html');
    await page.evaluate(canned => { window.fakeAI.respond = () => JSON.stringify(canned); }, cannedHome);
    const target = page.locator('#target');
    await expect(target).toHaveAttribute('ready', '');
    await page.locator('#subject').setInputFiles('demo/home-school-transcript-example.pdf');
    await expect(target).toHaveAttribute('loads', '1');

    const calls = await page.evaluate(() => window.aiCalls);
    expect(calls.map(c => c.method)).toEqual(['availability', 'create', 'prompt', 'destroy']);
    const [availability, create, prompt] = calls;
    expect(availability.options.expectedInputs).toEqual([{type: 'text', languages: ['en']}]);
    // The instructions go in as the system prompt.
    const instructions = await page.evaluate(() => window.transcriptInstructions);
    expect(create.options.initialPrompts).toEqual([{role: 'system', content: instructions}]);
    // The lines go in as text, column by column (no interleaving), cells separated by ' | '.
    expect(prompt.input).toMatch(/^=== Column 1 of 2 ===\n/);
    expect(prompt.input).toContain('\n=== Column 2 of 2 ===\n');
    expect(prompt.input).toContain('Honors Eng 9: World Lit | A | 1');
    const [column1, column2] = prompt.input.split(/\n\n=== Column 2 of 2 ===\n/);
    expect(column1).toContain('Grade 9 | Gr | Cr');
    expect(column1).not.toContain('Grade 10');
    expect(column2).toContain('Grade 10 | Gr | Cr');
    // The schema constrains the response.
    expect(prompt.responseConstraint).toEqual(await page.evaluate(() => window.transcriptSchema));

    expect(await page.evaluate(() => window.loads[0])).toEqual(cannedHome);
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('AIHandler-home-school-transcript-example.pdf')));
    expect(stored).toEqual(cannedHome);
    // Scored against the deterministic handler:  2 of its 31 courses, both exact.
    const comparison = await page.evaluate(() => window.comparison);
    expect(comparison).toMatchObject({expected: 31, exact: 2, mismatched: [], extra: []});
    expect(comparison.missing).toHaveLength(29);
});

test('AIHandler: no usable model raises an error event', async ({ page }) => {
    await page.goto('./tests/AIHandler.html');
    await page.evaluate(() => { window.fakeAI.availability = 'unavailable'; });
    const target = page.locator('#target');
    await expect(target).toHaveAttribute('ready', '');
    await page.locator('#subject').setInputFiles('demo/sample-transcript.pdf');
    await expect(target).toHaveAttribute('loads', '1');
    expect(await page.evaluate(() => window.errors)).toEqual([
        {name: 'AIUnavailableError', message: 'The built-in language model is unavailable on this device.'},
    ]);
    expect(await page.evaluate(() => window.loads[0])).toBeUndefined();
    // With no records, writeTo falls back to the lines.
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('AIHandler-sample-transcript.pdf')));
    expect(stored[0]).toHaveProperty('cells');
});

test('AIHandler: a model that still needs downloading is not downloaded without a user gesture', async ({ page }) => {
    await page.goto('./tests/AIHandler.html');
    await page.evaluate(() => { window.fakeAI.availability = 'downloadable'; });
    const target = page.locator('#target');
    await expect(target).toHaveAttribute('ready', '');
    await page.locator('#subject').setInputFiles('demo/sample-transcript.pdf');
    await expect(target).toHaveAttribute('loads', '1');
    const [error] = await page.evaluate(() => window.errors);
    expect(error.name).toBe('AIUnavailableError');
    expect(error.message).toMatch(/is downloadable, but not ready/);
    expect((await page.evaluate(() => window.aiCalls)).map(c => c.method)).toEqual(['availability']);

    // From a click, create() is called (the real one would download the model).
    await page.locator('#enable').click();
    await expect(target).toHaveAttribute('enabled', '');
    await expect(target).toHaveAttribute('download', '1');
    expect((await page.evaluate(() => window.aiCalls)).map(c => c.method)).toEqual(['availability', 'availability', 'create', 'destroy']);
});

test('AIHandler: a response that is not JSON raises an error event', async ({ page }) => {
    await page.goto('./tests/AIHandler.html');
    await page.evaluate(() => { window.fakeAI.respond = () => 'Sure! Here are the courses...'; });
    const target = page.locator('#target');
    await expect(target).toHaveAttribute('ready', '');
    await page.locator('#subject').setInputFiles('demo/sample-transcript.pdf');
    await expect(target).toHaveAttribute('loads', '1');
    const errors = await page.evaluate(() => window.errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/^The model's response wasn't valid JSON: Sure!/);
    // The session is destroyed even so.
    expect((await page.evaluate(() => window.aiCalls)).at(-1).method).toBe('destroy');
});
