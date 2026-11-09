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