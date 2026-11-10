// @ts-check
/** @import {HandlerArgs} from '../types/be-pdfing/types' */

/*
 * Two handlers that turn either sample transcript into the same shape of records:
 *
 *   {student: string, courses: [{gradeLevel, term?, courseCode?, course, grade, credits}]}
 *
 * - `aiHandler` asks the browser's built-in model (Gemini Nano, via the Prompt API).
 *   One generic schema + instructions, no per-document code.
 * - `deterministicHandler` uses the layout helpers, with per-document logic.
 *
 * `compareCourses` scores one against the other.
 */

/** JSON Schema for the model's response (passed as `responseConstraint`). */
export const transcriptSchema = {
    type: 'object',
    properties: {
        student: {type: 'string', description: "The student's full name"},
        courses: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    gradeLevel: {type: 'integer', description: 'School grade (9-12) the course was taken in'},
                    term: {type: 'string', description: 'Term or MO/YR heading the course is listed under, if any'},
                    courseCode: {type: 'string'},
                    course: {type: 'string', description: 'Course name / description'},
                    grade: {type: 'string', description: 'Letter grade, e.g. A, B+, P'},
                    credits: {type: 'number', description: 'Credits earned'},
                },
                required: ['gradeLevel', 'course', 'grade', 'credits'],
                additionalProperties: false,
            },
        },
    },
    required: ['student', 'courses'],
    additionalProperties: false,
};

export const transcriptInstructions = `You extract data from high school transcripts.
The user message is text extracted from a PDF transcript: one line per row of the page, with the cells of a row separated by " | ".
When the page has side-by-side columns, each column is given separately, under a "=== Column N ===" heading.
Return the student's name and one entry per course row. A course that appears in several terms is listed once per term.
gradeLevel is the grade (9 to 12) from the heading the course is listed under.
term is that heading's MO/YR value, if it has one.
Do not include GPA, total, cumulative or summary rows, grading scales, or legends.`;

/**
 * @param {HandlerArgs} args
 */
export async function aiHandler({lines, helpers}){
    const {promptForRecords, columnsOf} = helpers;
    return await promptForRecords(columnsOf(lines), {
        schema: transcriptSchema,
        instructions: transcriptInstructions,
    });
}

/**
 * @param {HandlerArgs} args
 */
export function deterministicHandler({lines, helpers}){
    const {tables, valueAfter, num} = helpers;
    if(valueAfter(lines, 'Student:') !== undefined){
        // home-school-transcript-example.pdf
        return {
            student: valueAfter(lines, 'Student:'),
            courses: tables(lines, {
                header: /Grade (?<gradeLevel>\d+)\tGr\tCr/,
                until: /^GPA/,
                columns: ['course', 'grade', 'credits'],
            }).flatMap(({header, rows}) => rows.map(row => ({
                gradeLevel: num(header.gradeLevel), course: row.course, grade: row.grade, credits: num(row.credits),
            }))),
        };
    }
    // sample-transcript.pdf
    const courses = [];
    for(const table of tables(lines, {
        header: /Code\tCODE\tDescription\tGrade\tEarn\t(?:Cred )?Attp\tDSG/,
        until: /Report Period/,
        columns: ['stateCode', 'courseCode', 'description', 'grade', 'credEarn', 'credAttp', 'dsg'],
    })){
        let term;
        for(const [i, row] of table.rows.entries()){
            const heading = /MO\/YR: (\S+)\t(?:GRD )?LEV: (\d+)/.exec(table.lines[i].text);
            if(heading !== null){
                term = {term: heading[1], gradeLevel: num(heading[2])};
            }else if(term !== undefined && /^\d{5}$/.test(row.stateCode)){
                courses.push({...term, courseCode: row.courseCode, course: row.description, grade: row.grade, credits: num(row.credEarn)});
            }
        }
    }
    return {
        student: valueAfter(lines, 'LEGAL NAME (Last, First, Middle)', {below: true}),
        courses,
    };
}

/**
 * How well `actual` matches `expected`:  courses are matched one-to-one by
 * (course name, grade level); a match whose grade or credits differ is a mismatch.
 * @param {{courses: Array<any>}} expected
 * @param {{courses: Array<any>}} actual
 */
export function compareCourses(expected, actual){
    const key = (/** @type {any} */ c) => `${String(c.course).toLowerCase().replace(/\s+/g, ' ').trim()}|${Number(c.gradeLevel)}`;
    const remaining = [...(actual.courses ?? [])];
    let exact = 0;
    /** @type {Array<{expected: any, actual: any}>} */
    const mismatched = [];
    /** @type {Array<any>} */
    const missing = [];
    for(const e of expected.courses){
        const i = remaining.findIndex(a => key(a) === key(e));
        if(i === -1){
            missing.push(e);
            continue;
        }
        const [a] = remaining.splice(i, 1);
        if(String(a.grade).trim() === String(e.grade).trim() && Number(a.credits) === Number(e.credits)) exact++;
        else mismatched.push({expected: e, actual: a});
    }
    return {expected: expected.courses.length, exact, mismatched, missing, extra: remaining};
}
