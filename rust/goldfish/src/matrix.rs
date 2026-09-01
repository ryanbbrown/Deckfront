use crate::equilibrium::{solve_maximum_support, verify_mix};
use crate::kernel::{Kingdom, competitive_game};
use crate::reservoir::{
    DecodedStrategy, LoadedKingdom, ReservoirSelection, decode_strategy, load_kingdom,
    read_reservoir_selection,
};
use crate::self_play::{self, Source as SelfPlaySource};
use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

const MAGIC: &[u8; 4] = b"HGR1";
const HEADER_BYTES: usize = 64;
pub(crate) const PAIRS_KIND: u32 = 5;
pub(crate) const PURCHASES_KIND: u32 = 6;
pub(crate) const MATRIX_KIND: u32 = 7;
pub(crate) const PAIRS_ROW_BYTES: u32 = 133;
const DEFAULT_TOP: usize = 50;
const SHUFFLE_COUNT: usize = 125;
const MATRIX_SHUFFLES: usize = 75;
pub(crate) const FIRST_MATRIX_SEED: u32 = 4_200_001;
pub(crate) const LAST_MATRIX_SEED: u32 = 4_200_125;
const TURN_LIMIT: i16 = 30;
const ACTION_CAP: i16 = 200;

#[derive(Clone, Debug)]
pub(crate) struct Header {
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
    pub(crate) fn encode(&self) -> Result<[u8; HEADER_BYTES], String> {
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

pub(crate) fn crc32(bytes: &[u8]) -> u32 {
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

#[derive(Clone)]
pub(crate) struct PairResult {
    pub(crate) first: u32,
    pub(crate) second: u32,
    pub(crate) points: Vec<u8>,
    pub(crate) purchases: [Vec<u32>; 2],
    pub(crate) damage: [[u32; 5]; 2],
}

pub(crate) fn play_pair_with_kingdom(
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

pub(crate) fn make_header(
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

pub(crate) fn pair_rows(results: &[PairResult]) -> Vec<u8> {
    let mut rows = Vec::with_capacity(results.len() * PAIRS_ROW_BYTES as usize);
    for result in results {
        rows.extend_from_slice(&result.first.to_le_bytes());
        rows.extend_from_slice(&result.second.to_le_bytes());
        rows.extend_from_slice(&result.points);
    }
    rows
}

pub(crate) fn purchase_rows(results: &[PairResult]) -> Vec<u8> {
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

pub(crate) fn matrix_values(
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

pub(crate) fn matrix_rows(numbers: &[u32], percentages: &[Vec<f64>], weights: &[f64]) -> Vec<u8> {
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

pub(crate) fn verify_files(
    kingdom: &LoadedKingdom,
    reservoir: &ReservoirSelection,
    top: usize,
    pairs_path: &Path,
    purchases_path: &Path,
    matrix_path: &Path,
) -> Result<(), String> {
    let pair_count = top * (top - 1) / 2;
    let purchase_row_bytes = (8 + kingdom.all_card_ids.len() * 4 + 20) as u32;
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
                    let id = &kingdom.all_card_ids[card];
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
                    let offset = purchase_offset + 8 + kingdom.all_card_ids.len() * 4 + family * 4;
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

pub(crate) struct MatrixStructure {
    pub(crate) row_crcs: [u32; 3],
}

pub(crate) fn load_matrix_structure(
    kingdom: &LoadedKingdom,
    reservoir_crc: u32,
    expected_numbers: &[u32],
    directory: &Path,
) -> Result<MatrixStructure, String> {
    let top = expected_numbers.len();
    let pair_count = top * (top - 1) / 2;
    let purchase_row_bytes = (8 + kingdom.all_card_ids.len() * 4 + 20) as u32;
    let matrix_row_bytes = (4 + top * 8 + 8) as u32;
    let expected = |kind, row_bytes, row_count| Header {
        kind,
        row_bytes,
        range_start: 0,
        range_end: top as u32,
        row_count: row_count as u32,
        row_crc: 0,
        source_checksum: reservoir_crc,
        seeds: [FIRST_MATRIX_SEED, LAST_MATRIX_SEED, 0, 0],
        rule_fingerprint: kingdom.fingerprint.clone(),
    };
    let (pairs, _) = read_checked_file(
        &directory.join("pairs.hgm"),
        &expected(PAIRS_KIND, PAIRS_ROW_BYTES, pair_count),
    )?;
    let (purchases, _) = read_checked_file(
        &directory.join("purchases.hgm"),
        &expected(PURCHASES_KIND, purchase_row_bytes, pair_count * 2),
    )?;
    let (matrix, rows) = read_checked_file(
        &directory.join("matrix.hgm"),
        &expected(MATRIX_KIND, matrix_row_bytes, top),
    )?;
    let numbers = (0..top)
        .map(|row| read_u32(&rows, row * matrix_row_bytes as usize))
        .collect::<Vec<_>>();
    if numbers != expected_numbers {
        return Err(format!(
            "{} matrix strategy order differs from its selected source",
            directory.display()
        ));
    }
    Ok(MatrixStructure {
        row_crcs: [pairs.row_crc, purchases.row_crc, matrix.row_crc],
    })
}

pub(crate) struct MatrixEvidence {
    pub(crate) pairs: Vec<PairResult>,
    pub(crate) weights: Vec<f64>,
    pub(crate) row_crcs: [u32; 3],
}

pub(crate) fn self_play_source(
    reservoir_crc: u32,
    row_crcs: [u32; 3],
    generation: u32,
    fingerprint: &str,
) -> SelfPlaySource {
    SelfPlaySource {
        reservoir_crc,
        pairs_crc: row_crcs[0],
        purchases_crc: row_crcs[1],
        matrix_crc: row_crcs[2],
        generation,
        fingerprint: fingerprint.to_owned(),
    }
}

pub(crate) fn load_matrix_evidence(
    kingdom: &LoadedKingdom,
    reservoir: &ReservoirSelection,
    top: usize,
    directory: &Path,
) -> Result<MatrixEvidence, String> {
    let pair_count = top * (top - 1) / 2;
    let purchase_row_bytes = (8 + kingdom.all_card_ids.len() * 4 + 20) as u32;
    let matrix_row_bytes = (4 + top * 8 + 8) as u32;
    let expected = |kind, row_bytes, row_count| Header {
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
    let (pairs_header, pair_bytes) = read_checked_file(
        &directory.join("pairs.hgm"),
        &expected(PAIRS_KIND, PAIRS_ROW_BYTES, pair_count),
    )?;
    let (purchases_header, purchase_bytes) = read_checked_file(
        &directory.join("purchases.hgm"),
        &expected(PURCHASES_KIND, purchase_row_bytes, pair_count * 2),
    )?;
    let (matrix_header, matrix_bytes) = read_checked_file(
        &directory.join("matrix.hgm"),
        &expected(MATRIX_KIND, matrix_row_bytes, top),
    )?;
    verify_files(
        kingdom,
        reservoir,
        top,
        &directory.join("pairs.hgm"),
        &directory.join("purchases.hgm"),
        &directory.join("matrix.hgm"),
    )?;
    let mut pairs = Vec::with_capacity(pair_count);
    for pair_index in 0..pair_count {
        let pair_offset = pair_index * PAIRS_ROW_BYTES as usize;
        let mut purchases = [
            vec![0; kingdom.all_card_ids.len()],
            vec![0; kingdom.all_card_ids.len()],
        ];
        let mut damage = [[0; 5]; 2];
        for seat in 0..2 {
            let offset = (pair_index * 2 + seat) * purchase_row_bytes as usize;
            for (card, count) in purchases[seat].iter_mut().enumerate() {
                *count = read_u32(&purchase_bytes, offset + 8 + card * 4);
            }
            for (family, total) in damage[seat].iter_mut().enumerate() {
                *total = read_u32(
                    &purchase_bytes,
                    offset + 8 + kingdom.all_card_ids.len() * 4 + family * 4,
                );
            }
        }
        pairs.push(PairResult {
            first: read_u32(&pair_bytes, pair_offset),
            second: read_u32(&pair_bytes, pair_offset + 4),
            points: pair_bytes[pair_offset + 8..pair_offset + PAIRS_ROW_BYTES as usize].to_vec(),
            purchases,
            damage,
        });
    }
    let weights = (0..top)
        .map(|rank| {
            read_f64(
                &matrix_bytes,
                rank * matrix_row_bytes as usize + 4 + top * 8,
            )
        })
        .collect();
    Ok(MatrixEvidence {
        pairs,
        weights,
        row_crcs: [
            pairs_header.row_crc,
            purchases_header.row_crc,
            matrix_header.row_crc,
        ],
    })
}

#[derive(Default)]
struct Options {
    kingdom: Option<String>,
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
            "--kingdom" if options.kingdom.is_none() => options.kingdom = Some(value.clone()),
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
    if options.kingdom.is_none() || options.reservoir.is_none() || options.out.is_none() {
        return Err(format!(
            "{command} requires --kingdom, --reservoir, and --out"
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
    for name in [
        "pairs.hgm",
        "purchases.hgm",
        "matrix.hgm",
        self_play::FILE_NAME,
    ] {
        if report == resolve_path(&out.join(name))? {
            return Err(format!("--report must not resolve to {name} under --out"));
        }
    }
    Ok(())
}

fn run_matrix(options: Options, explicit_top: bool) -> Result<(), String> {
    let kingdom_id = options.kingdom.expect("required kingdom");
    let reservoir_path = options.reservoir.expect("required reservoir");
    let out = options.out.expect("required out");
    let threads = options.threads.expect("required threads");
    let top = options.top.expect("defaulted top");
    let report_path = options.report;
    reject_evidence_report_path(&out, report_path.as_deref())?;
    let started = Instant::now();
    let read_started = Instant::now();
    let kingdom = load_kingdom(&kingdom_id)?;
    let reservoir = read_reservoir_selection(&reservoir_path, &kingdom, top, explicit_top)?;
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
                play_pair_with_kingdom(&kingdom.kingdom, &strategies[*first], &strategies[*second])
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
    let purchase_row_bytes = (8 + kingdom.all_card_ids.len() * 4 + 20) as u32;
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
    let self_play_rows = self_play::play_rows(&kingdom.kingdom, &strategies, &pool);
    let self_play_path = out.join(self_play::FILE_NAME);
    let self_play_tmp = self_play::write_temporary(
        &self_play_path,
        &self_play_rows,
        kingdom.all_card_ids.len(),
        &self_play_source(
            reservoir.source_checksum,
            [
                pair_header.row_crc,
                purchase_header.row_crc,
                matrix_header.row_crc,
            ],
            0,
            &kingdom.fingerprint,
        ),
    )?;
    bytes_written += fs::metadata(&self_play_tmp)
        .map_err(|error| format!("read self-play output size: {error}"))?
        .len() as usize;
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
    self_play::publish_temporary(&self_play_tmp, &self_play_path)?;
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
        bytes_read: usize::try_from(reservoir.bytes).unwrap_or(usize::MAX),
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
    let kingdom = load_kingdom(&options.kingdom.expect("required kingdom"))?;
    let top = options.top.expect("defaulted top");
    let reservoir = read_reservoir_selection(
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
    let evidence = load_matrix_evidence(&kingdom, &reservoir, top, &out)?;
    let self_play_rows = self_play::read(
        &out.join(self_play::FILE_NAME),
        &reservoir.numbers,
        kingdom.all_card_ids.len(),
        &self_play_source(
            reservoir.source_checksum,
            evidence.row_crcs,
            0,
            &kingdom.fingerprint,
        ),
    )?;
    let strategies = reservoir
        .numbers
        .iter()
        .map(|number| decode_strategy(&kingdom, *number))
        .collect::<Result<Vec<_>, _>>()?;
    self_play::verify_strategy_bounds(&self_play_rows, &strategies, &kingdom.all_card_ids)?;
    println!(
        "{}",
        serde_json::json!({"command": "matrix-verify", "strategyCount": top})
    );
    Ok(())
}

pub(crate) fn run(command: &str, args: &[String]) -> Result<(), String> {
    let (options, explicit_top) = parse_options(command, args)?;
    match command {
        "matrix" => run_matrix(options, explicit_top),
        "matrix-verify" => run_verify(options, explicit_top),
        _ => Err(format!("unknown matrix subcommand {command}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::{
        CompetitiveBlockInput, CompetitiveLoadInput, CompetitiveScoreInput, RawSlot,
        load_competitive, score_competitive,
    };
    use crate::reservoir::{kingdom_input, raw_strategy_for};

    fn fixture_kingdom() -> LoadedKingdom {
        load_kingdom("balance-tuning-005").expect("embedded fixture kingdom")
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
            let raw = raw_strategy_for(&kingdom, number).expect("decode strategy");
            let actual = raw
                .buy_plan
                .iter()
                .filter_map(|slot| match slot {
                    RawSlot::Buy {
                        card_id,
                        desired_count,
                    } => Some((card_id.as_str(), *desired_count)),
                    _ => None,
                })
                .collect::<Vec<_>>();
            assert_eq!(actual, expected, "strategy {number}");
        }
    }

    #[test]
    fn pair_scores_match_competitive_batch_for_all_shuffles() {
        let kingdom = fixture_kingdom();
        let raw = [0, 1_000_000, 12_972_959]
            .map(|number| raw_strategy_for(&kingdom, number).expect("raw strategy"));
        let session = load_competitive(CompetitiveLoadInput {
            protocol_version: 1,
            scorer_version: "native-competitive-v1".into(),
            load_id: "matrix-pair-test".into(),
            rule_fingerprint: kingdom.fingerprint.clone(),
            kingdom: kingdom_input("balance-tuning-005").expect("embedded kingdom input"),
            strategies: raw.to_vec(),
            turn_limit_per_player: TURN_LIMIT,
            action_cap_per_turn: ACTION_CAP,
            starting_draft_enabled: false,
            infinite_count: 99,
            first_player_health_penalty: 4,
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
                play_pair_with_kingdom(&kingdom.kingdom, &first, &second)
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
}
