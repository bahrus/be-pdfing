// @ts-check
/** @import {Line, Cell, Fields, Table, TableColumn, TableOptions, Match, ColumnsOptions, ValueAfterOptions, TextPattern} from './types/be-pdfing/types' */
import { applyRules, cellStarts, xAt } from './applyRules.js';

export { applyRules };
export { linesToText, aiAvailability, promptForRecords, createSession, AIUnavailableError } from './ai.js';

/**
 * Every match of `pattern` in every line's `text`, with the horizontal extent of the match.
 * The `g` flag is always applied, so a pattern can match several times per line.
 * @param {Array<Line>} lines
 * @param {TextPattern} pattern
 * @returns {Array<Match>}
 */
export function matches(lines, pattern){
    const re = toGlobalRegExp(pattern);
    /** @type {Array<Match>} */
    const result = [];
    for(const line of lines){
        const starts = cellStarts(line);
        for(const match of line.text.matchAll(re)){
            const s = /** @type {number} */ (match.index);
            const e = s + match[0].length;
            if(e === s) continue;
            result.push({line, match, x0: xAt(line, starts, s, false), x1: xAt(line, starts, e, true)});
        }
    }
    return result;
}

/**
 * The lines after the first line matching `start`, up to (not including) the next line
 * matching `end`.  Pass `undefined` as `start` to begin at the first line; omit `end`
 * to continue to the last line.  Returns `[]` if `start` never matches.
 * @param {Array<Line>} lines
 * @param {TextPattern | undefined} start
 * @param {TextPattern} [end]
 * @returns {Array<Line>}
 */
export function between(lines, start, end){
    let i = 0;
    if(start !== undefined){
        const startRe = toRegExp(start);
        i = lines.findIndex(line => startRe.test(line.text));
        if(i === -1) return [];
        i++;
    }
    if(end === undefined) return lines.slice(i);
    const endRe = toRegExp(end);
    const j = lines.findIndex((line, k) => k >= i && endRe.test(line.text));
    return lines.slice(i, j === -1 ? undefined : j);
}

/**
 * The lines after the first line matching `start`.
 * @param {Array<Line>} lines
 * @param {TextPattern} start
 */
export function after(lines, start){
    return between(lines, start);
}

/**
 * The value that goes with a label, for form-like blocks ("Student: Albert Smith").
 *
 * Finds the first cell that starts with `label` (a string, compared after trimming, or a
 * RegExp tested against the cell's text).  If the label cell has more text after the label
 * ("MO/YR: 01/2018"), that's the value.  Otherwise it's the next cell on the same line or,
 * with `{below: true}`, the cell on the next line that sits most directly under the label
 * (for label-over-value layouts).
 * @param {Array<Line>} lines
 * @param {TextPattern} label
 * @param {ValueAfterOptions} [options]
 * @returns {string | undefined}
 */
export function valueAfter(lines, label, options = {}){
    const {below = false} = options;
    for(let i = 0; i < lines.length; i++){
        const {cells} = lines[i];
        for(let j = 0; j < cells.length; j++){
            const cell = cells[j];
            const rest = restAfterLabel(cell.text, label);
            if(rest === undefined) continue;
            if(rest !== '') return rest;
            if(!below) return cells[j + 1]?.text;
            const next = lines[i + 1];
            if(next === undefined || next.page !== lines[i].page) return undefined;
            return mostOverlapping(next.cells, cell.x, cell.x + cell.width)?.text;
        }
    }
    return undefined;
}

/**
 * Finds tables by their header row, and assigns each cell below the header to a column
 * by its horizontal position under the header cells.
 *
 * - `header` is a RegExp matched against each line's `text` (cells joined by `\t`), or an
 *   array of header cell texts.  It may match several times per line:  each match is a
 *   separate table (side-by-side tables), and the page is divided between them halfway
 *   across the gap between neighboring headers.
 * - A cell belongs to the table whose horizontal range contains its center, and to the
 *   column it overlaps most (or, if it overlaps none, the nearest one).  So empty cells
 *   don't shift the others, and a cell can't land in the wrong column.
 * - Column names are the header cells' text, unless `columns` renames them (in order).
 * - A table ends at the first line (within its range) matching `until`, at the next
 *   header that overlaps it, at a page break, or at an unusually large vertical gap
 *   (more than 1.75 times the typical row spacing so far).
 * @param {Array<Line>} lines
 * @param {TableOptions} options
 * @returns {Array<Table>}
 */
export function tables(lines, options){
    const {header, until, columns: names} = options;
    const headerRe = Array.isArray(header)
        ? new RegExp(header.map(h => typeof h === 'string' ? escapeRegExp(h) : h.source).join('\t'), 'g')
        : toGlobalRegExp(header);
    const untilRe = until === undefined ? undefined : toRegExp(until);

    /** @type {Array<{lineIndex: number, table: Table}>} */
    const found = [];
    for(let li = 0; li < lines.length; li++){
        const line = lines[li];
        const starts = cellStarts(line);
        /** @type {Array<{groups: Fields, columns: Array<TableColumn>}>} */
        const onLine = [];
        for(const match of line.text.matchAll(headerRe)){
            const s = /** @type {number} */ (match.index);
            const e = s + match[0].length;
            if(e === s) continue;
            const headerCells = line.cells.filter((cell, k) => starts[k] < e && s < starts[k] + cell.text.length);
            if(headerCells.length === 0) continue;
            onLine.push({
                groups: fieldsOf(match),
                columns: headerCells.map((cell, k) => ({
                    name: names?.[k] ?? cell.text,
                    x0: cell.x,
                    x1: cell.x + cell.width,
                })),
            });
        }
        for(let k = 0; k < onLine.length; k++){
            const {groups, columns} = onLine[k];
            const prev = onLine[k - 1];
            const next = onLine[k + 1];
            const first = columns[0];
            const last = columns[columns.length - 1];
            found.push({lineIndex: li, table: {
                page: line.page,
                y: line.y,
                header: groups,
                columns,
                x0: prev === undefined ? -Infinity : (prev.columns[prev.columns.length - 1].x1 + first.x0) / 2,
                x1: next === undefined ? Infinity : (last.x1 + next.columns[0].x0) / 2,
                rows: [],
                lines: [],
            }});
        }
    }

    for(const {lineIndex, table} of found){
        const {columns, x0, x1} = table;
        /** @type {Array<number>} */
        const gaps = [];
        let prevY = table.y;
        for(let li = lineIndex + 1; li < lines.length; li++){
            const line = lines[li];
            if(line.page !== table.page) break;
            if(found.some(f => f.lineIndex === li && f.table.x0 < x1 && x0 < f.table.x1)) break;
            // Gaps are measured between consecutive lines of the page (not just this table's
            // rows), so a line that only has text in a neighboring table doesn't look like a gap.
            const gap = prevY - line.y;
            if(gaps.length >= 2 && gap > 1.75 * median(gaps)) break;
            if(table.rows.length > 0) gaps.push(gap);
            prevY = line.y;
            const cells = line.cells.filter(cell => {
                const center = cell.x + cell.width / 2;
                return center >= x0 && center < x1;
            });
            if(cells.length === 0) continue;
            const scoped = scopedLine(line, cells);
            if(untilRe !== undefined && untilRe.test(scoped.text)) break;
            /** @type {Fields} */
            const row = {};
            for(const cell of cells){
                const column = mostOverlapping(columns, cell.x, cell.x + cell.width);
                if(column === undefined) continue;
                row[column.name] = row[column.name] === undefined ? cell.text : `${row[column.name]} ${cell.text}`;
            }
            table.rows.push(row);
            table.lines.push(scoped);
        }
    }
    return found.map(f => f.table);
}

/**
 * Splits two-column (or multi-column) pages into separate column streams, so each column
 * can be processed top to bottom instead of interleaved line by line.
 *
 * Returns one array of lines per column:  column 0 holds the left column's lines of every
 * page, in order, then column 1 the right column's, and so on.  A cell goes to the column
 * that contains its center.  Lines are trimmed to the cells in that column; lines with no
 * cells in a column are left out of it.
 *
 * `gutter` gives the dividing x position(s) explicitly.  Without it, the gutter is detected
 * per page:  among the middle 40% of the text's horizontal extent, the x crossed by the
 * fewest cells (ignoring single-cell lines such as titles and paragraphs), nearest the
 * middle.  Detection always assumes two columns.
 * @param {Array<Line>} lines
 * @param {ColumnsOptions} [options]
 * @returns {Array<Array<Line>>}
 */
export function columnsOf(lines, options = {}){
    const {gutter} = options;
    /** @type {Array<Array<Line>>} */
    const columns = [];
    for(const pageLines of byPage(lines)){
        const gutters = gutter === undefined ? [detectGutter(pageLines)]
            : Array.isArray(gutter) ? [...gutter].sort((a, b) => a - b) : [gutter];
        for(let c = 0; c <= gutters.length; c++){
            const left = c === 0 ? -Infinity : gutters[c - 1];
            const right = c === gutters.length ? Infinity : gutters[c];
            columns[c] ??= [];
            for(const line of pageLines){
                const cells = line.cells.filter(cell => {
                    const center = cell.x + cell.width / 2;
                    return center >= left && center < right;
                });
                if(cells.length > 0) columns[c].push(scopedLine(line, cells));
            }
        }
    }
    return columns;
}

/**
 * Lenient number parsing:  ignores surrounding space, thousands separators, currency
 * symbols and a trailing %.  Returns `undefined` for empty or non-numeric text.
 * @param {string | undefined | null} s
 * @returns {number | undefined}
 */
export function num(s){
    if(s === undefined || s === null) return undefined;
    const cleaned = String(s).trim().replace(/[,$€£%\s]/g, '');
    if(cleaned === '' || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return undefined;
    return Number(cleaned);
}

/**
 * @param {Array<Line>} lines
 */
function byPage(lines){
    /** @type {Map<number, Array<Line>>} */
    const pages = new Map();
    for(const line of lines){
        let page = pages.get(line.page);
        if(page === undefined) pages.set(line.page, page = []);
        page.push(line);
    }
    return pages.values();
}

/**
 * @param {Array<Line>} pageLines
 */
function detectGutter(pageLines){
    let min = Infinity, max = -Infinity;
    for(const {cells} of pageLines){
        for(const cell of cells){
            min = Math.min(min, cell.x);
            max = Math.max(max, cell.x + cell.width);
        }
    }
    const middle = (min + max) / 2;
    const from = Math.floor(min + 0.3 * (max - min));
    const to = Math.ceil(min + 0.7 * (max - min));
    const multiCell = pageLines.filter(line => line.cells.length > 1);
    let best = middle, bestCount = Infinity;
    // Half-point steps, so a gutter between cells that are 1pt apart is still found.
    for(let x = from; x <= to; x += 0.5){
        let count = 0;
        for(const {cells} of multiCell){
            for(const cell of cells){
                if(cell.x < x && x < cell.x + cell.width) count++;
            }
        }
        if(count < bestCount || (count === bestCount && Math.abs(x - middle) < Math.abs(best - middle))){
            best = x;
            bestCount = count;
        }
    }
    return best;
}

/**
 * A copy of `line` restricted to `cells`.
 * @param {Line} line
 * @param {Array<Cell>} cells
 * @returns {Line}
 */
function scopedLine(line, cells){
    return {page: line.page, y: line.y, text: cells.map(c => c.text).join('\t'), cells};
}

/**
 * The item overlapping [x0, x1] the most or, if none overlaps, the nearest.
 * @template {{x0: number, x1: number} | Cell} T
 * @param {Array<T>} items
 * @param {number} x0
 * @param {number} x1
 * @returns {T | undefined}
 */
function mostOverlapping(items, x0, x1){
    /** @type {T | undefined} */
    let best;
    let bestScore = -Infinity;
    for(const item of items){
        const [ix0, ix1] = 'x0' in item ? [item.x0, item.x1] : [item.x, item.x + item.width];
        // Positive: the overlap's width.  Negative: minus the gap between them.
        const score = Math.min(x1, ix1) - Math.max(x0, ix0);
        if(score > bestScore){
            best = item;
            bestScore = score;
        }
    }
    return best;
}

/**
 * @param {string} text
 * @param {TextPattern} label
 * @returns {string | undefined} the text after the label, or undefined if `text` doesn't start with it
 */
function restAfterLabel(text, label){
    const trimmed = text.trim();
    if(typeof label === 'string'){
        const l = label.trim();
        return trimmed.startsWith(l) ? trimmed.slice(l.length).trim() : undefined;
    }
    const match = new RegExp(label.source, label.flags.replace('g', '')).exec(trimmed);
    if(match === null || match.index !== 0) return undefined;
    return trimmed.slice(match[0].length).trim();
}

/**
 * @param {Array<number>} values
 */
function median(values){
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Named groups that participated in the match, trimmed.
 * @param {RegExpMatchArray} match
 * @returns {Fields}
 */
function fieldsOf(match){
    /** @type {Fields} */
    const fields = {};
    for(const [key, val] of Object.entries(match.groups ?? {})){
        if(val !== undefined) fields[key] = val.trim();
    }
    return fields;
}

/**
 * @param {TextPattern} pattern
 */
function toRegExp(pattern){
    if(typeof pattern === 'string') return new RegExp(escapeRegExp(pattern));
    return pattern.global || pattern.sticky ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')) : pattern;
}

/**
 * @param {TextPattern} pattern
 */
function toGlobalRegExp(pattern){
    if(typeof pattern === 'string') return new RegExp(escapeRegExp(pattern), 'g');
    return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
}

/**
 * @param {string} s
 */
function escapeRegExp(s){
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
