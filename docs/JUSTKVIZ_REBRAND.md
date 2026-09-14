# JustKvíz: rebranding existing V2

Public spelling is **JustKvíz**. This is the same application and data on the existing `filmovy-kviz-v2-staging` project, site and media bucket. The URL remains unchanged.

## Presentation

- `packages/quiz-domain/src/brand.ts` owns public name, JK monogram, description and optional author text. `apps/web/src/config/product.ts` retains the existing frontend configuration boundary and icon path.
- `Brand` is the shared typographic wordmark. There is no final supplied graphic logo. `justkviz-jk-temporary.svg` is a temporary JK favicon, not approved final artwork. CSS preserves the exact case inside existing uppercase projector captions.
- Existing public/admin navigation, login, projector captions, final/interim results and local launcher messages use the new name. No new watermark, page, navigation or footer was added. The optional author is not rendered in the wordmark, icon, page titles or projection.
- Browser titles use fixed route categories only: JustKvíz, Knihovna kvízů, Editor kvízu, Akce and Projekce. Private names, IDs, answer values and registration fragments never enter metadata.
- HTML title/description and application-name use JustKvíz. The baseline has no Open Graph/Twitter tags, apple-touch-icon, PWA manifest or service worker. No install identity, scope, start URL or cache-clearing mechanism was introduced.
- Existing PDF metadata changes to JustKvíz. The only affected deployed backend entry point is `generatePrintArtifact`, with the same HTTP contract and dependencies. Its release must use the deployed source as a baseline and verify that only the renderer and brand constant differ.
- `functions/src/email/templates.ts` changes the existing registration email brand. **NENASAZENO**: registration/team email functions remain excluded from the rollout and `VITE_ENABLE_TEAM_EMAIL=false` remains required for staging.

## Scope and release

Base: deployed complete editor `384b21f03fcf9235197f8ed85731e7d4dfe686ff`, branch `codex/complete-quiz-editor`, PR #28. Before this work, live Hosting release was `1789323294987000`, version `ff915284633d6ab4`. The rebrand Draft PR targets that branch because main does not contain the complete editor. PR #28 and all prior release artifacts remain unchanged.

Required before deployment: review the diff; `pnpm check`; unit and Security Rules suites; existing complete-editor, private-draft and media regressions; and Quality gate CI for the exact new SHA. The workflow additionally accepts the actual PR base. It does not deploy.

Allowed deployment scope: existing staging Hosting and only `generatePrintArtifact`. Read current live release/source immediately before each deployment and stop on an unreviewed change. Preserve Hosting headers and SPA rewrite, media gateway, CORS, Function configuration and runtime identity. Do not deploy Rules, indexes, other Functions or email modules. Record the new SHA, CI URL, exact uploaded file hashes and readback in the separate ignored run evidence, not in historical manifests.

Cloud display-name updates must read, patch only their named field and read back. Firebase rejects Czech diacritics in the project display-name field: verified fallback is `JustKviz - staging`; the existing web app accepts `JustKvíz - web staging`. Record Authentication/OAuth presentation results independently; never change providers, permissions, sender addresses, callback URLs or template variables to rename a brand.

## Deliberately retained names

- Project/site IDs, project number, appId, API config, web.app/firebaseapp.com addresses, authDomain and storage bucket.
- Repository URL/directory, package names and imports, Function names/regions, schema, document IDs, QR targets and existing links/tokens.
- localStorage/IndexedDB keys, projector window/channel identifiers, YouTube diagnostic identifiers and demo project IDs.
- User quiz/event/team/media titles, questions, answers, snapshots and synthetic fixture content, including film-themed titles.
- Historical reports, draft design/audit evidence, immutable release manifests, checksums and V1 references. They describe their original state rather than current branding.

Online QA must create only distinctly named new QA content, record exact document IDs and object generations, verify the pre-existing content fingerprint, and delete only that run's own records and exact uploaded generations. LOCAL / CI / ONLINE results are reported separately.
