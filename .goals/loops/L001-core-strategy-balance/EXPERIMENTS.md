# Experiments

All run commands used `/Users/ryanbrown/code/Deckfront` as the working directory.

### E001: Soldier assault versus archer skirmish

- Status: complete
- Hypothesis: A pure archer range plan can remain competitive with a pure soldier attack plan through distance control.
- Primary lever: Unit composition and the matching attack or range investment.
- Exact changes: Add `soldier-assault-v1.txt`, `archer-skirmish-v1.txt`, and their five-unit setup files. Do not change game values.
- Frozen controls: Current rules, map, units, deck, equal seven-point opening drafts, five units per player, and the shared ThinHarness runner.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: P1 soldier assault uses `strategies/soldier-assault-v1.txt` and `setups/soldier-assault.json`. P2 archer skirmish uses `strategies/archer-skirmish-v1.txt` and `setups/archer-skirmish.json`.
- Seeds: 2106.
- Run cap: One game initially. The game has 30 completed player turns.
- Run paths: `.games/L001/E001/e001-g01/`.
- Tests: Passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` on 2026-08-11.
- Validation: Passed `bun run validate-run -- --strict --strict-deck --strict-win .games/L001/E001/e001-g01/timeline.json`.
- Strategy representation: Full for both sides. Both used the required pure compositions. P1 bought only attack cards and economy, spent every affordable attack symbol, advanced as a front, and focused targets. P2 bought only range cards and economy, spent every affordable range symbol, maintained spacing before contact, and focused or retreated when attacks became legal. P2 could not upgrade before turn 10 because its earlier one- and two-symbol outputs did not meet the three-symbol first range cost.
- Evidence level: Full. One rejected P1 board submission on turn 9 overspent two attack symbols. The tool rejected it, and the repaired submission spent the legal amount. The retry did not affect the persisted state or conclusion.
- Results: P1 won by elimination after 13 completed turns with five soldiers and 23 total HP remaining. P2 lost its first archer on turn 7 before making any attack. P2 dealt seven total damage across turns 8, 10, and 12 but removed no soldier. P1 removed two archers on turn 9 and the last two on turns 11 and 13. This 5-0 result is strong imbalance evidence under the current guidance.
- Decision: Reject the hypothesis under the current card outputs. Longbow grants two range symbols, but the first archer range upgrade costs three. A single Whetstone grants the two symbols needed for the first soldier attack upgrade. Test the smallest correction before changing unit stats or rules.
- Next step: Run E002 with Longbow granting three archerRange symbols.

### E002: Usable Longbow output

- Status: complete
- Hypothesis: Letting one Longbow fund the first archer range upgrade gives the pure archer plan enough distance control to avoid a severe loss.
- Primary lever: Change Longbow from two to three archerRange symbols.
- Exact changes: In `game/deck.yaml`, change Longbow's `archerRange` grant from 2 to 3. Keep both E001 strategies and setups unchanged.
- Frozen controls: E001 rules, map, unit stats, equal seven-point drafts, strategies, setup positions, shared runner, and all card values except Longbow output.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: P1 soldier assault uses `strategies/soldier-assault-v1.txt` and `setups/soldier-assault.json`. P2 archer skirmish uses `strategies/archer-skirmish-v1.txt` and `setups/archer-skirmish.json`.
- Seeds: 2107.
- Run cap: One game initially. The game has 30 completed player turns.
- Run paths: `.games/L001/E002/e002-g01/`.
- Tests: Passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` on 2026-08-11.
- Validation: Passed `bun run validate-run -- --strict --strict-deck --strict-win .games/L001/E002/e002-g01/timeline.json`.
- Strategy representation: Full for both sides. P2 played Longbow with Ranging and upgraded one archer to range 3 on each of turns 6, 8, and 10. P2 focused four attacks on one soldier on turn 6, removed it on turn 8, and retreated its last archers on turn 10. P1 bought only attack cards, upgraded attack, advanced, and focused targets.
- Evidence level: Full. Three rejected P1 board submissions involved one occupied destination and two excessive movement paths. The tool rejected each submission. Each repaired action passed strict validation. These retries did not benefit P2 or weaken the archer strategy conclusion.
- Results: P1 won by elimination after 11 completed turns with four soldiers and 20 total HP remaining. P2 removed one soldier on turn 8. P1 removed the first archer on turn 7, two more on turn 9, and the last two on turn 11. This 4-0 result remains strong imbalance evidence.
- Decision: Reject the hypothesis. The output change made Longbow usable and must remain. Range 3 created legal attacks and one focused removal, but one-point archer attacks could not remove soldiers before the melee front arrived. Test a cohesive range-and-attack archer build before changing unit stats.
- Next step: Run E003 with five archers and mixed Ranging, Longbow, and Bodkin priorities.

### E003: Archer range and attack mix

- Status: complete
- Hypothesis: A five-archer plan that adds attack after establishing range can trade units credibly with the soldier assault.
- Primary lever: Archer card and upgrade priorities, with no further game-value change.
- Exact changes: Add `archer-skirmish-v2.txt` and mirrored setup files. Draft Ranging and Bodkin. Prioritize enough Bodkin cards to raise archer attack while retaining Longbow-backed range upgrades.
- Frozen controls: E002 rules, map, unit stats, Longbow output of three, soldier strategy and setup, equal eight-point-or-less drafts, setup positions, and shared runner.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: Game 1 uses P1 soldier assault and P2 mixed archers. Game 2 mirrors the seats with P1 mixed archers and P2 soldier assault. Both use the same strategy text and equivalent setup positions.
- Seeds: 2108 and 2109.
- Run cap: Two games. Each game has 30 completed player turns.
- Run paths: `.games/L001/E003/e003-g01/` and `.games/L001/E003/e003-g02/`.
- Tests: Passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` before both games on 2026-08-11.
- Validation: Both games passed strict deck, board, and win validation.
- Strategy representation: Require five archers, purchases in range, attack, or economy lanes, at least one affordable range upgrade, at least one affordable attack upgrade, focused ranged attacks, and distance-preserving movement.
- Evidence level: Partial for the stated mixed-strategy hypothesis. Both games passed strict validation, but neither archer player made a range upgrade. Game 1 had no rejected submissions. Game 2 had one rejected occupied destination on turn 7, followed by a valid repair.
- Results: Soldiers won both seat orders. In game 1, P1 won 5-0 after 13 turns with 19 HP. In game 2, P2 won 4-0 after 12 turns with 12 HP. The game 2 archer side removed one soldier on turn 7. Archer sides made two paid attack upgrades in each game but no paid range upgrade.
- Decision: The mixed strategy did not satisfy its full representation rule, so this batch cannot isolate the value of combined upgraded range and attack. It does show that first-player advantage does not explain the soldier wins. Bodkin appeared often but grants one symbol, while the first archer attack upgrade costs two. Test a usable Bodkin output before changing unit stats.
- Next step: Run E004 with Bodkin granting two archerAttack symbols.

### E004: Usable Bodkin output

- Status: complete
- Hypothesis: Letting one Bodkin fund the first archer attack upgrade allows the mixed five-archer plan to trade units credibly with the soldier assault.
- Primary lever: Change Bodkin from one to two archerAttack symbols.
- Exact changes: In `game/deck.yaml`, change Bodkin's `archerAttack` grant from 1 to 2. Keep Longbow at three and reuse the E003 strategies and first seat order.
- Frozen controls: E003 rules, map, unit stats, all other card values, strategies, setup positions, shared runner, and the 30-turn cap.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: Game 1 uses P1 soldier assault and P2 mixed archers. Game 2 mirrors the same strategies and equivalent setup positions.
- Seeds: 2110 and 2111.
- Run cap: Two games. Each game has 30 completed player turns.
- Run paths: `.games/L001/E004/e004-g01/` and `.games/L001/E004/e004-g02/`.
- Tests: Passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` before both games on 2026-08-11.
- Validation: Both games passed strict deck, board, and win validation.
- Strategy representation: Require five archers, attack upgrades whenever Bodkin output funds a listed legal upgrade, range purchases when affordable after the Bodkin priority, focused attacks, and distance-preserving movement. A range upgrade is desirable but not required because draw order can delay Longbow. This wording corrects the planned rule, which incorrectly required an upgrade after every Bodkin even when the next upgrade cost exceeded its output. No earlier E004 score used the incorrect wording.
- Evidence level: Full for both games. Game 1 had one rejected stale target after an earlier activation removed it. Game 2 had one rejected submission that left an affordable upgrade unspent. Both repairs passed strict validation and did not distort the comparison.
- Results: Soldiers won both games. Game 1 ended 2-0 after 15 turns with 8 soldier HP, which is acceptable. Game 2 ended 4-0 after 12 turns with 15 soldier HP, which is concerning by unit count. In game 2, two surviving soldiers had only 1 and 2 HP. Archer sides represented Bodkin attack investment and focused attacks in both games.
- Decision: Keep Bodkin at two because it made the first archer attack upgrade usable and produced credible trades. Do not accept the baseline yet because the mirrored 4-0 result is concerning. Soldiers currently exceed archers in both HP and movement, so the melee force can close after ranged contact. Reduce soldier movement before adding more archer damage or HP.
- Next step: Run E005 with soldier base movement reduced from four to three.

### E005: Slower soldier baseline

- Status: complete
- Hypothesis: Reducing soldier movement from four to three gives ranged attacks enough time to offset soldier durability without making the melee plan noncompetitive.
- Primary lever: Soldier base movement.
- Exact changes: In `game/units.json`, change soldier movement from 4 to 3. Keep Longbow at three range symbols and Bodkin at two attack symbols.
- Frozen controls: E004 rules, map, unit HP and attack, archer stats, card values, strategies, setup positions, shared runner, and 30-turn cap.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: Game 1 uses P1 soldier assault and P2 mixed archers. Game 2 mirrors the same strategies and equivalent setup positions.
- Seeds: 2112 and 2113.
- Run cap: Two games. Each game has 30 completed player turns.
- Run paths: `.games/L001/E005/e005-g01/` and `.games/L001/E005/e005-g02/`.
- Tests: The first baseline found seven stale assertions that encoded soldier movement 4. Updated `tests/helpers/skirmish.ts` and `tests/playtest/run.test.ts` to the current value. Then passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` before both games on 2026-08-11.
- Validation: Both games passed strict deck, board, and win validation.
- Strategy representation: Use the corrected E004 representation rule. Confirm that the soldier side still advances and reaches combat rather than stalling.
- Evidence level: Full for both games. Neither game had a rejected submission.
- Results: Soldiers won both seat orders by close margins. Game 1 ended 2-0 after 15 turns with 9 HP. Game 2 ended 1-0 after 16 turns with the last soldier at 2 HP. Both games featured focused removals by each strategy, and the soldier assault did not stall.
- Decision: Accept soldier movement 3 for the current baseline. Together with Longbow 3 and Bodkin 2, it changes the soldier-versus-archer contrast from repeated severe results to one acceptable and one close result. Retain all three values while testing other builds.
- Next step: Test the pure attack soldier plan against a movement-first soldier plan.

### E006: Soldier attack versus mobility

- Status: complete
- Hypothesis: A movement-first five-soldier plan can use positioning and the movement point to compete with pure attack investment.
- Primary lever: Purchase and upgrade priorities across soldier attack and movement lanes.
- Exact changes: Add `soldier-mobility-v1.txt` and a P2 setup that drafts Forced March and Silver. Do not change game values.
- Frozen controls: E005 rules, map, unit stats, card values, five-soldier composition, equivalent setup positions, shared runner, and 30-turn cap.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: P1 attack soldiers use `strategies/soldier-assault-v1.txt` and `setups/soldier-assault.json`. P2 mobility soldiers will use `strategies/soldier-mobility-v1.txt` and `setups/soldier-mobility-p2.json`.
- Seeds: 2114.
- Run cap: One game initially. The game has 30 completed player turns.
- Run paths: `.games/L001/E006/e006-g01/`.
- Tests: Passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` on 2026-08-11.
- Validation: Passed strict deck, board, and win validation.
- Strategy representation: Require five soldiers, movement purchases, at least one paid movement upgrade, use of improved movement for a flank, focus, retreat, or key-point contest, and later attack investment when affordable.
- Evidence level: Partial for the full movement-and-attack hypothesis. The mobility side made four paid movement upgrades and used improved units in combat, but it did not buy attack cards after reaching two movement-4 soldiers. There were no rejected submissions.
- Results: P1 attack soldiers won 4-0 after 15 turns with 19 HP. P2 removed one soldier on turn 12. P1 began removing P2 units on turn 9 and produced eight or nine attack symbols on its last three turns.
- Decision: Do not compare movement and attack as fully represented mixed plans from this game. The batch does show that Forced March has the same usability problem seen in Longbow and Bodkin: its two symbols cannot fund the first movement upgrade, which costs four. Make one Forced March usable and simplify the transition to attack purchases.
- Next step: Run E007 with Forced March granting four movement symbols and a two-stage mobility strategy.

### E007: Usable Forced March output

- Status: complete
- Hypothesis: A movement opening that receives one legal upgrade per Forced March can establish two mobile soldiers before switching to attack and compete with pure attack.
- Primary lever: Forced March output and explicit purchase stages.
- Exact changes: Change Forced March from two to four soldierMovement symbols. Add `soldier-mobility-v2.txt`, which buys movement cards for two purchase turns and then switches to attack cards.
- Frozen controls: E006 rules, map, unit stats, all other card values, five-soldier composition, setup positions, shared runner, and 30-turn cap.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: P1 attack soldiers use `strategies/soldier-assault-v1.txt` and `setups/soldier-assault.json`. P2 mobility soldiers use `strategies/soldier-mobility-v2.txt` and `setups/soldier-mobility-p2.json`.
- Seeds: 2115.
- Run cap: One game initially. The game has 30 completed player turns.
- Run paths: `.games/L001/E007/e007-g01/`.
- Tests: Passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` on 2026-08-11.
- Validation: Passed strict deck, board, and win validation.
- Strategy representation: Require paid movement upgrades on early Forced March turns, at least one attack-card purchase after the second purchase turn, an attack upgrade when affordable, focused attacks, and tactical use of improved movement.
- Evidence level: Partial for the full hypothesis. P2 made early movement upgrades and bought Sparring on turns 10 and 14. It did not produce enough attack symbols for a paid attack upgrade. One P1 occupied-destination submission was rejected and repaired.
- Results: P1 attack soldiers won 4-0 after 15 turns with 19 HP. P2 used improved movement to attack first on turn 6 and removed one soldier on turn 14. P1 removed units on turns 7, 11, 13, and 15.
- Decision: Keep Forced March at four because each play now funds a legal early upgrade. The two-purchase movement stage left too many movement cards in the deck for the later attack stage to appear. Test a narrower mixed build with one drafted Forced March and immediate attack purchases.
- Next step: Run E008 with one early movement upgrade followed by attack investment.

### E008: One mobile attacker

- Status: complete
- Hypothesis: One early movement upgrade followed by attack investment creates a mobile flanker without sacrificing enough damage to cause a severe loss.
- Primary lever: The number and timing of movement-card purchases.
- Exact changes: Add `soldier-mobile-assault-v1.txt` and mirrored setup assets. Keep the Forced March and Silver draft, but buy only attack cards during the game.
- Frozen controls: E007 rules, map, unit stats, card values, five-soldier composition, setups, shared runner, and 30-turn cap.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: Game 1 uses P1 pure attack and P2 mobile assault. Game 2 mirrors the same strategies and equivalent setup positions.
- Seeds: 2116 and 2117.
- Run cap: Two games. Each game has 30 completed player turns.
- Run paths: `.games/L001/E008/e008-g01/` and `.games/L001/E008/e008-g02/`.
- Tests: Passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` before both games on 2026-08-11.
- Validation: Both games passed strict deck, board, and win validation.
- Strategy representation: Require at least one paid movement upgrade from the drafted Forced March, only attack or economy purchases, at least one paid attack upgrade, focus fire, and tactical use of improved movement. This corrects the planned one-upgrade limit because a drafted card recurs and the runner requires spending every affordable symbol. No E008 score used the impossible limit.
- Evidence level: Full for both games. Game 1 had no rejected submissions. Game 2 had four rejected board submissions for movement, occupancy, and unspent upgrades. Each repair passed strict validation. The retries did not change either strategy's deck or persisted board state.
- Results: Pure attack won both seats. Game 1 ended 2-0 after 19 turns with 8 HP, which is acceptable. Game 2 ended 3-0 after 16 turns with 11 HP, which is concerning. The mixed plan made paid movement and attack upgrades, bought only attack or economy cards, used flanking movement, and removed three and two enemies.
- Decision: The mixed mobile assault is credible but not confirmed as competitive. Pure attack still won every representative matchup. Sparring's card draw creates a strong feedback loop in a concentrated attack deck. In game 2, P2 played six Sparrings and two Whetstones on turn 16 and produced ten attack symbols. Remove Sparring's draw before changing unit durability or attack costs.
- Next step: Run E009 with Sparring granting one attack symbol and no card draw.

### E009: Sparring without card draw

- Status: complete
- Hypothesis: Removing Sparring's card draw prevents pure attack from cycling its whole upgrade deck and lets the mobile assault compete without erasing attack investment.
- Primary lever: Sparring card draw.
- Exact changes: Remove the one-card grant from Sparring. Keep its cost and one soldierAttack symbol unchanged. Reuse the E008 strategies and first seat order.
- Frozen controls: E008 rules, map, unit stats, all other card values, strategies, setups, shared runner, and 30-turn cap.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: P1 pure attack uses `strategies/soldier-assault-v1.txt`. P2 mobile assault uses `strategies/soldier-mobile-assault-v1.txt`.
- Seeds: 2118.
- Run cap: One game initially. The game has 30 completed player turns.
- Run paths: `.games/L001/E009/e009-g01/`.
- Tests: The first baselines found two recursive-draw tests tied to Sparring. Switched those fixtures to Ranging, which retains card draw. Then passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` on 2026-08-11.
- Validation: Passed strict deck, board, and win validation.
- Strategy representation: Use the corrected E008 rule. Confirm that pure attack still produces paid attack upgrades and reaches combat.
- Evidence level: Full. One P1 submission referenced a target removed by an earlier activation. The tool rejected it, and the repair passed strict validation.
- Results: P1 pure attack won 4-0 after 17 turns with 14 HP. P2 represented the mixed plan with movement upgrades from turn 2, attack purchases, paid attack upgrades from turn 10, flanking attacks, and one removal on turn 14. P1 produced at most four paid attack symbols on a turn, so the removed draw stopped the large E008 chain.
- Decision: Reject the hypothesis. Removing Sparring draw stopped large symbol spikes but did not improve this matchup. P1 gained repeated central attack-point upgrades from turn 7, while the range point remains on the left edge. Restore Sparring draw and test key-point placement as the next primary lever.
- Next step: Run E010 with the range point at center and the attack point on the left flank.

### E010: Strategy-aligned key points

- Status: complete
- Hypothesis: Putting range at the central point and attack on the left flank prevents attack plans from receiving the strongest free upgrade through default central advance.
- Primary lever: Swap the attack and range key-point coordinates.
- Exact changes: Restore Sparring's one-card grant because E009 rejected its removal. In `game/map.json`, place range at `(4,8)` and attack at `(1,8)`. Keep movement at `(7,8)`.
- Frozen controls: E008 unit stats, Longbow 3, Bodkin 2, Forced March 4, all other rules and map parts, strategies, setups, shared runner, and 30-turn cap.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: Game 1 uses P1 attack soldiers and P2 mixed archers. Game 2 mirrors the same strategies and equivalent setup positions.
- Seeds: 2120 and 2121.
- Run cap: Two games. Each game has 30 completed player turns.
- Run paths: `.games/L001/E010/e010-g01/` and `.games/L001/E010/e010-g02/`.
- Tests: Updated the map generator, map validator, and focused tests for the new central range point and attack/movement rotation pair. Then passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` before both games on 2026-08-11.
- Validation: Both games passed strict deck, board, and win validation.
- Strategy representation: Use the E005 representation rules. Confirm whether archers contest or benefit from the central range point and whether soldiers must choose a flank to gain free attack.
- Evidence level: Full for both games. Neither game had a rejected submission.
- Results: Each strategy won one seat order. Game 1 ended with a 2-0 soldier win after 15 turns and 8 HP. Game 2 ended with a 3-0 archer win after 15 turns and 10 HP. Neither game granted a free attack or range upgrade. Movement-point upgrades occurred once in each game.
- Decision: Retain the strategy-aligned key points. The batch removes pure attack's universal win record and gives both pure unit compositions representative wins. The 3-0 mirror remains a concern for first-player or draw variance, but it does not show one universal build. Test a mixed composition before final confirmation.
- Next step: Test three soldiers and two archers against the pure attack soldier plan.

### E011: Combined arms versus pure attack

- Status: complete
- Hypothesis: A three-soldier, two-archer formation can use soldiers as a screen and archer focus fire to compete with five attack-focused soldiers.
- Primary lever: Mixed unit composition with both soldierAttack and archerAttack investment.
- Exact changes: Add `combined-arms-v1.txt` and mirrored setups with three soldiers, two archers, and a Sparring plus Bodkin draft. Do not change game values.
- Frozen controls: E010 rules, map, unit stats, card values, equivalent deployment columns, shared runner, and 30-turn cap.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: Game 1 uses P1 combined arms and P2 pure attack. Game 2 mirrors the same strategies and equivalent setup positions.
- Seeds: 2122 and 2123.
- Run cap: Two games. Each game has 30 completed player turns.
- Run paths: `.games/L001/E011/e011-g01/` and `.games/L001/E011/e011-g02/`.
- Tests: Passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` before both games on 2026-08-11.
- Validation: Both games passed strict deck, board, and win validation.
- Strategy representation: Require three soldiers and two archers, purchases for both attack lanes or economy, paid upgrades in both attack lanes when outputs allow, a soldier screen, archer focus fire, and unit preservation through spacing.
- Evidence level: Full for both games. Neither game had a rejected submission. Each combined-arms side bought both attack lanes, made paid upgrades in both lanes, screened its archers, and focused attacks.
- Results: Each strategy won as P1 by the same 3-0 margin. In game 1, combined arms won after 17 turns with 9 HP. In game 2, pure attack won after 15 turns with 11 HP. The combined-arms side removed two soldiers in game 2 before losing its screen and archers.
- Decision: Accept combined arms as a credible mixed composition. It can beat pure attack, while the mirror prevents a claim that it is universally dominant. The symmetric score also reinforces the E010 concern about seat or draw variance.
- Next step: Confirm the mixed mobile-assault strategy on the final key-point map.

### E012: Final-map mobile assault confirmation

- Status: complete
- Hypothesis: One early movement upgrade followed by attack investment remains credible against pure attack on the strategy-aligned key-point map.
- Primary lever: Mixed soldier movement and attack investment on the retained baseline.
- Exact changes: Reuse the E008 mobile-assault strategy and setups. Do not change game values.
- Frozen controls: E011 rules, map, unit stats, card values, five-soldier composition, equivalent deployment columns, shared runner, and 30-turn cap.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: Game 1 uses P1 pure attack and P2 mobile assault. Game 2 mirrors the same strategies and equivalent setup positions.
- Seeds: 2124 and 2125.
- Run cap: Two games. Each game has 30 completed player turns.
- Run paths: `.games/L001/E012/e012-g01/` and `.games/L001/E012/e012-g02/`.
- Tests: Passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` before both games on 2026-08-11.
- Validation: Both games passed strict deck, board, and win validation.
- Strategy representation: Require paid movement upgrades from the drafted Forced March, only attack or economy purchases, at least one paid attack upgrade, focus fire, and tactical use of improved movement.
- Evidence level: Full for both games. Game 1 had no rejected submissions. Game 2 had two rejected P1 board submissions on turn 9 for one movement budget and one invalid action. The tool rejected both, and the accepted repair passed strict validation without changing prior state. Both mobile sides made paid movement and attack upgrades, bought only attack or economy cards, focused attacks, and used improved movement for flanking or withdrawal.
- Results: Each strategy won as P1 by the same 2-0 margin after 17 turns with 12 HP. Each winner lost three units. The batch confirms mobile assault as credible under the current baseline, but it extends the final-map P1 win sequence to six mirrored games across E010, E011, and E012.
- Decision: Accept mobile assault as a credible mixed attack-and-movement strategy. Do not close the loop yet because the repeated P1 results could hide strategy differences. Use the final available game as a symmetric control.
- Next step: Run E013 with identical pure-attack plans in both seats.

### E013: Symmetric seat-order control

- Status: complete
- Hypothesis: Identical pure-attack plans produce no concerning Player 1 advantage under the retained baseline.
- Primary lever: Player order with strategy, composition, draft, and deployment shape held symmetric.
- Exact changes: Use the pure-attack soldier strategy and equivalent five-soldier setups for both players. Do not change game values.
- Frozen controls: E012 rules, map, unit stats, card values, shared runner, and 30-turn cap.
- Model and settings: `openai:gpt-5.6-luna`, low reasoning, 180-second request timeout, five tool retries, 20 model requests, and 20 tool calls per turn.
- Strategy matchups: Both players use `strategies/soldier-assault-v1.txt`. P1 uses `setups/soldier-assault.json`, and P2 uses `setups/soldier-assault-p2.json`.
- Seeds: 2126.
- Run cap: One game. The game has 30 completed player turns. This is the loop's 20th and final game.
- Run paths: `.games/L001/E013/e013-g01/`.
- Tests: Passed `bun run test:all` (105 Vitest tests and 29 harness tests), `bun run typecheck`, and `bun run viewer:typecheck` before the game on 2026-08-11.
- Validation: Passed `bun run validate-run -- --strict --strict-deck --strict-win .games/L001/E013/e013-g01/timeline.json`.
- Strategy representation: Require both sides to buy only attack or economy cards, make paid attack upgrades, advance as connected fronts, and focus attacks.
- Evidence level: Full. Both sides followed the pure-attack plan. All 15 deck submissions and all 15 board submissions passed on the first attempt.
- Results: P1 won 2-0 after 15 turns with 7 HP. Both sides bought only attack or economy cards, made paid attack upgrades, advanced as connected fronts, and focused attacks. The acceptable result does not show a severe seat advantage, but P1 won all seven games on the final map.
- Decision: Retain the current baseline. The control does not identify a universal build or composition. Record Player 1 advantage as the main unresolved risk and stop at the 20-game cap.
- Next step: No further L001 games. Test turn order before using this baseline as a final competitive ruleset.

## Final baseline

- Status: Complete at the 20-game cap on 2026-08-11.
- Evidence: 20 complete games across 13 experiments. Each game passed strict deck, board, and win validation when generated. The seven retained-baseline games in E010 through E013 still pass against the current files.
- Unit values: Soldiers have 6 HP, 1 attack, 3 movement, and 1 range. Archers have 4 HP, 1 attack, 3 movement, and 2 range.
- Card outputs: Longbow grants 3 archer range. Bodkin grants 2 archer attack. Forced March grants 4 soldier movement. Sparring grants 1 soldier attack and draws 1 card.
- Key points: Range is at `(4,8)`, attack is at `(1,8)`, and movement is at `(7,8)`.
- Pure strategies: Pure soldier attack and five-archer range-and-attack plans both won representative final-map games.
- Mixed strategies: Three-soldier and two-archer combined arms won a representative game. Soldier movement plus attack removed three units in both final-map games.
- Unit compositions: Five soldiers, five archers, and three-soldier and two-archer formations produced credible results.
- Dominance: No tested build or composition won in both seat orders on the final map. Pure attack lost to archers, combined arms, and mobile assault when those plans had Player 1.
- Confirmation: E010, E011, and E012 used mirrored order on the retained map. Each matchup split by seat rather than by strategy.

## Remaining uncertainties

- Player 1 won all seven games on the retained map, including the symmetric E013 control. The E013 margin was acceptable at 2-0, but the sequence needs targeted turn-order testing.
- E010 did not produce a free range or attack upgrade. The new key-point locations changed access pressure, but the runs do not isolate each reward's value.
- The five-archer plan often won through attack and spacing before drawing enough range output for paid range upgrades. Range investment needs a focused follow-up if it must stand alone.
- The evidence uses one model and low reasoning. Different play quality could change strategy execution.
- The 13 tuning games from E001 through E009 do not revalidate against the current files. The validator reads current deck, unit, and map values instead of the values saved with each historical run. Their experiment entries retain the successful generation-time checks, but current replay validation cannot independently confirm those checks.
- The 20-game cap prevents another seat-order control in this loop.

## Reproduction commands

### E001

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E001/e001-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/archer-skirmish.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/archer-skirmish-v1.txt --title 'L001 E001 G01 soldier assault vs archer skirmish' --seed 2106 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

### E002

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E002/e002-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/archer-skirmish.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/archer-skirmish-v1.txt --title 'L001 E002 G01 soldier assault vs archer skirmish with Longbow 3' --seed 2107 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

### E003

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E003/e003-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/archer-skirmish-v2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/archer-skirmish-v2.txt --title 'L001 E003 G01 soldier assault vs mixed archer skirmish' --seed 2108 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
uv run scripts/run_game_thinharness.py --run .games/L001/E003/e003-g02 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/archer-skirmish-v2-p1.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/archer-skirmish-v2.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --title 'L001 E003 G02 mixed archer skirmish vs soldier assault mirror' --seed 2109 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

### E004

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E004/e004-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/archer-skirmish-v2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/archer-skirmish-v2.txt --title 'L001 E004 G01 soldier assault vs mixed archers with Bodkin 2' --seed 2110 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
uv run scripts/run_game_thinharness.py --run .games/L001/E004/e004-g02 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/archer-skirmish-v2-p1.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/archer-skirmish-v2.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --title 'L001 E004 G02 mixed archers with Bodkin 2 vs soldier assault mirror' --seed 2111 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

### E005

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E005/e005-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/archer-skirmish-v2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/archer-skirmish-v2.txt --title 'L001 E005 G01 slower soldier assault vs mixed archers' --seed 2112 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
uv run scripts/run_game_thinharness.py --run .games/L001/E005/e005-g02 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/archer-skirmish-v2-p1.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/archer-skirmish-v2.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --title 'L001 E005 G02 mixed archers vs slower soldier assault mirror' --seed 2113 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

### E006

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E006/e006-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-mobility-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-mobility-v1.txt --title 'L001 E006 G01 attack soldiers vs mobility soldiers' --seed 2114 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

### E007

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E007/e007-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-mobility-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-mobility-v2.txt --title 'L001 E007 G01 attack soldiers vs usable mobility soldiers' --seed 2115 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

### E008

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E008/e008-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-mobility-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-mobile-assault-v1.txt --title 'L001 E008 G01 pure attack vs one mobile attacker' --seed 2116 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
uv run scripts/run_game_thinharness.py --run .games/L001/E008/e008-g02 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-mobile-p1.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-mobile-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --title 'L001 E008 G02 one mobile attacker vs pure attack mirror' --seed 2117 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

### E009

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E009/e009-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-mobility-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-mobile-assault-v1.txt --title 'L001 E009 G01 pure attack without Sparring draw vs mobile assault' --seed 2118 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

### E010

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E010/e010-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/archer-skirmish-v2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/archer-skirmish-v2.txt --title 'L001 E010 G01 attack soldiers vs mixed archers on strategy-aligned points' --seed 2120 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
uv run scripts/run_game_thinharness.py --run .games/L001/E010/e010-g02 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/archer-skirmish-v2-p1.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/archer-skirmish-v2.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --title 'L001 E010 G02 mixed archers vs attack soldiers map mirror' --seed 2121 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

### E011

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E011/e011-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/combined-arms-p1.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/combined-arms-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --title 'L001 E011 G01 combined arms vs pure attack soldiers' --seed 2122 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
uv run scripts/run_game_thinharness.py --run .games/L001/E011/e011-g02 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/combined-arms-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/combined-arms-v1.txt --title 'L001 E011 G02 pure attack soldiers vs combined arms mirror' --seed 2123 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

### E012

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E012/e012-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-mobility-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-mobile-assault-v1.txt --title 'L001 E012 G01 pure attack soldiers vs mobile assault final map' --seed 2124 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
uv run scripts/run_game_thinharness.py --run .games/L001/E012/e012-g02 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-mobile-p1.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-mobile-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --title 'L001 E012 G02 mobile assault vs pure attack final map mirror' --seed 2125 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

### E013

```sh
uv run scripts/run_game_thinharness.py --run .games/L001/E013/e013-g01 --reset --p1-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault.json --p2-setup .goals/loops/L001-core-strategy-balance/setups/soldier-assault-p2.json --p1-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --p2-strategy-file .goals/loops/L001-core-strategy-balance/strategies/soldier-assault-v1.txt --title 'L001 E013 G01 symmetric pure attack seat-order control' --seed 2126 --max-turns 30 --model openai:gpt-5.6-luna --effort low --timeout-seconds 180 --tool-retries 5 --max-model-requests 20 --max-tool-calls 20
```

## Starting evidence

The pre-loop run `.games/skirmish-luna-strategy-03/` ended with a legal P1 elimination win after 15 completed turns. Strict deck, board, and win validation passed. All 15 deck and board submissions were accepted on the first attempt.

This run shows that the shared runner works and that deck choices can affect combat. It did not use the controlled L001 strategy method, so it is not balance evidence and receives no L001 score.

## Entry format

### E001: Title

- Status: planned | running | complete | stopped
- Hypothesis:
- Primary lever:
- Exact changes:
- Frozen controls:
- Model and settings:
- Strategy matchups:
- Seeds:
- Run cap:
- Run paths:
- Tests:
- Validation:
- Strategy representation:
- Evidence level:
- Results:
- Decision:
- Next step:
