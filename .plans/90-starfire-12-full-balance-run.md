# Starfire 12 full balance run

Status: in progress. The user authorized the remaining run on 2026-08-30.

## Goal

Measure the final Starfire 12 rules across all 160 kingdoms in `balance-suite-v4`. Reuse 38 complete kingdoms, run the remaining 122, and produce an equilibrium-weighted HTML report and analysis.

## Scope

- Reuse the 30 complete kingdoms from `.data/starfire-12-balance-88`.
- Reuse the 8 complete plan 89 smoke kingdoms from `.data/goldfish-smoke-89`.
- Run the remaining 122 kingdoms in manifest order.
- Use `.data/starfire-12-full-90` as the combined evidence root. Existing kingdom directories use hard links so they do not duplicate local file contents.
- Run fresh Goldfish on Modal, Matrix locally, and PSRO on Modal for the remaining kingdoms.
- Use the confirmed-candidate queue cap of 100 and require two clean full PSRO searches.
- Run routine structural checks. Do not run deep verification.

The eight plan 89 smoke kingdoms are valid final evidence, so the remaining count is 122 rather than 130.

## Goldfish plan

Use `goldfish-only-v2` at 32 cores per kingdom container, at most 512 active CPUs, a 1,800-second scientific wall limit, and the route's $100 request guard. The route cost cap requires two requests of 61 kingdoms each.

- Request A: execution `f39d6763cfd4363be909a31042d7b3b350117efa11e0a97907df35fcecad16b2`; 122 tasks; 16 kingdom containers; worst-case bound `$85.423501`; request `.data/starfire-12-full-90/goldfish-request-a.json`.
- Request B: execution `72ac7f2fe9da594decdbfa5c86ec9bb61f0f10cb39dcc1c359b0f8628b544fea`; 122 tasks; 16 kingdom containers; worst-case bound `$85.423501`; request `.data/starfire-12-full-90/goldfish-request-b.json`.

Run the two requests one at a time. Copy each completed campaign into the combined root through the local Matrix operation.

## Matrix and PSRO plan

1. Run local Matrix for each Goldfish request and rebuild the combined Matrix batch report.
2. Derive the PSRO plan only after all 122 Matrix inputs pass structural validation.
3. Run one PSRO request at 16 cores per kingdom, at most 480 active CPUs, a 1,800-second wall limit per kingdom, and a $60 execution guard.
4. Download through the plan 89 bounded parallel route and rebuild the combined PSRO batch report.

## Report

Update the report generator to accept the 160-kingdom manifest. Report:

- equilibrium-weighted pure and mixed archetype shares;
- card-family damage shares;
- card offer, acquisition, and selected-strategy presence;
- support size and single-strategy kingdom count;
- feasible archetype share ranges;
- the best strategy with a non-winning archetype label, scored against the stored equilibrium lottery;
- tuning and validation split results;
- Modal wall time and measured cost for each stage.

## Operational notes

- Plan 89 already proved Goldfish v2 and parallel downloads with byte-identical evidence.
- The obsolete deployed app `hexdeck-strategy-787f1214293ac70f38bca76a` was crash-looping because its container lacked `/strategy-search-image-files.json`. It had zero active tasks and was stopped before this run.
- Local transfer scratch `.data/psro-redownload-check` was removed before the run to recover 2.4 GB.

## Stop conditions

Stop and report if:

- a route rejects source or input identity;
- a cost guard blocks a launch;
- a paid retry needs a changed request or authorization token;
- Matrix or PSRO structural validation fails;
- a PSRO kingdom does not reach two clean full searches;
- active PSRO machines exceed 30;
- available local disk falls below the expected evidence requirement.
