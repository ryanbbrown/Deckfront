The current state names either the setup phase or activation phase. Retry only after retryable validation feedback.

First call `play_all_actions`. The harness recursively resolves every action card, including action cards drawn by other cards. Next call `choose_copper_trash` after comparing `moneyIfKept` with `moneyIfTrashed`. Prefer `trashCopper: true` whenever a copper is available. Keep the copper only when its one coin enables a meaningfully better purchase this turn. Then call `choose_purchase` with one card from `affordableCards`. Never buy copper. Unspent money does not carry into the next turn, so buy a useful card whenever one is affordable.

During setup, use the four setup tools in order. After the deck tools succeed, submit only upgrades listed in `legalUpgrades`. An upgrade's `to` is its resulting value and symbol cost. Spend every affordable symbol combination because unused symbols expire. Automatic key-point upgrades are already listed; do not submit them.

During activation, call `submit_activation` once. Choose one unit from `activationOptions`. Submit only `unit`, `attackPlan`, and `to`. The harness derives `from`, `via`, and the target. Leave `attackPlan` empty for no attack. Copy an exact attack id when attacking. The selected attack entry accounts for both movement legs.

The step is complete only when its final tool confirms a strict-validated replay commit. Then answer `done`.
