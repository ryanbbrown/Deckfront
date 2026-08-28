use crate::equilibrium::{solve_maximum_support, verify_mix};
use crate::kernel::{Kingdom, KingdomInput, RawSlot, RawStrategy, Strategy, competitive_game};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

const MAGIC: &[u8; 4] = b"HGR1";
const HEADER_BYTES: usize = 64;
const RESERVOIR_KIND: u32 = 4;
const PAIRS_KIND: u32 = 5;
const PURCHASES_KIND: u32 = 6;
const MATRIX_KIND: u32 = 7;
const RESERVOIR_ROW_BYTES: u32 = 124;
const PAIRS_ROW_BYTES: u32 = 133;
const DEFAULT_TOP: usize = 50;
const PRODUCTION_RESERVOIR_ROWS: u32 = 20_000;
const CANDIDATE_COUNT: u32 = 12_972_960;
const SHUFFLE_COUNT: usize = 125;
const MATRIX_SHUFFLES: usize = 75;
const FIRST_MATRIX_SEED: u32 = 4_200_001;
const LAST_MATRIX_SEED: u32 = 4_200_125;
const GOLDFISH_SEEDS: [u32; 4] = [4_100_000, 4_100_001, 4_100_002, 4_100_003];
const TURN_LIMIT: i16 = 30;
const ACTION_CAP: i16 = 200;

#[derive(Clone, Debug)]
struct Header {
    kind: u32,
    row_bytes: u32,
    range_start: u32,
    range_end: u32,
    row_count: u32,
    row_crc: u32,
    source_checksum: u32,
    seeds: [u32; 4],
    rule_fingerprint: String,
}

impl Header {
    fn encode(&self) -> Result<[u8; HEADER_BYTES], String> {
        if !self.rule_fingerprint.is_ascii() || self.rule_fingerprint.len() > 16 {
            return Err("rule fingerprint must be at most 16 ASCII bytes".into());
        }
        let mut bytes = [0; HEADER_BYTES];
        bytes[..4].copy_from_slice(MAGIC);
        for (offset, value) in [
            (4, self.kind),
            (8, self.row_bytes),
            (12, self.range_start),
            (16, self.range_end),
            (20, self.row_count),
            (24, self.row_crc),
            (28, self.source_checksum),
        ] {
            bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        for (index, seed) in self.seeds.iter().enumerate() {
            let offset = 32 + index * 4;
            bytes[offset..offset + 4].copy_from_slice(&seed.to_le_bytes());
        }
        let fingerprint = self.rule_fingerprint.as_bytes();
        bytes[48..48 + fingerprint.len()].copy_from_slice(fingerprint);
        Ok(bytes)
    }

    fn decode(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() < HEADER_BYTES || &bytes[..4] != MAGIC {
            return Err("file header magic is invalid".into());
        }
        let number = |offset: usize| {
            u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("four bytes"))
        };
        let fingerprint_bytes = &bytes[48..64];
        let fingerprint_end = fingerprint_bytes
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(fingerprint_bytes.len());
        if fingerprint_bytes[fingerprint_end..]
            .iter()
            .any(|byte| *byte != 0)
        {
            return Err("rule fingerprint padding is invalid".into());
        }
        let rule_fingerprint = std::str::from_utf8(&fingerprint_bytes[..fingerprint_end])
            .map_err(|_| "rule fingerprint is not ASCII")?
            .to_owned();
        if !rule_fingerprint.is_ascii() {
            return Err("rule fingerprint is not ASCII".into());
        }
        Ok(Self {
            kind: number(4),
            row_bytes: number(8),
            range_start: number(12),
            range_end: number(16),
            row_count: number(20),
            row_crc: number(24),
            source_checksum: number(28),
            seeds: [number(32), number(36), number(40), number(44)],
            rule_fingerprint,
        })
    }
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (index, entry) in table.iter_mut().enumerate() {
        let mut value = index as u32;
        for _ in 0..8 {
            value = if value & 1 == 1 {
                0xedb8_8320 ^ (value >> 1)
            } else {
                value >> 1
            };
        }
        *entry = value;
    }
    let mut crc = u32::MAX;
    for byte in bytes {
        crc = table[((crc ^ u32::from(*byte)) & 0xff) as usize] ^ (crc >> 8);
    }
    crc ^ u32::MAX
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KingdomDocument {
    kingdom: KingdomInput,
    ordered_card_ids: Vec<String>,
    rule_fingerprint: String,
}

struct LoadedKingdom {
    id: String,
    fingerprint: String,
    ordered_card_ids: Vec<String>,
    card_ids: Vec<String>,
    card_indexes: HashMap<String, usize>,
    kernel: Kingdom,
}

fn compare_utf16(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn load_kingdom(path: &Path) -> Result<LoadedKingdom, String> {
    let bytes = fs::read(path).map_err(|error| format!("read kingdom file: {error}"))?;
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|error| format!("parse kingdom file: {error}"))?;
    let id = value
        .pointer("/kingdom/id")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or("kingdom file has no kingdom id")?
        .to_owned();
    let document: KingdomDocument =
        serde_json::from_value(value).map_err(|error| format!("parse kingdom file: {error}"))?;
    if document.rule_fingerprint.is_empty()
        || !document.rule_fingerprint.is_ascii()
        || document.rule_fingerprint.len() > 16
    {
        return Err("kingdom rule fingerprint is invalid".into());
    }
    let mut expected = document
        .kingdom
        .cards
        .iter()
        .filter(|card| card.id != "copper" && card.cost > 0)
        .map(|card| card.id.clone())
        .collect::<Vec<_>>();
    if expected.iter().collect::<HashSet<_>>().len() != expected.len() {
        return Err("kingdom purchase card ids are not unique".into());
    }
    expected.sort_by(|left, right| compare_utf16(left, right));
    if document.ordered_card_ids != expected {
        return Err("orderedCardIds does not match the kingdom purchase-card rule".into());
    }
    let candidate_count = permutation_count(expected.len(), 5)?
        .checked_mul(quantity_vectors().len() as u32)
        .ok_or("candidate count overflow")?;
    if candidate_count != CANDIDATE_COUNT {
        return Err(format!(
            "kingdom candidate count {candidate_count} differs from {CANDIDATE_COUNT}"
        ));
    }
    let card_ids = document
        .kingdom
        .cards
        .iter()
        .map(|card| card.id.clone())
        .collect::<Vec<_>>();
    let card_indexes = card_ids
        .iter()
        .enumerate()
        .map(|(index, id)| (id.clone(), index))
        .collect::<HashMap<_, _>>();
    if card_indexes.len() != card_ids.len() {
        return Err("kingdom card ids are not unique".into());
    }
    let kernel = Kingdom::compile(document.kingdom)?;
    Ok(LoadedKingdom {
        id,
        fingerprint: document.rule_fingerprint,
        ordered_card_ids: expected,
        card_ids,
        card_indexes,
        kernel,
    })
}

fn permutation_count(card_count: usize, slots: usize) -> Result<u32, String> {
    if card_count < slots || slots == 0 {
        return Err("ordered permutation dimensions are invalid".into());
    }
    (0..slots).try_fold(1u32, |value, index| {
        value
            .checked_mul((card_count - index) as u32)
            .ok_or_else(|| "ordered permutation count overflow".into())
    })
}

fn quantity_vectors() -> Vec<[i16; 5]> {
    let mut values = Vec::new();
    for first in 1..=4 {
        for second in 1..=4 {
            for third in 1..=4 {
                let value = [first, second, third, 3, 3];
                if value.iter().sum::<i16>() <= 15 {
                    values.push(value);
                }
            }
        }
    }
    values
}

fn ordered_permutation_at(card_ids: &[String], mut index: u32) -> Result<[String; 5], String> {
    let mut available = card_ids.to_vec();
    let mut selected = Vec::with_capacity(5);
    for position in 0..5 {
        let remaining_slots = 4 - position;
        let block = if remaining_slots == 0 {
            1
        } else {
            permutation_count(available.len() - 1, remaining_slots)?
        };
        let selected_index = (index / block) as usize;
        if selected_index >= available.len() {
            return Err("strategy permutation index is out of range".into());
        }
        index %= block;
        selected.push(available.remove(selected_index));
    }
    selected
        .try_into()
        .map_err(|_| "strategy permutation has the wrong size".into())
}

struct DecodedStrategy {
    number: u32,
    kernel: Strategy,
    desired: Vec<u32>,
}

fn decode_strategy(kingdom: &LoadedKingdom, number: u32) -> Result<DecodedStrategy, String> {
    if number >= CANDIDATE_COUNT {
        return Err(format!("strategy number {number} is out of range"));
    }
    let quantities = quantity_vectors();
    let quantity = quantities[(number % quantities.len() as u32) as usize];
    let cards =
        ordered_permutation_at(&kingdom.ordered_card_ids, number / quantities.len() as u32)?;
    let mut desired = vec![0; kingdom.card_ids.len()];
    let mut buy_plan = Vec::with_capacity(10);
    for (card_id, count) in cards.iter().zip(quantity) {
        let index = *kingdom
            .card_indexes
            .get(card_id)
            .ok_or_else(|| format!("strategy card {card_id} is absent"))?;
        desired[index] = count as u32;
        buy_plan.push(RawSlot::Buy {
            card_id: card_id.clone(),
            desired_count: count,
        });
    }
    buy_plan.extend((0..5).map(|_| RawSlot::Inactive));
    let kernel = kingdom.kernel.strategy(RawStrategy {
        id: format!("gf-{number}"),
        canonical_strategy: format!("gf-{number}"),
        starting_build: Vec::new(),
        buy_plan,
    })?;
    Ok(DecodedStrategy {
        number,
        kernel,
        desired,
    })
}

struct Reservoir {
    source_checksum: u32,
    numbers: Vec<u32>,
    bytes: usize,
}

fn read_reservoir(
    path: &Path,
    kingdom: &LoadedKingdom,
    top: usize,
    explicit_top: bool,
) -> Result<Reservoir, String> {
    let bytes = fs::read(path).map_err(|error| format!("read reservoir: {error}"))?;
    let header = Header::decode(&bytes)?;
    if header.kind != RESERVOIR_KIND
        || header.row_bytes != RESERVOIR_ROW_BYTES
        || header.range_start != 0
        || header.range_end != 500_000
        || header.seeds != GOLDFISH_SEEDS
        || header.rule_fingerprint != kingdom.fingerprint
    {
        return Err("reservoir header differs from the Goldfish reservoir contract".into());
    }
    if (!explicit_top && header.row_count != PRODUCTION_RESERVOIR_ROWS)
        || (explicit_top && header.row_count < top as u32)
    {
        return Err("reservoir row count is invalid for --top".into());
    }
    let expected_len = HEADER_BYTES
        .checked_add(header.row_count as usize * RESERVOIR_ROW_BYTES as usize)
        .ok_or("reservoir size overflow")?;
    if bytes.len() != expected_len {
        return Err("reservoir is truncated or has trailing bytes".into());
    }
    let rows = &bytes[HEADER_BYTES..];
    if crc32(rows) != header.row_crc {
        return Err("reservoir CRC differs from its rows".into());
    }
    let mut numbers = Vec::with_capacity(top);
    let mut unique = HashSet::with_capacity(top);
    for rank in 0..top {
        let offset = rank * RESERVOIR_ROW_BYTES as usize;
        let number = u32::from_le_bytes(rows[offset..offset + 4].try_into().expect("number"));
        if number >= CANDIDATE_COUNT {
            return Err(format!(
                "reservoir strategy number {number} is out of range"
            ));
        }
        if !unique.insert(number) {
            return Err(format!(
                "reservoir top rows repeat strategy number {number}"
            ));
        }
        numbers.push(number);
    }
    Ok(Reservoir {
        source_checksum: header.row_crc,
        numbers,
        bytes: bytes.len(),
    })
}

#[derive(Clone)]
struct PairResult {
    first: u32,
    second: u32,
    points: Vec<u8>,
    purchases: [Vec<u32>; 2],
    damage: [[u32; 5]; 2],
}

fn play_pair_with_kingdom(
    kingdom: &Kingdom,
    first: &DecodedStrategy,
    second: &DecodedStrategy,
) -> PairResult {
    let card_count = first.desired.len();
    let mut points = Vec::with_capacity(SHUFFLE_COUNT);
    let mut purchases = [vec![0u32; card_count], vec![0u32; card_count]];
    let mut damage = [[0u32; 5]; 2];
    for seed in FIRST_MATRIX_SEED..=LAST_MATRIX_SEED {
        let mut score = 0;
        for first_indigo in [false, true] {
            let game = competitive_game(
                kingdom,
                &first.kernel,
                &second.kernel,
                seed,
                first_indigo,
                false,
                TURN_LIMIT,
                ACTION_CAP,
            );
            score += match game.result.outcome.as_str() {
                "ochre" => 2,
                "draw" => 1,
                "indigo" => 0,
                value => panic!("competitive kernel returned invalid outcome {value}"),
            };
            for seat in 0..2 {
                for (index, count) in game.seats[seat].purchases.iter().enumerate() {
                    purchases[seat][index] += u32::try_from(*count).expect("nonnegative purchases");
                }
                for (family, total) in damage[seat].iter_mut().enumerate() {
                    *total += u32::try_from(game.seats[seat].family_damage[family])
                        .expect("nonnegative damage");
                }
            }
        }
        points.push(score);
    }
    PairResult {
        first: first.number,
        second: second.number,
        points,
        purchases,
        damage,
    }
}

fn make_header(
    kind: u32,
    row_bytes: u32,
    top: usize,
    row_count: usize,
    rows: &[u8],
    source_checksum: u32,
    fingerprint: &str,
) -> Header {
    Header {
        kind,
        row_bytes,
        range_start: 0,
        range_end: top as u32,
        row_count: row_count as u32,
        row_crc: crc32(rows),
        source_checksum,
        seeds: [FIRST_MATRIX_SEED, LAST_MATRIX_SEED, 0, 0],
        rule_fingerprint: fingerprint.to_owned(),
    }
}

fn write_file(path: &Path, header: &Header, rows: &[u8]) -> Result<usize, String> {
    let mut bytes = Vec::with_capacity(HEADER_BYTES + rows.len());
    bytes.extend_from_slice(&header.encode()?);
    bytes.extend_from_slice(rows);
    fs::write(path, &bytes).map_err(|error| format!("write {}: {error}", path.display()))?;
    Ok(bytes.len())
}

fn pair_rows(results: &[PairResult]) -> Vec<u8> {
    let mut rows = Vec::with_capacity(results.len() * PAIRS_ROW_BYTES as usize);
    for result in results {
        rows.extend_from_slice(&result.first.to_le_bytes());
        rows.extend_from_slice(&result.second.to_le_bytes());
        rows.extend_from_slice(&result.points);
    }
    rows
}

fn purchase_rows(results: &[PairResult]) -> Vec<u8> {
    let card_count = results
        .first()
        .map(|result| result.purchases[0].len())
        .unwrap_or(0);
    let row_bytes = 8 + card_count * 4 + 20;
    let mut rows = Vec::with_capacity(results.len() * 2 * row_bytes);
    for result in results {
        for seat in 0..2 {
            let (strategy, partner) = if seat == 0 {
                (result.first, result.second)
            } else {
                (result.second, result.first)
            };
            rows.extend_from_slice(&strategy.to_le_bytes());
            rows.extend_from_slice(&partner.to_le_bytes());
            for count in &result.purchases[seat] {
                rows.extend_from_slice(&count.to_le_bytes());
            }
            for damage in result.damage[seat] {
                rows.extend_from_slice(&damage.to_le_bytes());
            }
        }
    }
    rows
}

fn matrix_values(
    results: &[PairResult],
    numbers: &[u32],
) -> Result<(Vec<Vec<f64>>, Vec<f64>), String> {
    let size = numbers.len();
    let mut sums = vec![vec![150u16; size]; size];
    let mut pair = 0;
    for first in 0..size {
        for second in first + 1..size {
            let result = results.get(pair).ok_or("pair rows end early")?;
            if result.first != numbers[first] || result.second != numbers[second] {
                return Err("pair rows are not in reservoir rank order".into());
            }
            let total = result.points[..MATRIX_SHUFFLES]
                .iter()
                .map(|value| u16::from(*value))
                .sum::<u16>();
            sums[first][second] = total;
            sums[second][first] = 300 - total;
            pair += 1;
        }
    }
    if pair != results.len() {
        return Err("pair rows have trailing entries".into());
    }
    let percentages = sums
        .iter()
        .map(|row| row.iter().map(|sum| f64::from(*sum) / 3.0).collect())
        .collect::<Vec<Vec<f64>>>();
    let payoff = sums
        .iter()
        .map(|row| {
            row.iter()
                .map(|sum| (2.0 * f64::from(*sum) - 300.0) / 300.0)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    let mut order = (0..size).collect::<Vec<_>>();
    order.sort_by_key(|index| numbers[*index]);
    let sorted_payoff = order
        .iter()
        .map(|row| order.iter().map(|column| payoff[*row][*column]).collect())
        .collect::<Vec<Vec<f64>>>();
    let sorted_weights = solve_maximum_support(&sorted_payoff)?;
    let mut weights = vec![0.0; size];
    for (sorted_index, rank) in order.iter().enumerate() {
        weights[*rank] = sorted_weights[sorted_index];
    }
    verify_mix(&payoff, &weights)?;
    Ok((percentages, weights))
}

fn matrix_rows(numbers: &[u32], percentages: &[Vec<f64>], weights: &[f64]) -> Vec<u8> {
    let row_bytes = 4 + numbers.len() * 8 + 8;
    let mut rows = Vec::with_capacity(numbers.len() * row_bytes);
    for rank in 0..numbers.len() {
        rows.extend_from_slice(&numbers[rank].to_le_bytes());
        for value in &percentages[rank] {
            rows.extend_from_slice(&value.to_le_bytes());
        }
        rows.extend_from_slice(&weights[rank].to_le_bytes());
    }
    rows
}

fn read_checked_file(path: &Path, expected: &Header) -> Result<(Header, Vec<u8>), String> {
    let bytes = fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    let header = Header::decode(&bytes)?;
    if header.kind != expected.kind
        || header.row_bytes != expected.row_bytes
        || header.range_start != expected.range_start
        || header.range_end != expected.range_end
        || header.row_count != expected.row_count
        || header.source_checksum != expected.source_checksum
        || header.seeds != expected.seeds
        || header.rule_fingerprint != expected.rule_fingerprint
    {
        return Err(format!(
            "{} header differs from expected values",
            path.display()
        ));
    }
    let expected_len = HEADER_BYTES + header.row_count as usize * header.row_bytes as usize;
    if bytes.len() != expected_len {
        return Err(format!("{} row length is invalid", path.display()));
    }
    let rows = bytes[HEADER_BYTES..].to_vec();
    if crc32(&rows) != header.row_crc {
        return Err(format!("{} CRC differs from its rows", path.display()));
    }
    Ok((header, rows))
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("u32 bytes"))
}

fn read_f64(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(bytes[offset..offset + 8].try_into().expect("f64 bytes"))
}

fn verify_files(
    kingdom: &LoadedKingdom,
    reservoir: &Reservoir,
    top: usize,
    pairs_path: &Path,
    purchases_path: &Path,
    matrix_path: &Path,
) -> Result<(), String> {
    let pair_count = top * (top - 1) / 2;
    let purchase_row_bytes = (8 + kingdom.card_ids.len() * 4 + 20) as u32;
    let matrix_row_bytes = (4 + top * 8 + 8) as u32;
    let base = |kind, row_bytes, row_count| Header {
        kind,
        row_bytes,
        range_start: 0,
        range_end: top as u32,
        row_count: row_count as u32,
        row_crc: 0,
        source_checksum: reservoir.source_checksum,
        seeds: [FIRST_MATRIX_SEED, LAST_MATRIX_SEED, 0, 0],
        rule_fingerprint: kingdom.fingerprint.clone(),
    };
    let (_, pair_bytes) =
        read_checked_file(pairs_path, &base(PAIRS_KIND, PAIRS_ROW_BYTES, pair_count))?;
    let (_, purchase_bytes) = read_checked_file(
        purchases_path,
        &base(PURCHASES_KIND, purchase_row_bytes, pair_count * 2),
    )?;
    let (_, matrix_bytes) =
        read_checked_file(matrix_path, &base(MATRIX_KIND, matrix_row_bytes, top))?;

    let strategies = reservoir
        .numbers
        .iter()
        .map(|number| decode_strategy(kingdom, *number))
        .collect::<Result<Vec<_>, _>>()?;
    let mut decoded_pairs = Vec::with_capacity(pair_count);
    let mut pair_index = 0;
    for first in 0..top {
        for second in first + 1..top {
            let offset = pair_index * PAIRS_ROW_BYTES as usize;
            let first_number = read_u32(&pair_bytes, offset);
            let second_number = read_u32(&pair_bytes, offset + 4);
            if first_number != reservoir.numbers[first]
                || second_number != reservoir.numbers[second]
            {
                return Err(
                    "pairs file order or strategy numbers differ from reservoir ranks".into(),
                );
            }
            let points = pair_bytes[offset + 8..offset + PAIRS_ROW_BYTES as usize].to_vec();
            if points.iter().any(|value| *value > 4) {
                return Err("pairs file contains a point byte above 4".into());
            }
            decoded_pairs.push(PairResult {
                first: first_number,
                second: second_number,
                points,
                purchases: [Vec::new(), Vec::new()],
                damage: [[0; 5]; 2],
            });
            for seat in 0..2 {
                let purchase_index = pair_index * 2 + seat;
                let purchase_offset = purchase_index * purchase_row_bytes as usize;
                let (strategy_rank, partner_rank) = if seat == 0 {
                    (first, second)
                } else {
                    (second, first)
                };
                if read_u32(&purchase_bytes, purchase_offset) != reservoir.numbers[strategy_rank]
                    || read_u32(&purchase_bytes, purchase_offset + 4)
                        != reservoir.numbers[partner_rank]
                {
                    return Err("purchases rows are not aligned with pairs rows".into());
                }
                let desired = &strategies[strategy_rank].desired;
                for (card, maximum) in desired.iter().enumerate() {
                    let count = read_u32(&purchase_bytes, purchase_offset + 8 + card * 4);
                    let id = &kingdom.card_ids[card];
                    if (*maximum == 0 && count != 0)
                        || ((id == "copper" || id == "scrap") && count != 0)
                        || count > 250 * maximum
                    {
                        return Err(format!(
                            "purchases count for strategy {} card {id} is invalid",
                            reservoir.numbers[strategy_rank]
                        ));
                    }
                }
                for family in 0..5 {
                    let offset = purchase_offset + 8 + kingdom.card_ids.len() * 4 + family * 4;
                    if read_u32(&purchase_bytes, offset) > 250 * 50 {
                        return Err("purchases family damage exceeds the game health bound".into());
                    }
                }
            }
            pair_index += 1;
        }
    }

    let (expected_percentages, expected_weights) =
        matrix_values(&decoded_pairs, &reservoir.numbers)?;
    for rank in 0..top {
        let offset = rank * matrix_row_bytes as usize;
        if read_u32(&matrix_bytes, offset) != reservoir.numbers[rank] {
            return Err("matrix strategy numbers differ from reservoir rank order".into());
        }
        for (column, expected) in expected_percentages[rank].iter().enumerate() {
            let actual = read_f64(&matrix_bytes, offset + 4 + column * 8);
            if actual.to_bits() != expected.to_bits() {
                return Err(format!(
                    "matrix cell {rank},{column} differs from pairs file"
                ));
            }
            if rank == column && actual.to_bits() != 50.0f64.to_bits() {
                return Err("matrix diagonal is not exactly 50%".into());
            }
        }
        let actual_weight = read_f64(&matrix_bytes, offset + 4 + top * 8);
        if actual_weight.to_bits() != expected_weights[rank].to_bits() {
            return Err(format!(
                "matrix weight at rank {rank} differs from the solved mix"
            ));
        }
    }
    let payoff = expected_percentages
        .iter()
        .map(|row| row.iter().map(|value| (value - 50.0) / 50.0).collect())
        .collect::<Vec<Vec<f64>>>();
    verify_mix(&payoff, &expected_weights)?;
    Ok(())
}

#[derive(Default)]
struct Options {
    kingdom_file: Option<PathBuf>,
    reservoir: Option<PathBuf>,
    out: Option<PathBuf>,
    threads: Option<usize>,
    top: Option<usize>,
    report: Option<PathBuf>,
}

fn parse_options(command: &str, args: &[String]) -> Result<(Options, bool), String> {
    let mut options = Options::default();
    let mut index = 0;
    while index < args.len() {
        let name = &args[index];
        let value = args
            .get(index + 1)
            .filter(|value| !value.starts_with("--"))
            .ok_or_else(|| format!("{name} needs a value"))?;
        match name.as_str() {
            "--kingdom-file" if options.kingdom_file.is_none() => {
                options.kingdom_file = Some(PathBuf::from(value))
            }
            "--reservoir" if options.reservoir.is_none() => {
                options.reservoir = Some(PathBuf::from(value))
            }
            "--out" if options.out.is_none() => options.out = Some(PathBuf::from(value)),
            "--threads" if command == "matrix" && options.threads.is_none() => {
                options.threads = Some(
                    value
                        .parse()
                        .map_err(|_| "--threads must be a positive integer")?,
                )
            }
            "--top" if options.top.is_none() => {
                options.top = Some(
                    value
                        .parse()
                        .map_err(|_| "--top must be an integer of at least 2")?,
                )
            }
            "--report" if command == "matrix" && options.report.is_none() => {
                options.report = Some(PathBuf::from(value))
            }
            _ => return Err(format!("unknown or repeated {command} option {name}")),
        }
        index += 2;
    }
    let explicit_top = options.top.is_some();
    let top = options.top.unwrap_or(DEFAULT_TOP);
    if top < 2 || top > u32::MAX as usize {
        return Err("--top must be an integer of at least 2".into());
    }
    options.top = Some(top);
    if options.kingdom_file.is_none() || options.reservoir.is_none() || options.out.is_none() {
        return Err(format!(
            "{command} requires --kingdom-file, --reservoir, and --out"
        ));
    }
    if command == "matrix" && options.threads.unwrap_or(0) == 0 {
        return Err("matrix requires a positive --threads value".into());
    }
    Ok((options, explicit_top))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunReport {
    command: &'static str,
    kingdom_id: String,
    threads: usize,
    strategy_count: usize,
    pair_count: usize,
    game_count: usize,
    elapsed_ms: f64,
    read_ms: f64,
    play_ms: f64,
    write_ms: f64,
    solve_ms: f64,
    verify_ms: f64,
    games_per_second: f64,
    bytes_read: usize,
    bytes_written: usize,
}

fn elapsed_ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            held => normalized.push(held.as_os_str()),
        }
    }
    normalized
}

fn resolve_path(path: &Path) -> Result<PathBuf, String> {
    let mut cursor = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("resolve current directory: {error}"))?
            .join(path)
    };
    let mut missing = Vec::new();
    loop {
        if let Ok(mut canonical) = fs::canonicalize(&cursor) {
            for component in missing.iter().rev() {
                canonical.push(component);
            }
            return Ok(normalize_path(&canonical));
        }
        let component = cursor
            .components()
            .next_back()
            .ok_or_else(|| format!("resolve path {}", path.display()))?;
        missing.push(component.as_os_str().to_os_string());
        if !cursor.pop() {
            return Err(format!("resolve path {}", path.display()));
        }
    }
}

fn reject_evidence_report_path(out: &Path, report: Option<&Path>) -> Result<(), String> {
    let Some(report) = report else {
        return Ok(());
    };
    let report = resolve_path(report)?;
    for name in ["pairs.hgm", "purchases.hgm", "matrix.hgm"] {
        if report == resolve_path(&out.join(name))? {
            return Err(format!("--report must not resolve to {name} under --out"));
        }
    }
    Ok(())
}

fn run_matrix(options: Options, explicit_top: bool) -> Result<(), String> {
    let kingdom_path = options.kingdom_file.expect("required kingdom");
    let reservoir_path = options.reservoir.expect("required reservoir");
    let out = options.out.expect("required out");
    let threads = options.threads.expect("required threads");
    let top = options.top.expect("defaulted top");
    let report_path = options.report;
    reject_evidence_report_path(&out, report_path.as_deref())?;
    let started = Instant::now();
    let read_started = Instant::now();
    let kingdom = load_kingdom(&kingdom_path)?;
    let reservoir = read_reservoir(&reservoir_path, &kingdom, top, explicit_top)?;
    let strategies = reservoir
        .numbers
        .iter()
        .map(|number| decode_strategy(&kingdom, *number))
        .collect::<Result<Vec<_>, _>>()?;
    let read_ms = elapsed_ms(read_started);

    let pairs = (0..top)
        .flat_map(|first| (first + 1..top).map(move |second| (first, second)))
        .collect::<Vec<_>>();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .map_err(|error| format!("build matrix thread pool: {error}"))?;
    let play_started = Instant::now();
    let results = pool.install(|| {
        pairs
            .par_iter()
            .map(|(first, second)| {
                play_pair_with_kingdom(&kingdom.kernel, &strategies[*first], &strategies[*second])
            })
            .collect::<Vec<_>>()
    });
    let play_ms = elapsed_ms(play_started);

    fs::create_dir_all(&out).map_err(|error| format!("create output directory: {error}"))?;
    let pairs_tmp = out.join("pairs.hgm.tmp");
    let purchases_tmp = out.join("purchases.hgm.tmp");
    let matrix_tmp = out.join("matrix.hgm.tmp");
    let write_started = Instant::now();
    let pair_bytes = pair_rows(&results);
    let pair_header = make_header(
        PAIRS_KIND,
        PAIRS_ROW_BYTES,
        top,
        results.len(),
        &pair_bytes,
        reservoir.source_checksum,
        &kingdom.fingerprint,
    );
    let mut bytes_written = write_file(&pairs_tmp, &pair_header, &pair_bytes)?;
    let purchases = purchase_rows(&results);
    let purchase_row_bytes = (8 + kingdom.card_ids.len() * 4 + 20) as u32;
    let purchase_header = make_header(
        PURCHASES_KIND,
        purchase_row_bytes,
        top,
        results.len() * 2,
        &purchases,
        reservoir.source_checksum,
        &kingdom.fingerprint,
    );
    bytes_written += write_file(&purchases_tmp, &purchase_header, &purchases)?;
    let mut write_ms = elapsed_ms(write_started);

    let solve_started = Instant::now();
    let (percentages, weights) = matrix_values(&results, &reservoir.numbers)?;
    let rows = matrix_rows(&reservoir.numbers, &percentages, &weights);
    let solve_ms = elapsed_ms(solve_started);
    let matrix_header = make_header(
        MATRIX_KIND,
        (4 + top * 8 + 8) as u32,
        top,
        top,
        &rows,
        reservoir.source_checksum,
        &kingdom.fingerprint,
    );
    let matrix_write_started = Instant::now();
    bytes_written += write_file(&matrix_tmp, &matrix_header, &rows)?;
    write_ms += elapsed_ms(matrix_write_started);

    let verify_started = Instant::now();
    verify_files(
        &kingdom,
        &reservoir,
        top,
        &pairs_tmp,
        &purchases_tmp,
        &matrix_tmp,
    )?;
    let verify_ms = elapsed_ms(verify_started);
    fs::rename(&pairs_tmp, out.join("pairs.hgm"))
        .map_err(|error| format!("publish pairs file: {error}"))?;
    fs::rename(&purchases_tmp, out.join("purchases.hgm"))
        .map_err(|error| format!("publish purchases file: {error}"))?;
    fs::rename(&matrix_tmp, out.join("matrix.hgm"))
        .map_err(|error| format!("publish matrix file: {error}"))?;

    let elapsed_ms = elapsed_ms(started);
    let game_count = pairs.len() * SHUFFLE_COUNT * 2;
    let report = RunReport {
        command: "matrix",
        kingdom_id: kingdom.id,
        threads,
        strategy_count: top,
        pair_count: pairs.len(),
        game_count,
        elapsed_ms,
        read_ms,
        play_ms,
        write_ms,
        solve_ms,
        verify_ms,
        games_per_second: game_count as f64 / (play_ms / 1000.0),
        bytes_read: fs::metadata(&kingdom_path)
            .map_err(|error| format!("read kingdom metadata: {error}"))?
            .len() as usize
            + reservoir.bytes,
        bytes_written,
    };
    if let Some(report_path) = report_path {
        if let Some(parent) = report_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("create report directory: {error}"))?;
        }
        let mut bytes = serde_json::to_vec(&report).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        fs::write(&report_path, bytes).map_err(|error| format!("write run report: {error}"))?;
    }
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "command": "matrix",
            "strategyCount": top,
            "pairCount": pairs.len(),
            "gameCount": game_count,
            "gamesPerSecond": report.games_per_second,
        }))
        .map_err(|error| error.to_string())?
    );
    Ok(())
}

fn run_verify(options: Options, explicit_top: bool) -> Result<(), String> {
    let kingdom = load_kingdom(&options.kingdom_file.expect("required kingdom"))?;
    let top = options.top.expect("defaulted top");
    let reservoir = read_reservoir(
        &options.reservoir.expect("required reservoir"),
        &kingdom,
        top,
        explicit_top,
    )?;
    let out = options.out.expect("required out");
    verify_files(
        &kingdom,
        &reservoir,
        top,
        &out.join("pairs.hgm"),
        &out.join("purchases.hgm"),
        &out.join("matrix.hgm"),
    )?;
    println!(
        "{}",
        serde_json::json!({"command": "matrix-verify", "strategyCount": top})
    );
    Ok(())
}

pub(crate) fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let command = args.next().ok_or("matrix subcommand is missing")?;
    let held = args.collect::<Vec<_>>();
    let (options, explicit_top) = parse_options(&command, &held)?;
    match command.as_str() {
        "matrix" => run_matrix(options, explicit_top),
        "matrix-verify" => run_verify(options, explicit_top),
        _ => Err(format!("unknown matrix subcommand {command}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::{
        CompetitiveBlockInput, CompetitiveLoadInput, CompetitiveScoreInput, load_competitive,
        score_competitive,
    };

    fn fixture_kingdom() -> LoadedKingdom {
        load_kingdom(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/balance-tuning-005.json"),
        )
        .expect("fixture kingdom")
    }

    #[test]
    fn crc_matches_standard_vector() {
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    }

    #[test]
    fn header_round_trip() {
        let header = Header {
            kind: PAIRS_KIND,
            row_bytes: PAIRS_ROW_BYTES,
            range_start: 0,
            range_end: 50,
            row_count: 1_225,
            row_crc: 123,
            source_checksum: 456,
            seeds: [FIRST_MATRIX_SEED, LAST_MATRIX_SEED, 0, 0],
            rule_fingerprint: "b7eaecb3cdb".into(),
        };
        let decoded = Header::decode(&header.encode().expect("header bytes")).expect("header");
        assert_eq!(decoded.kind, header.kind);
        assert_eq!(decoded.row_bytes, header.row_bytes);
        assert_eq!(decoded.row_count, header.row_count);
        assert_eq!(decoded.seeds, header.seeds);
        assert_eq!(decoded.rule_fingerprint, header.rule_fingerprint);
    }

    #[test]
    fn mapping_matches_balance_tuning_fixture_pins() {
        let kingdom = fixture_kingdom();
        for (number, expected) in [
            (
                0,
                vec![
                    ("cascade", 1),
                    ("channel", 1),
                    ("flurry", 1),
                    ("focus", 3),
                    ("gold", 3),
                ],
            ),
            (
                1,
                vec![
                    ("cascade", 1),
                    ("channel", 1),
                    ("flurry", 2),
                    ("focus", 3),
                    ("gold", 3),
                ],
            ),
            (
                53,
                vec![
                    ("cascade", 4),
                    ("channel", 4),
                    ("flurry", 1),
                    ("focus", 3),
                    ("gold", 3),
                ],
            ),
            (
                54,
                vec![
                    ("cascade", 1),
                    ("channel", 1),
                    ("flurry", 1),
                    ("focus", 3),
                    ("heavyBlow", 3),
                ],
            ),
            (
                1_000_000,
                vec![
                    ("channel", 2),
                    ("flurry", 4),
                    ("cascade", 1),
                    ("overload", 3),
                    ("strike", 3),
                ],
            ),
            (
                6_486_479,
                vec![
                    ("overload", 4),
                    ("volley", 4),
                    ("strike", 1),
                    ("step", 3),
                    ("starfire", 3),
                ],
            ),
            (
                12_972_959,
                vec![
                    ("volley", 4),
                    ("strike", 4),
                    ("step", 1),
                    ("starfire", 3),
                    ("silver", 3),
                ],
            ),
        ] {
            decode_strategy(&kingdom, number).expect("decode strategy");
            let quantities = quantity_vectors();
            let cards =
                ordered_permutation_at(&kingdom.ordered_card_ids, number / quantities.len() as u32)
                    .expect("strategy cards");
            let counts = quantities[(number % quantities.len() as u32) as usize];
            let actual = cards
                .iter()
                .zip(counts)
                .map(|(id, count)| (id.as_str(), count))
                .collect::<Vec<_>>();
            assert_eq!(actual, expected, "strategy {number}");
        }
    }

    #[test]
    fn pair_scores_match_competitive_batch_for_all_shuffles() {
        let kingdom = fixture_kingdom();
        let raw = [0, 1_000_000, 12_972_959].map(|number| {
            let quantities = quantity_vectors();
            let cards =
                ordered_permutation_at(&kingdom.ordered_card_ids, number / quantities.len() as u32)
                    .expect("cards");
            let quantity = quantities[(number % quantities.len() as u32) as usize];
            let mut buy_plan = cards
                .iter()
                .zip(quantity)
                .map(|(card_id, desired_count)| RawSlot::Buy {
                    card_id: card_id.clone(),
                    desired_count,
                })
                .collect::<Vec<_>>();
            buy_plan.extend((0..5).map(|_| RawSlot::Inactive));
            RawStrategy {
                id: format!("gf-{number}"),
                canonical_strategy: format!("gf-{number}"),
                starting_build: Vec::new(),
                buy_plan,
            }
        });
        let session = load_competitive(CompetitiveLoadInput {
            protocol_version: 1,
            scorer_version: "native-competitive-v1".into(),
            load_id: "matrix-pair-test".into(),
            rule_fingerprint: kingdom.fingerprint.clone(),
            kingdom: serde_json::from_str::<KingdomDocument>(include_str!(
                "../fixtures/balance-tuning-005.json"
            ))
            .expect("fixture")
            .kingdom,
            strategies: raw.to_vec(),
            turn_limit_per_player: TURN_LIMIT,
            action_cap_per_turn: ACTION_CAP,
            starting_draft_enabled: false,
            infinite_count: 99,
            first_player_health_penalty: 3,
            threads: 1,
            cpu_request: 1,
        })
        .expect("competitive session");
        let blocks = (0..SHUFFLE_COUNT)
            .flat_map(|index| {
                [(0, 1), (1, 2)].map(move |(candidate_index, opponent_index)| {
                    CompetitiveBlockInput {
                        candidate_index,
                        opponent_index,
                        seed: FIRST_MATRIX_SEED + index as u32,
                    }
                })
            })
            .collect::<Vec<_>>();
        let expected = score_competitive(
            &session,
            CompetitiveScoreInput {
                load_id: "matrix-pair-test".into(),
                blocks,
            },
        )
        .expect("batch score")
        .score_bytes;
        let results = [(0, 1), (1, 2)]
            .map(|(first, second)| {
                let first =
                    decode_strategy(&kingdom, [0, 1_000_000, 12_972_959][first]).expect("first");
                let second =
                    decode_strategy(&kingdom, [0, 1_000_000, 12_972_959][second]).expect("second");
                play_pair_with_kingdom(&kingdom.kernel, &first, &second)
            })
            .to_vec();
        let rows = pair_rows(&results);
        let path = std::env::temp_dir().join(format!(
            "hexdeck-pair-parity-{}-{}.hgm",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let header = make_header(
            PAIRS_KIND,
            PAIRS_ROW_BYTES,
            3,
            results.len(),
            &rows,
            0,
            &kingdom.fingerprint,
        );
        write_file(&path, &header, &rows).expect("write pairs file");
        let written = fs::read(&path).expect("read pairs file");
        fs::remove_file(path).expect("remove pairs file");
        for pair_index in 0..results.len() {
            let expected = expected
                .iter()
                .skip(pair_index)
                .step_by(results.len())
                .copied()
                .collect::<Vec<_>>();
            let offset = HEADER_BYTES + pair_index * PAIRS_ROW_BYTES as usize + 8;
            assert_eq!(
                &written[offset..offset + SHUFFLE_COUNT],
                expected.as_slice()
            );
        }
    }

    fn fixture_reservoir_bytes() -> Vec<u8> {
        let fingerprint = "b7eaecb3cdb";
        let row_count = 60usize;
        let mut numbers = vec![
            9_597_038, 10_927_691, 5_155_614, 5_426_963, 4_034_976, 5_715_683,
        ];
        let mut position = 0u64;
        while numbers.len() < row_count {
            let number = ((position * 1_000_003 + 7_654_321) % CANDIDATE_COUNT as u64) as u32;
            if !numbers.contains(&number) {
                numbers.push(number);
            }
            position += 1;
        }
        let mut rows = vec![0u8; row_count * RESERVOIR_ROW_BYTES as usize];
        for (rank, number) in numbers.into_iter().enumerate() {
            let offset = rank * RESERVOIR_ROW_BYTES as usize;
            rows[offset..offset + 4].copy_from_slice(&number.to_le_bytes());
        }
        let header = Header {
            kind: RESERVOIR_KIND,
            row_bytes: RESERVOIR_ROW_BYTES,
            range_start: 0,
            range_end: 500_000,
            row_count: row_count as u32,
            row_crc: crc32(&rows),
            source_checksum: 0,
            seeds: GOLDFISH_SEEDS,
            rule_fingerprint: fingerprint.into(),
        };
        let mut bytes = header.encode().expect("reservoir header").to_vec();
        bytes.extend(rows);
        bytes
    }

    #[test]
    fn committed_reservoir_fixture_is_exact() {
        assert_eq!(
            fixture_reservoir_bytes(),
            include_bytes!("../fixtures/balance-tuning-005-reservoir.hgf")
        );
    }
}
