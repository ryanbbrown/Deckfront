# Card balance experiments

## Flurry counts every Action card

Status: rejected and stashed. The active rule still counts only Tactical Actions.

- Stash commit: `41a3da725a8c25dbc2ce8b8ea60ba51b23a01534`
- Restore command: `git stash apply 41a3da725a8c25dbc2ce8b8ea60ba51b23a01534`
- Change: Flurry counted every other Action card played that turn. It still required Close range and had a maximum of 5 damage.
- Scope: card text, game rules, simulator, AI action ordering, telemetry, tests, the card-list plan, and the generated strategy report.
- Verification: 335 tests, typecheck, and lint passed.
- Tuning run: 40 affected kingdoms reran; 40 unaffected kingdoms kept their current results.

Results compared with the 4-damage, 4-coin Arc Bolt baseline:

| Measure | Baseline | Flurry experiment |
| --- | ---: | ---: |
| Pure-Melee Flurry usage when offered | 19.1% | 40.5% |
| Overall Flurry selection | 11.4% | 23.4% |
| Mean Flurry copies per strategy | 0.10 | 0.60 |
| Exact Mage share | 26.4% | 31.1% |
| Exact Melee share | 26.7% | 28.3% |
| Exact Ranged share | 25.7% | 21.0% |
| Kingdoms with 2 or 3 pure families at 40% | 56.3% | 60.0% |

The rule made Flurry useful but moved the exact family shares too far apart. Do not restore it as the default without a new balance decision.
