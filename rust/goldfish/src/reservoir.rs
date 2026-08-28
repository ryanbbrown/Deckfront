use crate::kernel::{self, Kingdom, KingdomInput};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const CANDIDATE_COUNT: u32 = 12_972_960;
pub const TOP_COUNT: u32 = 500_000;
pub const RESERVOIR_COUNT: u32 = 20_000;
const HEADER_BYTES: usize = 64;
const RESULT_ROW_BYTES: usize = 64;
const RESERVOIR_ROW_BYTES: usize = 124;
const BLOCK_SIZE: u32 = 1_024;
const TURN_LIMIT: i16 = 30;
const ACTION_CAP: i16 = 200;
const SEEDS: [u32; 4] = [4_100_000, 4_100_001, 4_100_002, 4_100_003];
const PROFILES: [&str; 3] = ["stationary", "chaser", "kiter"];

type ResultRow = [u32; 16];
type ReservoirRow = [u32; 31];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
enum Kind {
    StageOne = 1,
    StageTwo = 2,
    Top = 3,
    Reservoir = 4,
}

impl Kind {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "stage-one" => Ok(Self::StageOne),
            "stage-two" => Ok(Self::StageTwo),
            "top" => Ok(Self::Top),
            "reservoir" => Ok(Self::Reservoir),
            _ => Err(format!("unknown file kind {value}")),
        }
    }

    fn row_bytes(self) -> usize {
        if self == Self::Reservoir {
            RESERVOIR_ROW_BYTES
        } else {
            RESULT_ROW_BYTES
        }
    }

    fn seeds(self) -> [u32; 4] {
        match self {
            Self::StageOne | Self::Top => [SEEDS[0], 0, 0, 0],
            Self::StageTwo => [SEEDS[1], SEEDS[2], SEEDS[3], 0],
            Self::Reservoir => SEEDS,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Header {
    kind: Kind,
    row_bytes: u32,
    range_start: u32,
    range_end: u32,
    row_count: u32,
    checksum: u32,
    source_checksum: u32,
    seeds: [u32; 4],
    fingerprint: String,
}

impl Header {
    fn encode(&self) -> Result<[u8; HEADER_BYTES], String> {
        if !self.fingerprint.is_ascii() || self.fingerprint.len() > 16 {
            return Err("rule fingerprint must be at most 16 ASCII bytes".into());
        }
        let mut bytes = [0_u8; HEADER_BYTES];
        bytes[..4].copy_from_slice(b"HGR1");
        for (offset, value) in [
            self.kind as u32,
            self.row_bytes,
            self.range_start,
            self.range_end,
            self.row_count,
            self.checksum,
            self.source_checksum,
        ]
        .into_iter()
        .enumerate()
        {
            bytes[4 + offset * 4..8 + offset * 4].copy_from_slice(&value.to_le_bytes());
        }
        for (index, seed) in self.seeds.iter().enumerate() {
            bytes[32 + index * 4..36 + index * 4].copy_from_slice(&seed.to_le_bytes());
        }
        bytes[48..48 + self.fingerprint.len()].copy_from_slice(self.fingerprint.as_bytes());
        Ok(bytes)
    }

    fn decode(bytes: &[u8; HEADER_BYTES]) -> Result<Self, String> {
        if &bytes[..4] != b"HGR1" {
            return Err("file magic is not HGR1".into());
        }
        let word = |offset: usize| {
            u32::from_le_bytes(
                bytes[offset..offset + 4]
                    .try_into()
                    .expect("four-byte word"),
            )
        };
        let kind = match word(4) {
            1 => Kind::StageOne,
            2 => Kind::StageTwo,
            3 => Kind::Top,
            4 => Kind::Reservoir,
            value => return Err(format!("unknown file kind {value}")),
        };
        let fingerprint_end = bytes[48..]
            .iter()
            .position(|byte| *byte == 0)
            .map(|index| 48 + index)
            .unwrap_or(64);
        if bytes[fingerprint_end..].iter().any(|byte| *byte != 0) {
            return Err("rule fingerprint padding is not zero".into());
        }
        let fingerprint = std::str::from_utf8(&bytes[48..fingerprint_end])
            .map_err(|_| "rule fingerprint is not ASCII")?
            .to_owned();
        if !fingerprint.is_ascii() {
            return Err("rule fingerprint is not ASCII".into());
        }
        Ok(Self {
            kind,
            row_bytes: word(8),
            range_start: word(12),
            range_end: word(16),
            row_count: word(20),
            checksum: word(24),
            source_checksum: word(28),
            seeds: [word(32), word(36), word(40), word(44)],
            fingerprint,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeKingdomRecord {
    kingdom_id: String,
    kingdom: KingdomInput,
    ordered_card_ids: Vec<String>,
    rule_fingerprint: String,
}

#[derive(Deserialize)]
struct NativeKingdoms {
    kingdoms: Vec<NativeKingdomRecord>,
}

struct LoadedKingdom {
    id: String,
    kingdom: Kingdom,
    card_ids: Vec<String>,
    card_indexes: Vec<usize>,
    fingerprint: String,
}

fn load_kingdom(id: &str) -> Result<LoadedKingdom, String> {
    let database: NativeKingdoms = serde_json::from_str(include_str!("../kingdoms.json"))
        .map_err(|error| format!("embedded kingdoms.json is invalid: {error}"))?;
    let raw = database
        .kingdoms
        .into_iter()
        .find(|entry| entry.kingdom_id == id)
        .ok_or_else(|| format!("unknown registered strategy-search kingdom {id}"))?;
    if !raw.rule_fingerprint.is_ascii() || raw.rule_fingerprint.len() > 16 {
        return Err(format!("kingdom {id} has an invalid rule fingerprint"));
    }
    if raw.ordered_card_ids.len() != 14 {
        return Err(format!("kingdom {id} does not have 14 purchase cards"));
    }
    let kingdom = Kingdom::compile(raw.kingdom)?;
    let card_indexes = raw
        .ordered_card_ids
        .iter()
        .map(|card_id| kingdom.card_index(card_id))
        .collect::<Result<Vec<_>, _>>()?;
    if candidate_count(raw.ordered_card_ids.len())? != CANDIDATE_COUNT {
        return Err(format!(
            "kingdom {id} does not derive {CANDIDATE_COUNT} candidates"
        ));
    }
    Ok(LoadedKingdom {
        id: raw.kingdom_id,
        kingdom,
        card_ids: raw.ordered_card_ids,
        card_indexes,
        fingerprint: raw.rule_fingerprint,
    })
}

fn permutation_count(cards: usize, slots: usize) -> Result<u32, String> {
    if slots == 0 || cards < slots {
        return Err("ordered permutation dimensions are invalid".into());
    }
    (0..slots).try_fold(1_u32, |count, offset| {
        count
            .checked_mul(u32::try_from(cards - offset).map_err(|_| "card count is too large")?)
            .ok_or_else(|| "ordered permutation count overflowed".into())
    })
}

fn quantity_vectors() -> Vec<[u32; 5]> {
    let mut vectors = Vec::with_capacity(54);
    for first in 1..=4 {
        for second in 1..=4 {
            for third in 1..=4 {
                let vector = [first, second, third, 3, 3];
                if vector.iter().sum::<u32>() <= 15 {
                    vectors.push(vector);
                }
            }
        }
    }
    vectors
}

fn candidate_count(cards: usize) -> Result<u32, String> {
    permutation_count(cards, 5)?
        .checked_mul(u32::try_from(quantity_vectors().len()).expect("quantity vector count"))
        .ok_or_else(|| "candidate count overflowed".into())
}

fn candidate_parts(card_count: usize, number: u32) -> Result<([usize; 5], [u32; 5]), String> {
    let vectors = quantity_vectors();
    let vector_count = u32::try_from(vectors.len()).expect("quantity vector count");
    let total = candidate_count(card_count)?;
    if number >= total {
        return Err(format!(
            "strategy number must be from 0 through {}",
            total - 1
        ));
    }
    let mut remainder = number / vector_count;
    let quantities = vectors[(number % vector_count) as usize];
    let mut available: Vec<usize> = (0..card_count).collect();
    let mut selected = [0_usize; 5];
    for (position, held) in selected.iter_mut().enumerate() {
        let slots_left = 4 - position;
        let block_size = if slots_left == 0 {
            1
        } else {
            permutation_count(available.len() - 1, slots_left)?
        };
        let selected_index = (remainder / block_size) as usize;
        remainder %= block_size;
        *held = available.remove(selected_index);
    }
    Ok((selected, quantities))
}

fn strategy_for(loaded: &LoadedKingdom, number: u32) -> Result<kernel::Strategy, String> {
    let (positions, counts) = candidate_parts(loaded.card_ids.len(), number)?;
    let indexes = positions.map(|position| loaded.card_indexes[position]);
    loaded.kingdom.ordered_strategy(number, &indexes, &counts)
}

fn checked_u32(value: i32, name: &str) -> Result<u32, String> {
    u32::try_from(value).map_err(|_| format!("native {name} metric is negative"))
}

fn score_row(loaded: &LoadedKingdom, number: u32, seeds: &[u32]) -> Result<ResultRow, String> {
    let strategy = strategy_for(loaded, number)?;
    let mut row = [0_u32; 16];
    row[0] = number;
    for (profile_index, profile) in PROFILES.iter().enumerate() {
        let metrics = kernel::metrics(
            &loaded.kingdom,
            &strategy,
            seeds,
            profile,
            TURN_LIMIT,
            ACTION_CAP,
        );
        let start = 1 + profile_index * 5;
        row[start] = checked_u32(metrics.trials, "trials")?;
        row[start + 1] = checked_u32(metrics.completions, "completions")?;
        row[start + 2] = checked_u32(metrics.penalized_turns_to50, "penalized turns")?;
        row[start + 3] = checked_u32(metrics.damage_area, "damage total")?;
        row[start + 4] = checked_u32(metrics.money_spent, "money spent")?;
    }
    Ok(row)
}

fn profile_value(row: &[u32], profile: usize, metric: usize) -> u32 {
    row[1 + profile * 5 + metric]
}

fn compare_metrics(left: &[u32], right: &[u32]) -> Ordering {
    let min = |row: &[u32], metric| {
        (0..3)
            .map(|profile| profile_value(row, profile, metric))
            .min()
            .expect("three profiles")
    };
    let max = |row: &[u32], metric| {
        (0..3)
            .map(|profile| profile_value(row, profile, metric))
            .max()
            .expect("three profiles")
    };
    let sum = |row: &[u32], metric| {
        (0..3)
            .map(|profile| u64::from(profile_value(row, profile, metric)))
            .sum::<u64>()
    };
    min(left, 1)
        .cmp(&min(right, 1))
        .then_with(|| sum(left, 1).cmp(&sum(right, 1)))
        .then_with(|| max(right, 2).cmp(&max(left, 2)))
        .then_with(|| sum(right, 2).cmp(&sum(left, 2)))
        .then_with(|| min(left, 3).cmp(&min(right, 3)))
        .then_with(|| sum(left, 3).cmp(&sum(right, 3)))
        .then_with(|| sum(left, 4).cmp(&sum(right, 4)))
        .then_with(|| right[0].cmp(&left[0]))
}

fn combined_metrics(row: &ReservoirRow) -> ResultRow {
    let mut combined = [0_u32; 16];
    combined[0] = row[0];
    for index in 1..16 {
        combined[index] = row[index].saturating_add(row[index + 15]);
    }
    combined
}

fn compare_reservoir(left: &ReservoirRow, right: &ReservoirRow) -> Ordering {
    compare_metrics(&combined_metrics(left), &combined_metrics(right))
}

#[derive(Clone, Eq, PartialEq)]
struct HeapResult(ResultRow);
impl Ord for HeapResult {
    fn cmp(&self, other: &Self) -> Ordering {
        compare_metrics(&other.0, &self.0)
    }
}
impl PartialOrd for HeapResult {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Clone, Eq, PartialEq)]
struct HeapReservoir(ReservoirRow);
impl Ord for HeapReservoir {
    fn cmp(&self, other: &Self) -> Ordering {
        compare_reservoir(&other.0, &self.0)
    }
}
impl PartialOrd for HeapReservoir {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

const fn crc_table() -> [u32; 256] {
    let mut table = [0_u32; 256];
    let mut index = 0;
    while index < 256 {
        let mut value = index as u32;
        let mut bit = 0;
        while bit < 8 {
            value = if value & 1 == 1 {
                0xedb8_8320 ^ (value >> 1)
            } else {
                value >> 1
            };
            bit += 1;
        }
        table[index] = value;
        index += 1;
    }
    table
}
const CRC_TABLE: [u32; 256] = crc_table();

fn crc_update(mut state: u32, bytes: &[u8]) -> u32 {
    for byte in bytes {
        state = CRC_TABLE[((state ^ u32::from(*byte)) & 0xff) as usize] ^ (state >> 8);
    }
    state
}

#[cfg(test)]
fn crc32(bytes: &[u8]) -> u32 {
    !crc_update(u32::MAX, bytes)
}

fn result_bytes(row: &ResultRow) -> [u8; RESULT_ROW_BYTES] {
    let mut bytes = [0_u8; RESULT_ROW_BYTES];
    for (index, value) in row.iter().enumerate() {
        bytes[index * 4..index * 4 + 4].copy_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn reservoir_bytes(row: &ReservoirRow) -> [u8; RESERVOIR_ROW_BYTES] {
    let mut bytes = [0_u8; RESERVOIR_ROW_BYTES];
    for (index, value) in row.iter().enumerate() {
        bytes[index * 4..index * 4 + 4].copy_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn decode_result(bytes: &[u8; RESULT_ROW_BYTES]) -> ResultRow {
    let mut row = [0_u32; 16];
    for (index, value) in row.iter_mut().enumerate() {
        *value = u32::from_le_bytes(bytes[index * 4..index * 4 + 4].try_into().expect("word"));
    }
    row
}

fn decode_reservoir(bytes: &[u8; RESERVOIR_ROW_BYTES]) -> ReservoirRow {
    let mut row = [0_u32; 31];
    for (index, value) in row.iter_mut().enumerate() {
        *value = u32::from_le_bytes(bytes[index * 4..index * 4 + 4].try_into().expect("word"));
    }
    row
}

struct RowWriter {
    file: BufWriter<File>,
    path: PathBuf,
    crc: u32,
    rows: u32,
    bytes_written: u64,
}

impl RowWriter {
    fn new(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut file = BufWriter::new(File::create(path).map_err(|error| error.to_string())?);
        file.write_all(&[0_u8; HEADER_BYTES])
            .map_err(|error| error.to_string())?;
        Ok(Self {
            file,
            path: path.to_owned(),
            crc: u32::MAX,
            rows: 0,
            bytes_written: HEADER_BYTES as u64,
        })
    }

    fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.file
            .write_all(bytes)
            .map_err(|error| error.to_string())?;
        self.crc = crc_update(self.crc, bytes);
        self.rows += 1;
        self.bytes_written += bytes.len() as u64;
        Ok(())
    }

    fn finish(mut self, mut header: Header) -> Result<(u32, u64), String> {
        header.row_count = self.rows;
        header.checksum = !self.crc;
        self.file.flush().map_err(|error| error.to_string())?;
        self.file
            .seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        self.file
            .write_all(&header.encode()?)
            .map_err(|error| error.to_string())?;
        self.file.flush().map_err(|error| error.to_string())?;
        let expected = HEADER_BYTES as u64 + u64::from(self.rows) * u64::from(header.row_bytes);
        let actual = fs::metadata(&self.path)
            .map_err(|error| error.to_string())?
            .len();
        if actual != expected {
            return Err(format!(
                "written file has {actual} bytes; expected {expected}"
            ));
        }
        Ok((header.checksum, self.bytes_written))
    }
}

struct RowReader {
    file: BufReader<File>,
    header: Header,
    crc: u32,
    rows: u32,
    bytes_read: u64,
}

impl RowReader {
    fn open(path: &Path) -> Result<Self, String> {
        let mut file = BufReader::new(
            File::open(path).map_err(|error| format!("{}: {error}", path.display()))?,
        );
        let mut bytes = [0_u8; HEADER_BYTES];
        file.read_exact(&mut bytes)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        Ok(Self {
            file,
            header: Header::decode(&bytes)?,
            crc: u32::MAX,
            rows: 0,
            bytes_read: HEADER_BYTES as u64,
        })
    }

    fn result(&mut self) -> Result<ResultRow, String> {
        let mut bytes = [0_u8; RESULT_ROW_BYTES];
        self.file
            .read_exact(&mut bytes)
            .map_err(|error| error.to_string())?;
        self.crc = crc_update(self.crc, &bytes);
        self.rows += 1;
        self.bytes_read += RESULT_ROW_BYTES as u64;
        Ok(decode_result(&bytes))
    }

    fn reservoir(&mut self) -> Result<ReservoirRow, String> {
        let mut bytes = [0_u8; RESERVOIR_ROW_BYTES];
        self.file
            .read_exact(&mut bytes)
            .map_err(|error| error.to_string())?;
        self.crc = crc_update(self.crc, &bytes);
        self.rows += 1;
        self.bytes_read += RESERVOIR_ROW_BYTES as u64;
        Ok(decode_reservoir(&bytes))
    }

    fn finish(mut self) -> Result<u64, String> {
        if self.rows != self.header.row_count {
            return Err(format!(
                "read {} rows; header declares {}",
                self.rows, self.header.row_count
            ));
        }
        if !self.crc != self.header.checksum {
            return Err("row CRC-32 differs from the header".into());
        }
        let mut extra = [0_u8; 1];
        if self
            .file
            .read(&mut extra)
            .map_err(|error| error.to_string())?
            != 0
        {
            return Err("file has trailing bytes".into());
        }
        Ok(self.bytes_read)
    }
}

fn validate_header(header: &Header, loaded: &LoadedKingdom, kind: Kind) -> Result<(), String> {
    if header.kind != kind {
        return Err(format!(
            "file kind is {:?}; expected {:?}",
            header.kind, kind
        ));
    }
    if header.row_bytes as usize != kind.row_bytes() {
        return Err("row byte count differs from the file kind".into());
    }
    if header.fingerprint != loaded.fingerprint {
        return Err("rule fingerprint differs from the kingdom".into());
    }
    if header.seeds != kind.seeds() {
        return Err("shuffle seeds differ from the file kind".into());
    }
    if matches!(kind, Kind::StageOne | Kind::Top) && header.source_checksum != 0 {
        return Err("stage-one and top files must have source checksum 0".into());
    }
    Ok(())
}

fn header_for(
    loaded: &LoadedKingdom,
    kind: Kind,
    start: u32,
    end: u32,
    source_checksum: u32,
) -> Header {
    Header {
        kind,
        row_bytes: kind.row_bytes() as u32,
        range_start: start,
        range_end: end,
        row_count: 0,
        checksum: 0,
        source_checksum,
        seeds: kind.seeds(),
        fingerprint: loaded.fingerprint.clone(),
    }
}

fn read_all_results(
    path: &Path,
    loaded: &LoadedKingdom,
    kind: Kind,
) -> Result<(Header, Vec<ResultRow>, u64), String> {
    let mut reader = RowReader::open(path)?;
    validate_header(&reader.header, loaded, kind)?;
    let header = reader.header.clone();
    let mut rows = Vec::with_capacity(header.row_count as usize);
    for _ in 0..header.row_count {
        rows.push(reader.result()?);
    }
    let bytes = reader.finish()?;
    Ok((header, rows, bytes))
}

fn read_all_reservoir(
    path: &Path,
    loaded: &LoadedKingdom,
) -> Result<(Header, Vec<ReservoirRow>, u64), String> {
    let mut reader = RowReader::open(path)?;
    validate_header(&reader.header, loaded, Kind::Reservoir)?;
    let header = reader.header.clone();
    let mut rows = Vec::with_capacity(header.row_count as usize);
    for _ in 0..header.row_count {
        rows.push(reader.reservoir()?);
    }
    let bytes = reader.finish()?;
    Ok((header, rows, bytes))
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    command: String,
    kingdom_id: String,
    range_start: u32,
    range_end: u32,
    row_count: u32,
    threads: usize,
    bytes_read: u64,
    bytes_written: u64,
    elapsed_ms: u64,
    scoring_ms: u64,
    read_ms: u64,
    write_ms: u64,
    reduce_ms: u64,
}

fn ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn write_report(path: Option<&str>, report: &Report) -> Result<(), String> {
    let Some(path) = path else {
        return Ok(());
    };
    let path = Path::new(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut bytes = serde_json::to_vec_pretty(report).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    fs::write(path, bytes).map_err(|error| error.to_string())
}

#[derive(Default)]
struct Options {
    values: HashMap<String, String>,
}

impl Options {
    fn parse(args: &[String]) -> Result<Self, String> {
        let mut values = HashMap::new();
        let mut index = 0;
        while index < args.len() {
            let name = args[index]
                .strip_prefix("--")
                .ok_or_else(|| format!("unknown argument {}", args[index]))?;
            let value = args
                .get(index + 1)
                .filter(|value| !value.starts_with("--"))
                .ok_or_else(|| format!("--{name} needs a value"))?;
            if values.insert(name.to_owned(), value.clone()).is_some() {
                return Err(format!("--{name} can be specified only once"));
            }
            index += 2;
        }
        Ok(Self { values })
    }

    fn required(&self, name: &str) -> Result<&str, String> {
        self.values
            .get(name)
            .map(String::as_str)
            .ok_or_else(|| format!("--{name} is required"))
    }

    fn optional(&self, name: &str) -> Option<&str> {
        self.values.get(name).map(String::as_str)
    }

    fn integer(&self, name: &str) -> Result<u32, String> {
        self.required(name)?
            .parse::<u32>()
            .map_err(|_| format!("--{name} must be a uint32"))
    }

    fn optional_integer(&self, name: &str, default: u32) -> Result<u32, String> {
        self.optional(name)
            .map(|value| {
                value
                    .parse::<u32>()
                    .map_err(|_| format!("--{name} must be a uint32"))
            })
            .unwrap_or(Ok(default))
    }

    fn threads(&self) -> Result<usize, String> {
        let threads = self
            .required("threads")?
            .parse::<usize>()
            .map_err(|_| "--threads must be a positive integer".to_owned())?;
        if threads == 0 {
            return Err("--threads must be a positive integer".into());
        }
        Ok(threads)
    }

    fn only(&self, allowed: &[&str]) -> Result<(), String> {
        if let Some(name) = self
            .values
            .keys()
            .find(|name| !allowed.contains(&name.as_str()))
        {
            return Err(format!("unknown option --{name}"));
        }
        Ok(())
    }
}

fn input_paths(file: &str) -> Result<Vec<PathBuf>, String> {
    let paths: Vec<String> =
        serde_json::from_slice(&fs::read(file).map_err(|error| error.to_string())?)
            .map_err(|error| format!("input list is invalid: {error}"))?;
    if paths.is_empty() {
        return Err("input list is empty".into());
    }
    Ok(paths.into_iter().map(PathBuf::from).collect())
}

fn command_kingdom(options: &Options) -> Result<(), String> {
    options.only(&["kingdom"])?;
    let loaded = load_kingdom(options.required("kingdom")?)?;
    println!(
        "{}",
        serde_json::json!({
            "kingdomId": loaded.id,
            "candidateCount": CANDIDATE_COUNT,
            "ruleFingerprint": loaded.fingerprint,
            "cardIds": loaded.card_ids,
        })
    );
    Ok(())
}

fn command_strategies(options: &Options) -> Result<(), String> {
    options.only(&["kingdom", "numbers"])?;
    let loaded = load_kingdom(options.required("kingdom")?)?;
    for raw in options.required("numbers")?.split(',') {
        let number = raw
            .parse::<u32>()
            .map_err(|_| format!("invalid strategy number {raw}"))?;
        let (positions, counts) = candidate_parts(loaded.card_ids.len(), number)?;
        let card_ids: Vec<_> = positions
            .iter()
            .map(|position| loaded.card_ids[*position].clone())
            .collect();
        println!(
            "{}",
            serde_json::json!({ "number": number, "cardIds": card_ids, "counts": counts })
        );
    }
    Ok(())
}

fn command_score_one(options: &Options) -> Result<(), String> {
    options.only(&["kingdom", "start", "end", "threads", "out", "report"])?;
    let started = Instant::now();
    let loaded = load_kingdom(options.required("kingdom")?)?;
    let start = options.integer("start")?;
    let end = options.integer("end")?;
    let threads = options.threads()?;
    if start >= end || end > CANDIDATE_COUNT {
        return Err("score-one range is outside the candidate universe".into());
    }
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .map_err(|error| error.to_string())?;
    let mut writer = RowWriter::new(Path::new(options.required("out")?))?;
    let mut scoring_elapsed = Duration::ZERO;
    let mut write_elapsed = Duration::ZERO;
    let group_size = BLOCK_SIZE
        .saturating_mul(u32::try_from(threads).unwrap_or(u32::MAX))
        .saturating_mul(8);
    let mut cursor = start;
    while cursor < end {
        let group_end = cursor.saturating_add(group_size).min(end);
        let scoring_started = Instant::now();
        let rows: Vec<Result<ResultRow, String>> = pool.install(|| {
            (cursor..group_end)
                .into_par_iter()
                .map(|number| score_row(&loaded, number, &SEEDS[..1]))
                .collect()
        });
        scoring_elapsed += scoring_started.elapsed();
        let write_started = Instant::now();
        for row in rows {
            writer.write(&result_bytes(&row?))?;
        }
        write_elapsed += write_started.elapsed();
        cursor = group_end;
    }
    let write_started = Instant::now();
    let (_, bytes_written) = writer.finish(header_for(&loaded, Kind::StageOne, start, end, 0))?;
    write_elapsed += write_started.elapsed();
    let report = Report {
        command: "score-one".into(),
        kingdom_id: loaded.id,
        range_start: start,
        range_end: end,
        row_count: end - start,
        threads,
        bytes_written,
        elapsed_ms: ms(started.elapsed()),
        scoring_ms: ms(scoring_elapsed),
        write_ms: ms(write_elapsed),
        ..Report::default()
    };
    write_report(options.optional("report"), &report)
}

fn command_reduce_one(options: &Options) -> Result<(), String> {
    options.only(&["kingdom", "inputs", "out", "start", "end", "keep", "report"])?;
    let started = Instant::now();
    let loaded = load_kingdom(options.required("kingdom")?)?;
    let start = options.optional_integer("start", 0)?;
    let end = options.optional_integer("end", CANDIDATE_COUNT)?;
    let keep = options.optional_integer("keep", TOP_COUNT)?;
    if start >= end || end > CANDIDATE_COUNT || keep == 0 || keep > end - start {
        return Err("reduce-one universe or keep count is invalid".into());
    }
    let mut inputs: Vec<(PathBuf, Header)> = input_paths(options.required("inputs")?)?
        .into_iter()
        .map(|path| {
            let reader = RowReader::open(&path)?;
            validate_header(&reader.header, &loaded, Kind::StageOne)?;
            Ok((path, reader.header))
        })
        .collect::<Result<_, String>>()?;
    inputs.sort_by_key(|(_, header)| header.range_start);
    let mut cursor = start;
    for (_, header) in &inputs {
        if header.range_start != cursor
            || header.range_end <= header.range_start
            || header.row_count != header.range_end - header.range_start
        {
            return Err(
                "stage-one inputs have a gap, overlap, duplicate, or invalid row count".into(),
            );
        }
        cursor = header.range_end;
    }
    if cursor != end {
        return Err("stage-one inputs do not cover the requested universe".into());
    }
    let read_started = Instant::now();
    let reduce_started = Instant::now();
    let mut heap = BinaryHeap::with_capacity(keep as usize);
    let mut bytes_read = 0_u64;
    for (path, expected) in inputs {
        let mut reader = RowReader::open(&path)?;
        for index in 0..expected.row_count {
            let row = reader.result()?;
            if row[0] != expected.range_start + index {
                return Err("stage-one row strategy number differs from its range position".into());
            }
            if heap.len() < keep as usize {
                heap.push(HeapResult(row));
            } else if compare_metrics(&row, &heap.peek().expect("full heap").0) == Ordering::Greater
            {
                heap.pop();
                heap.push(HeapResult(row));
            }
        }
        bytes_read += reader.finish()?;
    }
    let read_reduce_elapsed = read_started.elapsed();
    let mut rows: Vec<_> = heap.into_iter().map(|entry| entry.0).collect();
    rows.sort_by(|left, right| compare_metrics(right, left));
    let reduce_elapsed = reduce_started.elapsed();
    let write_started = Instant::now();
    let mut writer = RowWriter::new(Path::new(options.required("out")?))?;
    for row in &rows {
        writer.write(&result_bytes(row))?;
    }
    let (_, bytes_written) = writer.finish(header_for(&loaded, Kind::Top, start, end, 0))?;
    let write_elapsed = write_started.elapsed();
    let report = Report {
        command: "reduce-one".into(),
        kingdom_id: loaded.id,
        range_start: start,
        range_end: end,
        row_count: keep,
        threads: 1,
        bytes_read,
        bytes_written,
        elapsed_ms: ms(started.elapsed()),
        read_ms: ms(read_reduce_elapsed.min(reduce_elapsed)),
        write_ms: ms(write_elapsed),
        reduce_ms: ms(reduce_elapsed.saturating_sub(read_reduce_elapsed.min(reduce_elapsed))),
        ..Report::default()
    };
    write_report(options.optional("report"), &report)
}

fn validated_top(
    path: &Path,
    loaded: &LoadedKingdom,
) -> Result<(Header, Vec<ResultRow>, u64), String> {
    let (header, rows, bytes) = read_all_results(path, loaded, Kind::Top)?;
    if header.range_end <= header.range_start || header.row_count != rows.len() as u32 {
        return Err("top file range or row count is invalid".into());
    }
    let mut seen = std::collections::HashSet::with_capacity(rows.len());
    for (index, row) in rows.iter().enumerate() {
        if row[0] < header.range_start
            || row[0] >= header.range_end
            || !seen.insert(row[0])
            || index > 0 && compare_metrics(&rows[index - 1], row) != Ordering::Greater
        {
            return Err("top file has an invalid number, duplicate, or ranking order".into());
        }
    }
    Ok((header, rows, bytes))
}

fn command_score_two(options: &Options) -> Result<(), String> {
    options.only(&["kingdom", "top", "start", "end", "threads", "out", "report"])?;
    let started = Instant::now();
    let loaded = load_kingdom(options.required("kingdom")?)?;
    let read_started = Instant::now();
    let (top_header, top_rows, bytes_read) =
        validated_top(Path::new(options.required("top")?), &loaded)?;
    let read_elapsed = read_started.elapsed();
    let start = options.integer("start")?;
    let end = options.integer("end")?;
    let threads = options.threads()?;
    if start >= end || end > top_header.row_count {
        return Err("score-two range is outside the top file".into());
    }
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .map_err(|error| error.to_string())?;
    let scoring_started = Instant::now();
    let rows: Vec<Result<ResultRow, String>> = pool.install(|| {
        top_rows[start as usize..end as usize]
            .par_iter()
            .map(|row| score_row(&loaded, row[0], &SEEDS[1..]))
            .collect()
    });
    let rows = rows.into_iter().collect::<Result<Vec<_>, _>>()?;
    let scoring_elapsed = scoring_started.elapsed();
    let write_started = Instant::now();
    let mut writer = RowWriter::new(Path::new(options.required("out")?))?;
    for row in &rows {
        writer.write(&result_bytes(row))?;
    }
    let (_, bytes_written) = writer.finish(header_for(
        &loaded,
        Kind::StageTwo,
        start,
        end,
        top_header.checksum,
    ))?;
    let write_elapsed = write_started.elapsed();
    let report = Report {
        command: "score-two".into(),
        kingdom_id: loaded.id,
        range_start: start,
        range_end: end,
        row_count: end - start,
        threads,
        bytes_read,
        bytes_written,
        elapsed_ms: ms(started.elapsed()),
        scoring_ms: ms(scoring_elapsed),
        read_ms: ms(read_elapsed),
        write_ms: ms(write_elapsed),
        ..Report::default()
    };
    write_report(options.optional("report"), &report)
}

fn command_reduce_two(options: &Options) -> Result<(), String> {
    options.only(&["kingdom", "top", "inputs", "out", "keep", "report"])?;
    let started = Instant::now();
    let loaded = load_kingdom(options.required("kingdom")?)?;
    let read_started = Instant::now();
    let (top_header, top_rows, mut bytes_read) =
        validated_top(Path::new(options.required("top")?), &loaded)?;
    let keep = options.optional_integer("keep", RESERVOIR_COUNT)?;
    if keep == 0 || keep > top_header.row_count {
        return Err("reduce-two keep count is invalid".into());
    }
    let mut inputs: Vec<(PathBuf, Header)> = input_paths(options.required("inputs")?)?
        .into_iter()
        .map(|path| {
            let reader = RowReader::open(&path)?;
            validate_header(&reader.header, &loaded, Kind::StageTwo)?;
            if reader.header.source_checksum != top_header.checksum {
                return Err("stage-two source checksum differs from top".into());
            }
            Ok((path, reader.header))
        })
        .collect::<Result<_, String>>()?;
    inputs.sort_by_key(|(_, header)| header.range_start);
    let mut cursor = 0;
    for (_, header) in &inputs {
        if header.range_start != cursor
            || header.range_end <= header.range_start
            || header.row_count != header.range_end - header.range_start
        {
            return Err(
                "stage-two inputs have a gap, overlap, duplicate, or invalid row count".into(),
            );
        }
        cursor = header.range_end;
    }
    if cursor != top_header.row_count {
        return Err("stage-two inputs do not cover the top file".into());
    }
    let mut heap = BinaryHeap::with_capacity(keep as usize);
    for (path, header) in inputs {
        let mut reader = RowReader::open(&path)?;
        for index in 0..header.row_count {
            let rank = header.range_start + index;
            let additional = reader.result()?;
            let stage_one = top_rows[rank as usize];
            if additional[0] != stage_one[0] {
                return Err("stage-two strategy number differs from the top rank".into());
            }
            let mut row = [0_u32; 31];
            row[0] = stage_one[0];
            row[1..16].copy_from_slice(&stage_one[1..]);
            row[16..].copy_from_slice(&additional[1..]);
            if heap.len() < keep as usize {
                heap.push(HeapReservoir(row));
            } else if compare_reservoir(&row, &heap.peek().expect("full heap").0)
                == Ordering::Greater
            {
                heap.pop();
                heap.push(HeapReservoir(row));
            }
        }
        bytes_read += reader.finish()?;
    }
    let read_elapsed = read_started.elapsed();
    let reduce_started = Instant::now();
    let mut rows: Vec<_> = heap.into_iter().map(|entry| entry.0).collect();
    rows.sort_by(|left, right| compare_reservoir(right, left));
    let reduce_elapsed = reduce_started.elapsed();
    let write_started = Instant::now();
    let mut writer = RowWriter::new(Path::new(options.required("out")?))?;
    for row in &rows {
        writer.write(&reservoir_bytes(row))?;
    }
    let (_, bytes_written) = writer.finish(header_for(
        &loaded,
        Kind::Reservoir,
        0,
        top_header.row_count,
        top_header.checksum,
    ))?;
    let write_elapsed = write_started.elapsed();
    let report = Report {
        command: "reduce-two".into(),
        kingdom_id: loaded.id,
        range_start: 0,
        range_end: top_header.row_count,
        row_count: keep,
        threads: 1,
        bytes_read,
        bytes_written,
        elapsed_ms: ms(started.elapsed()),
        read_ms: ms(read_elapsed),
        reduce_ms: ms(reduce_elapsed),
        write_ms: ms(write_elapsed),
        ..Report::default()
    };
    write_report(options.optional("report"), &report)
}

fn verify_result_rows(
    rows: &[ResultRow],
    header: &Header,
    kind: Kind,
    options: &Options,
) -> Result<(), String> {
    match kind {
        Kind::StageOne => {
            let start = options.optional_integer("start", header.range_start)?;
            let end = options.optional_integer("end", header.range_end)?;
            if header.range_start != start
                || header.range_end != end
                || header.row_count != end - start
            {
                return Err("stage-one range or row count differs".into());
            }
            if rows
                .iter()
                .enumerate()
                .any(|(index, row)| row[0] != start + index as u32)
            {
                return Err("stage-one strategy numbers are not in range order".into());
            }
        }
        Kind::StageTwo => {}
        Kind::Top => {
            let start = options.optional_integer("start", 0)?;
            let end = options.optional_integer("end", CANDIDATE_COUNT)?;
            let keep = options.optional_integer("keep", TOP_COUNT)?;
            if header.range_start != start || header.range_end != end || header.row_count != keep {
                return Err("top range or retained count differs".into());
            }
            let mut seen = std::collections::HashSet::with_capacity(rows.len());
            for (index, row) in rows.iter().enumerate() {
                if row[0] < start
                    || row[0] >= end
                    || !seen.insert(row[0])
                    || index > 0 && compare_metrics(&rows[index - 1], row) != Ordering::Greater
                {
                    return Err("top number uniqueness or order differs".into());
                }
            }
        }
        Kind::Reservoir => unreachable!(),
    }
    Ok(())
}

fn command_verify(options: &Options) -> Result<(), String> {
    options.only(&["kingdom", "kind", "file", "start", "end", "keep", "top"])?;
    let loaded = load_kingdom(options.required("kingdom")?)?;
    let kind = Kind::parse(options.required("kind")?)?;
    let file = Path::new(options.required("file")?);
    let (header, row_count) = if kind == Kind::Reservoir {
        let (header, rows, _) = read_all_reservoir(file, &loaded)?;
        let top_path = options.required("top")?;
        let (top_header, top_rows, _) = validated_top(Path::new(top_path), &loaded)?;
        let production_shape = options.optional("keep").is_none();
        let keep = options.optional_integer("keep", RESERVOIR_COUNT)?;
        if header.range_start != 0
            || header.range_end != top_header.row_count
            || header.row_count != keep
            || production_shape && top_header.row_count != TOP_COUNT
            || header.source_checksum != top_header.checksum
        {
            return Err("reservoir range, count, or source checksum differs".into());
        }
        let top_by_number: HashMap<u32, ResultRow> =
            top_rows.into_iter().map(|row| (row[0], row)).collect();
        let mut seen = std::collections::HashSet::with_capacity(rows.len());
        for (index, row) in rows.iter().enumerate() {
            let top = top_by_number
                .get(&row[0])
                .ok_or("reservoir strategy is absent from top")?;
            if row[1..16] != top[1..]
                || !seen.insert(row[0])
                || index > 0 && compare_reservoir(&rows[index - 1], row) != Ordering::Greater
            {
                return Err("reservoir stage-one evidence, uniqueness, or order differs".into());
            }
        }
        (header, rows.len())
    } else {
        let (header, rows, _) = read_all_results(file, &loaded, kind)?;
        if kind == Kind::StageTwo {
            let start = options.optional_integer("start", header.range_start)?;
            let end = options.optional_integer("end", header.range_end)?;
            let (top_header, top_rows, _) =
                validated_top(Path::new(options.required("top")?), &loaded)?;
            if header.range_start != start
                || header.range_end != end
                || header.row_count != end - start
                || end > top_header.row_count
                || header.source_checksum != top_header.checksum
            {
                return Err("stage-two range, count, or source checksum differs".into());
            }
            for (index, row) in rows.iter().enumerate() {
                if row[0] != top_rows[start as usize + index][0] {
                    return Err("stage-two strategy number differs from the top rank".into());
                }
            }
        } else {
            verify_result_rows(&rows, &header, kind, options)?;
        }
        (header, rows.len())
    };
    println!(
        "{}",
        serde_json::json!({ "valid": true, "kingdomId": loaded.id,
        "kind": options.required("kind")?, "file": file, "rowCount": row_count,
        "checksum": header.checksum, "sourceChecksum": header.source_checksum })
    );
    Ok(())
}

pub fn run(command: &str, args: &[String]) -> Result<(), String> {
    let options = Options::parse(args)?;
    match command {
        "kingdom" => command_kingdom(&options),
        "strategies" => command_strategies(&options),
        "score-one" => command_score_one(&options),
        "reduce-one" => command_reduce_one(&options),
        "score-two" => command_score_two(&options),
        "reduce-two" => command_reduce_two(&options),
        "verify" => command_verify(&options),
        _ => Err(format!("unknown subcommand {command}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::OpenOptions;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("hexdeck-{name}-{}-{nonce}", std::process::id()))
    }

    fn fixture_row(number: u32) -> ResultRow {
        let mut row = [0_u32; 16];
        row[0] = number;
        for profile in 0..3 {
            row[1 + profile * 5] = 1;
            row[3 + profile * 5] = 31;
        }
        row
    }

    fn write_results(
        path: &Path,
        loaded: &LoadedKingdom,
        kind: Kind,
        start: u32,
        end: u32,
        source_checksum: u32,
        rows: &[ResultRow],
    ) -> u32 {
        let mut writer = RowWriter::new(path).expect("writer");
        for row in rows {
            writer.write(&result_bytes(row)).expect("row");
        }
        writer
            .finish(header_for(loaded, kind, start, end, source_checksum))
            .expect("file")
            .0
    }

    fn options(values: &[(&str, String)]) -> Options {
        Options {
            values: values
                .iter()
                .map(|(name, value)| ((*name).to_owned(), value.clone()))
                .collect(),
        }
    }

    #[test]
    fn quantity_vectors_match_the_nested_order() {
        let vectors = quantity_vectors();
        assert_eq!(vectors.len(), 54);
        assert_eq!(vectors[0], [1, 1, 1, 3, 3]);
        assert_eq!(vectors[1], [1, 1, 2, 3, 3]);
        assert_eq!(vectors[53], [4, 4, 1, 3, 3]);
        assert!(
            vectors
                .iter()
                .all(|vector| vector.iter().sum::<u32>() <= 15)
        );
    }

    #[test]
    fn decodes_small_permutations_and_candidate_boundaries() {
        assert_eq!(candidate_parts(5, 0).unwrap().0, [0, 1, 2, 3, 4]);
        assert_eq!(candidate_parts(6, 54).unwrap().0, [0, 1, 2, 3, 5]);
        let first = candidate_parts(14, 0).unwrap();
        let last = candidate_parts(14, CANDIDATE_COUNT - 1).unwrap();
        assert_eq!(first, ([0, 1, 2, 3, 4], [1, 1, 1, 3, 3]));
        assert_eq!(last, ([13, 12, 11, 10, 9], [4, 4, 1, 3, 3]));
    }

    #[test]
    fn crc_matches_the_standard_check_value() {
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    }

    #[test]
    fn comparator_uses_each_rule_and_number_tiebreak() {
        let base = [1, 1, 1, 5, 10, 2, 1, 1, 5, 10, 2, 1, 1, 5, 10, 2];
        let mut better = base;
        better[2] = 2;
        assert_eq!(compare_metrics(&better, &base), Ordering::Greater);
        let mut lower_number = base;
        lower_number[0] = 0;
        assert_eq!(compare_metrics(&lower_number, &base), Ordering::Greater);
    }

    #[test]
    fn bounded_top_k_matches_a_full_sort() {
        let mut rows = Vec::new();
        let mut state = 11_u32;
        for number in 0..1_000 {
            let mut row = [0_u32; 16];
            row[0] = number;
            for value in &mut row[1..] {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                *value = state % 100;
            }
            rows.push(row);
        }
        let mut expected = rows.clone();
        expected.sort_by(|left, right| compare_metrics(right, left));
        expected.truncate(73);
        let mut heap = BinaryHeap::new();
        for row in rows {
            if heap.len() < 73 {
                heap.push(HeapResult(row));
            } else if compare_metrics(&row, &heap.peek().unwrap().0) == Ordering::Greater {
                heap.pop();
                heap.push(HeapResult(row));
            }
        }
        let mut actual: Vec<_> = heap.into_iter().map(|entry| entry.0).collect();
        actual.sort_by(|left, right| compare_metrics(right, left));
        assert_eq!(actual, expected);
    }

    #[test]
    fn header_round_trips() {
        let header = Header {
            kind: Kind::Reservoir,
            row_bytes: 124,
            range_start: 0,
            range_end: 500_000,
            row_count: 20_000,
            checksum: 7,
            source_checksum: 8,
            seeds: SEEDS,
            fingerprint: "123456789abcdef".into(),
        };
        assert_eq!(Header::decode(&header.encode().unwrap()).unwrap(), header);
    }

    #[test]
    fn readers_reject_corrupt_rows_and_wrong_header_contracts() {
        let loaded = load_kingdom("deep-beam-tuning-009").expect("kingdom");
        let root = temporary("header-rejections");
        fs::create_dir_all(&root).expect("directory");
        let clean = root.join("clean.hgs");
        write_results(&clean, &loaded, Kind::StageOne, 0, 1, 0, &[fixture_row(0)]);

        let flipped = root.join("flipped.hgs");
        let mut bytes = fs::read(&clean).expect("read");
        bytes[HEADER_BYTES + 7] ^= 1;
        fs::write(&flipped, bytes).expect("write");
        assert!(read_all_results(&flipped, &loaded, Kind::StageOne).is_err());

        let reader = RowReader::open(&clean).expect("header");
        let mut header = reader.header;
        header.range_end = 2;
        assert!(
            verify_result_rows(
                &[fixture_row(0)],
                &header,
                Kind::StageOne,
                &Options::default()
            )
            .is_err()
        );
        header = Header::decode(
            &fs::read(&clean).expect("read")[..HEADER_BYTES]
                .try_into()
                .unwrap(),
        )
        .unwrap();
        header.fingerprint = "wrong".into();
        assert!(validate_header(&header, &loaded, Kind::StageOne).is_err());
        header.fingerprint = loaded.fingerprint.clone();
        header.seeds[0] += 1;
        assert!(validate_header(&header, &loaded, Kind::StageOne).is_err());
        header.seeds = Kind::StageOne.seeds();
        assert!(validate_header(&header, &loaded, Kind::Top).is_err());

        let count = root.join("count.hgs");
        fs::copy(&clean, &count).expect("copy");
        let mut file = OpenOptions::new().write(true).open(&count).expect("open");
        file.seek(SeekFrom::Start(20)).expect("seek");
        file.write_all(&2_u32.to_le_bytes()).expect("count");
        assert!(read_all_results(&count, &loaded, Kind::StageOne).is_err());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reduce_one_rejects_a_gap_overlap_and_wrong_kind() {
        let loaded = load_kingdom("deep-beam-tuning-009").expect("kingdom");
        let root = temporary("reduce-one-rejections");
        fs::create_dir_all(&root).expect("directory");
        let first = root.join("first.hgs");
        let second = root.join("second.hgs");
        write_results(&first, &loaded, Kind::StageOne, 0, 1, 0, &[fixture_row(0)]);
        write_results(&second, &loaded, Kind::StageOne, 2, 3, 0, &[fixture_row(2)]);
        let list = root.join("inputs.json");
        fs::write(&list, serde_json::to_vec(&vec![&first, &second]).unwrap()).unwrap();
        let base = [
            ("kingdom", loaded.id.clone()),
            ("inputs", list.display().to_string()),
            ("out", root.join("top.hgf").display().to_string()),
            ("start", "0".into()),
            ("end", "3".into()),
            ("keep", "1".into()),
        ];
        assert!(
            command_reduce_one(&options(&base))
                .unwrap_err()
                .contains("gap")
        );
        fs::write(&list, serde_json::to_vec(&vec![&first, &first]).unwrap()).unwrap();
        assert!(command_reduce_one(&options(&base)).is_err());
        write_results(&second, &loaded, Kind::StageTwo, 1, 2, 7, &[fixture_row(1)]);
        fs::write(&list, serde_json::to_vec(&vec![&first, &second]).unwrap()).unwrap();
        assert!(command_reduce_one(&options(&base)).is_err());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn stage_two_rejects_wrong_rank_numbers_and_source_checksums() {
        let loaded = load_kingdom("deep-beam-tuning-009").expect("kingdom");
        let root = temporary("stage-two-rejections");
        fs::create_dir_all(&root).expect("directory");
        let top = root.join("top.hgf");
        let top_checksum = write_results(
            &top,
            &loaded,
            Kind::Top,
            0,
            3,
            0,
            &[fixture_row(0), fixture_row(1), fixture_row(2)],
        );
        let stage = root.join("stage.hgs");
        write_results(
            &stage,
            &loaded,
            Kind::StageTwo,
            0,
            3,
            top_checksum,
            &[fixture_row(0), fixture_row(2), fixture_row(2)],
        );
        let verify = [
            ("kingdom", loaded.id.clone()),
            ("kind", "stage-two".into()),
            ("file", stage.display().to_string()),
            ("start", "0".into()),
            ("end", "3".into()),
            ("top", top.display().to_string()),
        ];
        assert!(
            command_verify(&options(&verify))
                .unwrap_err()
                .contains("top rank")
        );
        write_results(
            &stage,
            &loaded,
            Kind::StageTwo,
            0,
            3,
            top_checksum.wrapping_add(1),
            &[fixture_row(0), fixture_row(1), fixture_row(2)],
        );
        assert!(
            command_verify(&options(&verify))
                .unwrap_err()
                .contains("source checksum")
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn every_embedded_kingdom_compiles_with_the_full_space() {
        let database: NativeKingdoms =
            serde_json::from_str(include_str!("../kingdoms.json")).unwrap();
        assert_eq!(database.kingdoms.len(), 260);
        for raw in database.kingdoms {
            assert_eq!(
                candidate_count(raw.ordered_card_ids.len()).unwrap(),
                CANDIDATE_COUNT
            );
            Kingdom::compile(raw.kingdom).unwrap();
        }
    }
}
