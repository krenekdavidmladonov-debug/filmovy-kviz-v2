# V1 library migration framework

## Purpose and scope

This tool prepares a one-time, auditable migration of V1 library quizzes into the private V2 Firestore model. It never reads production Firebase, never deploys, does not migrate registrations or contact data, and only writes to a local Firestore Emulator after fail-closed environment checks.

The phases are deliberately explicit:

1. **READ** a local, versioned library snapshot.
2. **NORMALIZE** V1 quiz documents and slides into a stable internal model.
3. **VALIDATE** ids, slide structure, video ranges, and non-empty input.
4. **TRANSFORM** quizzes into private `quizzes/rounds/questions` documents.
5. **VALIDATE OUTPUT** counts, order, answers, and a canonical copy of every source slide.
6. **WRITE** only in `emulator` mode and only to a local host with a `demo-*` project id.
7. **REPORT** aggregate and per-quiz counts without question text, answers, email addresses, or phone numbers.

## Protected local data

The whole `.local-data/` tree is ignored by Git. Real exports, converted snapshots, and any reports derived from them must remain there. Never move a real fixture into `tools/migration-v1/test`; that directory is for synthetic data only.

Use these locations:

```text
.local-data/
├── v1-managed-export/     # complete original managed export, unchanged
└── v1-export/
    └── library.json       # supported, versioned local extraction
```

If the available input is an official managed Firestore export, copy **the complete export directory** into `.local-data/v1-managed-export/`, preserving all filenames and subdirectories. Do not rename or extract only a metadata file.

Managed Firestore exports are not JSON. Google documents their payload as LevelDB log files with protobuf `*.export_metadata` files. The framework detects these files and stops rather than guessing at a parser. Firebase Emulator exports are a different bundle with `firebase-export-metadata.json`. A verified local conversion/import step will be selected after the real export layout is inspected; no custom binary parser is included.

References:

- [Google Cloud Firestore managed export format](https://cloud.google.com/firestore/docs/manage-data/export-import#export_format_and_metadata_files)
- [Firebase Local Emulator import and export](https://firebase.google.com/docs/emulator-suite/install_and_configure#export_and_import_emulator_data)

## Supported input

The current READ adapter accepts `.local-data/v1-export/library.json`:

```json
{
  "schemaVersion": 1,
  "collection": "library",
  "documents": [
    {
      "id": "quiz-document-id",
      "data": {
        "title": "Quiz title",
        "slides": []
      }
    }
  ]
}
```

For each quiz, the slide array may currently be named `slides`, `quiz`, `items`, or `questions`. This is an extraction contract, not a claim that managed export files use this shape. Once an actual local V1 export is available, run an offline structure inspection and adjust only the READ adapter if its evidence requires it.

## V1 to V2 mapping

- One V1 `library` document becomes `quizzes/{quizId}` with `draft` status.
- A V1 round-header slide starts `quizzes/{quizId}/rounds/{roundId}`.
- Slides before the first round header receive one clearly marked implicit round.
- Every non-round slide becomes a private question document in source order.
- V1 `correct` or `correctAnswer` becomes private `correctAnswer` on the question. It is never copied to a public/projector collection.
- Options, moderator notes, images, audio, video URLs, time ranges, and audio triggers are preserved.
- Recognized text, image, and audio questions use existing V2 types. Video, informational, and unknown V1 slide types use the minimal private `legacy` type until a product feature defines a native representation.
- Every source slide remains canonically preserved in private `legacy.raw`. Unmapped quiz metadata remains in private `legacy.metadata`. Unknown field names and slide types are also listed in the report.

External media is classified and its domain/URL validity is reported. The tool does not download media or write to Storage.

## Validation and failure policy

Before and after transformation, the tool counts quizzes, slides, rounds, questions, correct answers, images, audio items, and video items. It also compares every source slide, quiz metadata, ordering position, and private correct answer against the result. Any mismatch throws a validation error and prevents WRITE. There is no best-effort continuation.

The initial emulator writer uses one atomic Firestore commit and therefore refuses more than 500 documents per run. This avoids silently leaving a partly written quiz set. A later batching design must preserve equivalent all-or-nothing behavior before this limit can be raised.

## Commands

All commands default to `.local-data/v1-export/library.json`:

```powershell
pnpm migration:v1:inspect
pnpm migration:v1:validate
pnpm migration:v1:dry-run
pnpm migration:v1:emulator
```

`inspect`, `validate`, and `dry-run` never write. Calling the CLI without a mode also defaults to dry-run. An alternate input must still remain under `.local-data/`:

```powershell
pnpm migration:v1:dry-run -- --input .local-data/v1-export/library.json
```

For emulator WRITE, start the local Firestore Emulator separately and set both guards in the same shell:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:GCLOUD_PROJECT = 'demo-filmovy-kviz-v2'
pnpm migration:v1:emulator
```

WRITE is refused if the host is missing, non-local, lacks an explicit port, or the project id does not begin with `demo-`. There is no production override.

## Not migrated in this phase

- `events`, registrations, teams, emails, and phone numbers
- V1 `app/activeQuiz`, `app/activeScores`, or `app/liveState`
- media bytes or Firebase Storage objects
- public/projector documents
- production Firebase configuration or credentials

After a real export is placed in `.local-data/v1-managed-export/`, the next step is an offline inventory of its metadata and files, followed by a verified local extraction of only `library` into the documented `library.json` contract. Then run inspect, validate, dry-run, and finally emulator WRITE in that order.
