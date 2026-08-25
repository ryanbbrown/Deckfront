# Pre-merge gameplay and delivery fixes

Pre-implementation SHA: `a91f7b8af7bb678167741a5a7ae8fbfb7392c77d`

## Goal

Make the card-art branch safe to merge by reducing shipped media, correcting static delivery and saved-game boundaries, and closing focused accessibility gaps.

## Implementation

1. Ignore `.html/` and remove all `.html` paths from the Git tree while keeping the 46 selected card illustrations.
2. Resize each illustration to 800px wide without cropping, keep only smaller JPEG output, and verify dimensions and byte totals.
3. Serve JPEG files with `image/jpeg`, require revalidation for stable card-art URLs, and keep hashed Vite assets immutable.
4. Bump saved records, API views, and exports to schema 14. Reject schema-13 records without migration.
5. Default omitted `startingDraftEnabled` input to `false` at both HTTP and service boundaries.
6. Restore arena grouping, add keyboard card inspection and a visible inspector close button, and announce AI playback once per playback state.
7. Correct stale Deckfront health, schema, generated-artifact, and card-art plan prose.

## Verification

- Add direct API omission and old-schema rejection tests.
- Add browser coverage for JPEG response MIME, caching, decoding, keyboard inspection, close control, arena semantics, and AI playback status.
- Run unit tests, E2E manifest validation, typecheck, lint, build, and Playwright.
