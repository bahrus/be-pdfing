# be-pdfing

Enhances the input element with type=file so that files of type pdf can be opened, read, and parsed.

```html
<input type=file accept=".pdf" be-pdfing='
    "parse": {
        "regExp": "/(?<Course>\b[A-Z]{3,4}\\s+\\d{3}[L]?)(?<Description>.*?)(?<Grade>\\s[A-F][+-]?\\s)/g"
    },
    "writeToBase": "indexedDB://transcripts/"
'>
```

By default, creates a list based on the file name of the file selected.