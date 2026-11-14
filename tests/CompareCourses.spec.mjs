// compareCourses (demo/transcriptHandlers.js), which scores the AI demo's records.
import { test, expect } from '@playwright/test';
import { compareCourses } from '../demo/transcriptHandlers.js';

const expected = {courses: [
    {gradeLevel: 9, course: 'Honors Eng 9: World Lit', grade: 'A', credits: 1},
    {gradeLevel: 9, course: 'Alg II/Trig (gr 8)', grade: 'A', credits: 2},
    {gradeLevel: 10, course: 'El Spanish 1', grade: 'A', credits: 1},
    {gradeLevel: 11, course: 'British Lit', grade: 'A', credits: 1},
    {gradeLevel: 12, course: 'Eng Comp 2', grade: 'B', credits: 1},
]};

test('a name in courseCode, or split across courseCode and course, still matches', () => {
    const c = compareCourses(expected, {courses: [
        {gradeLevel: 9, courseCode: 'Honors Eng 9', course: 'World Lit', grade: 'A', credits: 1},
        {gradeLevel: 9, courseCode: 'Alg II/Trig (gr 8)', course: 'Algebra II/Trigonometry', grade: 'A', credits: 2},
        {gradeLevel: 12, course: 'eng  comp 2', grade: 'A', credits: 1},
    ]});
    expect(c.exact).toBe(2);
    expect(c.mismatched).toHaveLength(1);
    expect(c.mismatched[0].expected.course).toBe('Eng Comp 2');
    expect(c.extra).toEqual([]);
    expect(c.missing.map(m => m.course)).toEqual(['El Spanish 1', 'British Lit']);
});

test('rewording, or the wrong grade level, does not match', () => {
    const c = compareCourses(expected, {courses: [
        {gradeLevel: 11, course: 'British Literature', grade: 'A', credits: 1},
        {gradeLevel: 9, course: 'El Spanish 1', grade: 'A', credits: 1},
        {gradeLevel: 9, courseCode: 'Honors Eng 9', course: '', grade: 'A', credits: 1},
    ]});
    expect(c.exact).toBe(0);
    expect(c.extra).toHaveLength(3);
    expect(c.missing).toHaveLength(5);
});
