#![allow(
    clippy::too_many_arguments,
    clippy::collapsible_if,
    clippy::manual_contains
)]

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

const DAMAGE_WEIGHT: i16 = 6;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCard {
    pub id: String,
    pub card_type: String,
    pub mechanic: String,
    pub family: String,
    pub cost: i16,
    #[serde(default)]
    pub money: i16,
    #[serde(default)]
    pub supply: i16,
    pub tactical: bool,
    #[serde(default)]
    pub values: RawValues,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawValues {
    #[serde(default)]
    damage: i16,
    #[serde(default)]
    draw: i16,
    #[serde(default)]
    bonus: i16,
    #[serde(default)]
    money: i16,
    #[serde(default)]
    mana: i16,
    #[serde(default)]
    far_mana: i16,
    #[serde(default)]
    mana_cost: i16,
    #[serde(default)]
    per_mana: i16,
    #[serde(default)]
    per_spell: i16,
    #[serde(default)]
    per_mana_spent: i16,
    #[serde(default)]
    wall_damage: i16,
    #[serde(default)]
    first: i16,
    #[serde(default)]
    later: i16,
    #[serde(default)]
    per_copy: i16,
    #[serde(default)]
    per_action: i16,
    #[serde(default)]
    near: i16,
    #[serde(default)]
    far: i16,
    #[serde(default)]
    moved_draw: i16,
    #[serde(default)]
    cost_bonus: i16,
    #[serde(default)]
    draw_per_trash: i16,
    #[serde(default)]
    per_family: i16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Family {
    Treasure,
    Mana,
    Melee,
    Ranged,
    Engine,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mechanic {
    Money,
    Channel,
    LeyStep,
    Attune,
    Prism,
    Spell,
    Discharge,
    Cascade,
    Overload,
    Feint,
    Melee,
    Drive,
    OpeningStrike,
    Rally,
    BullRush,
    Flurry,
    Aim,
    Ranged,
    RepellingShot,
    Longshot,
    Volley,
    SalvageShot,
    PrecisionShot,
    Step,
    Footwork,
    Stipend,
    Reclaim,
    Regroup,
    Adapt,
    Muster,
    Discipline,
    Cull,
    Sharpen,
    Reforge,
    Scour,
    Improvise,
    Scrap,
}
fn mechanic(value: &str) -> Result<Mechanic, String> {
    use Mechanic::*;
    Ok(match value {
        "money" => Money,
        "channel" => Channel,
        "leyStep" => LeyStep,
        "attune" => Attune,
        "prism" => Prism,
        "spell" => Spell,
        "discharge" => Discharge,
        "cascade" => Cascade,
        "overload" => Overload,
        "feint" => Feint,
        "melee" => Melee,
        "drive" => Drive,
        "openingStrike" => OpeningStrike,
        "rally" => Rally,
        "bullRush" => BullRush,
        "flurry" => Flurry,
        "aim" => Aim,
        "ranged" => Ranged,
        "repellingShot" => RepellingShot,
        "longshot" => Longshot,
        "volley" => Volley,
        "salvageShot" => SalvageShot,
        "precisionShot" => PrecisionShot,
        "step" => Step,
        "footwork" => Footwork,
        "stipend" => Stipend,
        "reclaim" => Reclaim,
        "regroup" => Regroup,
        "adapt" => Adapt,
        "muster" => Muster,
        "discipline" => Discipline,
        "cull" => Cull,
        "sharpen" => Sharpen,
        "reforge" => Reforge,
        "scour" => Scour,
        "improvise" => Improvise,
        "scrap" => Scrap,
        other => return Err(format!("unsupported mechanic {other}")),
    })
}
fn family(value: &str) -> Result<Family, String> {
    Ok(match value {
        "treasure" => Family::Treasure,
        "mana" => Family::Mana,
        "melee" => Family::Melee,
        "ranged" => Family::Ranged,
        "engine" => Family::Engine,
        other => return Err(format!("unsupported family {other}")),
    })
}

#[derive(Clone, Debug)]
struct Card {
    id: String,
    action: bool,
    mechanic: Mechanic,
    family: Family,
    cost: i16,
    money: i16,
    supply: i16,
    tactical: bool,
    v: RawValues,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RawSlot {
    Buy { card_id: String, desired_count: i16 },
    Stop { threshold: i16 },
    Inactive,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawStrategy {
    pub id: String,
    pub canonical_strategy: String,
    pub starting_build: Vec<String>,
    pub buy_plan: Vec<RawSlot>,
}
#[derive(Clone, Debug)]
enum Slot {
    Buy { card: usize, count: i16 },
    Stop(i16),
    Inactive,
}
#[derive(Clone, Debug)]
struct Strategy {
    id: String,
    canonical: String,
    build: Vec<usize>,
    plan: Vec<Slot>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KingdomInput {
    pub health: i16,
    pub aim_bonus: i16,
    pub feint_bonus: i16,
    pub cards: Vec<RawCard>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchInput {
    pub protocol_version: u32,
    pub scorer_version: String,
    pub rule_fingerprint: String,
    pub kingdom: KingdomInput,
    pub strategies: Vec<RawStrategy>,
    pub seeds: Vec<u32>,
    pub movement_profiles: Vec<String>,
    pub turn_limit: i16,
    pub action_cap_per_turn: i16,
    pub threads: usize,
    pub cpu_request: usize,
    pub mode: String,
}

#[derive(Clone)]
struct Kingdom {
    health: i16,
    aim_bonus: i16,
    feint_bonus: i16,
    cards: Vec<Card>,
    copper: usize,
    scrap: usize,
}
impl Kingdom {
    fn compile(raw: KingdomInput) -> Result<Self, String> {
        let mut cards = Vec::with_capacity(raw.cards.len());
        for c in raw.cards {
            cards.push(Card {
                id: c.id,
                action: c.card_type == "action",
                mechanic: mechanic(&c.mechanic)?,
                family: family(&c.family)?,
                cost: c.cost,
                money: c.money,
                supply: c.supply,
                tactical: c.tactical,
                v: c.values,
            });
        }
        let find = |id: &str| {
            cards
                .iter()
                .position(|c| c.id == id)
                .ok_or_else(|| format!("missing card {id}"))
        };
        Ok(Self {
            health: raw.health,
            aim_bonus: raw.aim_bonus,
            feint_bonus: raw.feint_bonus,
            copper: find("copper")?,
            scrap: find("scrap")?,
            cards,
        })
    }
    fn strategy(&self, raw: RawStrategy) -> Result<Strategy, String> {
        let find = |id: &str| {
            self.cards
                .iter()
                .position(|c| c.id == id)
                .ok_or_else(|| format!("missing strategy card {id}"))
        };
        let build = raw
            .starting_build
            .iter()
            .map(|id| find(id))
            .collect::<Result<Vec<_>, _>>()?;
        let plan = raw
            .buy_plan
            .into_iter()
            .map(|s| {
                Ok(match s {
                    RawSlot::Buy {
                        card_id,
                        desired_count,
                    } => Slot::Buy {
                        card: find(&card_id)?,
                        count: desired_count,
                    },
                    RawSlot::Stop { threshold } => Slot::Stop(threshold),
                    RawSlot::Inactive => Slot::Inactive,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Strategy {
            id: raw.id,
            canonical: raw.canonical_strategy,
            build,
            plan,
        })
    }
}

#[derive(Clone)]
struct Player {
    strategy: Strategy,
    draw: Vec<usize>,
    head: usize,
    hand: Vec<usize>,
    discard: Vec<usize>,
    play: Vec<usize>,
    money: i16,
    mana: i16,
    acquired: Vec<i16>,
    attack: Vec<i16>,
    live: i16,
    money_spent: i32,
    unspent: i32,
}
#[derive(Clone)]
struct State<'a> {
    k: &'a Kingdom,
    p: Player,
    pos: [i16; 2],
    health: [i16; 2],
    aimed: bool,
    exposed: bool,
    supply: Vec<i16>,
    turn: i16,
    rng: u32,
    tactical: i16,
    cards_played: Vec<usize>,
    moved: i16,
    mana_spent: i16,
    spells: i16,
    copies: Vec<i16>,
    families: u8,
}
fn attack_mechanic(m: Mechanic) -> bool {
    matches!(
        m,
        Mechanic::Melee
            | Mechanic::Drive
            | Mechanic::Flurry
            | Mechanic::OpeningStrike
            | Mechanic::Rally
            | Mechanic::BullRush
            | Mechanic::Ranged
            | Mechanic::RepellingShot
            | Mechanic::Longshot
            | Mechanic::SalvageShot
            | Mechanic::PrecisionShot
            | Mechanic::Spell
            | Mechanic::Discharge
            | Mechanic::Cascade
            | Mechanic::Overload
            | Mechanic::Discipline
            | Mechanic::Improvise
            | Mechanic::Scrap
            | Mechanic::Volley
    )
}
fn family_bit(f: Family) -> u8 {
    match f {
        Family::Mana => 1,
        Family::Melee => 2,
        Family::Ranged => 4,
        _ => 0,
    }
}
fn lcg(r: &mut u32, max: usize) -> usize {
    *r = r.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    ((u64::from(*r) * max as u64) >> 32) as usize
}
fn shuffle(r: &mut u32, source: &[usize]) -> Vec<usize> {
    let mut out = source.to_vec();
    for i in (1..out.len()).rev() {
        let j = lcg(r, i + 1);
        out.swap(i, j)
    }
    out
}
impl<'a> State<'a> {
    fn new(k: &'a Kingdom, s: Strategy, seed: u32) -> Self {
        let mut acquired = vec![0; k.cards.len()];
        for &c in &s.build {
            acquired[c] += 1
        }
        let mut rng = seed;
        let starting = [vec![k.copper; 7], vec![k.scrap; 3]].concat();
        let draw = shuffle(&mut rng, &starting);
        let _dummy_shuffle = shuffle(&mut rng, &starting);
        let mut p = Player {
            strategy: s,
            draw,
            head: 0,
            hand: vec![],
            discard: vec![],
            play: vec![],
            money: 0,
            mana: 0,
            acquired,
            attack: vec![0; k.cards.len()],
            live: 10,
            money_spent: 0,
            unspent: 0,
        };
        p.attack[k.scrap] = 3;
        let mut state = Self {
            k,
            p,
            pos: [3, 4],
            health: [k.health, 50],
            aimed: false,
            exposed: false,
            supply: k.cards.iter().map(|c| c.supply).collect(),
            turn: 1,
            rng,
            tactical: 0,
            cards_played: vec![],
            moved: 0,
            mana_spent: 0,
            spells: 0,
            copies: vec![0; k.cards.len()],
            families: 0,
        };
        state.draw(5);
        state
    }
    fn draw(&mut self, n: i16) {
        for _ in 0..n {
            if self.p.head >= self.p.draw.len() {
                if self.p.discard.is_empty() {
                    break;
                }
                self.p.draw = shuffle(&mut self.rng, &self.p.discard);
                self.p.head = 0;
                self.p.discard.clear()
            }
            self.p.hand.push(self.p.draw[self.p.head]);
            self.p.head += 1
        }
    }
    fn close(&self) -> bool {
        self.pos[0] == self.pos[1]
    }
    fn enabled(&self, ci: usize) -> bool {
        let c = &self.k.cards[ci];
        match c.mechanic {
            Mechanic::BullRush => {
                self.close()
                    && self
                        .p
                        .hand
                        .iter()
                        .filter(|&&x| self.k.cards[x].family == Family::Melee)
                        .count()
                        > 1
            }
            Mechanic::SalvageShot => {
                !self.close()
                    && self
                        .p
                        .hand
                        .iter()
                        .filter(|&&x| self.k.cards[x].family == Family::Ranged)
                        .count()
                        > 1
            }
            Mechanic::Melee
            | Mechanic::Drive
            | Mechanic::Flurry
            | Mechanic::Feint
            | Mechanic::OpeningStrike
            | Mechanic::Rally => self.close(),
            Mechanic::Ranged
            | Mechanic::RepellingShot
            | Mechanic::Volley
            | Mechanic::Aim
            | Mechanic::Longshot
            | Mechanic::PrecisionShot => !self.close(),
            Mechanic::Spell | Mechanic::Cascade => self.p.mana >= c.v.mana_cost,
            _ => c.action,
        }
    }
    fn money_now(&self) -> i16 {
        self.p.money
            + self
                .p
                .hand
                .iter()
                .map(|&x| {
                    if self.k.cards[x].action {
                        0
                    } else {
                        self.k.cards[x].money
                    }
                })
                .sum::<i16>()
    }
    fn projection(&self, lost: i16) -> Vec<i16> {
        let mut acquired = self.p.acquired.clone();
        let mut supply = self.supply.clone();
        let mut bought = vec![0; self.p.strategy.plan.len()];
        let mut money = self.money_now() - lost;
        loop {
            let mut purchased = false;
            let mut stopped = false;
            for (i, slot) in self.p.strategy.plan.iter().enumerate() {
                match *slot {
                    Slot::Inactive => {}
                    Slot::Stop(t) => {
                        if money >= t {
                            stopped = true;
                            break;
                        }
                    }
                    Slot::Buy { card, count } => {
                        let c = &self.k.cards[card];
                        if card == self.k.copper
                            || (count != 99 && acquired[card] >= count)
                            || c.cost <= 0
                            || c.cost > money
                            || (c.action && supply[card] <= 0)
                        {
                            continue;
                        }
                        money -= c.cost;
                        acquired[card] += 1;
                        bought[i] += 1;
                        if c.action {
                            supply[card] -= 1
                        }
                        purchased = true;
                        break;
                    }
                }
            }
            if stopped || !purchased {
                break;
            }
        }
        bought
    }
    fn compare_projection(a: &[i16], b: &[i16]) -> Ordering {
        for i in 0..a.len().max(b.len()) {
            let d = a.get(i).copied().unwrap_or(0) - b.get(i).copied().unwrap_or(0);
            if d != 0 {
                return d.cmp(&0);
            }
        }
        Ordering::Equal
    }
    fn printed(
        &self,
        ci: usize,
        ap: i16,
        op: i16,
        public: bool,
        mana: i16,
        tactical: i16,
        salvage: i16,
        aimed: bool,
    ) -> i16 {
        let c = &self.k.cards[ci];
        let close = ap == op;
        let aim = if aimed || public { self.k.aim_bonus } else { 0 };
        let close_bonus = if self.exposed { self.k.feint_bonus } else { 0 };
        match c.mechanic {
            Mechanic::Melee => {
                if close {
                    c.v.damage + close_bonus
                } else {
                    0
                }
            }
            Mechanic::Drive => {
                if close {
                    c.v.damage
                        + close_bonus
                        + if ap == 1 || ap == 6 {
                            c.v.wall_damage
                        } else {
                            0
                        }
                } else {
                    0
                }
            }
            Mechanic::Flurry => {
                if close {
                    (if public { 1 } else { tactical }) * c.v.per_action + close_bonus
                } else {
                    0
                }
            }
            Mechanic::OpeningStrike => {
                if close {
                    c.v.first + close_bonus
                } else {
                    0
                }
            }
            Mechanic::Rally => {
                if close {
                    c.v.damage + close_bonus
                } else {
                    0
                }
            }
            Mechanic::BullRush => {
                if close {
                    c.v.damage + close_bonus
                } else {
                    0
                }
            }
            Mechanic::Ranged => {
                if close {
                    0
                } else {
                    c.v.damage + aim
                }
            }
            Mechanic::RepellingShot => {
                if close {
                    0
                } else {
                    (if (ap - op).abs() == 1 {
                        c.v.near
                    } else {
                        c.v.far
                    }) + aim
                }
            }
            Mechanic::Longshot => {
                if close {
                    0
                } else {
                    (ap - op).abs() + aim
                }
            }
            Mechanic::SalvageShot => {
                if close {
                    0
                } else {
                    salvage + aim
                }
            }
            Mechanic::PrecisionShot => {
                if close {
                    0
                } else {
                    (if public || self.copies[ci] == 0 {
                        c.v.first
                    } else {
                        c.v.later
                    }) + aim
                }
            }
            Mechanic::Spell => c.v.damage,
            Mechanic::Discharge => mana * c.v.per_mana,
            Mechanic::Cascade => c.v.damage + if public { 0 } else { self.spells } * c.v.per_spell,
            Mechanic::Overload => {
                if public {
                    0
                } else {
                    self.mana_spent * c.v.per_mana_spent
                }
            }
            Mechanic::Improvise => {
                if public {
                    0
                } else {
                    self.families.count_ones() as i16 * c.v.per_family
                }
            }
            Mechanic::Discipline => c.v.damage,
            Mechanic::Scrap => {
                if public || self.copies[ci] == 0 {
                    c.v.damage
                } else {
                    0
                }
            }
            Mechanic::Volley => {
                if close {
                    0
                } else {
                    (if (ap - op).abs() == 1 {
                        c.v.near
                    } else {
                        c.v.far
                    }) + aim
                }
            }
            _ => 0,
        }
    }
    fn immediate(&self, hi: usize) -> i16 {
        let ci = self.p.hand[hi];
        let salvage = self
            .p
            .hand
            .iter()
            .enumerate()
            .filter(|(i, x)| *i != hi && self.k.cards[**x].family == Family::Ranged)
            .map(|(_, &x)| self.k.cards[x].cost)
            .max()
            .unwrap_or(0);
        self.printed(
            ci,
            self.pos[0],
            self.pos[1],
            false,
            self.p.mana,
            self.tactical,
            salvage,
            self.aimed,
        )
    }
    fn hand_damage(&self, ap: i16, op: i16, mana: i16, tactical: i16) -> i16 {
        let mut total = 0;
        let mut ranged = false;
        let mut spell = vec![0i16; mana.max(0) as usize + 1];
        let mut scrap = self.copies[self.k.scrap] == 0;
        for (i, &ci) in self.p.hand.iter().enumerate() {
            let c = &self.k.cards[ci];
            if !attack_mechanic(c.mechanic) {
                continue;
            }
            if matches!(c.mechanic, Mechanic::Spell | Mechanic::Cascade) {
                let cost = c.v.mana_cost as usize;
                if cost > mana as usize {
                    continue;
                }
                let damage = self.printed(ci, ap, op, false, mana, tactical, 0, false);
                for a in (cost..spell.len()).rev() {
                    spell[a] = spell[a].max(spell[a - cost] + damage)
                }
                continue;
            }
            let salvage = self
                .p
                .hand
                .iter()
                .enumerate()
                .filter(|(j, x)| *j != i && self.k.cards[**x].family == Family::Ranged)
                .map(|(_, &x)| self.k.cards[x].cost)
                .max()
                .unwrap_or(0);
            let mut damage = self.printed(ci, ap, op, false, mana, tactical, salvage, false);
            if c.mechanic == Mechanic::Scrap {
                if !scrap {
                    damage = 0
                }
                scrap = false
            }
            total += damage;
            if damage > 0
                && matches!(
                    c.mechanic,
                    Mechanic::Ranged
                        | Mechanic::RepellingShot
                        | Mechanic::Longshot
                        | Mechanic::SalvageShot
                        | Mechanic::PrecisionShot
                        | Mechanic::Volley
                )
            {
                ranged = true
            }
        }
        total
            + if ranged && self.aimed {
                self.k.aim_bonus
            } else {
                0
            }
            + *spell.last().unwrap_or(&0)
    }
    fn position_value(&self, ap: i16, op: i16) -> i32 {
        let mut total = 0i32;
        for (ci, &count) in self.p.attack.iter().enumerate() {
            if count == 0 {
                continue;
            }
            let count = if ci == self.k.scrap {
                count.min(1)
            } else {
                count
            };
            let current = self.printed(ci, ap, op, true, 0, 0, 0, false);
            let mut best = -1;
            let mut steps = 5;
            for p in 1..=6 {
                let d = self.printed(ci, p, op, true, 0, 0, 0, false);
                let s = (p - ap).abs();
                if d > best || (d == best && s < steps) {
                    best = d;
                    steps = s
                }
            }
            total += i32::from(count) * i32::from(current * DAMAGE_WEIGHT - steps)
        }
        total * 10 - 6 * i32::from(self.p.live)
    }
    fn best_move(&self, ci: usize) -> i16 {
        let c = &self.k.cards[ci];
        let choices: Vec<i16> = match c.mechanic {
            Mechanic::Footwork => ([-1, 0, 1])
                .into_iter()
                .filter(|d| self.pos[0] + d >= 1 && self.pos[0] + d <= 6)
                .collect(),
            _ => [-1, 1]
                .into_iter()
                .filter(|d| self.pos[0] + d >= 1 && self.pos[0] + d <= 6)
                .collect(),
        };
        let mut best = choices[0];
        let mut key = (-1i16, i32::MIN);
        for d in choices {
            let ap = self.pos[0] + d;
            let mana = self.p.mana
                + if c.mechanic == Mechanic::LeyStep {
                    c.v.mana
                } else {
                    0
                };
            let k = (
                self.hand_damage(ap, self.pos[1], mana, self.tactical + 1),
                self.position_value(ap, self.pos[1]),
            );
            if k > key
                || (k == key
                    && (d == 0
                        || (best != 0
                            && ((ap - self.pos[1]).abs()
                                > (self.pos[0] + best - self.pos[1]).abs()
                                || (ap - self.pos[1]).abs()
                                    == (self.pos[0] + best - self.pos[1]).abs()
                                    && d < best))))
            {
                key = k;
                best = d
            }
        }
        best
    }
    fn repelling_improves(&self) -> bool {
        let step = if self.pos[1] > self.pos[0] { 1 } else { -1 };
        let target = self.pos[1] + step;
        let (actor, opponent) = if (1..=6).contains(&target) {
            (self.pos[0], target)
        } else {
            let held = self.pos[0] - step;
            (
                if (1..=6).contains(&held) {
                    held
                } else {
                    self.pos[0]
                },
                self.pos[1],
            )
        };
        let current = self.hand_damage(self.pos[0], self.pos[1], self.p.mana, self.tactical);
        let next = self.hand_damage(actor, opponent, self.p.mana, self.tactical + 1);
        next > current
            || (next == current
                && self.position_value(actor, opponent)
                    > self.position_value(self.pos[0], self.pos[1]))
    }
    fn best_drive(&self, ci: usize) -> i16 {
        let c = &self.k.cards[ci];
        let mut best = -1;
        let mut best_key = (i16::MIN, i32::MIN);
        for movement in [-1, 1] {
            let destination = self.pos[0] + movement;
            let collision = !(1..=6).contains(&destination);
            let actor = if collision { self.pos[0] } else { destination };
            let opponent = if collision { self.pos[1] } else { destination };
            let damage = c.v.damage
                + if self.exposed { self.k.feint_bonus } else { 0 }
                + if collision { c.v.wall_damage } else { 0 };
            let key = (damage, self.position_value(actor, opponent));
            if key > best_key {
                best_key = key;
                best = movement
            }
        }
        best
    }
    fn choose(&self) -> Decision {
        let find = |m| {
            self.p
                .hand
                .iter()
                .enumerate()
                .find(|&(_, &ci)| self.enabled(ci) && self.k.cards[ci].mechanic == m)
                .map(|(i, _)| i)
        };
        if self.aimed {
            if let Some(i) = find(Mechanic::Volley) {
                return Decision::Play(i, 0, None, false);
            }
        }
        if self.cards_played.is_empty() {
            if let Some(i) = find(Mechanic::OpeningStrike) {
                return Decision::Play(i, 0, None, false);
            }
        }
        if let Some(i) = find(Mechanic::Reclaim) {
            if !self.p.discard.is_empty() {
                return Decision::Play(i, 0, None, false);
            }
        }
        if let Some(i) = find(Mechanic::Footwork) {
            return Decision::Play(i, self.best_move(self.p.hand[i]), None, false);
        }
        if let Some(i) = find(Mechanic::Channel).or_else(|| find(Mechanic::Attune)) {
            return Decision::Play(i, 0, None, false);
        }
        if let Some(i) = find(Mechanic::Muster).or_else(|| find(Mechanic::Regroup)) {
            return Decision::Play(i, 0, None, false);
        }
        if let Some(i) = find(Mechanic::Stipend) {
            return Decision::Play(i, 0, None, false);
        }
        if let Some(i) = find(Mechanic::Aim) {
            return Decision::Play(i, 0, None, false);
        }
        let adapt = find(Mechanic::Adapt);
        let movement = find(Mechanic::LeyStep).or_else(|| find(Mechanic::Step));
        if let (Some(a), Some(m)) = (adapt, movement) {
            if self.moved == 0 {
                let d = self.best_move(self.p.hand[m]);
                if self.hand_damage(self.pos[0] + d, self.pos[1], self.p.mana, self.tactical + 1)
                    >= self.hand_damage(self.pos[0], self.pos[1], self.p.mana, self.tactical)
                {
                    return Decision::Play(m, d, None, false);
                }
            }
            return Decision::Play(a, 0, None, false);
        }
        if let Some(a) = adapt {
            return Decision::Play(a, 0, None, false);
        }
        if let Some(i) = find(Mechanic::Prism) {
            if self.p.hand.len() > 1 {
                return Decision::Play(i, 0, None, false);
            }
        }
        if let Some(i) = find(Mechanic::Feint) {
            if !self.exposed
                && self.p.hand.iter().any(|&ci| {
                    self.enabled(ci)
                        && matches!(
                            self.k.cards[ci].mechanic,
                            Mechanic::Melee
                                | Mechanic::Drive
                                | Mechanic::Flurry
                                | Mechanic::OpeningStrike
                                | Mechanic::Rally
                                | Mechanic::BullRush
                        )
                })
            {
                return Decision::Play(i, 0, None, false);
            }
        }
        if let Some(i) = find(Mechanic::RepellingShot) {
            if self.repelling_improves() {
                return Decision::Play(i, 0, None, false);
            }
        }
        if self.p.hand.iter().any(|&x| x == self.k.scrap) {
            if let Some(i) = find(Mechanic::Discipline) {
                let target = self.p.hand.iter().position(|&x| x == self.k.scrap);
                return Decision::Play(i, 0, target, false);
            }
            if let Some(i) = find(Mechanic::Cull) {
                return Decision::Play(i, 0, None, false);
            }
            for m in [Mechanic::Sharpen, Mechanic::Scour, Mechanic::Reforge] {
                if let Some(i) = find(m) {
                    let target = self
                        .p
                        .hand
                        .iter()
                        .position(|&x| x == self.k.scrap)
                        .or_else(|| self.p.hand.iter().position(|&x| x == self.k.copper));
                    return Decision::Play(i, 0, target, target.is_none());
                }
            }
        }
        let mut best = None;
        let mut damage = -1;
        for (i, &ci) in self.p.hand.iter().enumerate() {
            if self.enabled(ci)
                && attack_mechanic(self.k.cards[ci].mechanic)
                && self.k.cards[ci].mechanic != Mechanic::Flurry
            {
                let d = self.immediate(i);
                if d > damage {
                    damage = d;
                    best = Some(i)
                }
            }
        }
        if let Some(i) = best {
            return Decision::Play(
                i,
                if self.k.cards[self.p.hand[i]].mechanic == Mechanic::Drive {
                    self.best_drive(self.p.hand[i])
                } else {
                    0
                },
                self.family_target(i),
                false,
            );
        }
        if let Some(i) = find(Mechanic::Flurry) {
            if self.immediate(i) > 0 {
                return Decision::Play(i, 0, None, false);
            }
        }
        if let Some(i) = movement {
            let d = self.best_move(self.p.hand[i]);
            let new =
                self.hand_damage(self.pos[0] + d, self.pos[1], self.p.mana, self.tactical + 1);
            let old = self.hand_damage(self.pos[0], self.pos[1], self.p.mana, self.tactical);
            if new > old
                || (new == old
                    && self.position_value(self.pos[0] + d, self.pos[1])
                        > self.position_value(self.pos[0], self.pos[1]))
            {
                return Decision::Play(i, d, None, false);
            }
        }
        if let Some(i) = find(Mechanic::Cull) {
            if self
                .p
                .hand
                .iter()
                .any(|&x| x == self.k.copper || x == self.k.scrap)
            {
                return Decision::Play(i, 0, None, false);
            }
        }
        for m in [Mechanic::Sharpen, Mechanic::Scour, Mechanic::Reforge] {
            if let Some(i) = find(m) {
                let target = self
                    .p
                    .hand
                    .iter()
                    .position(|&x| x == self.k.scrap)
                    .or_else(|| self.p.hand.iter().position(|&x| x == self.k.copper));
                return Decision::Play(i, 0, target, target.is_none());
            }
        }
        if let Some(i) = find(Mechanic::Reclaim) {
            return Decision::Play(i, 0, None, false);
        }
        Decision::End
    }
    fn family_target(&self, hi: usize) -> Option<usize> {
        let c = &self.k.cards[self.p.hand[hi]];
        let f = match c.mechanic {
            Mechanic::BullRush => Family::Melee,
            Mechanic::SalvageShot => Family::Ranged,
            _ => return None,
        };
        let targets: Vec<(usize, usize)> = self
            .p
            .hand
            .iter()
            .enumerate()
            .filter_map(|(i, &x)| {
                if i != hi && self.k.cards[x].family == f {
                    Some((i, x))
                } else {
                    None
                }
            })
            .collect();
        if c.mechanic == Mechanic::SalvageShot {
            let mut best = None;
            for (i, x) in targets {
                if best
                    .map(|(bi, bx): (usize, usize)| {
                        self.k.cards[x].cost > self.k.cards[bx].cost
                            || (self.k.cards[x].cost == self.k.cards[bx].cost
                                && (self.k.cards[x]
                                    .id
                                    .encode_utf16()
                                    .cmp(self.k.cards[bx].id.encode_utf16())
                                    == Ordering::Less
                                    || (self.k.cards[x].id == self.k.cards[bx].id && i < bi)))
                    })
                    .unwrap_or(true)
                {
                    best = Some((i, x))
                }
            }
            best.map(|(i, _)| i)
        } else {
            targets.first().map(|(i, _)| *i)
        }
    }
    fn discard_choice(&self) -> Option<usize> {
        let mut best: Option<(usize, Vec<i16>, i32)> = None;
        for (index, &ci) in self.p.hand.iter().enumerate() {
            let projection = self.projection(self.k.cards[ci].money);
            let mut retained = 0i32;
            let mut useful_scraps = if self.copies[self.k.scrap] == 0 { 1 } else { 0 };
            for (held, &card) in self.p.hand.iter().enumerate() {
                if held == index {
                    continue;
                }
                let damage = if card == self.k.scrap {
                    let value = if useful_scraps > 0 {
                        self.k.cards[card].v.damage
                    } else {
                        0
                    };
                    useful_scraps -= 1;
                    value
                } else {
                    self.immediate(held)
                };
                let draw = self.k.cards[card].v.draw
                    + if self.k.cards[card].mechanic == Mechanic::Adapt && self.moved > 0 {
                        self.k.cards[card].v.moved_draw
                    } else {
                        0
                    };
                retained += i32::from(damage) * 100
                    + i32::from(draw) * 30
                    + i32::from(self.k.cards[card].v.mana) * 15
                    + i32::from(self.k.cards[card].money) * 20
                    + i32::from(self.k.cards[card].cost);
            }
            if best
                .as_ref()
                .map(|(_, held, value)| {
                    Self::compare_projection(&projection, held) == Ordering::Greater
                        || (Self::compare_projection(&projection, held) == Ordering::Equal
                            && retained > *value)
                })
                .unwrap_or(true)
            {
                best = Some((index, projection, retained));
            }
        }
        best.map(|(index, _, _)| index)
    }
    fn remove_hand(&mut self, i: usize) -> usize {
        self.p.hand.remove(i)
    }
    fn damage(&mut self, n: i16, close: bool) -> bool {
        let actual = n + if close && self.exposed {
            self.k.feint_bonus
        } else {
            0
        };
        self.health[1] = (self.health[1] - actual).max(0);
        self.health[1] == 0
    }
    fn play(&mut self, decision: Decision) -> bool {
        let Decision::Play(hi, movement, target, self_target) = decision else {
            return false;
        };
        let selected = target.and_then(|i| self.p.hand.get(i).copied());
        let after = target.map(|i| if i > hi { i - 1 } else { i });
        let ci = self.remove_hand(hi);
        let c = self.k.cards[ci].clone();
        self.p.play.push(ci);
        let prev = self.tactical;
        let ranged_attack = matches!(
            c.mechanic,
            Mechanic::Ranged
                | Mechanic::RepellingShot
                | Mechanic::Longshot
                | Mechanic::SalvageShot
                | Mechanic::PrecisionShot
                | Mechanic::Volley
        );
        let aim_bonus = if ranged_attack && self.aimed {
            self.k.aim_bonus
        } else {
            0
        };
        if ranged_attack {
            self.aimed = false;
        }
        if c.tactical {
            self.tactical += 1
        }
        self.cards_played.push(ci);
        self.copies[ci] += 1;
        if matches!(
            c.id.as_str(),
            "arcBolt" | "fireball" | "starfire" | "discharge" | "cascade" | "overload"
        ) {
            self.spells += 1
        }
        self.families |= family_bit(c.family);
        macro_rules! hit {
            ($n:expr,$close:expr) => {
                if self.damage($n, $close) {
                    return true;
                }
            };
        }
        match c.mechanic {
            Mechanic::Channel => {
                self.p.mana += c.v.mana;
                self.draw(c.v.draw)
            }
            Mechanic::Step | Mechanic::LeyStep => {
                self.pos[0] += movement;
                self.moved += movement.abs();
                self.p.mana += c.v.mana
                    + if c.mechanic == Mechanic::LeyStep && (self.pos[0] - self.pos[1]).abs() >= 2 {
                        c.v.far_mana
                    } else {
                        0
                    }
            }
            Mechanic::Footwork => {
                self.pos[0] += movement;
                self.moved += movement.abs();
                self.draw(c.v.draw)
            }
            Mechanic::Melee => {
                hit!(c.v.damage, true);
                self.draw(c.v.draw)
            }
            Mechanic::Longshot => hit!((self.pos[0] - self.pos[1]).abs() + aim_bonus, false),
            Mechanic::PrecisionShot => {
                let first = self.copies[ci] == 1;
                hit!(
                    (if first { c.v.first } else { c.v.later }) + aim_bonus,
                    false
                )
            }
            Mechanic::Ranged => {
                let n = c.v.damage + aim_bonus;
                hit!(n, false);
                self.draw(c.v.draw)
            }
            Mechanic::Improvise => hit!(self.families.count_ones() as i16 * c.v.per_family, false),
            Mechanic::Scrap => hit!(if self.copies[ci] == 1 { c.v.damage } else { 0 }, false),
            Mechanic::Reclaim => {
                if self.p.discard.is_empty() {
                    self.draw(c.v.draw)
                } else {
                    let mut best = 0usize;
                    for i in 1..self.p.discard.len() {
                        let a = self.p.discard[i];
                        let b = self.p.discard[best];
                        if self.k.cards[a].cost > self.k.cards[b].cost
                            || (self.k.cards[a].cost == self.k.cards[b].cost
                                && self.k.cards[a]
                                    .id
                                    .encode_utf16()
                                    .cmp(self.k.cards[b].id.encode_utf16())
                                    == Ordering::Less)
                        {
                            best = i
                        }
                    }
                    let x = self.p.discard.remove(best);
                    self.p.hand.push(x)
                }
            }
            Mechanic::Sharpen => {
                self.draw(c.v.draw);
                let t = self
                    .p
                    .hand
                    .iter()
                    .position(|&x| x == self.k.scrap)
                    .or_else(|| {
                        let i = self.p.hand.iter().position(|&x| x == self.k.copper)?;
                        if Self::compare_projection(&self.projection(1), &self.projection(0))
                            != Ordering::Less
                        {
                            Some(i)
                        } else {
                            None
                        }
                    });
                if let Some(i) = t {
                    let x = self.remove_hand(i);
                    self.p.live -= 1;
                    if attack_mechanic(self.k.cards[x].mechanic) {
                        self.p.attack[x] -= 1
                    }
                }
            }
            Mechanic::Scour => {
                let mut n = 0;
                for _ in 0..2 {
                    if let Some(i) = self
                        .p
                        .hand
                        .iter()
                        .position(|&x| x == self.k.scrap)
                        .or_else(|| self.p.hand.iter().position(|&x| x == self.k.copper))
                    {
                        let x = self.remove_hand(i);
                        self.p.live -= 1;
                        if attack_mechanic(self.k.cards[x].mechanic) {
                            self.p.attack[x] -= 1;
                        }
                        n += 1
                    }
                }
                self.draw(n * c.v.draw_per_trash)
            }
            Mechanic::Reforge => {
                let i = after.unwrap_or_else(|| {
                    self.p
                        .hand
                        .iter()
                        .position(|&x| x == self.k.scrap)
                        .or_else(|| self.p.hand.iter().position(|&x| x == self.k.copper))
                        .unwrap_or(0)
                });
                let x = if self_target {
                    self.p.play.pop().unwrap()
                } else {
                    self.remove_hand(i)
                };
                self.p.live -= 1;
                if attack_mechanic(self.k.cards[x].mechanic) {
                    self.p.attack[x] -= 1;
                }
                let max = self.k.cards[x].cost + c.v.cost_bonus;
                let mut gain: Option<usize> = None;
                for (i, g) in self.k.cards.iter().enumerate() {
                    if g.id != "scrap"
                        && g.cost <= max
                        && (!g.action || self.supply[i] > 0)
                        && gain
                            .map(|j| {
                                g.cost > self.k.cards[j].cost
                                    || (g.cost == self.k.cards[j].cost
                                        && g.id
                                            .encode_utf16()
                                            .cmp(self.k.cards[j].id.encode_utf16())
                                            == Ordering::Less)
                            })
                            .unwrap_or(true)
                    {
                        gain = Some(i)
                    }
                }
                if let Some(g) = gain {
                    self.p.discard.push(g);
                    if self.k.cards[g].action {
                        self.supply[g] -= 1
                    }
                    self.p.live += 1;
                    if attack_mechanic(self.k.cards[g].mechanic) {
                        self.p.attack[g] += 1
                    }
                }
            }
            Mechanic::SalvageShot => {
                if let Some(x) = selected {
                    let i = self.p.hand.iter().position(|&v| v == x).unwrap();
                    let x = self.remove_hand(i);
                    self.p.discard.push(x);
                    hit!(self.k.cards[x].cost + aim_bonus, false);
                    self.draw(c.v.draw)
                }
            }
            Mechanic::Attune => {
                self.p.mana += c.v.mana + (self.copies[ci] - 1) * c.v.per_copy;
                self.draw(c.v.draw)
            }
            Mechanic::Spell => {
                self.p.mana -= c.v.mana_cost;
                self.mana_spent += c.v.mana_cost;
                hit!(c.v.damage, false)
            }
            Mechanic::Discharge => {
                let n = self.p.mana * c.v.per_mana;
                self.p.mana = 0;
                hit!(n, false)
            }
            Mechanic::Cascade => {
                self.p.mana -= c.v.mana_cost;
                self.mana_spent += c.v.mana_cost;
                hit!(c.v.damage + (self.spells - 1) * c.v.per_spell, false)
            }
            Mechanic::Overload => hit!(self.mana_spent * c.v.per_mana_spent, false),
            Mechanic::OpeningStrike => hit!(
                if self.cards_played.len() == 1 {
                    c.v.first
                } else {
                    c.v.later
                },
                true
            ),
            Mechanic::Rally => hit!(c.v.damage + (self.copies[ci] - 1) * c.v.per_copy, true),
            Mechanic::Flurry => hit!(prev * c.v.per_action, true),
            Mechanic::Aim => {
                self.aimed = true;
                self.draw(c.v.draw)
            }
            Mechanic::Stipend => {
                self.draw(c.v.draw);
                self.p.money += c.v.money
            }
            Mechanic::Muster => self.draw(c.v.draw),
            Mechanic::Adapt => {
                self.draw(c.v.draw);
                if self.moved > 0 {
                    self.draw(c.v.moved_draw)
                }
            }
            Mechanic::Feint => {
                self.draw(c.v.draw);
                self.exposed = true
            }
            Mechanic::Discipline => {
                let i = after.unwrap_or(0);
                let x = if self_target {
                    self.p.play.pop().unwrap()
                } else {
                    self.remove_hand(i)
                };
                self.p.live -= 1;
                if attack_mechanic(self.k.cards[x].mechanic) {
                    self.p.attack[x] -= 1;
                }
                hit!(c.v.damage, false)
            }
            Mechanic::Drive => {
                hit!(c.v.damage, true);
                let destination = self.pos[0] + movement;
                if !(1..=6).contains(&destination) {
                    hit!(c.v.wall_damage, false);
                } else {
                    self.moved += movement.abs();
                    self.pos = [destination, destination];
                }
            }
            Mechanic::RepellingShot => {
                let near = (self.pos[0] - self.pos[1]).abs() == 1;
                hit!((if near { c.v.near } else { c.v.far }) + aim_bonus, false);
                let step = if self.pos[1] > self.pos[0] { 1 } else { -1 };
                let target = self.pos[1] + step;
                if (1..=6).contains(&target) {
                    self.pos[1] = target
                } else {
                    let actor = self.pos[0] - step;
                    if (1..=6).contains(&actor) {
                        self.moved += (actor - self.pos[0]).abs();
                        self.pos[0] = actor
                    }
                }
            }
            Mechanic::Volley => {
                let near = (self.pos[0] - self.pos[1]).abs() == 1;
                hit!((if near { c.v.near } else { c.v.far }) + aim_bonus, false);
            }
            Mechanic::BullRush => {
                if let Some(x) = selected {
                    if let Some(i) = self.p.hand.iter().position(|&held| held == x) {
                        let held = self.remove_hand(i);
                        self.p.discard.push(held)
                    }
                }
                hit!(c.v.damage, true)
            }
            Mechanic::Prism => {
                self.p.mana += c.v.mana;
                self.draw(c.v.draw);
                if let Some(i) = self.discard_choice() {
                    let held = self.remove_hand(i);
                    self.p.discard.push(held)
                }
            }
            Mechanic::Regroup => {
                self.draw(c.v.draw);
                if let Some(i) = self.discard_choice() {
                    let held = self.remove_hand(i);
                    self.p.discard.push(held)
                }
            }
            Mechanic::Cull => {
                let mut targets: Vec<usize> = self
                    .p
                    .hand
                    .iter()
                    .enumerate()
                    .filter_map(|(i, &x)| if x == self.k.scrap { Some(i) } else { None })
                    .take(2)
                    .collect();
                let capacity = 2usize.saturating_sub(targets.len());
                let copper: Vec<usize> = self
                    .p
                    .hand
                    .iter()
                    .enumerate()
                    .filter_map(|(i, &x)| if x == self.k.copper { Some(i) } else { None })
                    .take(capacity)
                    .collect();
                let base = self.projection(0);
                let mut best_count = 0;
                for count in 1..=copper.len() {
                    if Self::compare_projection(&self.projection(count as i16), &base)
                        != Ordering::Less
                    {
                        best_count = count
                    }
                }
                targets.extend(copper.into_iter().take(best_count));
                targets.sort_unstable_by(|a, b| b.cmp(a));
                for i in targets {
                    let x = self.remove_hand(i);
                    self.p.live -= 1;
                    if attack_mechanic(self.k.cards[x].mechanic) {
                        self.p.attack[x] -= 1
                    }
                }
            }
            _ => {}
        }
        false
    }
    fn end_action(&mut self) {
        let mut remain = vec![];
        for x in self.p.hand.drain(..) {
            if self.k.cards[x].action {
                remain.push(x)
            } else {
                self.p.money += self.k.cards[x].money;
                self.p.play.push(x)
            }
        }
        self.p.hand = remain;
        self.p.mana = 0
    }
    fn purchase(&self) -> Option<usize> {
        for slot in &self.p.strategy.plan {
            match *slot {
                Slot::Inactive => {}
                Slot::Stop(t) => {
                    if self.p.money >= t {
                        return None;
                    }
                }
                Slot::Buy { card, count } => {
                    let c = &self.k.cards[card];
                    if card != self.k.copper
                        && (count == 99 || self.p.acquired[card] < count)
                        && c.cost > 0
                        && c.cost <= self.p.money
                        && (!c.action || self.supply[card] > 0)
                    {
                        return Some(card);
                    }
                }
            }
        }
        None
    }
    fn buy(&mut self, ci: usize) {
        let c = &self.k.cards[ci];
        self.p.money -= c.cost;
        self.p.money_spent += i32::from(c.cost);
        if c.action {
            self.supply[ci] -= 1
        }
        self.p.discard.push(ci);
        self.p.acquired[ci] += 1;
        self.p.live += 1;
        if attack_mechanic(c.mechanic) {
            self.p.attack[ci] += 1
        }
    }
    fn end_buy(&mut self) {
        self.p.unspent += i32::from(self.p.money);
        self.p.discard.append(&mut self.p.hand);
        self.p.discard.append(&mut self.p.play);
        self.p.money = 0;
        self.p.mana = 0;
        self.aimed = false;
        self.exposed = false;
        self.draw(5);
        self.tactical = 0;
        self.cards_played.clear();
        self.moved = 0;
        self.mana_spent = 0;
        self.spells = 0;
        self.copies.fill(0);
        self.families = 0;
        self.turn += 1
    }
}
#[derive(Clone, Copy)]
enum Decision {
    End,
    Play(usize, i16, Option<usize>, bool),
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    trials: i32,
    completions: i32,
    mean_turns_to50: Option<f64>,
    total_turns_to50: i32,
    damage_area: i32,
    total_damage: i32,
    mean_damage: f64,
    money_spent: i32,
    unspent_money: i32,
    penalized_turns_to50: i32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileScore {
    profile: String,
    score: Metrics,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    profiles: Option<Vec<ProfileScore>>,
    worst_completions: i32,
    total_completions: i32,
    worst_penalized_turns_to50: i32,
    total_penalized_turns_to50: i32,
    worst_damage_area: i32,
    total_damage_area: i32,
    total_money_spent: i32,
    strategy_id: String,
    collision_tie_key: String,
}
struct Trial {
    complete: bool,
    turn: i16,
    area: i32,
    damage: i16,
    spent: i32,
    unspent: i32,
}
fn trial(k: &Kingdom, s: &Strategy, seed: u32, profile: &str, limit: i16, cap: i16) -> Trial {
    let mut st = State::new(k, s.clone(), seed);
    let mut phase = false;
    let mut actions = 0;
    let mut done = 0;
    let mut area = 0;
    let mut final_damage = 0;
    let mut victory = false;
    loop {
        let mut changed = false;
        if !phase {
            match st.choose() {
                Decision::End => {
                    st.end_action();
                    actions += 1;
                    phase = true
                }
                d => {
                    if st.play(d) {
                        final_damage = 50;
                        area += 50;
                        done += 1;
                        victory = true;
                        break;
                    }
                    actions += 1
                }
            }
        } else if let Some(c) = st.purchase() {
            st.buy(c);
            actions += 1
        } else {
            st.end_buy();
            actions += 1;
            phase = false;
            final_damage = 50 - st.health[1];
            area += i32::from(final_damage);
            done += 1;
            if profile == "chaser" {
                if st.pos[1] < st.pos[0] && st.pos[1] < 6 {
                    st.pos[1] += 1
                } else if st.pos[1] > st.pos[0] && st.pos[1] > 1 {
                    st.pos[1] -= 1
                }
            } else if profile == "kiter" {
                let d = st.pos[1];
                let c = st.pos[0];
                let mut best: Option<i16> = None;
                for p in [d - 1, d + 1] {
                    if (1..=6).contains(&p) && (p - c).abs() > (d - c).abs() {
                        best = Some(best.map(|held| held.min(p)).unwrap_or(p))
                    }
                }
                if let Some(position) = best {
                    st.pos[1] = position
                }
            }
            changed = true
        }
        if actions > cap {
            break;
        }
        if st.turn > limit {
            break;
        }
        if changed {
            actions = 0
        }
    }
    area += i32::from(limit - done) * i32::from(final_damage);
    Trial {
        complete: victory,
        turn: st.turn,
        area,
        damage: final_damage,
        spent: st.p.money_spent,
        unspent: st.p.unspent,
    }
}
fn metrics(
    k: &Kingdom,
    s: &Strategy,
    seeds: &[u32],
    profile: &str,
    limit: i16,
    cap: i16,
) -> Metrics {
    let t: Vec<_> = seeds
        .iter()
        .map(|&seed| trial(k, s, seed, profile, limit, cap))
        .collect();
    let completed: Vec<_> = t.iter().filter(|x| x.complete).collect();
    let turns = completed.iter().map(|x| i32::from(x.turn)).sum::<i32>();
    let damage = t.iter().map(|x| i32::from(x.damage)).sum::<i32>();
    Metrics {
        trials: t.len() as i32,
        completions: completed.len() as i32,
        mean_turns_to50: if completed.is_empty() {
            None
        } else {
            Some(turns as f64 / completed.len() as f64)
        },
        total_turns_to50: turns,
        damage_area: t.iter().map(|x| x.area).sum(),
        total_damage: damage,
        mean_damage: damage as f64 / t.len() as f64,
        money_spent: t.iter().map(|x| x.spent).sum(),
        unspent_money: t.iter().map(|x| x.unspent).sum(),
        penalized_turns_to50: t
            .iter()
            .map(|x| {
                if x.complete {
                    i32::from(x.turn)
                } else {
                    i32::from(limit) + 1
                }
            })
            .sum(),
    }
}

pub fn score_batch(input: BatchInput) -> Result<Vec<Score>, String> {
    if input.protocol_version != 1
        || input.scorer_version != "native-goldfish-v1"
        || input.rule_fingerprint.is_empty()
    {
        return Err("native scorer protocol, version, or rule fingerprint mismatch".into());
    }
    if input
        .movement_profiles
        .iter()
        .any(|profile| !matches!(profile.as_str(), "stationary" | "chaser" | "kiter"))
    {
        return Err("unknown goldfish movement profile".into());
    }
    if input.threads == 0 || input.threads > input.cpu_request {
        return Err("threads exceed CPU request".into());
    }
    let k = Kingdom::compile(input.kingdom)?;
    let strategies = input
        .strategies
        .into_iter()
        .map(|raw| k.strategy(raw))
        .collect::<Result<Vec<_>, String>>()?;
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(input.threads)
        .build()
        .map_err(|e| e.to_string())?;
    let scores: Vec<Score> = pool.install(|| {
        strategies
            .into_par_iter()
            .map(|s| {
                let profiles: Vec<_> = input
                    .movement_profiles
                    .iter()
                    .map(|p| ProfileScore {
                        profile: p.clone(),
                        score: metrics(
                            &k,
                            &s,
                            &input.seeds,
                            p,
                            input.turn_limit,
                            input.action_cap_per_turn,
                        ),
                    })
                    .collect();
                let vals: Vec<_> = profiles.iter().map(|x| &x.score).collect();
                Score {
                    strategy_id: s.id.clone(),
                    collision_tie_key: s.canonical.clone(),
                    worst_completions: vals.iter().map(|x| x.completions).min().unwrap_or(0),
                    total_completions: vals.iter().map(|x| x.completions).sum(),
                    worst_penalized_turns_to50: vals
                        .iter()
                        .map(|x| x.penalized_turns_to50)
                        .max()
                        .unwrap_or(0),
                    total_penalized_turns_to50: vals.iter().map(|x| x.penalized_turns_to50).sum(),
                    worst_damage_area: vals.iter().map(|x| x.damage_area).min().unwrap_or(0),
                    total_damage_area: vals.iter().map(|x| x.damage_area).sum(),
                    total_money_spent: vals.iter().map(|x| x.money_spent).sum(),
                    profiles: if input.mode == "full" {
                        Some(profiles)
                    } else {
                        None
                    },
                }
            })
            .collect::<Vec<_>>()
    });
    Ok(scores)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(
        id: &str,
        card_type: &str,
        mechanic: &str,
        family: &str,
        cost: i16,
        money: i16,
        supply: i16,
        values: RawValues,
    ) -> RawCard {
        RawCard {
            id: id.into(),
            card_type: card_type.into(),
            mechanic: mechanic.into(),
            family: family.into(),
            cost,
            money,
            supply,
            tactical: card_type == "action",
            values,
        }
    }

    fn fixture() -> (Kingdom, Strategy) {
        let kingdom = Kingdom::compile(KingdomInput {
            health: 50,
            aim_bonus: 2,
            feint_bonus: 1,
            cards: vec![
                card(
                    "copper",
                    "treasure",
                    "money",
                    "treasure",
                    0,
                    1,
                    -1,
                    RawValues::default(),
                ),
                card(
                    "gold",
                    "treasure",
                    "money",
                    "treasure",
                    6,
                    3,
                    -1,
                    RawValues::default(),
                ),
                card(
                    "precisionShot",
                    "action",
                    "precisionShot",
                    "ranged",
                    5,
                    0,
                    10,
                    RawValues {
                        first: 4,
                        later: 2,
                        ..RawValues::default()
                    },
                ),
                card(
                    "scrap",
                    "action",
                    "scrap",
                    "engine",
                    0,
                    0,
                    -1,
                    RawValues {
                        damage: 1,
                        ..RawValues::default()
                    },
                ),
            ],
        })
        .unwrap();
        let strategy = kingdom
            .strategy(RawStrategy {
                id: "fixture".into(),
                canonical_strategy: "fixture".into(),
                starting_build: vec![],
                buy_plan: vec![
                    RawSlot::Buy {
                        card_id: "precisionShot".into(),
                        desired_count: 99,
                    },
                    RawSlot::Inactive,
                ],
            })
            .unwrap();
        (kingdom, strategy)
    }

    #[test]
    fn turn_and_action_boundaries_pad_damage_area() {
        let (kingdom, strategy) = fixture();
        let turn = trial(&kingdom, &strategy, 11, "stationary", 1, 200);
        let action = trial(&kingdom, &strategy, 11, "stationary", 30, 1);
        let complete = trial(&kingdom, &strategy, 11, "stationary", 30, 200);
        assert_eq!(turn.area, i32::from(turn.damage));
        assert_eq!(action.area, i32::from(action.damage) * 30);
        assert!(complete.area >= i32::from(complete.damage));
    }
}
