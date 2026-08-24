# Goldfish random pilot results

## Run

- Kingdom: `deep-beam-tuning-009`, draft off
- Proposals: 200,000 unique unrestricted random policies
- Goldfish evidence: four shared shuffle seeds, 30-turn limit, stationary passive 50-health dummy
- Runtime: 46.80 seconds on 10 workers; the 2,000-policy benchmark took 1.22 seconds
- Ranking: most kills, then fewest total turns to 50, largest cumulative damage area, most money spent, and stable strategy ID

## Top policies

| Rank | Plan | Goldfish result |
|---:|---|---:|
| 1 | Precision Shot ×1 → Sharpen ×4 → Salvage Shot ×4 → Reclaim ×3 → Precision Shot ×3 → Channel ×5 → Longshot ×∞ | 4/4 kills; 13.50 turns |
| 2 | Precision Shot ×1 → Sharpen ×4 → Salvage Shot ×3 → Reclaim ×3 → Sharpen ×∞ | 4/4 kills; 13.50 turns |
| 3 | Sharpen ×3 → Precision Shot ×3 → Scour ×5 → Silver ×1 → Salvage Shot ×∞ | 4/4 kills; 13.50 turns |
| 4 | Scour ×3 → Gold ×5 → Step ×1 → Strike ×5 → Improvise ×2 → Channel ×∞ | 4/4 kills; 13.75 turns |
| 5 | Step ×1 → Precision Shot ×3 → Strike ×∞ | 4/4 kills; 13.75 turns |

## Competitive result

None of the five policies was competitive against any saved Kingdom 009 lottery. Across the six V4–V6 lotteries, their scores ranged from 1.0% to 22.0%. The best result was policy 4 at 22.0% against V4 seed 35002. Every 95% confidence interval remained below 24%.

The goldfish objective is not useful as a standalone top-five selector. It finds decks that damage a stationary opponent efficiently when nothing attacks or changes range in response. Those same decks lose badly in a real match. A later experiment can test goldfish performance as a low minimum-quality filter, but competitive play must remain the ranking objective.

Ignored detailed evidence: `.experiments/goldfish-k009/pilot.{json,md}`.
