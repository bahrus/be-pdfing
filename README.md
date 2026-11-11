# be-pdfing

Enhance the input element (type=file) so it can declaratively read PDF files, extract their text as layout-aware lines and cells, and turn tables of information into records.

be-pdfing uses [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`), which is loaded only once a file is actually selected.

## Registration

be-pdfing is registered with [be-hive](https://github.com/bahrus/be-hive) by pointing at the generated EMC JSON config:

```html
<be-hive>
    <script type=emc src="be-pdfing/emc.json"></script>
</be-hive>
<script type=module>
    import 'be-hive/be-hive.js';
</script>
```

Your import map needs an entry for `pdfjs-dist/` alongside be-pdfing's other dependencies (`assign-gingerly`, `be-hive`, `fifteenth`, `mount-observer`, `roundabout-lib`). be-pdfing points pdf.js at its worker via `import.meta.resolve('pdfjs-dist/build/pdf.worker.min.mjs')`. Set `workerSrc` to override that.

## Example 1: lines

```html
<input type=file accept=".pdf" be-pdfing onload="
    if(event.enh !== 'bePdfing') return;
    const [{file, numPages, lines}] = event.results;
    console.log(lines);
">
```

The input emits **one** `load` event once all the selected file(s) have been read (as [be-literate](https://github.com/bahrus/be-literate) does). `event.results` has one entry per file, `{file, numPages, lines, records}`, and the same array is set on the enhancement instance's `results` property. As with be-literate, check that `event.enh` is `'bePdfing'` in case another enhancement also dispatches `load`.

Each line looks like this:

```JSON
{
    "page": 1,
    "y": 413.9,
    "text": "00001\tENGL1\tEnglish 9\tA\t0.50\t0.50\tB\t00011\tENGL3\tEnglish 11\tA\t0.50\t0.50\tB",
    "cells": [{"text": "00001", "x": 15.5, "width": 22.8}, "..."]
}
```

- Lines are in reading order: page by page, top to bottom (regardless of the order the PDF draws its text in).
- A line is split into **cells** wherever there's a wide horizontal gap between pieces of text. That's typically a table column boundary. `text` joins the cells with a tab (`\t`).
- Positions are in PDF points. `x` is measured from the left of the page and `y` from the bottom.
- Rotated text (diagonal watermarks, vertical labels) is skipped.

Two tuning properties control the layout analysis:

| Property | Default | Meaning |
|----------|---------|---------|
| `cellGap` | `1` | A gap wider than this many multiples of the font height starts a new cell. |
| `lineTolerance` | `0.5` | Text whose baselines differ by no more than this fraction of the font height is on the same line. |

The input also emits a `progress` event after each page (`event.file`, `event.page`, `event.numPages`), and an `error` event (`event.file`, `event.error`) for a file that can't be read as a PDF.

## Example 2: custom logic turns lines into records

Lines are the raw material. To turn them into the records you actually want, write ordinary JavaScript, with the help of a few functions that do the layout-aware work.

### In a `load` listener (including an inline `onload`)

Set `records` on each entry of `event.results`. Whatever ends up there is what `writeTo` writes (Example 4) and what the `results` property holds. The helpers are on `event.helpers`, because inline handlers can't `import`:

```html
<input type=file accept=".pdf" be-pdfing onload="
    if(event.enh !== 'bePdfing') return;
    const {tables, valueAfter, num} = event.helpers;
    for(const result of event.results){
        result.records = {
            student: valueAfter(result.lines, 'Student:'),
            courses: tables(result.lines, {
                header: /Grade (?<gradeLevel>\d+)\tGr\tCr/,
                until: /^GPA/,
                columns: ['course', 'grade', 'credits'],
            }).flatMap(({header, rows}) => rows.map(row => ({
                gradeLevel: num(header.gradeLevel), ...row, credits: num(row.credits),
            }))),
        };
    }
">
```

Applied to [demo/home-school-transcript-example.pdf](demo/home-school-transcript-example.pdf):

```JSON
{
    "student": "Albert Smith",
    "courses": [
        {"gradeLevel": 9, "course": "Honors Eng 9: World Lit", "grade": "A", "credits": 1},
        "...",
        {"gradeLevel": 10, "course": "Advanced Writing", "grade": "A", "credits": 1},
        "..."
    ]
}
```

For asynchronous logic (a lookup, say), pass a promise to `event.waitUntil(promise)`, synchronously, during the event. `writeTo` and the `results` property wait for it.

Inline event handlers are subject to your Content Security Policy. `addEventListener('load', ...)` from a script works exactly the same way.

### As a `handler` property

When attaching programmatically (see below), set a `handler` function. It's called **once per file**, before the `load` event, and its return value (or the value of the Promise it returns) becomes that file's `records`:

```JS
myFileInput.enh.set.bePdfing.handler = ({file, numPages, lines, records, helpers}) => {
    const {tables, valueAfter, num} = helpers;
    return { student: valueAfter(lines, 'Student:'), /* ... */ };
};
```

`records` is the output of `rules` (Example 3), if any. If the handler returns `undefined`, the records are left as they were. If it throws, the input emits an `error` event for that file. Assigning a new handler re-runs it on the lines already extracted.

### The helpers

They're all plain functions over `lines`, also importable on their own: `import {tables} from 'be-pdfing/helpers.js'`.

| Helper | What it does |
|--------|--------------|
| `tables(lines, {header, until?, columns?})` | Finds tables by their header row and returns `[{header, columns, rows, lines, page, y, x0, x1}]`. See below. |
| `valueAfter(lines, label, {below?})` | The value that goes with a label, for form-like blocks. See below. |
| `columnsOf(lines, {gutter?})` | Splits multi-column pages into one array of lines per column (`[left, right]`), so each column can be read top to bottom. |
| `between(lines, start, end?)`, `after(lines, start)` | The lines after the first line matching `start`, up to (not including) the next one matching `end`. |
| `matches(lines, pattern)` | Every match of a regex across the lines: `[{line, match, x0, x1}]`. |
| `applyRules(lines, rules)` | The rules engine of Example 3. |
| `num(text)` | Lenient number parsing (`'1,234.50'` → `1234.5`, `''` → `undefined`). |

Wherever a helper takes a pattern, it's a string (matched literally) or a RegExp, tested against a line's `text`, whose cells are separated by `\t`.

**`tables`** is the workhorse for tables of information:

- `header` is a RegExp, or an array of the header cells' texts (strings or RegExps). Its named groups end up in each table's `header`.
- **Each cell is assigned to the column it sits under** (the header cell it overlaps most, or the nearest one). An empty cell doesn't shift the others into the wrong column.
- **The header can match several times on a line**, once per table. Side-by-side tables are split halfway across the gap between their headers, and come back one whole table at a time, top to bottom, then left to right.
- `rows` are objects keyed by column name: the header cells' text, or the names in `columns`, in order. `lines[i]` is the line `rows[i]` came from, restricted to the table's cells, which is handy for lines that aren't data rows (sub-headings).
- A table ends before the first line (within its range) matching `until`, at the next header that overlaps it, at a page break, or at an unusually large vertical gap. Without `until`, a table often runs on into whatever is below it (a GPA row, a summary), so `until` is usually worth specifying.

**`valueAfter`** finds the first cell that starts with `label`. If that cell has more text after the label (`"MO/YR: 01/2018"`), that's the value. Otherwise it's the next cell on the line or, with `{below: true}`, the cell under the label on the next line (for label-over-value layouts).

Here's a handler for [demo/sample-transcript.pdf](demo/sample-transcript.pdf), whose two side-by-side tables each contain several terms, with a `MO/YR` sub-heading per term:

```JS
handler: ({lines, helpers: {tables, num}}) => {
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
                term = {moYr: heading[1], gradeLevel: heading[2]};
            }else if(term !== undefined && /^\d{5}$/.test(row.stateCode)){
                courses.push({...term, ...row, credEarn: num(row.credEarn), credAttp: num(row.credAttp)});
            }
        }
    }
    return {courses};
}
```

### Using the browser's built-in AI in a handler (experimental)

> [!WARNING]
> **This is a rough, experimental option, not the recommended path.** It has one real attraction: the transcript is never uploaded to an AI service, because the model runs inside the browser on the user's own device. But in our testing (late 2026), the technology isn't ready for this job:
>
> - **It's slow and hard on the hardware.** On a capable Windows laptop, extracting one two-page transcript took about a minute, with the fans at full speed. The model has to *write* every course as JSON (around 2,000 tokens), and small on-device models write slowly.
> - **Few users can run it.** It needs desktop Chrome on a well-equipped machine and a one-time download of several GB. It doesn't run on phones, so it's no help for cheap smartphones. Other browsers don't support it, or only behind flags.
> - **Setup is fiddly.** Even on supported hardware it may report "unavailable" until a browser setting is turned on (see [Trying it](#trying-the-built-in-ai) below).
> - **The output isn't guaranteed.** Results vary from run to run, and the model can drop or invent rows.
>
> The layout helpers above produce the same records in milliseconds, give the same result every time, and work on any device. Use them. Revisit this option as on-device models get faster and smaller, and as more browsers and devices support them.

Instead of layout logic, a handler can hand the text to the browser's built-in language model ([Chrome's Prompt API](https://developer.chrome.com/docs/ai/prompt-api), Gemini Nano), with a JSON Schema the response must match. pdf.js still does the reading. The model only sees text, and nothing leaves the device:

```JS
myFileInput.enh.set.bePdfing.handler = async ({lines, helpers: {promptForRecords, columnsOf}}) =>
    await promptForRecords(columnsOf(lines), {
        instructions: 'You extract data from high school transcripts. ...',   // the system prompt
        schema: {                                                              // the responseConstraint
            type: 'object',
            properties: {
                student: {type: 'string'},
                courses: {type: 'array', items: {type: 'object', properties: {
                    gradeLevel: {type: 'integer'}, course: {type: 'string'},
                    grade: {type: 'string'}, credits: {type: 'number'},
                }}},
            },
        },
    });
```

The AI helpers (in `be-pdfing/ai.js`, and also on `helpers`):

| Helper | What it does |
|--------|--------------|
| `promptForRecords(input, {schema, instructions?, signal?, allowDownload?})` | Creates a session, prompts it with `input` (text, lines, or columns of lines), parses the JSON response, and destroys the session. |
| `linesToText(lines)` | Lines as prompt text: one row per line, cells separated by `" \| "`. Given columns (from `columnsOf`), each column is labeled and given separately, so side-by-side tables aren't interleaved. |
| `aiAvailability()` | `'available'`, `'downloadable'`, `'downloading'` or `'unavailable'`. |
| `createSession({onDownloadProgress?, ...})` | Creates a session, downloading the model first if needed. Call it from a click handler to download the model. |

Things to know:

- **The model download is several GB, and needs a user gesture.** `promptForRecords` deliberately won't start it, since picking a file would otherwise be enough to trigger it. It throws an `AIUnavailableError`, which the input reports as an `error` event. Offer a button that calls `createSession()` (see the [AI demo](demo/ai.html)), or pass `allowDownload: true`.
- If the model is `'unavailable'` (an unsupported browser or device), `promptForRecords` throws an `AIUnavailableError` too. So does a response that isn't valid JSON.
- The model's output varies from run to run, and a small on-device model can miss or invent rows. [demo/ai.html](demo/ai.html) shows its records next to the layout-helper handler's, and scores them against each other.
- Expect a prompt like this one, which writes out a whole document as JSON, to take tens of seconds or more. A prompt that needs only a short answer is much faster. If you use the model at all, a good compromise is small questions (for example, "which of these columns is the grade?"), with `tables` still finding the rows.

#### Trying the built-in AI

What we found getting [demo/ai.html](demo/ai.html) to work:

1. **Use desktop Chrome**, Stable or Canary. The Prompt API isn't available on Android or iOS. Edge has its own version (using Phi-4-mini), but at the time of writing only behind a flag in edge://flags, and Edge 157 didn't expose `LanguageModel` at all.
2. **Check the hardware.** Chrome's [requirements](https://developer.chrome.com/docs/ai/get-started#hardware) include about 22 GB of free disk space, plus either a GPU with more than 4 GB of video memory or 16 GB of RAM and 4 or more CPU cores. Windows 10/11, macOS 13+ and Linux are supported.
3. **Turn on on-device AI in Chrome's settings.** This was the cause of our "unavailable". Chrome reported the model as `'unavailable'` until the setting was on, even though the hardware qualified. In Canary it's under **Settings → AI innovations**. In other versions it may be under **System**, so the quickest way to find it is to search settings for "on-device".
4. **If it's still unavailable, find out why.** Open chrome://on-device-internals, go to the **Broker State** tab, and look at **Manifest Criteria**. It lists each check (the user setting, disk space, the performance class, an enterprise policy) and whether it passes. The demo's status line also shows what `LanguageModel.availability()` returns.
5. **Leave the AI flags in chrome://flags at Default** unless you need one. Some force the model onto the CPU (for example, "Decisions API: Enabled with Gemma", whose description says so), which makes it much slower and hotter.
6. **Download the model by clicking "Enable built-in AI"** on the demo page. Chrome needs a click (a user gesture) to start the download. The model is several GB, and on a fast connection it took about a minute. It's downloaded once per browser profile and shared by every site, not once per site. Chrome may remove it if disk space runs low.
7. **Pick a sample PDF** (`demo/home-school-transcript-example.pdf` or `demo/sample-transcript.pdf`) and wait. The page shows the elapsed time, the model's records next to the layout helpers' records with differences highlighted, and a score line ("N of 31 exact, ... missing, ... extra").

## Example 3: rules turn lines into records, without JavaScript

For simpler documents, regular-expression rules in the attribute do the job with no script at all:

```html
<input type=file accept=".pdf" be-pdfing='{
    "rules": [
        {"pattern": "Student:\\t(?<student>[^\\t]+)", "sets": "document"},
        {"pattern": "Grade (?<gradeLevel>\\d+)\\tGr\\tCr", "sets": true},
        {"pattern": "(?<course>[^\\t]+)\\t(?<grade>[A-F][+-]?|P)\\t(?<credits>\\d+(?:\\.\\d+)?)", "emits": "courses"}
    ]
}'>
```

Applied to [demo/home-school-transcript-example.pdf](demo/home-school-transcript-example.pdf), each result then also has `records`:

```JSON
{
    "courses": [
        {"student": "Albert Smith", "gradeLevel": "9", "course": "Honors Eng 9: World Lit", "grade": "A", "credits": "1"},
        {"student": "Albert Smith", "gradeLevel": "10", "course": "Advanced Writing", "grade": "A", "credits": "1"},
        "..."
    ]
}
```

That PDF puts two tables side by side (Grade 9 | Grade 10), so every line holds a row of each. Even so, each course gets the grade level from the heading **above it in its own column**.

How rules work:

- Each rule's `pattern` is a regular expression, matched against every line's `text`. A rule can match several times on one line. The `g` flag is always applied. Add others with `"flags": "i"` and so on.
- **Named groups** become the record's fields, trimmed. (A pattern without named groups yields `{"match": "..."}`.)
- `"emits": "courses"` adds one record per match to `records.courses`.
- `"sets": true` turns the match's named groups into context. Records emitted below it inherit that context, but **only those that overlap it horizontally**, so a heading over the left column doesn't leak into the right column. `"sets": "document"` applies to every record that follows, wherever it is on the page.
- Rules **claim** the text they match, in the order they're listed. A later rule can't match text an earlier one already matched. So a rule with neither `emits` nor `sets` simply hides text (page headers, footers) from the rules after it.
- Records come out in line order. With side-by-side tables, the left and right rows are interleaved.
- Context lasts until a later match sets the same field. A record therefore also inherits context from headings above it in its column that belong to an *earlier* table (in [demo/sample-transcript.pdf](demo/sample-transcript.pdf), the "Cumulative" totals row inherits the `MO/YR` of the course table above it).

Those last two are where a handler (Example 2) is the better tool: `tables` returns one table at a time, and context in a handler is just a variable, which ends whenever your code says so.

Tips for writing patterns:

- Use `\t` to match a cell boundary and `[^\t]+` to match "one cell". This is much more robust than guessing at spaces.
- In an attribute, the rules are JSON, so every regex backslash is doubled: `\\d`, `\\t`. Note that `"\b"` in JSON is a *backspace* character. Write `"\\b"` for a word boundary.
- Setting rules programmatically avoids the doubling: ``{pattern: String.raw`(?<code>\d{5})\t`}``.
- Changing `rules` re-applies them to the lines already extracted, without re-reading the file. The [demo](demo/index.html) uses this for live editing.

## Example 4: where to store the results

As with be-literate, use `writeTo` with a [`fifteenth`](https://github.com/bahrus/fifteenth) Uniform Storage Path:

```html
<input type=file accept=".pdf" be-pdfing='{
    "rules": [...],
    "writeTo": "indexedDB://pdfs/records/{file.name}"
}'>
```

Each file's **records** are written when there are any (from rules, the handler or a `load` listener), and its **lines** otherwise. `{file.name}` (as well as `{file.size}`, `{file.type}` and `{file.lastModified}`) is substituted per file. fifteenth broadcasts `window.postMessage([usl])` once each write completes, and the enhancement's `writtenTo` property lists the USLs written. `writeTo` also accepts `localStorage://`, `sessionStorage://`, `globalThis://` and the other fifteenth targets.

## Programmatic attachment (no attribute)

The attribute syntax above shines for server-rendered HTML and progressive enhancement, where the markup alone says what the enhancement does.

Most web development today, though, renders on the client, with a framework (Lit, React, Vue, Svelte, etc.) that already has a JavaScript reference to each `<input type=file>` it creates. There, attaching be-pdfing programmatically is the better fit:

1. **A less clunky API.** The `rules` in Example 3 are regular expressions inside JSON inside an HTML attribute, so every backslash is doubled and `\b` silently turns into a backspace. Programmatically, `rules` is a plain array, and ``String.raw`...` `` lets you write each pattern exactly as you'd write a regex.

   And a `handler` (Example 2) is a function, so it can only be set programmatically.
2. **Less stringifying and parsing.** With the attribute, your code serializes the rules to a JSON string, and be-pdfing parses them back apart. Programmatically, the array passes straight through, and reassigning `rules` re-applies them to the already-extracted lines.
3. **Less overhead monitoring attributes.** The attribute approach relies on be-hive / mount-observer watching the DOM for `input[type=file]` elements that carry (or gain) the `be-pdfing` attribute, and for changes to its value. `def.js` doesn't load mount-observer at all. It just registers the config, and be-pdfing is attached exactly when, and to exactly the elements, your code says.

Either way, it's the **same enhancement**, with the same defaults, the same `load` / `progress` / `error` events, and the same `writeTo` behavior. The two approaches can be mixed in one app: attributes for server-rendered islands, programmatic attachment inside client-rendered components.

### Registration

```JS
import { defBePdfing } from 'be-pdfing/def.js';
const emc = await defBePdfing(document.body); // or a shadow root's host, for a scoped registry
```

### Attribute → property mapping

Each key of the attribute's JSON value is a property of the same name:

| Attribute key | Property | Notes |
|---------------|----------|-------|
| (no value) | (none) | Attaching is enough to get `lines`. |
| `rules` | `rules` | Array of `{pattern, flags?, emits?, sets?}`. Reassigning it re-applies the rules without re-reading the file. |
| (none) | `handler` | A function, `({file, numPages, lines, records, helpers}) => records`, called once per file. See Example 2. Reassigning it re-runs it without re-reading the file. |
| `writeTo` | `writeTo` | A USL string, with `{file.*}` placeholders. |
| `cellGap`, `lineTolerance` | same | Layout tuning; see Example 1. |
| `workerSrc` | `workerSrc` | URL of the pdf.js worker module. |

The results are on the instance too: `results` (`{file, numPages, lines, records}` per file) and `writtenTo` (the USLs written).

### Declarative -- via `enh.set`

```JS
// equivalent to Example 3, plus writeTo
myFileInput.enh.set.bePdfing.rules = [
    {pattern: String.raw`Grade (?<gradeLevel>\d+)\tGr\tCr`, sets: true},
    {pattern: String.raw`(?<course>[^\t]+)\t(?<grade>[A-F][+-]?|P)\t(?<credits>\d+(?:\.\d+)?)`, emits: 'courses'},
];
myFileInput.enh.bePdfing.writeTo = 'indexedDB://pdfs/records/{file.name}';
```

Only the first property needs to go through `.set`, since that access triggers attachment. This works before or after `defBePdfing` has been called.

### Imperative -- via `enh.get()`

```JS
Object.assign(myFileInput.enh.get(emc), {
    rules: [...],
    writeTo: 'indexedDB://pdfs/records/{file.name}',
});
```

See the [tests](tests/) (`Programmatic*.html`) for runnable examples.

## Using the pieces without the enhancement

The layout analysis, the rules engine and the helpers are plain modules with no DOM dependencies (they work in Node, with pdf.js's legacy build):

```JS
import { extractLines } from 'be-pdfing/extractLines.js';
import { tables, valueAfter, applyRules } from 'be-pdfing/helpers.js';
const loadingTask = pdfjs.getDocument({data});
const lines = await extractLines(await loadingTask.promise, {cellGap: 1});
await loadingTask.destroy();
const courses = tables(lines, {header: /Grade (?<gradeLevel>\d+)\tGr\tCr/, until: /^GPA/});
const records = applyRules(lines, rules);
```

## Viewing Demos Locally

1. Install git
2. Fork/clone this repo
3. Install node.js
4. Open command window to folder where you cloned this repo
5. > git submodule update --init --recursive
6. > npm install
7. > npm run build
8. > npm run serve
9. Open http://localhost:8000/demo/ in a modern browser (Chrome/Edge 146+ -- JSON module imports with type assertion are required)
   The experimental built-in AI version is at http://localhost:8000/demo/ai.html (see [Trying the built-in AI](#trying-the-built-in-ai) for setup).

`npm run serve` first copies pdf.js's two modules into `vendor/` as `.js` files, because the dev server (spa-ssi) treats `.mjs` requests as server-side includes rather than serving them as JavaScript. `imports.html` maps the pdf.js specifiers there.

## Running Tests

```
> npm run test
```

The built-in-AI tests (`AIHandler.spec.mjs`) use a fake `LanguageModel`, so they're deterministic, fast, and need no download or special hardware.

`AIHandlerReal.spec.mjs` runs the handler against the **real** model, scored against the layout-helper handler. It's skipped unless enabled, and it's slow (allow several minutes):

```
# bash
BE_PDFING_REAL_AI=1 npx playwright test AIHandlerReal
# PowerShell
$env:BE_PDFING_REAL_AI='1'; npx playwright test AIHandlerReal
```

- It opens a visible browser with a persistent profile under `.ai-profile/<channel>/` (git-ignored). The first run downloads the model (several GB) into that profile. Later runs reuse it.
- `BE_PDFING_AI_CHANNEL=chrome` (or `chrome-canary`, `msedge`) uses an installed browser instead of Playwright's bundled Chromium. `BE_PDFING_AI_PROFILE` and `BE_PDFING_AI_ARGS` set the profile folder and extra browser arguments. See the file's header comment.
- The [setup steps above](#trying-the-built-in-ai) still apply. If the test reports `unavailable`, open that browser profile manually, turn on on-device AI in its settings, and check chrome://on-device-internals.
- It passes if the model finds at least 80% of the courses and adds no more than 20% extra. Each run logs its scores.


