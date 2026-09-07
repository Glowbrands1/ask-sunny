# Form source fixtures

The real documents the business issued, kept here so the ingestion tests run
against what an administrator actually uploads rather than against something
written to make a parser pass.

| file | what it is | why it is here |
| --- | --- | --- |
| `coaching-form.pdf` | The Coaching Form as a flat PDF | **Zero AcroForm fields.** The regression case for the non-fillable path — the one that was reported as "the upload succeeded and the form did not change". |
| `coaching-form.docx` | The same form as Word | The `.docx` path, and the check that two formats of one document produce the same native form. |
| `prescreen-form.doc` | Prescreen / Phone Interview, Word 97-2003 | The legacy binary format, kept so its refusal is tested against a real `.doc` rather than a hand-made header. |

They contain no personal data: every field is an unfilled Word placeholder.
