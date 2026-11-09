// @ts-check
/** @import {Line, Cell, ExtractOptions} from './types/be-pdfing/types' */

/**
 * Extract layout-aware lines from every page of a pdf.js document.
 *
 * Lines are returned in reading order: page by page, top to bottom.  Each line
 * is split into cells wherever the horizontal gap between neighboring text runs
 * is wide (see {@link ExtractOptions.cellGap}), and the line's `text` joins its
 * cells with a tab character, so rules can treat `\t` as a column boundary.
 *
 * @param {any} pdf a pdf.js `PDFDocumentProxy`
 * @param {ExtractOptions} [options]
 * @param {(pageNumber: number, numPages: number) => void} [onPage] called after each page
 * @returns {Promise<Array<Line>>}
 */
export async function extractLines(pdf, options = {}, onPage){
    /** @type {Array<Line>} */
    const lines = [];
    const {numPages} = pdf;
    for(let pageNumber = 1; pageNumber <= numPages; pageNumber++){
        const page = await pdf.getPage(pageNumber);
        const {items} = await page.getTextContent();
        for(const line of linesFromItems(items, pageNumber, options)){
            lines.push(line);
        }
        page.cleanup();
        onPage?.(pageNumber, numPages);
    }
    return lines;
}

/**
 * Group the text items of one page into lines and cells.
 *
 * Exported separately so it can be unit tested without pdf.js.
 *
 * @param {Array<any>} items `getTextContent().items` of a single page
 * @param {number} pageNumber 1-based
 * @param {ExtractOptions} [options]
 * @returns {Array<Line>}
 */
export function linesFromItems(items, pageNumber, options = {}){
    const {cellGap = 1, lineTolerance = 0.5} = options;
    /** @type {Array<Run>} */
    const runs = [];
    for(const item of items){
        if(typeof item?.str !== 'string') continue; // marked-content items
        const str = item.str;
        if(str.trim() === '') continue;
        const [a, b, c, d, x, y] = item.transform;
        // Rotated or skewed text (diagonal watermarks, vertical column labels)
        // doesn't belong to a horizontal line.
        if(Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0) continue;
        const height = item.height || Math.abs(d);
        runs.push({str, x, y, width: item.width, height});
    }
    // Top of page first (PDF y grows upward), then left to right.
    runs.sort((p, q) => (q.y - p.y) || (p.x - q.x));

    /** @type {Array<Array<Run>>} */
    const grouped = [];
    /** @type {Array<Run> | undefined} */
    let current;
    for(const run of runs){
        const anchor = current?.[0];
        if(anchor !== undefined
            && Math.abs(anchor.y - run.y) <= lineTolerance * Math.min(anchor.height, run.height)){
            current.push(run);
        }else{
            current = [run];
            grouped.push(current);
        }
    }

    return grouped.map(lineRuns => toLine(lineRuns, pageNumber, cellGap));
}

/**
 * @typedef {{str: string, x: number, y: number, width: number, height: number}} Run
 */

/**
 * @param {Array<Run>} lineRuns
 * @param {number} pageNumber
 * @param {number} cellGap
 * @returns {Line}
 */
function toLine(lineRuns, pageNumber, cellGap){
    lineRuns.sort((p, q) => p.x - q.x);
    /** @type {Array<Cell>} */
    const cells = [];
    /** @type {Run | undefined} */
    let prev;
    let text = '', start = 0, end = 0;
    const flush = () => {
        const trimmed = text.trim();
        if(trimmed) cells.push({text: trimmed, x: round(start), width: round(end - start)});
    };
    for(const run of lineRuns){
        if(prev !== undefined){
            // Some generators fake bold by drawing the same text twice, slightly offset.
            if(run.str === prev.str && Math.abs(run.x - prev.x) < 1) continue;
            const gap = run.x - end;
            const em = Math.min(prev.height, run.height);
            if(gap > cellGap * em){
                flush();
                text = run.str;
                start = run.x;
            }else{
                const needsSpace = gap > 0.15 * em && !/\s$/.test(text) && !/^\s/.test(run.str);
                text += (needsSpace ? ' ' : '') + run.str;
            }
        }else{
            text = run.str;
            start = run.x;
        }
        end = Math.max(end, run.x + run.width);
        prev = run;
    }
    flush();
    return {
        page: pageNumber,
        y: round(lineRuns[0].y),
        text: cells.map(cell => cell.text).join('\t'),
        cells,
    };
}

/** @param {number} n */
function round(n){
    return Math.round(n * 10) / 10;
}
