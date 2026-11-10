// @ts-check
/** @import {Line, PromptForRecordsOptions} from './types/be-pdfing/types' */

/**
 * Helpers for asking the browser's built-in language model (Chrome's Prompt API,
 * `LanguageModel`, backed by Gemini Nano) to turn extracted lines into records.
 *
 * pdf.js still does the reading:  the model only sees text.  The layout-aware helpers
 * (e.g. `columnsOf`) can be used to give it text in a sensible order first.
 */

/**
 * Lines as plain text for a prompt:  one line per row, cells separated by ' | '.
 * Pass an array of columns (e.g. from `columnsOf`) to have each column labeled and
 * given separately, which keeps side-by-side tables from being interleaved.
 * @param {Array<Line> | Array<Array<Line>>} lines
 * @param {{separator?: string}} [options]
 * @returns {string}
 */
export function linesToText(lines, options = {}){
    const {separator = ' | '} = options;
    if(lines.length > 0 && Array.isArray(lines[0])){
        const columns = /** @type {Array<Array<Line>>} */ (lines);
        return columns.map((column, i) => `=== Column ${i + 1} of ${columns.length} ===\n${linesToText(column, options)}`).join('\n\n');
    }
    return /** @type {Array<Line>} */ (lines).map(line => line.cells.map(c => c.text).join(separator)).join('\n');
}

/**
 * Whether the built-in model can be used:  'unavailable', 'downloadable', 'downloading'
 * or 'available' (or 'unavailable' when the browser has no Prompt API at all).
 * @param {{model?: any}} [options]
 * @returns {Promise<string>}
 */
export async function aiAvailability(options = {}){
    const model = options.model ?? /** @type {any} */ (globalThis).LanguageModel;
    if(model === undefined) return 'unavailable';
    return await model.availability(languageOptions());
}

/**
 * Prompts the built-in model with `input` (text, or lines, which are converted with
 * `linesToText`), constrained to `schema`, and returns the parsed JSON.
 *
 * Throws an `AIUnavailableError` when there's no usable model, including when the model
 * still needs downloading:  it's several GB, so by default that's left to an explicit
 * `createSession()` call from a user gesture (as the demo's "Enable built-in AI" button
 * does).  Pass `allowDownload: true` to start the download from here instead.
 * @param {string | Array<Line> | Array<Array<Line>>} input
 * @param {PromptForRecordsOptions} options
 * @returns {Promise<any>}
 */
export async function promptForRecords(input, options){
    const {schema, instructions, signal, allowDownload = false} = options;
    const session = await createSession({...options, systemPrompt: instructions, allowDownload});
    try{
        const text = typeof input === 'string' ? input : linesToText(input);
        const response = await session.prompt(text, {responseConstraint: schema, signal});
        try{
            return JSON.parse(response);
        }catch(e){
            throw new Error(`The model's response wasn't valid JSON: ${String(response).slice(0, 200)}`);
        }
    }finally{
        session.destroy();
    }
}

/**
 * Creates a model session (downloading the model first if needed, which requires a
 * user gesture).  `promptForRecords` calls this itself; call it directly from a click
 * handler to trigger the download ahead of time.
 *
 * `allowDownload` (default true here) permits starting the model download.
 * @param {import('./types/be-pdfing/types').CreateSessionOptions} [options]
 */
export async function createSession(options = {}){
    const {systemPrompt, signal, onDownloadProgress, allowDownload = true} = options;
    const model = options.model ?? /** @type {any} */ (globalThis).LanguageModel;
    if(model === undefined){
        throw new AIUnavailableError('This browser has no built-in language model (Prompt API).');
    }
    const availability = await model.availability(languageOptions());
    if(availability === 'unavailable'){
        throw new AIUnavailableError('The built-in language model is unavailable on this device.');
    }
    if(availability !== 'available' && !allowDownload){
        // Picking a file usually leaves a user activation in effect, so without this a
        // multi-GB download could start as a side effect of selecting a PDF.
        throw new AIUnavailableError(`The built-in language model is ${availability}, but not ready. `
            + 'Call createSession() from a user gesture (e.g. a button click) to download it.');
    }
    return await model.create({
        ...languageOptions(),
        signal,
        initialPrompts: systemPrompt === undefined ? undefined : [{role: 'system', content: systemPrompt}],
        monitor(/** @type {EventTarget} */ m){
            m.addEventListener('downloadprogress', (/** @type {any} */ e) => onDownloadProgress?.(e.loaded));
        },
    });
}

export class AIUnavailableError extends Error {
    name = 'AIUnavailableError';
}

function languageOptions(){
    return {
        expectedInputs: [{type: 'text', languages: ['en']}],
        expectedOutputs: [{type: 'text', languages: ['en']}],
    };
}
