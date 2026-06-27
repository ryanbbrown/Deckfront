# E005 Evaluation

## Validation

All four map-access replay bundles validate:

- `.games/e005-rush-vs-engine-a/timeline.json`: valid, 15 entries.
- `.games/e005-rush-vs-engine-b/timeline.json`: valid, 16 entries.
- `.games/e005-center-vs-flank-a/timeline.json`: valid, 16 entries.
- `.games/e005-center-vs-flank-b/timeline.json`: valid, 16 entries.

## Run Validity

- `rush-vs-engine-a`: full evidence. P1 rush still led strongly, 9 units to 5, and threatened a start-turn win if P2 could not respond.
- `rush-vs-engine-b`: full evidence. P1 rush led 9 units to 7 and 5 centers to 2, but P2's improved access and guardian screen prevented the immediate 3-unit threshold.
- `center-vs-flank-a`: full evidence. Best evidence for the map change: no winner, P2 led units 7-to-6, center control was tied 3-to-3, and P1 held stronger upgraded central units plus saved supply.
- `center-vs-flank-b`: partial-to-full evidence. The run validates and follows locked timing, with the notes flagging fixed starting decks as a setup caveat. It ends unresolved with P1 ahead 9-to-8 units and 4-to-3 centers, while P2's flank remains live.

## Score

Ruleset/map score: **78 / 100**

- Pacing and arc: **21 / 25**. All runs reached 15-16 completed player turns and avoided inert openings. Rush-vs-engine A was nearly decided, but still gave P2 a response window.
- Strategic diversity: **21 / 30**. Center/flank improved: both runs stayed live and one had P2 ahead on units. Rush still outpaced engine in both runs, so slower deck-engine stabilization remains under-proven.
- Board tension: **19 / 20**. This is the strongest evidence so far. The map-access change made center/flank fights more contested and produced closer center splits without removing supply pressure.
- Combat interest: **17 / 25**. Combat decisions remained meaningful around upgraded guardians, attack-bound deck damage, printed healing, and raider/scout trades. However, rush damage bursts still convert too directly into unit-count pressure before healing or engine plans can matter.

## Main Lessons

`sketch-v2-access` is worth deepening. It improves center/flank tension without changing the ruleset: `center-vs-flank-a` ends with P2 ahead on units and tied centers, while `center-vs-flank-b` stays close at 9-to-8 units and 4-to-3 centers.

The map change alone does not solve rush-vs-engine. P1 rush still leads both runs, including a 9-to-5 unit edge in `rush-vs-engine-a`. The problem appears less like pure access now and more like damage-tempo plus supply-to-body conversion outrunning healing/engine payoff.

## Recommended Next Experiment

Iterate near E005. Keep `sketch-v2-access`, then test an economy or rush-tempo variant that gives slower plans more time without making openings inert. Candidate levers:

- Increase recruit cost from 5 to 6.
- Reduce base board income from `2 + centers` to `1 + centers`.
- Keep income but make deck `damage` spend at most 1 extra damage per attacking unit.

The cleanest next test is recruit cost 6, because it directly slows supply-to-body snowball while preserving map pressure and card text.
