// The built-in-AI handler against the REAL model, scored against the deterministic
// handler.  Skipped unless BE_PDFING_REAL_AI=1, because it needs an installed browser
// with the Prompt API, a capable device (see Chrome's hardware requirements), and
// a one-time model download of several GB.
//
//   BE_PDFING_REAL_AI=1                 enable
//   BE_PDFING_AI_CHANNEL=chromium|chrome|msedge  browser to use (default chromium:  Playwright's
//                                       own Chromium, which has the Prompt API as of v158)
//   BE_PDFING_AI_PROFILE=<dir>          persistent profile, so the model is downloaded once
//                                       (default .ai-profile/<channel>)
//   BE_PDFING_AI_ARGS="--flag ..."      extra browser arguments (e.g. feature flags)
//
// The model's output varies, so the assertions are thresholds; each run logs the scores.
import { test, expect, chromium } from '@playwright/test';

const enabled = process.env.BE_PDFING_REAL_AI === '1';
const channel = process.env.BE_PDFING_AI_CHANNEL ?? 'chromium';
const languageOptions = {expectedInputs: [{type: 'text', languages: ['en']}], expectedOutputs: [{type: 'text', languages: ['en']}]};

test.describe('AIHandlerReal', () => {
    test.skip(!enabled, 'Set BE_PDFING_REAL_AI=1 to run against the real built-in model.');
    test.describe.configure({mode: 'serial', timeout: 30 * 60_000});

    /** @type {import('@playwright/test').BrowserContext} */
    let context;
    let availability;

    test.beforeAll(async () => {
        context = await chromium.launchPersistentContext(process.env.BE_PDFING_AI_PROFILE ?? `.ai-profile/${channel}`, {
            channel: channel === 'chromium' ? undefined : channel,
            headless: false,
            baseURL: 'http://localhost:8000/',
            args: (process.env.BE_PDFING_AI_ARGS ?? '').split(' ').filter(Boolean),
        });
        const page = await context.newPage();
        await page.goto('./tests/AIHandler.html');
        availability = await page.evaluate(async options =>
            'LanguageModel' in window ? await LanguageModel.availability(options) : 'no Prompt API', languageOptions);
        console.log(`[${channel}] availability: ${availability}`);
        if(availability === 'downloadable' || availability === 'downloading'){
            // A real click, so the download has its user gesture.
            await page.locator('#enable').click();
            await expect(page.locator('#target')).toHaveAttribute('enabled', '', {timeout: 30 * 60_000});
            availability = 'available';
        }
        await page.close();
    });

    test.afterAll(async () => {
        await context?.close();
    });

    for(const [file, student] of [
        ['home-school-transcript-example.pdf', /Albert Smith/],
        ['sample-transcript.pdf', /Cougar/],
    ]){
        test(file, async () => {
            test.skip(availability !== 'available', `The built-in model is ${availability} in ${channel}.`);
            const page = await context.newPage();
            await page.goto('./tests/AIHandler.html');
            const target = page.locator('#target');
            await expect(target).toHaveAttribute('ready', '');
            const started = Date.now();
            await page.locator('#subject').setInputFiles(`demo/${file}`);
            await expect(target).toHaveAttribute('loads', '1', {timeout: 10 * 60_000});
            const seconds = (Date.now() - started) / 1000;
            const {records, comparison, errors} = await page.evaluate(() => ({
                records: window.loads[0], comparison: window.comparison, errors: window.errors,
            }));
            console.log(`[${channel}] ${file}: ${seconds.toFixed(1)}s`, JSON.stringify({
                student: records?.student,
                courses: records?.courses?.length,
                expected: comparison?.expected,
                exact: comparison?.exact,
                mismatched: comparison?.mismatched.length,
                missing: comparison?.missing.length,
                extra: comparison?.extra.length,
            }));
            expect(errors).toEqual([]);
            expect(records.student).toMatch(student);
            // Found (by name and grade level):  at least 80% of the courses.  Hallucinated or
            // misplaced:  at most 20%.
            const found = comparison.exact + comparison.mismatched.length;
            expect(found).toBeGreaterThanOrEqual(0.8 * comparison.expected);
            expect(comparison.extra.length).toBeLessThanOrEqual(0.2 * comparison.expected);
            await page.close();
        });
    }
});
