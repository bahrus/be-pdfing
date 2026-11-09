# Initialization

## Bruce's Ask

The general thing I would like to do is [create an enhancement](../types/NewEnhancementInstructions.md), similar to [be-literate](../../be-literate/), but which does much more -- it reads a PDF and pulls information out of it.

That last sentence has lots of things to decide -- which libraries, if any, are needed to help with that?  How powerful can we make that?  Is something like what is suggested in the README.md the most effort way to do it.  Is this something that could use AI capabilities, either built into the browser (I think Chromium browsers may provide something along those lines), or calling an AI service?

Typical use case -- reading transcripts from a college.

Please provide your thoughts below before implementing anything.

## Claude's Thoughts

No code yet, per your request. This is how I'd approach it, followed by questions for you.

### 1. Treat it as a pipeline, not a single regex

"Reads a PDF and pulls information out of it" is really four separate steps, and each one needs its own decision:

| Stage | What it does | Candidate tech |
|-------|--------------|----------------|
| **Read** | Get the file's bytes | `file.arrayBuffer()` (no `FileReader` needed), as in be-literate |
| **Extract** | Bytes → text *with position info* | pdf.js (`pdfjs-dist`); OCR fallback for scanned pages |
| **Structure** | Text → records (`{term, course, title, credits, grade}`) | Declarative rules (regex), or AI |
| **Store/emit** | Records → event + `writeTo` | `fifteenth`'s `set`, same as be-literate |

Read and Store/emit are basically solved by be-literate. All the real decisions are in Extract and Structure.

### 2. Libraries

- **pdf.js (`pdfjs-dist`, Mozilla)** is the clear choice for extraction. It's what Firefox uses, it ships as an ES module, and it has no build-step requirement. The key API is `page.getTextContent()`. It returns text *items*, each with an `(x, y)` transform, not lines. That position data matters a lot for transcripts (see section 3).
  - Cost: roughly 1MB+ including the worker. We should load it with a dynamic `import()` only when a PDF is actually selected. It also needs `GlobalWorkerOptions.workerSrc` set, which means an extra import-map entry in `imports.html`.
- **`unpdf`** is a thin, more modern wrapper around pdf.js. It's convenient, but it's one more dependency. I'd use pdf.js directly.
- **`pdf-lib`** is for creating and editing PDFs, not extracting text. Not relevant here, except maybe for generating test fixtures.
- **Tesseract.js (OCR)** is only needed for *scanned* transcripts, i.e. pages with no text layer. It's heavy (WASM plus language data, several MB), so it should be an opt-in tier that's lazy-loaded when a page comes back from pdf.js with no text. I'd **defer it past v1**. Many transcripts today are e-transcripts (Parchment, National Student Clearinghouse, etc.) that have a real text layer.

### 3. Is the README's regex approach the right one?

I'm reading "most effort way" as "most *effective* way". Short answer: it's a good **escape hatch**, but as written it will be fragile on real transcripts:

1. **pdf.js doesn't give you lines.** Text items come in content-stream order, and that can jump around. Many transcripts are **two-column**, with Fall on the left and Spring on the right. Naively joining items interleaves the columns, and a course regex then matches across both. The fix is to rebuild lines by clustering items on `y` (with a tolerance), sorting by `x` within each line, and detecting column gutters. Matching per *line* is then much more robust than matching over the whole document.
2. **Records need context.** A course row doesn't contain its term ("Fall 2023"). That comes from a heading line above it. So instead of one flat regex, we need a small *stateful* rule set:
   ```json
   "rules": [
       {"match": "^(?<term>(Fall|Spring|Summer|Winter)\\s+\\d{4})", "sets": ["term"]},
       {"match": "(?<course>[A-Z]{2,4}[\\s-]?\\d{3,4}[A-Z]?)\\s+(?<title>.+?)\\s+(?<credits>\\d+\\.\\d{1,2})\\s+(?<grade>[A-F][+-]?|P|NP|W|I|IP|CR|NC|AU)\\b", "emits": "courses"}
   ]
   ```
   Each emitted record inherits the most recently `sets` values. That covers terms, the "Transfer Credit" sections, and so on. (The [`nested-regex-groups`](../types/nested-regex-groups/) package already in the ecosystem may cover part of this. I'll check before writing anything new.)
3. **Grade and course-code variety.** The README regex only allows `A–F[+-]`, but real transcripts also use `P/NP/W/I/IP/CR/NC/AU`, repeat markers, and course codes like `MATH-1010` or `ENGL 1301H`. Every institution is a little different, which is the core weakness of the regex approach.
4. **There's a bug in the README example.** In JSON, `"\b"` is the *backspace* character, not a regex word boundary. It needs to be `"\\b"`. Also, `"/.../g"` as a string means we'd have to parse out the flags. Separate `"pattern"` and `"flags"` keys, or just always matching all occurrences, would be simpler.
5. **Repeated page headers and watermarks.** Student name/ID repeated on every page, and "ISSUED TO STUDENT" security backgrounds, show up as text items. Rules for ignoring them are useful, or we can drop text with unusual rotation or size.

So I'd keep regex rules in the design, but **on top of a layout-aware line extraction**, and not as the main answer for "any college's transcript".

### 4. Should it use AI?

Yes, as an **optional, pluggable** structuring step. Transcripts are exactly the messy, institution-specific layout problem where an LLM beats hand-written rules. Two options:

**a) Built-in browser AI (Chromium's Prompt API / Gemini Nano, `LanguageModel`)**
- Pros: runs **on-device**, so **no student data leaves the machine**. That's a big deal for transcripts, which are FERPA-protected PII. It's free, needs no API key, and needs no server. It supports **structured output** via `responseConstraint` (a JSON Schema), which fits "give me `courses[]`" well. You're already Chromium-only (Chrome 146+), so the browser-support limitation matters less for this ecosystem than it usually would.
- Cons: availability depends on hardware and disk (a multi-GB model download, with GPU/RAM requirements). The first use has to trigger a download. The context window is small, so we'd process **page by page**. A small model is less accurate than a frontier model, and quite capable of inventing a row. Edge has its own Prompt API implementation (Phi-4-mini), but Firefox and Safari have nothing. **I'd need to verify where the Prompt API stands for regular web pages (vs. extensions/origin trial) as of today before relying on it.**
- Related built-in APIs (Summarizer, Language Detector, Translator) aren't very useful for extraction.

**b) A cloud AI service (Claude, etc.)**
- Pros: much better accuracy. Some APIs (Claude included) accept the **PDF itself**, which handles scanned pages and complex layouts without pdf.js or OCR, and they support schema-constrained JSON output.
- Cons: **an API key can't live in client-side HTML.** It needs a backend proxy, which is outside what an HTML enhancement should own. It also sends student records to a third party, which institutional users may not be allowed to do. And it costs money per document.
- My suggestion is that be-pdfing **doesn't talk to any AI vendor directly**. It should POST the extracted text (or the PDF) plus the desired JSON Schema to a **user-supplied endpoint**, and that endpoint is where vendor choice, keys and privacy policy live.

**Guarding against hallucination:** transcripts contain their own checksums, like term and cumulative credit totals and GPA. The enhancement can recompute those from the extracted rows and flag mismatches (`validation: {creditsMatch: false}`). That's a cheap, strong check, and it works for any of the structuring strategies.

### 5. Recommended shape

Make the stages and tiers explicit and load each one only when it's used:

```html
<input type=file accept=".pdf" be-pdfing='{
    "extract": "layout",
    "structure": {
        "via": "rules",
        "rules": [ ... ]
    },
    "schema": "transcript",
    "writeTo": "indexedDB://transcripts/{file.name}"
}'>
```

- `extract`: `"text"` (raw), `"layout"` (lines/columns, the default), and later `"ocr"`.
- `structure.via`: `"none"` (just emit lines), `"rules"` (deterministic), `"builtin-ai"` (Prompt API, falling back to rules or none if unavailable), `"endpoint"` (POST to a URL).
- `schema`: a JSON Schema object, or a built-in preset name like `"transcript"`. It's used as the AI `responseConstraint` and also to validate rule output.
- Events: `load` (same as be-literate, with `enh` stamped), plus `extracted` (lines) and `structured` (records), so consumers can hook in at any stage, and `progress` per page.
- Results are also on the instance (`lines`, `records`, `validation`), and the enhancement supports programmatic attachment via `def.js` from the start, per the addendum.

**Relationship to be-literate:** I'd make be-pdfing **standalone** rather than stacking it on be-literate. be-literate's `FileManager` is coupled to its own props, and PDFs always want `ArrayBuffer`, so `readVerb` is pointless here. We'd copy over be-literate's conventions (`writeTo` via fifteenth, `{file.*}` substitution, the `enh` stamp, `initialized` gating) rather than its code.

### 6. Suggested phasing

1. **v1:** scaffold per `NewEnhancementInstructions.md`, then pdf.js layout extraction producing `lines`, then `rules` structuring, then `writeTo`. Playwright tests against fixture PDFs.
2. **v2:** `builtin-ai` with schema plus totals validation, with feature detection and a graceful fallback.
3. **v3:** `endpoint` strategy and the OCR tier.

### Questions for you

1. **Sample transcripts:** do you have a few real (redacted) or realistic transcript PDFs, ideally from different institutions and including a two-column one? They'd drive both the line-reconstruction logic and the test fixtures. If not, I can generate synthetic ones with pdf-lib for tests.
2. **v1 scope:** are you OK with v1 being deterministic only (layout plus rules), with built-in AI as v2? Or do you want the Prompt API in from the start, since it's the more interesting part?
3. **Output granularity:** one record per *file* (`{student, terms: [{term, courses: []}], totals}`), or one store entry per *course row*? This affects the `writeTo` design.
4. **Generic vs. transcript-specific:** should `"transcript"` be a built-in preset in be-pdfing, or should be-pdfing stay generic and keep transcript knowledge in demos/docs?

## Bruce's Follow up question

Would Chrome's built in AI Gemini model be able to parse the file bytes, obviating the need for the firefox library?

## Claude's Response to Follow up

**Short answer: no. pdf.js (or something like it) is still needed, even with the built-in model.**

### What the Prompt API accepts

According to Chrome's current Prompt API docs, a `LanguageModel` session accepts three input types, declared up front in `expectedInputs`:

- **text**
- **image** (`Blob`, `<img>`, `<canvas>`, `ImageBitmap`, video frame, etc.)
- **audio**

There's no PDF or "document" input type. Output is text only, optionally constrained by a JSON Schema. Multimodal (image/audio) input is also newer and less settled than text input. MDN dates it to Chrome 148, and there's a `prompt-api-for-gemini-nano-multimodal-input` flag for development, so I'd re-check its status before depending on it.

### Why you can't just hand it the bytes

1. **There's no slot for them.** A PDF `Blob` passed as an "image" isn't a format the browser can decode as an image. I'd expect a `NotSupportedError` or a decode failure.
2. **Even as text, raw PDF bytes are close to useless.** The page content in a PDF is usually *compressed* (FlateDecode streams), and the text often uses font-specific glyph encodings, so the actual characters aren't present in readable form. Decoding all that is exactly what pdf.js does. Asking a small on-device model to do it from raw bytes would fail, and the bytes would blow through its context window anyway.
3. **Chrome's own PDF engine (PDFium) isn't available to page JavaScript.** The browser can *display* PDFs, but it doesn't expose text extraction or rendering to scripts.

### Where AI can still replace part of the pipeline

The model can replace the **Structure** step (and, with images, some of the layout heuristics), but not the **Extract** step. There are two routes:

- **Text route (what I recommended before):** pdf.js extracts the text and lines, then Gemini Nano turns the lines into JSON records using `responseConstraint`. This is the most reliable on-device option.
- **Image route:** pdf.js renders each page to a `<canvas>`, then the canvas is passed to Gemini Nano as an image with a prompt like "extract the courses as JSON." That sidesteps the two-column and reading-order problems, and it would also handle **scanned** transcripts without Tesseract. But it **still uses pdf.js**, just for rendering instead of text extraction. A small model also reading dense, small-font tables from an image is likely to be *less* accurate than the text route. It would be a good option to try, maybe as a fallback when a page has no text layer.

### The one way to skip pdf.js entirely

Cloud models such as Claude accept the PDF file directly and do the decoding and rendering on the server side. That would remove pdf.js, but it brings back the trade-offs from section 4b: the transcript leaves the device, and you need a server-side proxy to hold the API key. That fits the `"endpoint"` strategy, not the built-in one.

### Effect on the plan

There's no change to v1: pdf.js remains the foundation. For v2 I'd add `"structure": {"via": "builtin-ai", "input": "text" | "image"}`, so we can compare the two routes on real transcripts. `"image"` would also be the natural way to handle scanned pages.

Sources: [Chrome: The Prompt API](https://developer.chrome.com/docs/ai/prompt-api?hl=en), [MDN: Multimodal prompts](https://developer.mozilla.org/en-US/docs/Web/API/Prompt_API/Multimodal), [MDN (de): Multimodal prompts](https://developer.mozilla.org/de/docs/Web/API/Prompt_API/Multimodal)

## Bruce's Response II

Let's go in baby steps as you recommend.  I added two [sample](../demo/home-school-transcript-example.pdf) [transcripts](../demo/sample-transcript.pdf) but really I don't want things too tied to transcripts.  I think maybe "tables of information" is the focus.

Let's please start with 

> 1. **v1:** scaffold per `NewEnhancementInstructions.md`, then pdf.js layout extraction producing `lines`, then `rules` structuring, then `writeTo`. Playwright tests against fixture PDFs.

## Claude's v1 Implementation Notes

v1 is done. All 6 Playwright tests pass on Chromium, using your two sample PDFs as fixtures. I kept everything generic ("tables of information"). The transcript-specific knowledge lives only in the rules in the tests, the demo, and the README examples, and there's no transcript preset.

### What your samples showed

Both samples are **two-column** layouts, the hard case from my earlier notes:

- In `home-school-transcript-example.pdf`, two tables sit side by side (Grade 9 | Grade 10, Grade 11 | Grade 12).
- In `sample-transcript.pdf`, the left column runs five terms of courses, while the right column holds one term of courses and then a summary table.

In both, pdf.js reports a left row and a right row with the same `y`, so each visual line holds one row from *each* column. `sample-transcript.pdf` also draws its footer first, so the items have to be sorted.

### Design

**1. Lines and cells ([extractLines.js](../extractLines.js)).** Text items are grouped into lines by baseline, top to bottom. Within a line, they're split into **cells** wherever the horizontal gap is wider than about one font height. `line.text` joins the cells with `\t`. For example:

```
00001	ENGL1	English 9	A	0.50	0.50	B	00011	ENGL3	English 11	A	0.50	0.50	B
```

So rule authors can use `\t` and `[^\t]+` ("one cell") instead of guessing at spaces. That one decision makes the regexes far more robust. Each cell also keeps its `x` and `width`. Rotated text is skipped, and so is "fake bold" (the same text drawn twice).

**2. Rules ([applyRules.js](../applyRules.js)).** Rather than one regex, rules are an ordered list of `{pattern, flags?, emits?, sets?}`:

- `emits: "courses"` adds a record per match, built from the named groups.
- `sets: true` makes the named groups **context** for the records below it. The key decision is that context is **inherited only by records that overlap the heading horizontally**. That's what solves the two-column problem *without* detecting columns at all: "Grade 10" sits above the right half, so only right-half rows inherit it, even though they share lines with Grade 9 rows. I first considered splitting each page into columns by finding gutters, but tables have internal gutters too, so the overlap approach was both simpler and more reliable on your samples.
- `sets: "document"` is for page-wide facts such as `Student: Albert Smith`. It applies to every later record.
- Rules **claim** the text they match, in the order they're listed, so earlier rules take priority. A rule with neither `emits` nor `sets` just hides text, such as headers and footers.

Results: `home-school` → 31 courses, each with the right `gradeLevel`. `sample-transcript` → 30 courses, each with the right `moYr`/`gradeLevel`, including the right column's 06/2020 term. The `Cumulative` totals row comes out as a separate collection.

**3. The enhancement ([be-pdfing.js](../be-pdfing.js), [emc.mjs](../emc.mjs)).** It follows `NewEnhancementInstructions.md` and the addendum: plain class, roundabout, `initialized` gating, `def.js`, and all three attachment patterns tested. It has three actions:

- `hydrate`: listens for `change`.
- `structure`: runs when `extracted` **or `rules`** change. So reassigning `rules` re-applies them without re-reading the PDF, which the demo uses for live rule editing.
- `storeResults`: `writeTo` through fifteenth. It writes `records` when there are rules, `lines` otherwise, with `{file.name}` and other placeholders substituted.

Events are `load` (`event.results`, `event.enh`), `progress` (one per page), and `error` (a file that isn't a valid PDF). pdf.js is loaded by dynamic `import()` only once a file is selected.

**4. Demo ([demo/index.html](../demo/index.html)).** Pick a PDF and you see the extracted lines on the right and the records as tables on the left, with a rules textarea and presets for both samples.

### Things to know

1. **spa-ssi serves `.mjs` as `text/html`**, because it treats `.mjs` requests as server-side includes. So Chrome refused to load pdf.js, which ships only `.mjs`. To work around it, `npm run serve` (via a `preserve` hook) copies pdf.js's two modules into a gitignored `vendor/` folder as `.js` files, and `imports.html` maps the `pdfjs-dist/build/...` specifiers there. The source code keeps the real specifiers, so consumers aren't affected. **A cleaner fix would be in spa-ssi itself:** serve an `.mjs` that has no `render` export as `text/javascript`. Want me to look at that?
2. **The `types` submodule has a new `be-pdfing/types.d.ts`.** It needs committing there, as with be-literate.
3. **The README's `"\b"` bug is fixed**, and the README now documents all of the above, including the programmatic-attachment section the addendum asks for.
4. **No emoji shorthand yet.** Let me know if you'd like one (📑?).
5. **Nothing is committed.**

### Known limitations (candidates for later steps)

- **Records come out in line order**, so side-by-side tables interleave: G9 row, G10 row, G9 row, and so on. Each record has the correct context, but you may want them grouped by column.
- **Context never "ends."** A record inherits any earlier heading above it in its column, even one that belongs to a previous table. In `sample-transcript.pdf`, the `Cumulative` totals row inherits `moYr: 06/2020` from the course table above it. A possible fix would be a way for a rule to *clear* context, e.g. `"clears": true` on a heading such as `Report Period and Cumulative Summary`.
- **Values are strings.** Number conversion (`"0.50"` → `0.5`) would be easy to add, e.g. `"types": {"credits": "number"}`.
- **Multi-line cells** aren't joined. `sample-transcript.pdf`'s stacked column headers ("State / CRS / Code") come out as three lines. That doesn't matter for data rows.
- **Scanned PDFs** produce no lines. That's the later OCR or AI-image tier.

