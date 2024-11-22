# be-pdfing

Enhances the input element with type=file so that files of type pdf can be opened, read, and parsed.

```html
<input type=file data-student-id=12345 accept=".pdf" be-pdfing='
    "parse": {
        "regExp": "/(?<Course>\b[A-Z]{3,4}\\s+\\d{3}[L]?)(?<Description>.*?)(?<Grade>\\s[A-F][+-]?\\s)/g"
    },
    "writeTo": "indexedDB://myDB/transcriptTable[$0:dataset:StudentId/"
'>
```