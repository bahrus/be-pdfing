// Unit tests of helpers.js.  These run in Node (no page), using pdf.js's legacy build.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractLines } from '../extractLines.js';
import { tables, columnsOf, valueAfter, between, after, matches, num } from '../helpers.js';

/** @param {string} path */
async function linesOf(path){
    const data = new Uint8Array(await readFile(path));
    const loadingTask = pdfjs.getDocument({data, verbosity: 0});
    try{
        return await extractLines(await loadingTask.promise);
    }finally{
        await loadingTask.destroy();
    }
}

const home = await linesOf('demo/home-school-transcript-example.pdf');
const sample = await linesOf('demo/sample-transcript.pdf');

test('tables: side-by-side tables, in column order', () => {
    const found = tables(home, {
        header: /Grade (?<gradeLevel>\d+)\tGr\tCr/,
        until: /^GPA/,
        columns: ['course', 'grade', 'credits'],
    });
    expect(found.map(t => [t.header.gradeLevel, t.rows.length])).toEqual([['9', 8], ['10', 7], ['11', 9], ['12', 7]]);
    expect(found[0].rows[0]).toEqual({course: 'Honors Eng 9: World Lit', grade: 'A', credits: '1'});
    expect(found[1].rows.at(-1)).toEqual({course: 'Physical Education', grade: 'P', credits: '0.5'});
    expect(found[2].rows.at(-1)).toEqual({course: "Driver's Ed", grade: 'P', credits: '0.5'});
    // The tables split the page halfway across the gap between their headers.
    expect(found[0].x1).toBe(found[1].x0);
    // lines[i] is rows[i]'s line, restricted to the table's cells.
    expect(found[0].lines[0].text).toBe('Honors Eng 9: World Lit\tA\t1');
});

test('tables: header as an array of cell texts, default column names', () => {
    const [first, second] = tables(home, {header: [/Grade (?<gradeLevel>\d+)/, 'Gr', 'Cr']});
    expect(first.header).toEqual({gradeLevel: '9'});
    expect(first.columns.map(c => c.name)).toEqual(['Grade 9', 'Gr', 'Cr']);
    expect(second.columns.map(c => c.name)).toEqual(['Grade 10', 'Gr', 'Cr']);
    expect(first.rows[0]).toEqual({'Grade 9': 'Honors Eng 9: World Lit', Gr: 'A', Cr: '1'});
    // Without `until`, the GPA row is part of the table.
    expect(first.rows.at(-1)).toEqual({'Grade 9': 'GPA = 4.0', Cr: '9'});
});

test('tables: empty cells, stacked headings, and a vertical gap ending the table', () => {
    const [left, right] = tables(sample, {
        header: /Code\tCODE\tDescription\tGrade\tEarn\t(?:Cred )?Attp\tDSG/,
        until: /Report Period/,
        columns: ['stateCode', 'courseCode', 'description', 'grade', 'credEarn', 'credAttp', 'dsg'],
    });
    // 5 terms of (heading + 5 courses); the signature block below is excluded by the gap.
    expect(left.rows).toHaveLength(30);
    expect(left.lines.at(-1).text).toMatch(/^00015/);
    // PE has no DSG, and the other cells stay in their columns.
    expect(left.rows.find(r => r.courseCode === 'PHE1')).toEqual({
        stateCode: '00005', courseCode: 'PHE1', description: 'PE', grade: 'A', credEarn: '0.50', credAttp: '0.50',
    });
    // The right table ends at the "Report Period" banner.
    expect(right.rows.filter(r => /^\d{5}$/.test(r.stateCode ?? ''))).toHaveLength(5);
    expect(right.rows.at(-1)).toEqual({credAttp: 'Credits Earned'});
});

test('the sample-transcript handler from the README', () => {
    const courses = [];
    for(const table of tables(sample, {
        header: /Code\tCODE\tDescription\tGrade\tEarn\t(?:Cred )?Attp\tDSG/,
        until: /Report Period/,
        columns: ['stateCode', 'courseCode', 'description', 'grade', 'credEarn', 'credAttp', 'dsg'],
    })){
        let term;
        for(const [i, row] of table.rows.entries()){
            const heading = /MO\/YR: (\S+)\t(?:GRD )?LEV: (\d+)/.exec(table.lines[i].text);
            if(heading !== null){
                term = {moYr: heading[1], gradeLevel: heading[2]};
            }else if(term !== undefined && /^\d{5}$/.test(row.stateCode)){
                courses.push({...term, ...row, credEarn: num(row.credEarn), credAttp: num(row.credAttp)});
            }
        }
    }
    expect(courses).toHaveLength(30);
    expect(courses[0]).toEqual({
        moYr: '01/2018', gradeLevel: '09', stateCode: '00001', courseCode: 'ENGL1',
        description: 'English 9', grade: 'A', credEarn: 0.5, credAttp: 0.5, dsg: 'B',
    });
    // Left column first, then the right:  no interleaving.
    expect(courses.slice(0, 25).every(c => c.moYr !== '06/2020')).toBe(true);
    expect(courses.slice(25).every(c => c.moYr === '06/2020' && c.gradeLevel === '11')).toBe(true);
});

test('valueAfter', () => {
    expect(valueAfter(home, 'Student:')).toBe('Albert Smith');
    expect(valueAfter(home, 'Evaluator:')).toBe('Dr. Stan Albertson');
    // The rest of the label's own cell.
    expect(valueAfter(home, 'Entrance Date:')).toBe('Sept. 1, 2014');
    expect(valueAfter(sample, /MO\/YR:/)).toBe('01/2018');
    // Label over value.
    expect(valueAfter(sample, 'LEGAL NAME (Last, First, Middle)', {below: true})).toBe('Cougar, Butch The');
    expect(valueAfter(sample, 'Report Date', {below: true})).toBe('1/1/2020');
    expect(valueAfter(sample, 'No such label')).toBeUndefined();
});

test('columnsOf', () => {
    const [left, right] = columnsOf(sample);
    expect(left.some(l => l.text.startsWith('00001\tENGL1'))).toBe(true);
    expect(left.some(l => l.text.includes('ENGL3'))).toBe(true); // the left column's 01/2020 term
    expect(right.some(l => l.text.startsWith('00011\tENGL3'))).toBe(true);
    expect(right.every(l => !l.text.includes('ENGL1'))).toBe(true);
    // An explicit gutter.
    const [l2, r2] = columnsOf(home, {gutter: 300});
    expect(l2.find(l => l.text.startsWith('Student:'))?.text).toBe('Student:\tAlbert Smith');
    expect(r2.find(l => l.text.startsWith('Evaluator:'))?.text).toBe('Evaluator:\tDr. Stan Albertson');
});

test('between, after, matches', () => {
    const record = between(sample, /ACADEMIC RECORD/, /SAMPLE TRANSCRIPT/);
    expect(record[0].text).toMatch(/^State/);
    expect(record.at(-1).text).toMatch(/^00015/);
    expect(after(sample, /SAMPLE TRANSCRIPT/)[0].text).toMatch(/^Uploading/);
    expect(between(sample, /no such line/)).toEqual([]);
    const gpas = matches(home, /GPA = (?<gpa>[\d.]+)/);
    expect(gpas.map(m => m.match.groups.gpa)).toEqual(['3.76', '4.0', '3.76', '4.0']);
    expect(gpas[0].x0).toBeGreaterThan(300); // right column first:  it's higher on the page
});

test('num', () => {
    expect(num('0.50')).toBe(0.5);
    expect(num(' 1,234.50 ')).toBe(1234.5);
    expect(num('$12')).toBe(12);
    expect(num('-3')).toBe(-3);
    expect(num('')).toBeUndefined();
    expect(num('A')).toBeUndefined();
    expect(num(undefined)).toBeUndefined();
});
