# Deployed game record access

Status: investigated and implemented locally; not deployed.

## Finding

The deployed service writes one JSON file per game to `/var/data/games/<id>.json`.

- `src/server/main.ts` reads `HEXDECK_DATA_DIR`.
- `Dockerfile` sets `HEXDECK_DATA_DIR=/var/data/games`.
- `render.yaml` mounts the service's 1 GB `deckfront-data` disk at `/var/data`.
- `src/server/persistence.ts` creates and replaces the JSON file under that directory.

The records persist across deploys and restarts because they are below the Render disk mount. Render documents that only data below a persistent disk's mount path survives deploys and restarts: <https://render.com/docs/disks>. Render also takes a disk snapshot every 24 hours and retains snapshots for at least seven days. A snapshot restore replaces the full disk; it is not a file export.

The application never deletes a game record. A reset rewrites the same record. There is no delete route.

## Existing access

The deployed API has these routes:

- `GET /api/games/<id>` returns the public game view when the caller already knows the UUID.
- `GET /api/games/<id>/export` downloads a wrapper around that public view. It intentionally omits raw fields such as `committedCommands` and `aiStrategy`.
- The deployed `GET /api/stats` route returns aggregate finished-game counts. It returns no IDs or raw records.
- No route lists game IDs or downloads the raw records in bulk.

The public export is not an input for `scripts/extract_human_decks.ts`. That script reads the raw files and uses fields that the public export omits.

## Read-only production check on September 3, 2026

The existing Render CLI login works. Read-only service inspection confirmed:

- service: `deckfront` (`srv-daadl2lg1s2s73csfgag`)
- disk: `deckfront-data` (`dsk-daadl2lg1s2s73csfgh0`)
- disk mount: `/var/data`
- service state: live, one instance
- deployed health check: HTTP 200 from `https://deckfront.onrender.com/api/health`
- deployed statistics: 5 finished Expert AI game series, with 2 human wins and 3 AI wins

The statistics prove that finished records still exist on the disk. They do not give the total file count because the route excludes unfinished games, superseded reset attempts, and records from older schemas.

The current service cannot expose the disk through Render Shell, SSH, or SCP:

- `render ssh srv-daadl2lg1s2s73csfgag` fails with `Permission denied (publickey)` because this Render account has no SSH public key configured.
- Adding an SSH key would not be sufficient. The production image is distroless, and Render states that distroless images do not support SSH or dashboard shell sessions: <https://render.com/docs/ssh>.
- Render request logs contain application and build output, not the game UUIDs or response bodies.
- The browser stores only the current game UUID. The current Chrome data has a deleted `hexdeck.activeGameId` entry for the deployed origin, so it cannot identify the finished target game.

As a result, the existing read-only access cannot list the files. At least 5 finished Expert records exist, but the exact file count and the target game's existence are not confirmed. The target is likely still recoverable: the disk is attached, saves below the mount survive deploys, and the application has no deletion path. This is an inference, not a file-level check.

The deployed setup catalog does contain the requested `balance-tuning-035` card set: cascade, fireball, footwork, jab, pepperingShot, prism, repellingShot, salvageShot, sharpen, and starfire.

No file was copied to `/Users/ryanbrown/code/Deckfront/.data/games/` because no target UUID could be confirmed and checked for a name collision.

## Options

| Option | Effort | Safety | Bulk later | Assessment |
| --- | --- | --- | --- | --- |
| Token-gated read-only export route | Low | High | Yes | Recommended. It gives one read-only download without granting shell access. |
| Render Shell, SSH, or SCP | Medium | Medium | Yes | Blocked by the distroless image and missing Render SSH key. Enabling it requires an image change, a deploy, and broad shell access. |
| Scheduled object-storage sync | Medium to high | High | Yes, automatic | Good when off-site backups or regular analysis become necessary. It adds object-storage credentials, retention rules, retries, and monitoring. A Render cron job cannot directly mount this service's disk, so the service must upload records or an external job must call the export route. |
| Move records to a database | High | Medium during migration; high after | Yes | Useful for queries, accounts, or multiple service instances. It is unnecessary for the current append-and-replace JSON workload and adds a migration that can fail. |

## Recommendation implemented on this branch

The local code adds `GET /api/admin/games/export`.

- The route is absent when `DECKFRONT_GAME_EXPORT_TOKEN` is unset.
- The route requires `Authorization: Bearer <token>` when enabled.
- It returns `application/x-ndjson`, with one complete raw record per line.
- It sets `Cache-Control: no-store`.
- It reads every UUID-named JSON file without applying the current game schema. This preserves access to older records that `GameService.load` can no longer open.
- It does not create, update, or delete a record.

The HTTP test proves that a missing token disables the route, a wrong token returns 401, a correct token returns all records, and an older-schema raw record is included.

## Validation

These checks pass:

- `npx vitest run test/http-distance-duel.test.ts --maxWorkers=1` — 19 tests
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run build:production`
- `git diff --check`

The full `npm test` run passed 610 tests and failed 9 tests outside the changed server boundary. The failures report a stale native Goldfish binary or rule fingerprint, two unknown strategy-search kingdoms, and two missing ignored `.html` evidence files.

## Ryan's actions

Deploying and changing the Render environment are Ryan's call. Nothing in this investigation changed the deployed service.

1. Merge or cherry-pick the implementation commit into `main`.
2. Generate a long random token outside the repository.
3. In the Render dashboard, add `DECKFRONT_GAME_EXPORT_TOKEN` to the `deckfront` service with the token as its secret value.
4. Deploy `main`.
5. Put the same token in a local shell variable without committing it:

```sh
read -rsp 'Deckfront export token: ' DECKFRONT_GAME_EXPORT_TOKEN
export DECKFRONT_GAME_EXPORT_TOKEN
printf '\n'
```

6. Download and count the records:

```sh
umask 077
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${DECKFRONT_GAME_EXPORT_TOKEN}" \
  https://deckfront.onrender.com/api/admin/games/export \
  --output /tmp/deckfront-game-records.ndjson &&
wc -l /tmp/deckfront-game-records.ndjson
```

7. Find finished Expert AI-game candidates on the requested card set that bought the five named cards:

```sh
jq -r '
  . as $game
  | [$game.kingdom.actionPiles[].cardId] as $cards
  | $game.state.players[$game.humanPlayerId].purchases as $purchases
  | select(
      $game.mode == "ai"
      and $game.aiDifficulty == "expert"
      and $game.finishedAt != null
      and ($cards | sort) == ([
        "cascade", "fireball", "footwork", "jab", "pepperingShot",
        "prism", "repellingShot", "salvageShot", "sharpen", "starfire"
      ] | sort)
      and (["sharpen", "silver", "prism", "starfire", "jab"]
        | all(. as $card | $purchases | index($card) != null))
    )
  | $game.id
' /tmp/deckfront-game-records.ndjson
```

Inspect the matching record's purchase events to confirm which candidate has the late Jab. Before copying that record, check that its destination does not exist:

```sh
id='<confirmed-game-id>'
destination="/Users/ryanbrown/code/Deckfront/.data/games/${id}.json"
test ! -e "$destination" || { echo "Refusing to overwrite $destination" >&2; exit 1; }
jq --arg id "$id" 'select(.id == $id)' \
  /tmp/deckfront-game-records.ndjson > "${destination}.tmp"
test -s "${destination}.tmp" || { rm -f "${destination}.tmp"; echo 'Game not found in export' >&2; exit 1; }
mv "${destination}.tmp" "$destination"
```

Then run the existing extractor:

```sh
npx tsx scripts/extract_human_decks.ts \
  /Users/ryanbrown/code/Deckfront/.data/games/
```

Keep the Render token in Render's secret environment and the local shell or a non-repository secret store. Do not put it in `render.yaml`, a command file, a plan, or Git.
