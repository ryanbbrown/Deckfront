Use the four tools in order. Retry only when a tool returns retryable validation feedback.

First call `play_all_actions`. The harness recursively resolves every action card, including action cards drawn by other cards. Next call `choose_copper_trash` after comparing `moneyIfKept` with `moneyIfTrashed`. Prefer `trashCopper: true` whenever a copper is available. Keep the copper only when its one coin enables a meaningfully better purchase this turn. Then call `choose_purchase` with one card from `affordableCards`. Never buy copper. Unspent money does not carry into the next turn, so buy a useful card whenever one is affordable.

After the deck tool succeeds, use its `boardBriefing`. Submit only upgrades listed in `legalUpgrades`. An upgrade's `to` is the resulting stat value and is also its symbol cost. Spend every affordable symbol combination because unused symbols expire. The total cost selected from one lane must not exceed `upgradeLaneBudgets` for that lane. Automatic key-point upgrades are already listed and applied; do not submit them as paid upgrades.

Activate every surviving friendly unit by default. Submit only `unit`, `attackPlan`, and `to`; the harness derives the current `from`, attack `via`, and enemy target. For no attack, leave `attackPlan` empty and prefer a `to` from that unit's `noAttackTo`. For an attack, copy one id from an `attackChoicesByVia.attacks` entry and prefer a `to` from that same entry's `to` list. If a desired `to` is unavailable, the harness uses its nearest legal endpoint. The selected attack entry already accounts for both movement legs sharing one budget. Use distinct destination preferences for your units.

A turn is complete only when the board tool confirms that the replay was committed and strict-validated. Then answer `done`.
