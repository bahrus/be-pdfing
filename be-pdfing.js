// @ts-check
/** @import {Actions, PAP, AllProps, AP, PdfResult, USL, Helpers} from './types/be-pdfing/types' */;
/** @import {RoundaboutOptions, RAConfig} from './types/roundabout/types' */;
/** @import {ElementEnhancementGateway, SpawnContext} from './types/assign-gingerly/types' */;
/** @import {EMC} from './types/mount-observer/types' */;

/**
 * @implements {Actions}
 * @implements {EventListenerObject}
 */
class BePdfing {

    /**
     * @type {AbortController | undefined}
     */
    #abortController;

    /**
     * Enhancement key ('bePdfing'), stamped onto the dispatched events so
     * consumers overloading these event names can tell which enhancement fired.
     * @type {string | symbol}
     */
    #enhKey = 'bePdfing';

    /**
     * Incremented per file selection, so a slow, superseded read is dropped.
     */
    #readCount = 0;

    /**
     * Incremented per `structure` run, so a run superseded (e.g. by new rules) while it
     * awaits a handler or `waitUntil` doesn't overwrite the newer results.
     */
    #structureCount = 0;

    /**
     * @this {AllProps & Actions}
     * @param {Element & ElementEnhancementGateway} enhancedElement
     * @param {SpawnContext} ctx
     * @param {PAP} initVals
     */
    constructor(enhancedElement, ctx, initVals){
        this.init(this, enhancedElement, ctx, initVals);
    }

    /**
     * @param {AllProps} self
     * @param {Element & ElementEnhancementGateway} enhancedElement
     * @param {SpawnContext} ctx
     * @param {PAP} initVals
     */
    async init(self, enhancedElement, ctx, initVals){
        // ctx.emc is only populated on the declarative (attribute) spawn path;
        // enh.get()/enh.set only pass ctx.config, onto which def.js copies customData.
        const {customData} = /** @type {EMC<any, AllProps, Element, RAConfig<AllProps, Actions>>} */ (ctx.emc || ctx.config);
        this.#enhKey = ctx.config.enhKey;
        /**
         * @type {RoundaboutOptions}
         */
        const raOptions = {
            ...customData,
            vm: self,
            initialPropVals: {
                enhancedElement,
                ...customData?.defaultPropVals,
                ...initVals
            }
        };
        await (await import('roundabout-lib/roundabout.js')).roundabout(raOptions);
        self.initialized = true;
    }

    /**
     * @param {AP} self
     */
    async hydrate(self){
        this.#disconnect();
        this.#abortController = new AbortController();
        const {enhancedElement} = self;
        enhancedElement.addEventListener('change', this, {signal: this.#abortController.signal});
        return /** @type {PAP} */ ({resolved: true});
    }

    /**
     * @param {Event} e
     */
    async handleEvent(e) {
        const self = /** @type {AP} */ (/** @type {any} */ (this));
        await this.#readFiles(self);
    }

    /**
     * Turns the extracted lines into records:  applies `rules` (if any), then calls
     * `handler` (if any) once per file, then dispatches `load`, whose listeners may also
     * set each result's `records`, and may delay `writeTo` with `event.waitUntil()`.
     * @param {AP} self
     */
    async structure(self){
        const {extracted, rules, handler, enhancedElement} = self;
        if(extracted === undefined) return /** @type {PAP} */ ({});
        const structureCount = ++this.#structureCount;
        const helpers = await import('./helpers.js');
        /** @type {Array<PdfResult>} */
        const results = [];
        for(const {file, numPages, lines} of extracted){
            /** @type {PdfResult} */
            const result = {file, numPages, lines};
            if(rules !== undefined && rules.length > 0){
                result.records = helpers.applyRules(lines, rules);
            }
            if(typeof handler === 'function'){
                try{
                    const returned = await handler({file, numPages, lines, records: result.records, helpers});
                    if(returned !== undefined) result.records = returned;
                }catch(error){
                    enhancedElement.dispatchEvent(new PdfErrorEvent(file, error, this.#enhKey));
                }
            }
            results.push(result);
        }
        if(structureCount !== this.#structureCount) return /** @type {PAP} */ ({}); // superseded
        const loadEvent = new LoadEvent(results, helpers, this.#enhKey);
        enhancedElement.dispatchEvent(loadEvent);
        await Promise.all(loadEvent.pending);
        if(structureCount !== this.#structureCount) return /** @type {PAP} */ ({});
        return /** @type {PAP} */ ({results});
    }

    /**
     * Writes each file's records (if rules, the handler or a `load` listener produced any),
     * otherwise its lines.
     * @param {AP} self
     */
    async storeResults(self){
        const {results, writeTo} = self;
        if(results === undefined || writeTo === undefined) return /** @type {PAP} */ ({});
        /** @type {Array<USL>} */
        const writtenTo = [];
        const {set} = await import('fifteenth/set.js');
        for(const result of results){
            const {file} = result;
            let adjustedWriteTo = writeTo;
            for(const key of ['name', 'size', 'type', 'lastModified']){
                const val = /** @type {any} */ (file)[key];
                if(val !== undefined && val !== ''){
                    adjustedWriteTo = adjustedWriteTo.replaceAll(`{file.${key}}`, String(val));
                }
            }
            await set(adjustedWriteTo, result.records !== undefined ? result.records : result.lines);
            writtenTo.push(adjustedWriteTo);
        }
        return /** @type {PAP} */ ({writtenTo});
    }

    #disconnect(){
        if(this.#abortController !== undefined) this.#abortController.abort();
    }

    /**
     * @param {AP} self
     */
    async #readFiles(self){
        const {enhancedElement} = self;
        if(!enhancedElement.checkValidity()) return;
        const {files} = enhancedElement;
        if(files === null || files.length === 0) return;
        const readCount = ++this.#readCount;
        const pdfjs = await loadPdfJs(self.workerSrc);
        const {extractLines} = await import('./extractLines.js');
        /** @type {Array<PdfResult>} */
        const extracted = [];
        for(const file of files){
            let loadingTask;
            try{
                const data = new Uint8Array(await file.arrayBuffer());
                loadingTask = pdfjs.getDocument({
                    data,
                    isEvalSupported: false,
                    verbosity: pdfjs.VerbosityLevel.ERRORS,
                });
                const pdf = await loadingTask.promise;
                const lines = await extractLines(pdf, self, (page, numPages) => {
                    enhancedElement.dispatchEvent(new PdfProgressEvent(file, page, numPages, this.#enhKey));
                });
                extracted.push({file, numPages: pdf.numPages, lines});
            }catch(error){
                enhancedElement.dispatchEvent(new PdfErrorEvent(file, error, this.#enhKey));
            }finally{
                // pdf.js 6 has `destroy` on the loading task (not the document proxy).
                await loadingTask?.destroy().catch(() => {});
            }
        }
        if(readCount !== this.#readCount) return; // superseded by a newer selection
        self.extracted = extracted;
    }
}

/** @type {Promise<any> | undefined} */
let pdfJsPromise;

/**
 * Lazily loads pdf.js (only once a file is actually selected), and points it at its worker.
 * @param {string | undefined} workerSrc
 */
function loadPdfJs(workerSrc){
    if(pdfJsPromise === undefined){
        pdfJsPromise = import('pdfjs-dist/build/pdf.min.mjs').then(pdfjs => {
            if(!pdfjs.GlobalWorkerOptions.workerSrc){
                pdfjs.GlobalWorkerOptions.workerSrc =
                    workerSrc ?? import.meta.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
            }
            return pdfjs;
        });
    }
    return pdfJsPromise;
}

export class LoadEvent extends Event {
    static EventName = 'load';
    /**
     * @type {Array<Promise<unknown>>}
     */
    #pending = [];
    /**
     * @param {Array<PdfResult>} results
     * @param {Helpers} helpers
     * @param {string | symbol} enh
     */
    constructor(results, helpers, enh){
        super(LoadEvent.EventName);
        /**
         * One entry per selected file that could be read.  Listeners may set (or modify)
         * each entry's `records`; that's what `writeTo` writes.
         */
        this.results = results;
        /** The functions of be-pdfing/helpers.js, for inline handlers, which can't import. */
        this.helpers = helpers;
        this.enh = enh;
    }
    /**
     * Delays `writeTo` (and the instance's `results` property) until `promise` settles,
     * for asynchronous logic in a listener.  Call it synchronously, during dispatch.
     * @param {Promise<unknown>} promise
     */
    waitUntil(promise){
        this.#pending.push(Promise.resolve(promise).catch(e => console.error(e)));
    }
    /**
     * The promises passed to `waitUntil`.
     */
    get pending(){
        return this.#pending;
    }
}

export class PdfProgressEvent extends Event {
    static EventName = 'progress';
    /**
     * @param {File} file
     * @param {number} page the page just extracted (1-based)
     * @param {number} numPages
     * @param {string | symbol} enh
     */
    constructor(file, page, numPages, enh){
        super(PdfProgressEvent.EventName);
        this.file = file;
        this.page = page;
        this.numPages = numPages;
        this.enh = enh;
    }
}

export class PdfErrorEvent extends Event {
    static EventName = 'error';
    /**
     * @param {File} file
     * @param {unknown} error
     * @param {string | symbol} enh
     */
    constructor(file, error, enh){
        super(PdfErrorEvent.EventName);
        this.file = file;
        this.error = error;
        this.enh = enh;
    }
}

export { BePdfing }
