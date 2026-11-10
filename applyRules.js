// @ts-check
/** @import {Line, Rule, Records, Fields} from './types/be-pdfing/types' */

/**
 * Turn extracted lines into records, using an ordered list of regular-expression rules.
 *
 * - Every rule is matched against each line's `text` (cells joined by `\t`), and
 *   may match several times per line (the `g` flag is always applied).
 * - Rules claim the text they match, in the order they're listed:  a later rule
 *   can't match text an earlier rule already matched.  A rule with neither
 *   `emits` nor `sets` therefore just hides text from the rules after it.
 * - `emits: 'name'` adds one record per match to `records.name`, made of the
 *   match's named groups.
 * - `sets: true` makes the match's named groups context, inherited by the
 *   records emitted *below* it that overlap it horizontally -- so a heading
 *   above the left half of a two-column page only applies to the left column.
 *   `sets: 'document'` applies to every record that follows, wherever it is.
 *
 * @param {Array<Line>} lines
 * @param {Array<Rule>} rules
 * @returns {Records}
 */
export function applyRules(lines, rules){
    const compiled = rules.map(rule => ({rule, re: new RegExp(rule.pattern, withGlobal(rule.flags))}));
    /** @type {Records} */
    const records = {};
    for(const {emits} of rules){
        if(emits) records[emits] ??= [];
    }
    /** @type {Array<{x0: number, x1: number, everywhere: boolean, fields: Fields}>} */
    const context = [];

    for(const line of lines){
        const starts = cellStarts(line);
        /** @type {Array<[number, number]>} */
        const claimed = [];
        /** @type {Array<{rule: Rule, fields: Fields, x0: number, x1: number}>} */
        const accepted = [];
        for(const {rule, re} of compiled){
            for(const match of line.text.matchAll(re)){
                const s = /** @type {number} */ (match.index);
                const e = s + match[0].length;
                if(e === s) continue;
                if(claimed.some(([cs, ce]) => s < ce && cs < e)) continue;
                claimed.push([s, e]);
                accepted.push({
                    rule,
                    fields: fieldsOf(match),
                    x0: xAt(line, starts, s, false),
                    x1: xAt(line, starts, e, true),
                });
            }
        }
        accepted.sort((p, q) => p.x0 - q.x0);
        for(const {rule, fields, x0, x1} of accepted){
            if(rule.sets){
                context.push({x0, x1, everywhere: rule.sets === 'document', fields});
            }
            if(rule.emits){
                records[rule.emits].push({...inherited(context, x0, x1), ...fields});
            }
        }
    }
    return records;
}

/**
 * @param {string | undefined} flags
 */
function withGlobal(flags = ''){
    return flags.includes('g') ? flags : flags + 'g';
}

/**
 * Named groups that participated in the match, trimmed.  A pattern with no
 * named groups yields `{match}`.
 * @param {RegExpMatchArray} match
 * @returns {Fields}
 */
function fieldsOf(match){
    /** @type {Fields} */
    const fields = {};
    if(match.groups === undefined){
        fields.match = match[0].trim();
        return fields;
    }
    for(const [key, val] of Object.entries(match.groups)){
        if(val !== undefined) fields[key] = val.trim();
    }
    return fields;
}

/**
 * The most recent value of each context field whose source overlaps [x0, x1].
 * @param {Array<{x0: number, x1: number, everywhere: boolean, fields: Fields}>} context
 * @param {number} x0
 * @param {number} x1
 * @returns {Fields}
 */
function inherited(context, x0, x1){
    /** @type {Fields} */
    const result = {};
    for(let i = context.length - 1; i >= 0; i--){
        const entry = context[i];
        if(!entry.everywhere && !(x0 < entry.x1 && entry.x0 < x1)) continue;
        for(const key in entry.fields){
            if(!(key in result)) result[key] = entry.fields[key];
        }
    }
    return result;
}

/**
 * Offset of each cell within `line.text`.
 * @param {Line} line
 */
export function cellStarts(line){
    const starts = [];
    let offset = 0;
    for(const cell of line.cells){
        starts.push(offset);
        offset += cell.text.length + 1; // + the '\t' separator
    }
    return starts;
}

/**
 * Approximate horizontal position of a character offset within the line.
 * @param {Line} line
 * @param {Array<number>} starts
 * @param {number} offset
 * @param {boolean} isEnd true for an exclusive end offset
 */
export function xAt(line, starts, offset, isEnd){
    const {cells} = line;
    for(let i = 0; i < cells.length; i++){
        const cell = cells[i];
        const start = starts[i];
        const stop = start + cell.text.length;
        const inCell = isEnd ? offset > start && offset <= stop : offset >= start && offset < stop;
        if(inCell){
            return cell.x + ((offset - start) / cell.text.length) * cell.width;
        }
        if(isEnd ? offset <= start : offset < start){
            // In the separator before this cell.
            const prev = cells[i - 1];
            return isEnd && prev !== undefined ? prev.x + prev.width : cell.x;
        }
    }
    const last = cells[cells.length - 1];
    return last.x + last.width;
}
