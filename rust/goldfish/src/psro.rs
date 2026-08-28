use crate::kernel::competitive_game;
use crate::matrix::{
    self, FIRST_MATRIX_SEED, LAST_MATRIX_SEED, MATRIX_KIND, PAIRS_KIND, PAIRS_ROW_BYTES,
    PURCHASES_KIND, PairResult,
};
use crate::reservoir::{
    DecodedStrategy, LoadedKingdom, ReservoirSelection, VerifiedReservoir, decode_strategy,
    load_kingdom, read_verified_reservoir,
};
use crate::stable_hash_value;
use rayon::prelude::*;
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

const MAGIC: &[u8; 4] = b"HPS1";
const VERSION: u32 = 1;
const HEADER_BYTES: usize = 128;
const PROTOCOL_TAG: &str = "rust-psro-v1";
const SCREEN_KIND: u32 = 1;
const CONFIRMATION_KIND: u32 = 2;
const RETEST_KIND: u32 = 3;
const ADMISSION_KIND: u32 = 4;
const CHECKPOINT_KIND: u32 = 5;
const DECISIONS_KIND: u32 = 6;
const SCREEN_DEPTHS: [u32; 7] = [8, 16, 32, 64, 128, 256, 512];
const CONFIRMATION_DEPTHS: [u32; 5] = [400, 800, 1_600, 3_200, 6_400];
const SCREEN_ALPHA: f64 = 0.05;
const FAMILY_ALPHA: f64 = 0.05;
const THRESHOLD: f64 = 0.51;
const TURN_LIMIT: i16 = 30;
const ACTION_CAP: i16 = 200;
const PRODUCTION_MATRIX_SIZE: usize = 50;
const PRODUCTION_RESERVOIR_SIZE: usize = 20_000;
const BETTING: [f64; 9] = [
    1.0 / 256.0,
    1.0 / 128.0,
    1.0 / 64.0,
    1.0 / 32.0,
    1.0 / 16.0,
    1.0 / 8.0,
    1.0 / 4.0,
    1.0 / 2.0,
    1.0,
];

#[derive(Clone, Debug, PartialEq)]
struct CommonHeader {
    kind: u32,
    payload_bytes: u32,
    payload_crc: u32,
    reservoir_crc: u32,
    initial_pairs_crc: u32,
    initial_purchases_crc: u32,
    initial_matrix_crc: u32,
    matrix_generation: u32,
    search: u32,
    ordinal: u32,
    depth: u32,
    previous_depth: u32,
    family_size: u32,
    row_count: u32,
    row_bytes: u32,
    suffix_count: u32,
    card_count: u32,
    alpha: f64,
    threshold: f64,
    fingerprint: String,
}

impl CommonHeader {
    fn encode(&self) -> Result<[u8; HEADER_BYTES], String> {
        if !self.fingerprint.is_ascii() || self.fingerprint.len() > 16 {
            return Err("PSRO rule fingerprint must fit 16 ASCII bytes".into());
        }
        let mut bytes = [0; HEADER_BYTES];
        bytes[..4].copy_from_slice(MAGIC);
        for (offset, value) in [
            (4, VERSION),
            (8, self.kind),
            (12, HEADER_BYTES as u32),
            (16, self.payload_bytes),
            (20, self.payload_crc),
            (24, self.reservoir_crc),
            (28, self.initial_pairs_crc),
            (32, self.initial_purchases_crc),
            (36, self.initial_matrix_crc),
            (40, self.matrix_generation),
            (44, self.search),
            (48, self.ordinal),
            (52, self.depth),
            (56, self.previous_depth),
            (60, self.family_size),
            (64, self.row_count),
            (68, self.row_bytes),
            (72, self.suffix_count),
            (76, self.card_count),
        ] {
            bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        bytes[80..88].copy_from_slice(&self.alpha.to_le_bytes());
        bytes[88..96].copy_from_slice(&self.threshold.to_le_bytes());
        bytes[96..96 + self.fingerprint.len()].copy_from_slice(self.fingerprint.as_bytes());
        bytes[112..112 + PROTOCOL_TAG.len()].copy_from_slice(PROTOCOL_TAG.as_bytes());
        Ok(bytes)
    }

    fn decode(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() < HEADER_BYTES || &bytes[..4] != MAGIC {
            return Err("PSRO file magic is invalid".into());
        }
        let word = |offset| u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("word"));
        if word(4) != VERSION || word(12) != HEADER_BYTES as u32 {
            return Err("PSRO file version or header size is invalid".into());
        }
        let padded = |range: std::ops::Range<usize>| -> Result<String, String> {
            let held = &bytes[range];
            let end = held
                .iter()
                .position(|byte| *byte == 0)
                .unwrap_or(held.len());
            if held[end..].iter().any(|byte| *byte != 0) {
                return Err("PSRO text padding is not zero".into());
            }
            let value = std::str::from_utf8(&held[..end]).map_err(|_| "PSRO text is not ASCII")?;
            if !value.is_ascii() {
                return Err("PSRO text is not ASCII".into());
            }
            Ok(value.to_owned())
        };
        let fingerprint = padded(96..112)?;
        if padded(112..128)? != PROTOCOL_TAG {
            return Err("PSRO protocol tag differs".into());
        }
        Ok(Self {
            kind: word(8),
            payload_bytes: word(16),
            payload_crc: word(20),
            reservoir_crc: word(24),
            initial_pairs_crc: word(28),
            initial_purchases_crc: word(32),
            initial_matrix_crc: word(36),
            matrix_generation: word(40),
            search: word(44),
            ordinal: word(48),
            depth: word(52),
            previous_depth: word(56),
            family_size: word(60),
            row_count: word(64),
            row_bytes: word(68),
            suffix_count: word(72),
            card_count: word(76),
            alpha: f64::from_le_bytes(bytes[80..88].try_into().expect("alpha")),
            threshold: f64::from_le_bytes(bytes[88..96].try_into().expect("threshold")),
            fingerprint,
        })
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Bounds {
    mean: f64,
    lower: f64,
    upper: f64,
}

fn log_mean_exp(values: &[f64]) -> f64 {
    let maximum = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    maximum
        + libm::log(
            values
                .iter()
                .map(|value| libm::exp(*value - maximum))
                .sum::<f64>()
                / values.len() as f64,
        )
}

fn p_value(values: &[u8], threshold: f64, greater: bool) -> f64 {
    let mut capitals = [0.0; BETTING.len()];
    let mut maximum = 0.0f64;
    for value in values {
        let score = f64::from(*value) / 4.0;
        let difference = if greater {
            score - threshold
        } else {
            threshold - score
        };
        for (capital, lambda) in capitals.iter_mut().zip(BETTING) {
            let factor = 1.0 + lambda * difference;
            *capital += libm::log(factor);
        }
        maximum = maximum.max(log_mean_exp(&capitals));
    }
    libm::exp(-maximum).min(1.0)
}

fn bisect(values: &[u8], alpha: f64, greater: bool) -> f64 {
    let mut low = 0.0f64;
    let mut high = 1.0f64;
    for _ in 0..21 {
        let middle = (low + high) / 2.0;
        let threshold = middle.clamp(1e-9, 1.0 - 1e-9);
        let rejected = p_value(values, threshold, greater) <= alpha / 2.0;
        if (greater && rejected) || (!greater && !rejected) {
            low = middle;
        } else {
            high = middle;
        }
    }
    if greater { low } else { high }
}

fn confidence(values: &[u8], alpha: f64) -> Result<Bounds, String> {
    if values.is_empty() || values.iter().any(|value| *value > 4) || !(0.0 < alpha && alpha < 1.0) {
        return Err("confidence input is invalid".into());
    }
    let lower = if p_value(values, 1e-9, true) <= alpha / 2.0 {
        bisect(values, alpha, true)
    } else {
        0.0
    };
    let upper = if p_value(values, 1.0 - 1e-9, false) <= alpha / 2.0 {
        bisect(values, alpha, false)
    } else {
        1.0
    };
    Ok(Bounds {
        mean: values
            .iter()
            .map(|value| f64::from(*value) / 4.0)
            .sum::<f64>()
            / values.len() as f64,
        lower,
        upper,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ScheduleEntry {
    seed: u32,
    opponent: u32,
}

fn weighted_schedule(
    numbers: &[u32],
    weights: &[f64],
    seeds: &[u32],
) -> Result<Vec<ScheduleEntry>, String> {
    if numbers.len() != weights.len() || numbers.is_empty() || seeds.is_empty() {
        return Err("PSRO schedule dimensions are invalid".into());
    }
    let mut entries = numbers
        .iter()
        .copied()
        .zip(weights.iter().copied())
        .filter(|(_, weight)| *weight > 0.0)
        .collect::<Vec<_>>();
    if entries.is_empty() || entries.iter().any(|(_, weight)| !weight.is_finite()) {
        return Err("PSRO schedule has no finite positive weight".into());
    }
    entries.sort_by_key(|(number, _)| *number);
    let total = entries.iter().map(|(_, weight)| *weight).sum::<f64>();
    let normalized = entries
        .iter()
        .map(|(_, weight)| *weight / total)
        .collect::<Vec<_>>();
    let mut assigned = vec![0u32; entries.len()];
    let mut schedule = Vec::with_capacity(seeds.len());
    for (position, seed) in seeds.iter().copied().enumerate() {
        let k = position as f64 + 1.0;
        let selected = (0..entries.len())
            .max_by(|left, right| {
                let a = normalized[*left] * k - f64::from(assigned[*left]);
                let b = normalized[*right] * k - f64::from(assigned[*right]);
                a.partial_cmp(&b)
                    .unwrap_or(Ordering::Equal)
                    .then_with(|| entries[*right].0.cmp(&entries[*left].0))
            })
            .expect("positive entries");
        assigned[selected] += 1;
        schedule.push(ScheduleEntry {
            seed,
            opponent: entries[selected].0,
        });
    }
    Ok(schedule)
}

#[allow(clippy::too_many_arguments)]
fn race_seed(
    kingdom: &str,
    reservoir_crc: u32,
    initial_pairs_crc: u32,
    search: u32,
    kind: &str,
    race: u32,
    position: u32,
    used: &mut HashSet<u32>,
) -> (u32, String) {
    let mut nonce = 0u32;
    loop {
        let preimage = format!(
            "rust-psro-v1:{kingdom}:{reservoir_crc}:{initial_pairs_crc}:{search}:{kind}:{race}:{position}:nonce:{nonce}"
        );
        let seed = stable_hash_value(&preimage);
        if used.insert(seed) {
            return (seed, preimage);
        }
        nonce = nonce.wrapping_add(1);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Candidate {
    number: u32,
    rank: u32,
}

#[derive(Clone, Debug, PartialEq)]
struct QueueRecord {
    candidate: Candidate,
    blocks: u32,
    source_search: u32,
    source_race: u32,
    bounds: Bounds,
}

fn order_queue(queue: &mut [QueueRecord]) {
    queue.sort_by(|left, right| {
        right
            .bounds
            .lower
            .total_cmp(&left.bounds.lower)
            .then_with(|| right.bounds.mean.total_cmp(&left.bounds.mean))
            .then_with(|| right.bounds.upper.total_cmp(&left.bounds.upper))
            .then_with(|| left.candidate.rank.cmp(&right.candidate.rank))
            .then_with(|| left.candidate.number.cmp(&right.candidate.number))
    });
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum Phase {
    Screen = 0,
    Confirmation = 1,
    Retest = 2,
    Admission = 3,
    BetweenSearches = 4,
    Complete = 5,
}

impl Phase {
    fn parse(value: u8) -> Result<Self, String> {
        match value {
            0 => Ok(Self::Screen),
            1 => Ok(Self::Confirmation),
            2 => Ok(Self::Retest),
            3 => Ok(Self::Admission),
            4 => Ok(Self::BetweenSearches),
            5 => Ok(Self::Complete),
            _ => Err("checkpoint phase is unknown".into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileRef {
    kind: u32,
    generation: u32,
    search: u32,
    ordinal: u32,
    depth: u32,
    payload_crc: u32,
}

#[derive(Clone, Debug, PartialEq)]
struct State {
    complete: bool,
    phase: Phase,
    search: u32,
    look_index: u32,
    retest_ordinal: u32,
    admissions: u32,
    generation: u32,
    clean_searches: u32,
    matrix_numbers: Vec<u32>,
    matrix_weights: Vec<f64>,
    fixed_family: Vec<Candidate>,
    active: Vec<Candidate>,
    queue: Vec<QueueRecord>,
    refs: Vec<FileRef>,
    race_ordinal: u32,
    previous_depth: u32,
    next_depth: u32,
}

#[derive(Clone)]
struct Source {
    reservoir_crc: u32,
    pairs_crc: u32,
    purchases_crc: u32,
    matrix_crc: u32,
    fingerprint: String,
    card_count: usize,
}

fn put_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}
fn put_f64(bytes: &mut Vec<u8>, value: f64) {
    bytes.extend_from_slice(&value.to_le_bytes());
}
fn get_u32(bytes: &[u8], offset: &mut usize) -> Result<u32, String> {
    let end = offset.checked_add(4).ok_or("binary offset overflow")?;
    let held = bytes.get(*offset..end).ok_or("binary payload ends early")?;
    *offset = end;
    Ok(u32::from_le_bytes(held.try_into().expect("u32")))
}
fn get_f64(bytes: &[u8], offset: &mut usize) -> Result<f64, String> {
    let end = offset.checked_add(8).ok_or("binary offset overflow")?;
    let held = bytes.get(*offset..end).ok_or("binary payload ends early")?;
    *offset = end;
    Ok(f64::from_le_bytes(held.try_into().expect("f64")))
}

fn base_header(source: &Source, state: &State, kind: u32) -> CommonHeader {
    CommonHeader {
        kind,
        payload_bytes: 0,
        payload_crc: 0,
        reservoir_crc: source.reservoir_crc,
        initial_pairs_crc: source.pairs_crc,
        initial_purchases_crc: source.purchases_crc,
        initial_matrix_crc: source.matrix_crc,
        matrix_generation: state.generation,
        search: state.search,
        ordinal: state.race_ordinal,
        depth: 0,
        previous_depth: 0,
        family_size: 0,
        row_count: 0,
        row_bytes: 0,
        suffix_count: 0,
        card_count: source.card_count as u32,
        alpha: 0.0,
        threshold: 0.0,
        fingerprint: source.fingerprint.clone(),
    }
}

fn verify_source(header: &CommonHeader, source: &Source) -> Result<(), String> {
    if header.reservoir_crc != source.reservoir_crc
        || header.initial_pairs_crc != source.pairs_crc
        || header.initial_purchases_crc != source.purchases_crc
        || header.initial_matrix_crc != source.matrix_crc
        || header.card_count != source.card_count as u32
        || header.fingerprint != source.fingerprint
    {
        return Err("PSRO evidence source identity differs".into());
    }
    Ok(())
}

fn file_bytes(mut header: CommonHeader, payload: &[u8]) -> Result<Vec<u8>, String> {
    header.payload_bytes = u32::try_from(payload.len()).map_err(|_| "PSRO payload is too large")?;
    header.payload_crc = matrix::crc32(payload);
    let mut bytes = header.encode()?.to_vec();
    bytes.extend_from_slice(payload);
    Ok(bytes)
}

fn read_evidence(
    path: &Path,
    source: &Source,
    kind: u32,
) -> Result<(CommonHeader, Vec<u8>), String> {
    let bytes = fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    let header = CommonHeader::decode(&bytes)?;
    verify_source(&header, source)?;
    if header.kind != kind || bytes.len() != HEADER_BYTES + header.payload_bytes as usize {
        return Err(format!("{} PSRO kind or length is invalid", path.display()));
    }
    let payload = bytes[HEADER_BYTES..].to_vec();
    if matrix::crc32(&payload) != header.payload_crc {
        return Err(format!("{} PSRO payload CRC differs", path.display()));
    }
    Ok((header, payload))
}

fn sync_parent(path: &Path) -> Result<(), String> {
    let parent = path.parent().ok_or("evidence path has no parent")?;
    File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("sync {}: {error}", parent.display()))
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    let mut file =
        File::create(path).map_err(|error| format!("create {}: {error}", path.display()))?;
    file.write_all(bytes)
        .map_err(|error| format!("write {}: {error}", path.display()))?;
    file.flush()
        .map_err(|error| format!("flush {}: {error}", path.display()))?;
    file.sync_all()
        .map_err(|error| format!("sync {}: {error}", path.display()))
}

fn atomic_write_verified<F>(path: &Path, bytes: &[u8], verify: F) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    let temporary = PathBuf::from(format!("{}.tmp", path.display()));
    write_synced(&temporary, bytes)?;
    verify(&temporary)?;
    fs::rename(&temporary, path).map_err(|error| format!("rename {}: {error}", path.display()))?;
    sync_parent(path)
}

fn checkpoint_payload(state: &State) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.push(u8::from(state.complete));
    bytes.push(state.phase as u8);
    bytes.extend_from_slice(&[0, 0]);
    for value in [
        state.search,
        state.look_index,
        state.retest_ordinal,
        state.admissions,
        state.generation,
        state.clean_searches,
        state.matrix_numbers.len() as u32,
        state.fixed_family.len() as u32,
        state.active.len() as u32,
        state.queue.len() as u32,
        state.refs.len() as u32,
        state.race_ordinal,
        state.previous_depth,
        state.next_depth,
    ] {
        put_u32(&mut bytes, value);
    }
    bytes.extend_from_slice(&[0; 36]);
    debug_assert_eq!(bytes.len(), 96);
    for (number, weight) in state.matrix_numbers.iter().zip(&state.matrix_weights) {
        put_u32(&mut bytes, *number);
        put_f64(&mut bytes, *weight);
    }
    for family in [&state.fixed_family, &state.active] {
        for candidate in family {
            put_u32(&mut bytes, candidate.number);
            put_u32(&mut bytes, candidate.rank);
        }
    }
    for record in &state.queue {
        for value in [
            record.candidate.number,
            record.candidate.rank,
            record.blocks,
            record.source_search,
            record.source_race,
            0,
        ] {
            put_u32(&mut bytes, value);
        }
        put_f64(&mut bytes, record.bounds.mean);
        put_f64(&mut bytes, record.bounds.lower);
        put_f64(&mut bytes, record.bounds.upper);
    }
    for reference in &state.refs {
        for value in [
            reference.kind,
            reference.generation,
            reference.search,
            reference.ordinal,
            reference.depth,
            reference.payload_crc,
        ] {
            put_u32(&mut bytes, value);
        }
    }
    bytes
}

fn parse_checkpoint(payload: &[u8]) -> Result<State, String> {
    if payload.len() < 96
        || payload[2..4].iter().any(|byte| *byte != 0)
        || payload[60..96].iter().any(|byte| *byte != 0)
    {
        return Err("checkpoint prefix or reserved bytes are invalid".into());
    }
    let complete = match payload[0] {
        0 => false,
        1 => true,
        _ => return Err("checkpoint status is unknown".into()),
    };
    let phase = Phase::parse(payload[1])?;
    let mut offset = 4;
    let search = get_u32(payload, &mut offset)?;
    let look_index = get_u32(payload, &mut offset)?;
    let retest_ordinal = get_u32(payload, &mut offset)?;
    let admissions = get_u32(payload, &mut offset)?;
    let generation = get_u32(payload, &mut offset)?;
    let clean_searches = get_u32(payload, &mut offset)?;
    let matrix_count = get_u32(payload, &mut offset)? as usize;
    let fixed_count = get_u32(payload, &mut offset)? as usize;
    let active_count = get_u32(payload, &mut offset)? as usize;
    let queue_count = get_u32(payload, &mut offset)? as usize;
    let ref_count = get_u32(payload, &mut offset)? as usize;
    let race_ordinal = get_u32(payload, &mut offset)?;
    let previous_depth = get_u32(payload, &mut offset)?;
    let next_depth = get_u32(payload, &mut offset)?;
    offset = 96;
    let mut matrix_numbers = Vec::with_capacity(matrix_count);
    let mut matrix_weights = Vec::with_capacity(matrix_count);
    for _ in 0..matrix_count {
        matrix_numbers.push(get_u32(payload, &mut offset)?);
        matrix_weights.push(get_f64(payload, &mut offset)?);
    }
    let mut read_family = |count: usize| -> Result<Vec<Candidate>, String> {
        (0..count)
            .map(|_| {
                Ok(Candidate {
                    number: get_u32(payload, &mut offset)?,
                    rank: get_u32(payload, &mut offset)?,
                })
            })
            .collect()
    };
    let fixed_family = read_family(fixed_count)?;
    let active = read_family(active_count)?;
    let mut queue = Vec::with_capacity(queue_count);
    for _ in 0..queue_count {
        let candidate = Candidate {
            number: get_u32(payload, &mut offset)?,
            rank: get_u32(payload, &mut offset)?,
        };
        let blocks = get_u32(payload, &mut offset)?;
        let source_search = get_u32(payload, &mut offset)?;
        let source_race = get_u32(payload, &mut offset)?;
        if get_u32(payload, &mut offset)? != 0 {
            return Err("checkpoint queue reserved word is nonzero".into());
        }
        queue.push(QueueRecord {
            candidate,
            blocks,
            source_search,
            source_race,
            bounds: Bounds {
                mean: get_f64(payload, &mut offset)?,
                lower: get_f64(payload, &mut offset)?,
                upper: get_f64(payload, &mut offset)?,
            },
        });
    }
    let mut refs = Vec::with_capacity(ref_count);
    for _ in 0..ref_count {
        refs.push(FileRef {
            kind: get_u32(payload, &mut offset)?,
            generation: get_u32(payload, &mut offset)?,
            search: get_u32(payload, &mut offset)?,
            ordinal: get_u32(payload, &mut offset)?,
            depth: get_u32(payload, &mut offset)?,
            payload_crc: get_u32(payload, &mut offset)?,
        });
    }
    if offset != payload.len()
        || matrix_numbers.len() != matrix_weights.len()
        || complete != (phase == Phase::Complete)
    {
        return Err("checkpoint section lengths or completion state differ".into());
    }
    Ok(State {
        complete,
        phase,
        search,
        look_index,
        retest_ordinal,
        admissions,
        generation,
        clean_searches,
        matrix_numbers,
        matrix_weights,
        fixed_family,
        active,
        queue,
        refs,
        race_ordinal,
        previous_depth,
        next_depth,
    })
}

fn write_checkpoint(
    out: &Path,
    source: &Source,
    state: &State,
    handshake: bool,
) -> Result<(), String> {
    let payload = checkpoint_payload(state);
    let mut header = base_header(source, state, CHECKPOINT_KIND);
    header.ordinal = state.refs.len() as u32;
    let bytes = file_bytes(header, &payload)?;
    let path = out.join("checkpoint.hpc");
    atomic_write_verified(&path, &bytes, |temporary| {
        let (verified_header, verified_payload) =
            read_evidence(temporary, source, CHECKPOINT_KIND)?;
        let verified_state = parse_checkpoint(&verified_payload)?;
        if verified_state != *state
            || verified_header.matrix_generation != state.generation
            || verified_header.search != state.search
            || verified_header.ordinal != state.refs.len() as u32
        {
            return Err("temporary checkpoint verification differs".into());
        }
        Ok(())
    })?;
    if std::env::var("HEXDECK_PSRO_TEST_STOP_AFTER_TRANSITION")
        .ok()
        .is_some_and(|value| value == state.refs.len().to_string())
        && !state.complete
    {
        return Err("test stop after committed PSRO transition".into());
    }
    if handshake {
        let ordinal = state.refs.len();
        println!("checkpoint {ordinal} {}", matrix::crc32(&payload));
        std::io::stdout()
            .flush()
            .map_err(|error| error.to_string())?;
        let mut line = String::new();
        std::io::stdin()
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if line.trim() != format!("committed {ordinal}") {
            return Err("Modal checkpoint acknowledgement differs".into());
        }
    }
    Ok(())
}

fn read_checkpoint(out: &Path, source: &Source) -> Result<Option<State>, String> {
    let path = out.join("checkpoint.hpc");
    if !path.exists() {
        return Ok(None);
    }
    let (header, payload) = read_evidence(&path, source, CHECKPOINT_KIND)?;
    let state = parse_checkpoint(&payload)?;
    if header.matrix_generation != state.generation || header.search != state.search {
        return Err("checkpoint header differs from checkpoint payload".into());
    }
    Ok(Some(state))
}

fn look_path(out: &Path, phase: Phase, search: u32, race: u32, depth: u32) -> PathBuf {
    match phase {
        Phase::Screen => out.join(format!("search-{search:04}/screen-{depth:04}.hpl")),
        Phase::Confirmation => out.join(format!("search-{search:04}/confirmation-{depth:04}.hpl")),
        Phase::Retest => out.join(format!("retest-{race:04}/confirmation-{depth:04}.hpl")),
        _ => unreachable!("look phase"),
    }
}

fn look_kind(phase: Phase) -> u32 {
    match phase {
        Phase::Screen => SCREEN_KIND,
        Phase::Confirmation => CONFIRMATION_KIND,
        Phase::Retest => RETEST_KIND,
        _ => unreachable!("look phase"),
    }
}

struct LookRow {
    candidate: Candidate,
    decision: u8,
    bounds: Bounds,
    points: Vec<u8>,
    purchases: Vec<u32>,
    damage: [u32; 5],
}

fn encode_look(schedule: &[ScheduleEntry], rows: &[LookRow]) -> Vec<u8> {
    let mut payload = Vec::new();
    for entry in schedule {
        put_u32(&mut payload, entry.seed);
        put_u32(&mut payload, entry.opponent);
    }
    for row in rows {
        put_u32(&mut payload, row.candidate.number);
        put_u32(&mut payload, row.candidate.rank);
        payload.push(row.decision);
        payload.extend_from_slice(&[0; 3]);
        put_f64(&mut payload, row.bounds.mean);
        put_f64(&mut payload, row.bounds.lower);
        put_f64(&mut payload, row.bounds.upper);
        payload.extend_from_slice(&row.points);
        for count in &row.purchases {
            put_u32(&mut payload, *count);
        }
        for damage in row.damage {
            put_u32(&mut payload, damage);
        }
    }
    payload
}

fn parse_look(
    header: &CommonHeader,
    payload: &[u8],
) -> Result<(Vec<ScheduleEntry>, Vec<LookRow>), String> {
    let expected =
        header.suffix_count as usize * 8 + header.row_count as usize * header.row_bytes as usize;
    if payload.len() != expected {
        return Err("look payload length differs from its dimensions".into());
    }
    let mut offset = 0;
    let mut schedule = Vec::with_capacity(header.suffix_count as usize);
    for _ in 0..header.suffix_count {
        schedule.push(ScheduleEntry {
            seed: get_u32(payload, &mut offset)?,
            opponent: get_u32(payload, &mut offset)?,
        });
    }
    let mut rows = Vec::with_capacity(header.row_count as usize);
    let point_count = header.suffix_count as usize;
    for _ in 0..header.row_count {
        let candidate = Candidate {
            number: get_u32(payload, &mut offset)?,
            rank: get_u32(payload, &mut offset)?,
        };
        let decision = *payload.get(offset).ok_or("look decision ends early")?;
        if decision > 2
            || payload
                .get(offset + 1..offset + 4)
                .ok_or("look padding ends early")?
                .iter()
                .any(|byte| *byte != 0)
        {
            return Err("look decision or padding is invalid".into());
        }
        offset += 4;
        let bounds = Bounds {
            mean: get_f64(payload, &mut offset)?,
            lower: get_f64(payload, &mut offset)?,
            upper: get_f64(payload, &mut offset)?,
        };
        let points = payload
            .get(offset..offset + point_count)
            .ok_or("look points end early")?
            .to_vec();
        if points.iter().any(|point| *point > 4) {
            return Err("look contains a score above 4".into());
        }
        offset += point_count;
        let purchases = (0..header.card_count)
            .map(|_| get_u32(payload, &mut offset))
            .collect::<Result<Vec<_>, _>>()?;
        let mut damage = [0; 5];
        for value in &mut damage {
            *value = get_u32(payload, &mut offset)?;
        }
        rows.push(LookRow {
            candidate,
            decision,
            bounds,
            points,
            purchases,
            damage,
        });
    }
    Ok((schedule, rows))
}

struct Runtime {
    kingdom: LoadedKingdom,
    reservoir: VerifiedReservoir,
    initial_count: usize,
    initial_weights: Vec<f64>,
    candidate_limit: usize,
    initial_pairs: Vec<PairResult>,
    matrix: Vec<PairResult>,
    strategies: HashMap<u32, DecodedStrategy>,
    source: Source,
    out: PathBuf,
    pool: rayon::ThreadPool,
    used_seeds: HashSet<u32>,
    handshake: bool,
    games: u64,
    transitions: Vec<TransitionTiming>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransitionTiming {
    kind: String,
    search: u32,
    ordinal: u32,
    depth: u32,
    candidates: usize,
    games: u64,
    elapsed_ms: f64,
}

impl Runtime {
    fn strategy(&mut self, number: u32) -> Result<&DecodedStrategy, String> {
        if !self.strategies.contains_key(&number) {
            let decoded = decode_strategy(&self.kingdom, number)?;
            self.strategies.insert(number, decoded);
        }
        Ok(self.strategies.get(&number).expect("inserted strategy"))
    }

    fn eligible(&self, matrix_numbers: &[u32]) -> Vec<Candidate> {
        let held: HashSet<u32> = matrix_numbers.iter().copied().collect();
        self.reservoir
            .numbers
            .iter()
            .enumerate()
            .filter(|(_, number)| !held.contains(number))
            .take(self.candidate_limit)
            .map(|(rank, number)| Candidate {
                number: *number,
                rank: rank as u32,
            })
            .collect()
    }

    fn schedule(
        &mut self,
        state: &State,
        phase: Phase,
        maximum: u32,
    ) -> Result<Vec<ScheduleEntry>, String> {
        let kind = match phase {
            Phase::Screen => "screen",
            Phase::Confirmation => "confirmation",
            Phase::Retest => "queue-retest",
            _ => unreachable!(),
        };
        let seeds = (0..maximum)
            .map(|position| {
                race_seed(
                    &self.kingdom.id,
                    self.source.reservoir_crc,
                    self.source.pairs_crc,
                    state.search,
                    kind,
                    state.race_ordinal,
                    position,
                    &mut self.used_seeds,
                )
                .0
            })
            .collect::<Vec<_>>();
        weighted_schedule(&state.matrix_numbers, &state.matrix_weights, &seeds)
    }

    fn score_look(
        &mut self,
        active: &[Candidate],
        suffix: &[ScheduleEntry],
        prefixes: &HashMap<u32, Vec<u8>>,
        alpha: f64,
    ) -> Result<Vec<LookRow>, String> {
        let matrix_numbers = suffix
            .iter()
            .map(|entry| entry.opponent)
            .collect::<HashSet<_>>();
        for number in active
            .iter()
            .map(|candidate| candidate.number)
            .chain(matrix_numbers)
        {
            self.strategy(number)?;
        }
        let card_count = self.kingdom.all_card_ids.len();
        let jobs = active.len() * suffix.len();
        let started = Instant::now();
        let results = self.pool.install(|| {
            (0..jobs)
                .into_par_iter()
                .map(|job| {
                    let candidate_index = job / suffix.len();
                    let schedule_index = job % suffix.len();
                    let candidate = &self.strategies[&active[candidate_index].number];
                    let opponent = &self.strategies[&suffix[schedule_index].opponent];
                    let mut point = 0u8;
                    let mut purchases = vec![0u32; card_count];
                    let mut damage = [0u32; 5];
                    for first_indigo in [false, true] {
                        let game = competitive_game(
                            &self.kingdom.kingdom,
                            &candidate.kernel,
                            &opponent.kernel,
                            suffix[schedule_index].seed,
                            first_indigo,
                            false,
                            TURN_LIMIT,
                            ACTION_CAP,
                        );
                        point += match game.result.outcome.as_str() {
                            "ochre" => 2,
                            "draw" => 1,
                            "indigo" => 0,
                            value => panic!("competitive kernel returned {value}"),
                        };
                        for (index, count) in game.seats[0].purchases.iter().enumerate() {
                            purchases[index] +=
                                u32::try_from(*count).expect("nonnegative purchase");
                        }
                        for (family, total) in damage.iter_mut().enumerate() {
                            *total += u32::try_from(game.seats[0].family_damage[family])
                                .expect("nonnegative damage");
                        }
                    }
                    (point, purchases, damage)
                })
                .collect::<Vec<_>>()
        });
        let mut rows = Vec::with_capacity(active.len());
        for (candidate_index, candidate) in active.iter().enumerate() {
            let start = candidate_index * suffix.len();
            let held = &results[start..start + suffix.len()];
            let points = held.iter().map(|entry| entry.0).collect::<Vec<_>>();
            let mut cumulative = prefixes.get(&candidate.number).cloned().unwrap_or_default();
            cumulative.extend_from_slice(&points);
            let bounds = confidence(&cumulative, alpha)?;
            let decision = if bounds.upper <= THRESHOLD {
                1
            } else if bounds.lower > THRESHOLD {
                2
            } else {
                0
            };
            let mut purchases = vec![0; card_count];
            let mut damage = [0; 5];
            for (_, held_purchases, held_damage) in held {
                for (target, value) in purchases.iter_mut().zip(held_purchases) {
                    *target += value;
                }
                for family in 0..5 {
                    damage[family] += held_damage[family];
                }
            }
            rows.push(LookRow {
                candidate: candidate.clone(),
                decision,
                bounds,
                points,
                purchases,
                damage,
            });
        }
        let games = (jobs * 2) as u64;
        self.games += games;
        self.transitions.push(TransitionTiming {
            kind: "look".into(),
            search: 0,
            ordinal: 0,
            depth: 0,
            candidates: active.len(),
            games,
            elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
        });
        Ok(rows)
    }
}

fn candidate_map(candidates: &[Candidate]) -> HashMap<u32, Candidate> {
    candidates
        .iter()
        .cloned()
        .map(|candidate| (candidate.number, candidate))
        .collect()
}

fn execute_race(runtime: &mut Runtime, state: &mut State, resumed: bool) -> Result<(), String> {
    let phase = state.phase;
    let depths: &[u32] = if phase == Phase::Screen {
        &SCREEN_DEPTHS
    } else {
        &CONFIRMATION_DEPTHS
    };
    let alpha = if phase == Phase::Screen {
        SCREEN_ALPHA
    } else {
        FAMILY_ALPHA / state.fixed_family.len() as f64
    };
    let initial = if phase == Phase::Screen {
        runtime.eligible(&state.matrix_numbers)
    } else {
        state.fixed_family.clone()
    };
    if initial.is_empty() {
        state.active.clear();
        state.look_index = depths.len() as u32;
        return Ok(());
    }
    let full_schedule = runtime.schedule(state, phase, *depths.last().expect("depths"))?;
    let mut active = initial.clone();
    let initial_by_number = candidate_map(&initial);
    let mut prefixes: HashMap<u32, Vec<u8>> = initial
        .iter()
        .map(|candidate| (candidate.number, Vec::new()))
        .collect();
    let mut prior_resolved = Vec::new();
    let committed = if resumed {
        state.look_index as usize
    } else {
        0
    };
    for (index, depth) in depths.iter().copied().enumerate() {
        if active.is_empty() {
            state.look_index = depths.len() as u32;
            break;
        }
        let previous = if index == 0 { 0 } else { depths[index - 1] };
        let suffix = &full_schedule[previous as usize..depth as usize];
        let path = look_path(&runtime.out, phase, state.search, state.race_ordinal, depth);
        let (header, rows) = if index < committed || resumed && index == committed && path.exists()
        {
            let (header, payload) = read_evidence(&path, &runtime.source, look_kind(phase))?;
            let (stored_schedule, rows) = parse_look(&header, &payload)?;
            if header.matrix_generation != state.generation
                || header.search != state.search
                || header.ordinal != state.race_ordinal
                || header.depth != depth
                || header.previous_depth != previous
                || header.family_size != initial.len() as u32
                || header.alpha.to_bits() != alpha.to_bits()
                || header.threshold.to_bits() != THRESHOLD.to_bits()
                || stored_schedule != suffix
                || rows.iter().map(|row| &row.candidate).ne(active.iter())
            {
                return Err(format!(
                    "{} committed look differs from the race",
                    path.display()
                ));
            }
            (header, rows)
        } else {
            if path.exists() {
                return Err(format!(
                    "{} exists beyond the restart adoption boundary",
                    path.display()
                ));
            }
            let rows = runtime.score_look(&active, suffix, &prefixes, alpha)?;
            if let Some(timing) = runtime.transitions.last_mut() {
                timing.kind = match phase {
                    Phase::Screen => "screen",
                    Phase::Confirmation => "confirmation",
                    Phase::Retest => "queue-retest",
                    _ => unreachable!(),
                }
                .into();
                timing.search = state.search;
                timing.ordinal = state.race_ordinal;
                timing.depth = depth;
            }
            let payload = encode_look(suffix, &rows);
            let row_bytes = 36 + suffix.len() + runtime.source.card_count * 4 + 20;
            let mut header = base_header(&runtime.source, state, look_kind(phase));
            header.depth = depth;
            header.previous_depth = previous;
            header.family_size = initial.len() as u32;
            header.row_count = rows.len() as u32;
            header.row_bytes = row_bytes as u32;
            header.suffix_count = suffix.len() as u32;
            header.alpha = alpha;
            header.threshold = THRESHOLD;
            let bytes = file_bytes(header.clone(), &payload)?;
            let expected_header = CommonHeader::decode(&bytes)?;
            atomic_write_verified(&path, &bytes, |temporary| {
                let (verified_header, verified_payload) =
                    read_evidence(temporary, &runtime.source, look_kind(phase))?;
                let (_, verified_rows) = parse_look(&verified_header, &verified_payload)?;
                if verified_header != expected_header
                    || verified_payload != payload
                    || verified_rows.len() != rows.len()
                {
                    return Err("temporary look verification differs".into());
                }
                Ok(())
            })?;
            let (verified_header, verified_payload) =
                read_evidence(&path, &runtime.source, look_kind(phase))?;
            let (_, verified_rows) = parse_look(&verified_header, &verified_payload)?;
            if verified_rows.len() != rows.len() {
                return Err("written look verification differs".into());
            }
            if std::env::var("HEXDECK_PSRO_TEST_STOP_AFTER_RENAME")
                .ok()
                .is_some_and(|value| value == format!("{}:{depth}", look_kind(phase)))
            {
                return Err("test stop after renamed PSRO look".into());
            }
            (verified_header, rows)
        };
        for row in &rows {
            let scores = prefixes
                .get_mut(&row.candidate.number)
                .ok_or("look candidate is outside family")?;
            scores.extend_from_slice(&row.points);
            let expected = confidence(scores, alpha)?;
            let expected_decision = if expected.upper <= THRESHOLD {
                1
            } else if expected.lower > THRESHOLD {
                2
            } else {
                0
            };
            if row.bounds.mean.to_bits() != expected.mean.to_bits()
                || row.bounds.lower.to_bits() != expected.lower.to_bits()
                || row.bounds.upper.to_bits() != expected.upper.to_bits()
                || row.decision != expected_decision
            {
                return Err("look confidence bits or decision differ".into());
            }
        }
        let mut next = Vec::new();
        for row in rows {
            if row.decision == 0 && index + 1 < depths.len() {
                next.push(row.candidate);
            } else {
                prior_resolved.push((row.candidate, row.decision, row.bounds, depth));
            }
        }
        active = next;
        let reference = FileRef {
            kind: look_kind(phase),
            generation: state.generation,
            search: state.search,
            ordinal: state.race_ordinal,
            depth,
            payload_crc: header.payload_crc,
        };
        if index >= committed {
            state.refs.push(reference);
        } else if state.refs.iter().all(|held| held != &reference) {
            return Err("checkpoint omits a committed look reference".into());
        }
        state.look_index = (index + 1) as u32;
        state.previous_depth = depth;
        state.next_depth = depths.get(index + 1).copied().unwrap_or(0);
        state.active = active.clone();
        if phase == Phase::Screen {
            for (candidate, decision, _, _) in &prior_resolved {
                if *decision == 2 && !state.fixed_family.contains(candidate) {
                    state.fixed_family.push(candidate.clone());
                }
            }
            state.fixed_family.sort_by_key(|candidate| candidate.rank);
        } else {
            for (candidate, decision, bounds, blocks) in &prior_resolved {
                if *decision == 2
                    && state
                        .queue
                        .iter()
                        .all(|record| record.candidate != *candidate)
                {
                    state.queue.push(QueueRecord {
                        candidate: candidate.clone(),
                        blocks: *blocks,
                        source_search: state.search,
                        source_race: state.race_ordinal,
                        bounds: *bounds,
                    });
                }
            }
            order_queue(&mut state.queue);
        }
        write_checkpoint(&runtime.out, &runtime.source, state, runtime.handshake)?;
    }
    state.active.clear();
    state.look_index = depths.len() as u32;
    let _ = initial_by_number;
    Ok(())
}

fn start_search(runtime: &Runtime, state: &mut State) {
    state.phase = Phase::Screen;
    state.look_index = 0;
    state.race_ordinal = 1;
    state.previous_depth = 0;
    state.next_depth = SCREEN_DEPTHS[0];
    state.fixed_family.clear();
    state.active = runtime.eligible(&state.matrix_numbers);
    state.queue.clear();
}

fn finish_clean_search(runtime: &Runtime, state: &mut State) {
    state.clean_searches += 1;
    if state.clean_searches >= 2 {
        state.complete = true;
        state.phase = Phase::Complete;
        state.next_depth = 0;
    } else {
        state.search += 1;
        start_search(runtime, state);
    }
}

fn admission_path(out: &Path, ordinal: u32) -> PathBuf {
    out.join(format!("admission-{ordinal:04}.hpa"))
}

fn admission_payload(
    state: &State,
    selected: &QueueRecord,
    queue: &[QueueRecord],
    before: &[f64],
    after: &[f64],
    results: &[PairResult],
    card_count: usize,
) -> Vec<u8> {
    let mut payload = Vec::new();
    for value in [
        state.admissions + 1,
        state.search,
        selected.source_race,
        selected.candidate.number,
        selected.candidate.rank,
        state.matrix_numbers.len() as u32,
        state.matrix_numbers.len() as u32 + 1,
        queue.len() as u32,
    ] {
        put_u32(&mut payload, value);
    }
    put_f64(&mut payload, selected.bounds.mean);
    put_f64(&mut payload, selected.bounds.lower);
    put_f64(&mut payload, selected.bounds.upper);
    for record in queue {
        put_u32(&mut payload, record.candidate.number);
    }
    put_u32(&mut payload, state.matrix_numbers.len() as u32);
    for (number, weight) in state.matrix_numbers.iter().zip(before) {
        put_u32(&mut payload, *number);
        put_f64(&mut payload, *weight);
    }
    put_u32(&mut payload, state.matrix_numbers.len() as u32 + 1);
    for (number, weight) in state
        .matrix_numbers
        .iter()
        .copied()
        .chain(std::iter::once(selected.candidate.number))
        .zip(after)
    {
        put_u32(&mut payload, number);
        put_f64(&mut payload, *weight);
    }
    for result in results {
        put_u32(&mut payload, result.first);
        payload.extend_from_slice(&result.points);
        for count in &result.purchases[1] {
            put_u32(&mut payload, *count);
        }
        for damage in result.damage[1] {
            put_u32(&mut payload, damage);
        }
        for count in &result.purchases[0] {
            put_u32(&mut payload, *count);
        }
        for damage in result.damage[0] {
            put_u32(&mut payload, damage);
        }
    }
    debug_assert_eq!(
        results.first().map(|result| result.purchases[0].len()),
        Some(card_count)
    );
    payload
}

#[derive(Clone)]
struct ParsedAdmission {
    admission: u32,
    search: u32,
    source_race: u32,
    candidate: Candidate,
    queue_numbers: Vec<u32>,
    bounds: Bounds,
    before_numbers: Vec<u32>,
    before_weights: Vec<f64>,
    after_numbers: Vec<u32>,
    after_weights: Vec<f64>,
    results: Vec<PairResult>,
}

fn parse_admission(payload: &[u8], card_count: usize) -> Result<ParsedAdmission, String> {
    let mut offset = 0;
    let admission = get_u32(payload, &mut offset)?;
    let search = get_u32(payload, &mut offset)?;
    let source_race = get_u32(payload, &mut offset)?;
    let candidate_number = get_u32(payload, &mut offset)?;
    let candidate_rank = get_u32(payload, &mut offset)?;
    let before_count = get_u32(payload, &mut offset)? as usize;
    let after_count = get_u32(payload, &mut offset)? as usize;
    let queue_count = get_u32(payload, &mut offset)? as usize;
    if after_count != before_count + 1 {
        return Err("admission matrix sizes are invalid".into());
    }
    let bounds = Bounds {
        mean: get_f64(payload, &mut offset)?,
        lower: get_f64(payload, &mut offset)?,
        upper: get_f64(payload, &mut offset)?,
    };
    let queue_numbers = (0..queue_count)
        .map(|_| get_u32(payload, &mut offset))
        .collect::<Result<Vec<_>, _>>()?;
    if get_u32(payload, &mut offset)? as usize != before_count {
        return Err("admission before-mix count differs".into());
    }
    let mut before_numbers = Vec::with_capacity(before_count);
    let mut before_weights = Vec::with_capacity(before_count);
    for _ in 0..before_count {
        before_numbers.push(get_u32(payload, &mut offset)?);
        before_weights.push(get_f64(payload, &mut offset)?);
    }
    if get_u32(payload, &mut offset)? as usize != after_count {
        return Err("admission after-mix count differs".into());
    }
    let mut after_numbers = Vec::with_capacity(after_count);
    let mut after_weights = Vec::with_capacity(after_count);
    for _ in 0..after_count {
        after_numbers.push(get_u32(payload, &mut offset)?);
        after_weights.push(get_f64(payload, &mut offset)?);
    }
    let mut results = Vec::with_capacity(before_count);
    for _ in 0..before_count {
        let first = get_u32(payload, &mut offset)?;
        let points = payload
            .get(offset..offset + 125)
            .ok_or("admission points end early")?
            .to_vec();
        if points.iter().any(|point| *point > 4) {
            return Err("admission point byte exceeds 4".into());
        }
        offset += 125;
        let mut candidate_purchases = vec![0; card_count];
        for value in &mut candidate_purchases {
            *value = get_u32(payload, &mut offset)?;
        }
        let mut candidate_damage = [0; 5];
        for value in &mut candidate_damage {
            *value = get_u32(payload, &mut offset)?;
        }
        let mut opponent_purchases = vec![0; card_count];
        for value in &mut opponent_purchases {
            *value = get_u32(payload, &mut offset)?;
        }
        let mut opponent_damage = [0; 5];
        for value in &mut opponent_damage {
            *value = get_u32(payload, &mut offset)?;
        }
        results.push(PairResult {
            first,
            second: candidate_number,
            points,
            purchases: [opponent_purchases, candidate_purchases],
            damage: [opponent_damage, candidate_damage],
        });
    }
    if offset != payload.len() {
        return Err("admission payload has trailing bytes".into());
    }
    Ok(ParsedAdmission {
        admission,
        search,
        source_race,
        candidate: Candidate {
            number: candidate_number,
            rank: candidate_rank,
        },
        queue_numbers,
        bounds,
        before_numbers,
        before_weights,
        after_numbers,
        after_weights,
        results,
    })
}

fn expanded_files(runtime: &Runtime, state: &State) -> Result<(), String> {
    let numbers = &state.matrix_numbers;
    let (percentages, weights) = matrix::matrix_values(&runtime.matrix, numbers)?;
    if weights
        .iter()
        .zip(&state.matrix_weights)
        .any(|(left, right)| left.to_bits() != right.to_bits())
    {
        return Err("expanded matrix solve differs from checkpoint mix".into());
    }
    let pair_rows = matrix::pair_rows(&runtime.matrix);
    let purchase_rows = matrix::purchase_rows(&runtime.matrix);
    let matrix_rows = matrix::matrix_rows(numbers, &percentages, &weights);
    let size = numbers.len();
    let headers = [
        matrix::make_header(
            PAIRS_KIND,
            PAIRS_ROW_BYTES,
            size,
            runtime.matrix.len(),
            &pair_rows,
            runtime.source.reservoir_crc,
            &runtime.source.fingerprint,
        ),
        matrix::make_header(
            PURCHASES_KIND,
            (8 + runtime.source.card_count * 4 + 20) as u32,
            size,
            runtime.matrix.len() * 2,
            &purchase_rows,
            runtime.source.reservoir_crc,
            &runtime.source.fingerprint,
        ),
        matrix::make_header(
            MATRIX_KIND,
            (4 + size * 8 + 8) as u32,
            size,
            size,
            &matrix_rows,
            runtime.source.reservoir_crc,
            &runtime.source.fingerprint,
        ),
    ];
    let rows = [&pair_rows, &purchase_rows, &matrix_rows];
    let names = ["pairs.hgm", "purchases.hgm", "matrix.hgm"];
    for index in 0..3 {
        let mut bytes = headers[index].encode()?.to_vec();
        bytes.extend_from_slice(rows[index]);
        let temporary = runtime.out.join(format!("{}.tmp", names[index]));
        write_synced(&temporary, &bytes)?;
    }
    let selection = ReservoirSelection {
        source_checksum: runtime.source.reservoir_crc,
        numbers: numbers.clone(),
        bytes: 0,
    };
    matrix::verify_files(
        &runtime.kingdom,
        &selection,
        size,
        &runtime.out.join("pairs.hgm.tmp"),
        &runtime.out.join("purchases.hgm.tmp"),
        &runtime.out.join("matrix.hgm.tmp"),
    )?;
    for name in names {
        fs::rename(
            runtime.out.join(format!("{name}.tmp")),
            runtime.out.join(name),
        )
        .map_err(|error| format!("publish expanded {name}: {error}"))?;
        sync_parent(&runtime.out.join(name))?;
    }
    Ok(())
}

fn grow_pairs(
    existing: &[PairResult],
    added: &[PairResult],
    old_size: usize,
) -> Result<Vec<PairResult>, String> {
    if existing.len() != old_size * (old_size - 1) / 2 || added.len() != old_size {
        return Err("expanded pair dimensions are invalid".into());
    }
    let mut grown = Vec::with_capacity((old_size + 1) * old_size / 2);
    let mut cursor = 0;
    for (first, new_pair) in added.iter().enumerate() {
        let held = old_size - first - 1;
        grown.extend_from_slice(&existing[cursor..cursor + held]);
        cursor += held;
        grown.push(new_pair.clone());
    }
    Ok(grown)
}

fn admit(runtime: &mut Runtime, state: &mut State) -> Result<(), String> {
    order_queue(&mut state.queue);
    let queue = state.queue.clone();
    let selected = queue.first().ok_or("admission queue is empty")?.clone();
    let path = admission_path(&runtime.out, state.admissions + 1);
    let started = Instant::now();
    let (verified, results, all_pairs, numbers, after, played) = if path.exists() {
        let (header, payload) = read_evidence(&path, &runtime.source, ADMISSION_KIND)?;
        let parsed = parse_admission(&payload, runtime.source.card_count)?;
        let expected_queue = queue
            .iter()
            .map(|record| record.candidate.number)
            .collect::<Vec<_>>();
        if header.matrix_generation != state.generation + 1
            || header.ordinal != state.admissions + 1
            || parsed.admission != state.admissions + 1
            || parsed.search != state.search
            || parsed.source_race != selected.source_race
            || parsed.candidate != selected.candidate
            || parsed.queue_numbers != expected_queue
            || parsed.bounds.mean.to_bits() != selected.bounds.mean.to_bits()
            || parsed.bounds.lower.to_bits() != selected.bounds.lower.to_bits()
            || parsed.bounds.upper.to_bits() != selected.bounds.upper.to_bits()
            || parsed.before_numbers != state.matrix_numbers
            || parsed
                .before_weights
                .iter()
                .zip(&state.matrix_weights)
                .any(|(left, right)| left.to_bits() != right.to_bits())
        {
            return Err("renamed admission differs from the pending transition".into());
        }
        let all_pairs = grow_pairs(&runtime.matrix, &parsed.results, state.matrix_numbers.len())?;
        let mut expected_numbers = state.matrix_numbers.clone();
        expected_numbers.push(selected.candidate.number);
        let (_, expected_weights) = matrix::matrix_values(&all_pairs, &expected_numbers)?;
        if parsed.after_numbers != expected_numbers
            || parsed
                .after_weights
                .iter()
                .zip(&expected_weights)
                .any(|(left, right)| left.to_bits() != right.to_bits())
        {
            return Err("renamed admission mix differs from its pair evidence".into());
        }
        (
            header,
            parsed.results,
            all_pairs,
            expected_numbers,
            expected_weights,
            false,
        )
    } else {
        let selected_strategy = runtime.strategy(selected.candidate.number)?.clone();
        for number in &state.matrix_numbers {
            runtime.strategy(*number)?;
        }
        let results = runtime.pool.install(|| {
            state
                .matrix_numbers
                .par_iter()
                .map(|number| {
                    matrix::play_pair_with_kingdom(
                        &runtime.kingdom.kingdom,
                        &runtime.strategies[number],
                        &selected_strategy,
                    )
                })
                .collect::<Vec<_>>()
        });
        let all_pairs = grow_pairs(&runtime.matrix, &results, state.matrix_numbers.len())?;
        let mut numbers = state.matrix_numbers.clone();
        numbers.push(selected.candidate.number);
        let (_, after) = matrix::matrix_values(&all_pairs, &numbers)?;
        let payload = admission_payload(
            state,
            &selected,
            &queue,
            &state.matrix_weights,
            &after,
            &results,
            runtime.source.card_count,
        );
        let mut header = base_header(&runtime.source, state, ADMISSION_KIND);
        header.ordinal = state.admissions + 1;
        header.row_count = results.len() as u32;
        header.row_bytes = (4 + 125 + 2 * (4 * runtime.source.card_count + 20)) as u32;
        header.matrix_generation = state.generation + 1;
        let bytes = file_bytes(header, &payload)?;
        let expected_header = CommonHeader::decode(&bytes)?;
        atomic_write_verified(&path, &bytes, |temporary| {
            let (verified_header, verified_payload) =
                read_evidence(temporary, &runtime.source, ADMISSION_KIND)?;
            let parsed = parse_admission(&verified_payload, runtime.source.card_count)?;
            if verified_header != expected_header
                || verified_payload != payload
                || parsed.candidate != selected.candidate
                || parsed.queue_numbers
                    != queue
                        .iter()
                        .map(|record| record.candidate.number)
                        .collect::<Vec<_>>()
            {
                return Err("temporary admission verification differs".into());
            }
            Ok(())
        })?;
        let (verified, verified_payload) = read_evidence(&path, &runtime.source, ADMISSION_KIND)?;
        parse_admission(&verified_payload, runtime.source.card_count)?;
        if std::env::var_os("HEXDECK_PSRO_TEST_STOP_AFTER_ADMISSION_RENAME").is_some() {
            return Err("test stop after renamed PSRO admission".into());
        }
        (verified, results, all_pairs, numbers, after, true)
    };
    runtime.matrix = all_pairs;
    state.matrix_numbers = numbers;
    state.matrix_weights = after;
    state.admissions += 1;
    state.generation += 1;
    state.clean_searches = 0;
    state.refs.push(FileRef {
        kind: ADMISSION_KIND,
        generation: state.generation,
        search: state.search,
        ordinal: state.admissions,
        depth: 0,
        payload_crc: verified.payload_crc,
    });
    expanded_files(runtime, state)?;
    if played {
        runtime.games += (results.len() * 250) as u64;
    }
    runtime.transitions.push(TransitionTiming {
        kind: if played {
            "admission".into()
        } else {
            "admission-adopted".into()
        },
        search: state.search,
        ordinal: state.admissions,
        depth: 125,
        candidates: results.len(),
        games: if played {
            (results.len() * 250) as u64
        } else {
            0
        },
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
    });
    let mut remaining = queue
        .into_iter()
        .skip(1)
        .map(|record| record.candidate)
        .collect::<Vec<_>>();
    remaining.sort_by_key(|candidate| candidate.rank);
    state.queue.clear();
    if remaining.is_empty() {
        state.search += 1;
        start_search(runtime, state);
    } else {
        state.retest_ordinal += 1;
        state.phase = Phase::Retest;
        state.race_ordinal = state.retest_ordinal;
        state.fixed_family = remaining.clone();
        state.active = remaining;
        state.look_index = 0;
        state.previous_depth = 0;
        state.next_depth = CONFIRMATION_DEPTHS[0];
    }
    write_checkpoint(&runtime.out, &runtime.source, state, runtime.handshake)
}

#[derive(Clone)]
struct DecisionRecord {
    phase: Phase,
    status: u8,
    search: u32,
    race: u32,
    depth: u32,
    candidate: Candidate,
    family_size: u32,
    bounds: Bounds,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SearchSummary {
    search: u32,
    result: u32,
    provisional: u32,
    confirmed: u32,
    unresolved_screen: u32,
    unresolved_confirmation: u32,
    clean_after: u32,
}

struct ReplayResult {
    state: State,
    decisions: Vec<DecisionRecord>,
    admissions: Vec<ParsedAdmission>,
    summaries: Vec<SearchSummary>,
}

fn weights_equal(left: &[f64], right: &[f64]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .all(|(left, right)| left.to_bits() == right.to_bits())
}

fn candidate_valid(runtime: &Runtime, candidate: &Candidate) -> bool {
    runtime
        .reservoir
        .numbers
        .get(candidate.rank as usize)
        .is_some_and(|number| *number == candidate.number)
}

fn replay_race(
    runtime: &Runtime,
    state: &mut State,
    used_seeds: &mut HashSet<u32>,
    decisions: &mut Vec<DecisionRecord>,
) -> Result<(), String> {
    let phase = state.phase;
    let depths: &[u32] = if phase == Phase::Screen {
        &SCREEN_DEPTHS
    } else {
        &CONFIRMATION_DEPTHS
    };
    let initial = if phase == Phase::Screen {
        runtime.eligible(&state.matrix_numbers)
    } else {
        state.fixed_family.clone()
    };
    if initial.is_empty() {
        return Err("PSRO evidence contains an empty scientific race".into());
    }
    if initial
        .iter()
        .any(|candidate| !candidate_valid(runtime, candidate))
        || initial
            .iter()
            .any(|candidate| state.matrix_numbers.contains(&candidate.number))
    {
        return Err("PSRO race family has an invalid or matrix candidate".into());
    }
    let alpha = if phase == Phase::Screen {
        SCREEN_ALPHA
    } else {
        FAMILY_ALPHA / initial.len() as f64
    };
    let (seed_kind, maximum) = match phase {
        Phase::Screen => ("screen", *SCREEN_DEPTHS.last().expect("screen depth")),
        Phase::Confirmation => (
            "confirmation",
            *CONFIRMATION_DEPTHS.last().expect("confirmation depth"),
        ),
        Phase::Retest => (
            "queue-retest",
            *CONFIRMATION_DEPTHS.last().expect("retest depth"),
        ),
        _ => return Err("PSRO replay expected a race phase".into()),
    };
    let seeds = (0..maximum)
        .map(|position| {
            race_seed(
                &runtime.kingdom.id,
                runtime.source.reservoir_crc,
                runtime.source.pairs_crc,
                state.search,
                seed_kind,
                state.race_ordinal,
                position,
                used_seeds,
            )
            .0
        })
        .collect::<Vec<_>>();
    let schedule = weighted_schedule(&state.matrix_numbers, &state.matrix_weights, &seeds)?;
    let mut active = initial.clone();
    let mut prefixes = initial
        .iter()
        .map(|candidate| (candidate.number, Vec::<u8>::new()))
        .collect::<HashMap<_, _>>();
    let mut previous = 0u32;
    state.active = active.clone();
    state.look_index = 0;
    state.previous_depth = 0;
    state.next_depth = depths[0];
    for (index, depth) in depths.iter().copied().enumerate() {
        if active.is_empty() {
            break;
        }
        let path = look_path(&runtime.out, phase, state.search, state.race_ordinal, depth);
        let kind = look_kind(phase);
        let (header, payload) = read_evidence(&path, &runtime.source, kind)?;
        let (stored_schedule, rows) = parse_look(&header, &payload)?;
        let suffix = &schedule[previous as usize..depth as usize];
        let expected_row_bytes = 36 + suffix.len() + runtime.source.card_count * 4 + 20;
        if header.matrix_generation != state.generation
            || header.search != state.search
            || header.ordinal != state.race_ordinal
            || header.depth != depth
            || header.previous_depth != previous
            || header.family_size != initial.len() as u32
            || header.row_count != active.len() as u32
            || header.row_bytes != expected_row_bytes as u32
            || header.suffix_count != suffix.len() as u32
            || header.alpha.to_bits() != alpha.to_bits()
            || header.threshold.to_bits() != THRESHOLD.to_bits()
            || stored_schedule != suffix
            || rows.iter().map(|row| &row.candidate).ne(active.iter())
        {
            return Err(format!(
                "{} differs from the independently replayed race",
                path.display()
            ));
        }
        let at_cap = index + 1 == depths.len();
        let mut next = Vec::new();
        for row in rows {
            let prefix = prefixes
                .get_mut(&row.candidate.number)
                .ok_or("race row is outside the derived family")?;
            prefix.extend_from_slice(&row.points);
            let expected = confidence(prefix, alpha)?;
            let status = if expected.upper <= THRESHOLD {
                1
            } else if expected.lower > THRESHOLD {
                2
            } else {
                0
            };
            if row.bounds.mean.to_bits() != expected.mean.to_bits()
                || row.bounds.lower.to_bits() != expected.lower.to_bits()
                || row.bounds.upper.to_bits() != expected.upper.to_bits()
                || row.decision != status
            {
                return Err("race confidence or decision differs from its score prefix".into());
            }
            if status == 0 && !at_cap {
                next.push(row.candidate);
            } else {
                decisions.push(DecisionRecord {
                    phase,
                    status,
                    search: state.search,
                    race: state.race_ordinal,
                    depth,
                    candidate: row.candidate.clone(),
                    family_size: initial.len() as u32,
                    bounds: row.bounds,
                });
                if status == 2 {
                    if phase == Phase::Screen {
                        state.fixed_family.push(row.candidate);
                    } else {
                        state.queue.push(QueueRecord {
                            candidate: row.candidate,
                            blocks: depth,
                            source_search: state.search,
                            source_race: state.race_ordinal,
                            bounds: row.bounds,
                        });
                    }
                }
            }
        }
        state.refs.push(FileRef {
            kind,
            generation: state.generation,
            search: state.search,
            ordinal: state.race_ordinal,
            depth,
            payload_crc: header.payload_crc,
        });
        active = next;
        state.active = active.clone();
        state.look_index = (index + 1) as u32;
        state.previous_depth = depth;
        state.next_depth = depths.get(index + 1).copied().unwrap_or(0);
        previous = depth;
    }
    state.active.clear();
    state.look_index = depths.len() as u32;
    if phase == Phase::Screen {
        state.fixed_family.sort_by_key(|candidate| candidate.rank);
    } else {
        order_queue(&mut state.queue);
    }
    Ok(())
}

fn replay_admission(
    runtime: &Runtime,
    state: &mut State,
    pairs: &mut Vec<PairResult>,
    admissions: &mut Vec<ParsedAdmission>,
) -> Result<bool, String> {
    order_queue(&mut state.queue);
    let queue = state.queue.clone();
    let selected = queue.first().ok_or("replayed admission queue is empty")?;
    let ordinal = state.admissions + 1;
    let (header, payload) = read_evidence(
        &admission_path(&runtime.out, ordinal),
        &runtime.source,
        ADMISSION_KIND,
    )?;
    let parsed = parse_admission(&payload, runtime.source.card_count)?;
    let expected_queue = queue
        .iter()
        .map(|record| record.candidate.number)
        .collect::<Vec<_>>();
    let row_bytes = (4 + 125 + 2 * (4 * runtime.source.card_count + 20)) as u32;
    if header.matrix_generation != state.generation + 1
        || header.search != state.search
        || header.ordinal != ordinal
        || header.depth != 0
        || header.previous_depth != 0
        || header.family_size != 0
        || header.row_count != state.matrix_numbers.len() as u32
        || header.row_bytes != row_bytes
        || header.suffix_count != 0
        || header.alpha.to_bits() != 0
        || header.threshold.to_bits() != 0
        || parsed.admission != ordinal
        || parsed.search != state.search
        || parsed.source_race != selected.source_race
        || parsed.candidate != selected.candidate
        || parsed.queue_numbers != expected_queue
        || parsed.bounds.mean.to_bits() != selected.bounds.mean.to_bits()
        || parsed.bounds.lower.to_bits() != selected.bounds.lower.to_bits()
        || parsed.bounds.upper.to_bits() != selected.bounds.upper.to_bits()
        || parsed.before_numbers != state.matrix_numbers
        || !weights_equal(&parsed.before_weights, &state.matrix_weights)
        || parsed.results.len() != state.matrix_numbers.len()
        || parsed
            .results
            .iter()
            .zip(&state.matrix_numbers)
            .any(|(result, number)| {
                result.first != *number || result.second != selected.candidate.number
            })
    {
        return Err(
            "admission differs from the independently replayed strongest queue entry".into(),
        );
    }
    let grown = grow_pairs(pairs, &parsed.results, state.matrix_numbers.len())?;
    let mut expected_numbers = state.matrix_numbers.clone();
    expected_numbers.push(selected.candidate.number);
    let (_, expected_weights) = matrix::matrix_values(&grown, &expected_numbers)?;
    if parsed.after_numbers != expected_numbers
        || !weights_equal(&parsed.after_weights, &expected_weights)
    {
        return Err("admission matrix transition differs from its pair evidence".into());
    }
    state.refs.push(FileRef {
        kind: ADMISSION_KIND,
        generation: state.generation + 1,
        search: state.search,
        ordinal,
        depth: 0,
        payload_crc: header.payload_crc,
    });
    *pairs = grown;
    state.matrix_numbers = expected_numbers;
    state.matrix_weights = expected_weights;
    state.admissions = ordinal;
    state.generation += 1;
    state.clean_searches = 0;
    admissions.push(parsed);
    let mut remaining = queue
        .into_iter()
        .skip(1)
        .map(|record| record.candidate)
        .collect::<Vec<_>>();
    remaining.sort_by_key(|candidate| candidate.rank);
    state.queue.clear();
    if remaining.is_empty() {
        state.search += 1;
        start_search(runtime, state);
        return Ok(false);
    }
    state.retest_ordinal += 1;
    state.phase = Phase::Retest;
    state.race_ordinal = state.retest_ordinal;
    state.fixed_family = remaining.clone();
    state.active = remaining;
    state.look_index = 0;
    state.previous_depth = 0;
    state.next_depth = CONFIRMATION_DEPTHS[0];
    Ok(true)
}

fn search_summary(
    decisions: &[DecisionRecord],
    search: u32,
    admitted: bool,
    clean_after: u32,
) -> SearchSummary {
    let in_search = decisions.iter().filter(|record| record.search == search);
    SearchSummary {
        search,
        result: u32::from(!admitted),
        provisional: in_search
            .clone()
            .filter(|record| record.phase == Phase::Screen && record.status == 2)
            .count() as u32,
        confirmed: in_search
            .clone()
            .filter(|record| record.phase != Phase::Screen && record.status == 2)
            .count() as u32,
        unresolved_screen: in_search
            .clone()
            .filter(|record| record.phase == Phase::Screen && record.status == 0)
            .count() as u32,
        unresolved_confirmation: in_search
            .filter(|record| record.phase != Phase::Screen && record.status == 0)
            .count() as u32,
        clean_after,
    }
}

fn replay_transitions(runtime: &Runtime) -> Result<ReplayResult, String> {
    let initial_numbers = runtime.reservoir.numbers[..runtime.initial_count].to_vec();
    let mut state = State {
        complete: false,
        phase: Phase::Screen,
        search: 1,
        look_index: 0,
        retest_ordinal: 0,
        admissions: 0,
        generation: 0,
        clean_searches: 0,
        matrix_numbers: initial_numbers,
        matrix_weights: runtime.initial_weights.clone(),
        fixed_family: Vec::new(),
        active: Vec::new(),
        queue: Vec::new(),
        refs: Vec::new(),
        race_ordinal: 1,
        previous_depth: 0,
        next_depth: SCREEN_DEPTHS[0],
    };
    start_search(runtime, &mut state);
    let mut used_seeds = [4_100_000, 4_100_001, 4_100_002, 4_100_003]
        .into_iter()
        .chain(FIRST_MATRIX_SEED..=LAST_MATRIX_SEED)
        .collect::<HashSet<_>>();
    let mut pairs = runtime.initial_pairs.clone();
    let mut decisions = Vec::new();
    let mut admissions = Vec::new();
    let mut summaries = Vec::new();
    while !state.complete {
        if state.search > runtime.reservoir.numbers.len() as u32 + 2 {
            return Err("PSRO evidence does not reach its deterministic stop".into());
        }
        let search = state.search;
        state.phase = Phase::Screen;
        state.race_ordinal = 1;
        replay_race(runtime, &mut state, &mut used_seeds, &mut decisions)?;
        if state.fixed_family.is_empty() {
            finish_clean_search(runtime, &mut state);
            summaries.push(search_summary(
                &decisions,
                search,
                false,
                state.clean_searches,
            ));
            continue;
        }
        state.phase = Phase::Confirmation;
        state.active = state.fixed_family.clone();
        state.look_index = 0;
        state.race_ordinal = 1;
        state.previous_depth = 0;
        state.next_depth = CONFIRMATION_DEPTHS[0];
        replay_race(runtime, &mut state, &mut used_seeds, &mut decisions)?;
        if state.queue.is_empty() {
            finish_clean_search(runtime, &mut state);
            summaries.push(search_summary(
                &decisions,
                search,
                false,
                state.clean_searches,
            ));
            continue;
        }
        state.phase = Phase::Admission;
        state.next_depth = 0;
        loop {
            let has_retest = replay_admission(runtime, &mut state, &mut pairs, &mut admissions)?;
            if !has_retest {
                break;
            }
            replay_race(runtime, &mut state, &mut used_seeds, &mut decisions)?;
            if state.queue.is_empty() {
                state.search += 1;
                start_search(runtime, &mut state);
                break;
            }
            state.phase = Phase::Admission;
            state.next_depth = 0;
        }
        summaries.push(search_summary(&decisions, search, true, 0));
    }
    Ok(ReplayResult {
        state,
        decisions,
        admissions,
        summaries,
    })
}

fn decisions_payload(runtime: &Runtime, replay: &ReplayResult) -> Result<Vec<u8>, String> {
    let state = &replay.state;
    let mut payload = Vec::new();
    for value in [
        1,
        1,
        replay.decisions.len() as u32,
        replay.admissions.len() as u32,
        replay.admissions.len() as u32 + 1,
        replay.summaries.len() as u32,
        state.generation,
        state.clean_searches,
    ] {
        put_u32(&mut payload, value);
    }
    for decision in &replay.decisions {
        payload.push(decision.phase as u8);
        payload.push(decision.status);
        payload.extend_from_slice(&[0, 0]);
        for value in [
            decision.search,
            decision.race,
            decision.depth,
            decision.candidate.number,
            decision.candidate.rank,
            decision.depth,
            decision.family_size,
        ] {
            put_u32(&mut payload, value);
        }
        put_f64(&mut payload, decision.bounds.mean);
        put_f64(&mut payload, decision.bounds.lower);
        put_f64(&mut payload, decision.bounds.upper);
    }
    for admission in &replay.admissions {
        for value in [
            admission.admission,
            admission.search,
            admission.source_race,
            admission.candidate.number,
            admission.candidate.rank,
            admission.before_numbers.len() as u32,
            admission.after_numbers.len() as u32,
            admission.queue_numbers.len() as u32,
        ] {
            put_u32(&mut payload, value);
        }
        put_f64(&mut payload, admission.bounds.mean);
        put_f64(&mut payload, admission.bounds.lower);
        put_f64(&mut payload, admission.bounds.upper);
        for number in &admission.queue_numbers {
            put_u32(&mut payload, *number);
        }
    }
    put_u32(&mut payload, 0);
    put_u32(&mut payload, runtime.initial_count as u32);
    for (number, weight) in runtime.reservoir.numbers[..runtime.initial_count]
        .iter()
        .zip(&runtime.initial_weights)
    {
        put_u32(&mut payload, *number);
        put_f64(&mut payload, *weight);
    }
    for admission in &replay.admissions {
        put_u32(&mut payload, admission.admission);
        put_u32(&mut payload, admission.after_numbers.len() as u32);
        for (number, weight) in admission.after_numbers.iter().zip(&admission.after_weights) {
            put_u32(&mut payload, *number);
            put_f64(&mut payload, *weight);
        }
    }
    for summary in &replay.summaries {
        for value in [
            summary.search,
            summary.result,
            summary.provisional,
            summary.confirmed,
            summary.unresolved_screen,
            summary.unresolved_confirmation,
            summary.clean_after,
        ] {
            put_u32(&mut payload, value);
        }
    }
    validate_decisions_payload(&payload)?;
    Ok(payload)
}

fn validate_decisions_payload(payload: &[u8]) -> Result<(), String> {
    if payload.len() < 32 {
        return Err("decisions payload ends before its prefix".into());
    }
    let mut offset = 0;
    let status = get_u32(payload, &mut offset)?;
    let reason = get_u32(payload, &mut offset)?;
    let decision_count = get_u32(payload, &mut offset)? as usize;
    let admission_count = get_u32(payload, &mut offset)? as usize;
    let snapshot_count = get_u32(payload, &mut offset)? as usize;
    let summary_count = get_u32(payload, &mut offset)? as usize;
    let generation = get_u32(payload, &mut offset)? as usize;
    let clean = get_u32(payload, &mut offset)?;
    if status != 1
        || reason != 1
        || snapshot_count != admission_count + 1
        || generation != admission_count
        || clean != 2
    {
        return Err("decisions prefix is invalid".into());
    }
    for _ in 0..decision_count {
        let held = payload
            .get(offset..offset + 56)
            .ok_or("decisions record ends early")?;
        if held[0] > Phase::Retest as u8 || held[1] > 2 || held[2..4].iter().any(|byte| *byte != 0)
        {
            return Err("decisions record enum or padding is invalid".into());
        }
        offset += 56;
    }
    for expected in 1..=admission_count {
        let start = offset;
        let admission = get_u32(payload, &mut offset)? as usize;
        for _ in 0..6 {
            get_u32(payload, &mut offset)?;
        }
        let queue_count = get_u32(payload, &mut offset)? as usize;
        for _ in 0..3 {
            get_f64(payload, &mut offset)?;
        }
        offset = offset
            .checked_add(queue_count * 4)
            .filter(|end| *end <= payload.len())
            .ok_or("decisions admission queue ends early")?;
        if admission != expected || offset - start != 56 + queue_count * 4 {
            return Err("decisions admission section is invalid".into());
        }
    }
    for expected in 0..snapshot_count {
        let generation = get_u32(payload, &mut offset)? as usize;
        let count = get_u32(payload, &mut offset)? as usize;
        for _ in 0..count {
            get_u32(payload, &mut offset)?;
            get_f64(payload, &mut offset)?;
        }
        if generation != expected || count < 2 {
            return Err("decisions equilibrium snapshot is invalid".into());
        }
    }
    for expected in 1..=summary_count {
        let search = get_u32(payload, &mut offset)? as usize;
        let result = get_u32(payload, &mut offset)?;
        for _ in 0..5 {
            get_u32(payload, &mut offset)?;
        }
        if search != expected || result > 1 {
            return Err("decisions search summary is invalid".into());
        }
    }
    if offset != payload.len() {
        return Err("decisions payload has trailing bytes".into());
    }
    Ok(())
}

fn scientific_state(state: &State) -> State {
    let mut scientific = state.clone();
    scientific
        .refs
        .retain(|reference| reference.kind != DECISIONS_KIND);
    scientific
}

fn require_replayed_state(state: &State, replay: &ReplayResult) -> Result<(), String> {
    if scientific_state(state) != replay.state {
        return Err("checkpoint differs from the independently replayed PSRO state".into());
    }
    Ok(())
}

fn ensure_decisions(
    runtime: &Runtime,
    state: &mut State,
    replay: &ReplayResult,
) -> Result<(), String> {
    require_replayed_state(state, replay)?;
    let payload = decisions_payload(runtime, replay)?;
    let mut header = base_header(&runtime.source, &replay.state, DECISIONS_KIND);
    header.ordinal = 0;
    let bytes = file_bytes(header, &payload)?;
    let expected_header = CommonHeader::decode(&bytes)?;
    let path = runtime.out.join("decisions.hpd");
    let verified = if path.exists() {
        let (verified, verified_payload) = read_evidence(&path, &runtime.source, DECISIONS_KIND)?;
        validate_decisions_payload(&verified_payload)?;
        if verified != expected_header || verified_payload != payload {
            return Err("renamed decisions evidence differs from replay".into());
        }
        verified
    } else {
        if state
            .refs
            .iter()
            .any(|reference| reference.kind == DECISIONS_KIND)
        {
            return Err("checkpoint references a missing decisions file".into());
        }
        atomic_write_verified(&path, &bytes, |temporary| {
            let (verified_header, verified_payload) =
                read_evidence(temporary, &runtime.source, DECISIONS_KIND)?;
            validate_decisions_payload(&verified_payload)?;
            if verified_header != expected_header || verified_payload != payload {
                return Err("temporary decisions verification differs".into());
            }
            Ok(())
        })?;
        if std::env::var_os("HEXDECK_PSRO_TEST_STOP_AFTER_DECISIONS_RENAME").is_some() {
            return Err("test stop after renamed PSRO decisions".into());
        }
        expected_header
    };
    let expected_ref = FileRef {
        kind: DECISIONS_KIND,
        generation: replay.state.generation,
        search: replay.state.search,
        ordinal: 0,
        depth: 0,
        payload_crc: verified.payload_crc,
    };
    let decision_refs = state
        .refs
        .iter()
        .filter(|reference| reference.kind == DECISIONS_KIND)
        .collect::<Vec<_>>();
    match decision_refs.as_slice() {
        [] => {
            state.refs.push(expected_ref);
            write_checkpoint(&runtime.out, &runtime.source, state, runtime.handshake)
        }
        [reference] if **reference == expected_ref => Ok(()),
        _ => Err("checkpoint decisions reference differs from replay".into()),
    }
}

#[derive(Default)]
struct Options {
    kingdom: Option<String>,
    top_file: Option<PathBuf>,
    reservoir: Option<PathBuf>,
    matrix_dir: Option<PathBuf>,
    out: Option<PathBuf>,
    threads: Option<usize>,
    report: Option<PathBuf>,
    matrix_size: Option<usize>,
    candidate_limit: Option<usize>,
}

fn parse_options(command: &str, args: &[String]) -> Result<Options, String> {
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
            "--top-file" if options.top_file.is_none() => options.top_file = Some(value.into()),
            "--reservoir" if options.reservoir.is_none() => options.reservoir = Some(value.into()),
            "--matrix-dir" if options.matrix_dir.is_none() => {
                options.matrix_dir = Some(value.into())
            }
            "--out" if options.out.is_none() => options.out = Some(value.into()),
            "--threads" if command == "psro" && options.threads.is_none() => {
                options.threads = Some(value.parse().map_err(|_| "--threads must be positive")?)
            }
            "--report" if command == "psro" && options.report.is_none() => {
                options.report = Some(value.into())
            }
            "--matrix-size" if options.matrix_size.is_none() => {
                options.matrix_size = Some(
                    value
                        .parse()
                        .map_err(|_| "--matrix-size must be at least 2")?,
                )
            }
            "--candidate-limit" if options.candidate_limit.is_none() => {
                options.candidate_limit = Some(
                    value
                        .parse()
                        .map_err(|_| "--candidate-limit must be positive")?,
                )
            }
            _ => return Err(format!("unknown or repeated {command} option {name}")),
        }
        index += 2;
    }
    if options.kingdom.is_none()
        || options.top_file.is_none()
        || options.reservoir.is_none()
        || options.matrix_dir.is_none()
        || options.out.is_none()
    {
        return Err(format!(
            "{command} requires --kingdom, --top-file, --reservoir, --matrix-dir, and --out"
        ));
    }
    if command == "psro" && options.threads.unwrap_or(0) == 0 {
        return Err("psro requires positive --threads".into());
    }
    if options.matrix_size.is_some() != options.candidate_limit.is_some() {
        return Err("--matrix-size and --candidate-limit must be explicit together".into());
    }
    if options.matrix_size.is_some_and(|value| value < 2) || options.candidate_limit == Some(0) {
        return Err("test matrix size or candidate limit is invalid".into());
    }
    Ok(options)
}

fn remove_temporary_files(root: &Path) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|error| format!("read {}: {error}", root.display()))? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_dir() {
            remove_temporary_files(&path)?;
        } else if path
            .file_name()
            .is_some_and(|name| name.to_string_lossy().ends_with(".tmp"))
        {
            fs::remove_file(&path)
                .map_err(|error| format!("remove {}: {error}", path.display()))?;
        }
    }
    Ok(())
}

fn prepare(
    options: &Options,
    threads: usize,
    repair_expanded: bool,
) -> Result<(Runtime, State, bool), String> {
    let kingdom = load_kingdom(options.kingdom.as_deref().expect("kingdom"))?;
    let matrix_size = options.matrix_size.unwrap_or(PRODUCTION_MATRIX_SIZE);
    let candidate_limit = options
        .candidate_limit
        .unwrap_or(PRODUCTION_RESERVOIR_SIZE - PRODUCTION_MATRIX_SIZE);
    let production = options.matrix_size.is_none();
    let reservoir = read_verified_reservoir(
        options.top_file.as_deref().expect("top"),
        options.reservoir.as_deref().expect("reservoir"),
        &kingdom,
        production,
        matrix_size + candidate_limit,
    )?;
    let initial_numbers = reservoir.numbers[..matrix_size].to_vec();
    let selection = ReservoirSelection {
        source_checksum: reservoir.row_checksum,
        numbers: initial_numbers.clone(),
        bytes: 0,
    };
    let matrix_evidence = matrix::load_matrix_evidence(
        &kingdom,
        &selection,
        matrix_size,
        options.matrix_dir.as_deref().expect("matrix dir"),
    )?;
    let source = Source {
        reservoir_crc: reservoir.row_checksum,
        pairs_crc: matrix_evidence.row_crcs[0],
        purchases_crc: matrix_evidence.row_crcs[1],
        matrix_crc: matrix_evidence.row_crcs[2],
        fingerprint: kingdom.fingerprint.clone(),
        card_count: kingdom.all_card_ids.len(),
    };
    let out = options.out.clone().expect("out");
    fs::create_dir_all(&out).map_err(|error| format!("create output: {error}"))?;
    remove_temporary_files(&out)?;
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .map_err(|error| error.to_string())?;
    let mut used_seeds = [4_100_000, 4_100_001, 4_100_002, 4_100_003]
        .into_iter()
        .chain(FIRST_MATRIX_SEED..=LAST_MATRIX_SEED)
        .collect::<HashSet<_>>();
    let handshake = std::env::var_os("HEXDECK_PSRO_HANDSHAKE").is_some();
    let initial_pairs = matrix_evidence.pairs;
    let mut runtime = Runtime {
        kingdom,
        reservoir,
        initial_count: matrix_size,
        initial_weights: matrix_evidence.weights.clone(),
        candidate_limit,
        initial_pairs: initial_pairs.clone(),
        matrix: initial_pairs,
        strategies: HashMap::new(),
        source,
        out,
        pool,
        used_seeds: std::mem::take(&mut used_seeds),
        handshake,
        games: 0,
        transitions: Vec::new(),
    };
    let existing = read_checkpoint(&runtime.out, &runtime.source)?;
    let resumed = existing.is_some();
    let state = existing.unwrap_or_else(|| {
        let mut state = State {
            complete: false,
            phase: Phase::Screen,
            search: 1,
            look_index: 0,
            retest_ordinal: 0,
            admissions: 0,
            generation: 0,
            clean_searches: 0,
            matrix_numbers: initial_numbers,
            matrix_weights: matrix_evidence.weights,
            fixed_family: Vec::new(),
            active: Vec::new(),
            queue: Vec::new(),
            refs: Vec::new(),
            race_ordinal: 1,
            previous_depth: 0,
            next_depth: SCREEN_DEPTHS[0],
        };
        start_search(&runtime, &mut state);
        state
    });
    if state.matrix_numbers[..matrix_size] != runtime.reservoir.numbers[..matrix_size] {
        return Err("checkpoint initial matrix numbers differ from reservoir".into());
    }
    if resumed {
        let current_kind = match state.phase {
            Phase::Screen => Some(SCREEN_KIND),
            Phase::Confirmation => Some(CONFIRMATION_KIND),
            Phase::Retest => Some(RETEST_KIND),
            _ => None,
        };
        let mut restored = HashSet::new();
        for reference in &state.refs {
            if !matches!(
                reference.kind,
                SCREEN_KIND | CONFIRMATION_KIND | RETEST_KIND
            ) {
                continue;
            }
            let key = (reference.kind, reference.search, reference.ordinal);
            if restored.contains(&key)
                || current_kind == Some(reference.kind)
                    && reference.search == state.search
                    && reference.ordinal == state.race_ordinal
            {
                continue;
            }
            restored.insert(key);
            let (kind, maximum) = match reference.kind {
                SCREEN_KIND => ("screen", *SCREEN_DEPTHS.last().expect("screen depth")),
                CONFIRMATION_KIND => (
                    "confirmation",
                    *CONFIRMATION_DEPTHS.last().expect("confirmation depth"),
                ),
                RETEST_KIND => (
                    "queue-retest",
                    *CONFIRMATION_DEPTHS.last().expect("retest depth"),
                ),
                _ => unreachable!(),
            };
            for position in 0..maximum {
                race_seed(
                    &runtime.kingdom.id,
                    runtime.source.reservoir_crc,
                    runtime.source.pairs_crc,
                    reference.search,
                    kind,
                    reference.ordinal,
                    position,
                    &mut runtime.used_seeds,
                );
            }
        }
    }
    if resumed {
        for admission in 1..=state.admissions {
            let (_, payload) = read_evidence(
                &admission_path(&runtime.out, admission),
                &runtime.source,
                ADMISSION_KIND,
            )?;
            let queue_count = u32::from_le_bytes(payload[28..32].try_into().unwrap()) as usize;
            let before_count_offset = 56 + queue_count * 4;
            let before_count = u32::from_le_bytes(
                payload[before_count_offset..before_count_offset + 4]
                    .try_into()
                    .unwrap(),
            ) as usize;
            let after_offset = before_count_offset + 4 + before_count * 12;
            let after_count =
                u32::from_le_bytes(payload[after_offset..after_offset + 4].try_into().unwrap())
                    as usize;
            let row_offset = after_offset + 4 + after_count * 12;
            let row_bytes = 4 + 125 + 2 * (4 * runtime.source.card_count + 20);
            let mut added = Vec::with_capacity(before_count);
            for row in 0..before_count {
                let offset = row_offset + row * row_bytes;
                let first = u32::from_le_bytes(payload[offset..offset + 4].try_into().unwrap());
                let points = payload[offset + 4..offset + 129].to_vec();
                let mut cursor = offset + 129;
                let mut candidate_purchases = vec![0; runtime.source.card_count];
                for value in &mut candidate_purchases {
                    *value = get_u32(&payload, &mut cursor)?;
                }
                let mut candidate_damage = [0; 5];
                for value in &mut candidate_damage {
                    *value = get_u32(&payload, &mut cursor)?;
                }
                let mut opponent_purchases = vec![0; runtime.source.card_count];
                for value in &mut opponent_purchases {
                    *value = get_u32(&payload, &mut cursor)?;
                }
                let mut opponent_damage = [0; 5];
                for value in &mut opponent_damage {
                    *value = get_u32(&payload, &mut cursor)?;
                }
                let candidate = u32::from_le_bytes(payload[12..16].try_into().unwrap());
                added.push(PairResult {
                    first,
                    second: candidate,
                    points,
                    purchases: [opponent_purchases, candidate_purchases],
                    damage: [opponent_damage, candidate_damage],
                });
            }
            runtime.matrix = grow_pairs(&runtime.matrix, &added, before_count)?;
        }
        if state.admissions > 0 {
            let expanded =
                ["pairs.hgm", "purchases.hgm", "matrix.hgm"].map(|name| runtime.out.join(name));
            if expanded.iter().all(|path| path.exists()) {
                let selection = ReservoirSelection {
                    source_checksum: runtime.source.reservoir_crc,
                    numbers: state.matrix_numbers.clone(),
                    bytes: 0,
                };
                matrix::verify_files(
                    &runtime.kingdom,
                    &selection,
                    state.matrix_numbers.len(),
                    &expanded[0],
                    &expanded[1],
                    &expanded[2],
                )?;
            } else if repair_expanded {
                expanded_files(&runtime, &state)?;
            } else {
                return Err("expanded matrix files are incomplete".into());
            }
        }
    }
    Ok((runtime, state, resumed))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunReport {
    command: &'static str,
    kingdom_id: String,
    searches: u32,
    admissions: u32,
    final_matrix_size: usize,
    total_games: u64,
    elapsed_ms: f64,
    games_per_second: f64,
    transitions: Vec<TransitionTiming>,
}

fn run_psro(options: Options) -> Result<(), String> {
    let started = Instant::now();
    let threads = options.threads.expect("threads");
    let report_path = options.report.clone();
    if report_path
        .as_ref()
        .is_some_and(|path| path.extension().is_none_or(|extension| extension != "json"))
    {
        return Err("PSRO --report must name a .json file outside binary evidence".into());
    }
    let (mut runtime, mut state, mut resumed) = prepare(&options, threads, true)?;
    if !state.complete {
        if !resumed {
            write_checkpoint(&runtime.out, &runtime.source, &state, runtime.handshake)?;
        }
        loop {
            match state.phase {
                Phase::Screen => {
                    execute_race(&mut runtime, &mut state, resumed)?;
                    resumed = false;
                    if state.fixed_family.is_empty() {
                        finish_clean_search(&runtime, &mut state);
                    } else {
                        state.phase = Phase::Confirmation;
                        state.active = state.fixed_family.clone();
                        state.look_index = 0;
                        state.race_ordinal = 1;
                        state.previous_depth = 0;
                        state.next_depth = CONFIRMATION_DEPTHS[0];
                    }
                    write_checkpoint(&runtime.out, &runtime.source, &state, runtime.handshake)?;
                }
                Phase::Confirmation | Phase::Retest => {
                    execute_race(&mut runtime, &mut state, resumed)?;
                    resumed = false;
                    if state.queue.is_empty() {
                        if state.phase == Phase::Confirmation {
                            finish_clean_search(&runtime, &mut state);
                        } else {
                            state.search += 1;
                            start_search(&runtime, &mut state);
                        }
                    } else {
                        state.phase = Phase::Admission;
                        state.next_depth = 0;
                    }
                    write_checkpoint(&runtime.out, &runtime.source, &state, runtime.handshake)?;
                }
                Phase::Admission => {
                    admit(&mut runtime, &mut state)?;
                    resumed = false;
                }
                Phase::BetweenSearches => {
                    state.search += 1;
                    start_search(&runtime, &mut state);
                }
                Phase::Complete => break,
            }
            if state.complete {
                break;
            }
        }
        if std::env::var_os("HEXDECK_PSRO_TEST_STOP_AFTER_COMPLETE_CHECKPOINT").is_some() {
            return Err("test stop after complete PSRO checkpoint".into());
        }
    }
    let replay = replay_transitions(&runtime)?;
    ensure_decisions(&runtime, &mut state, &replay)?;
    verify_complete(&runtime, &state)?;
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let report = RunReport {
        command: "psro",
        kingdom_id: runtime.kingdom.id.clone(),
        searches: state.search,
        admissions: state.admissions,
        final_matrix_size: state.matrix_numbers.len(),
        total_games: runtime.games,
        elapsed_ms,
        games_per_second: if elapsed_ms > 0.0 {
            runtime.games as f64 / (elapsed_ms / 1000.0)
        } else {
            0.0
        },
        transitions: runtime.transitions,
    };
    if let Some(path) = report_path {
        let mut bytes = serde_json::to_vec(&report).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        fs::write(path, bytes).map_err(|error| format!("write PSRO report: {error}"))?;
    }
    println!(
        "{}",
        serde_json::json!({"command":"psro","complete":true,"searches":state.search,"admissions":state.admissions,"matrixSize":state.matrix_numbers.len()})
    );
    Ok(())
}

fn verify_look_evidence(runtime: &Runtime, state: &State) -> Result<(), String> {
    let mut used = [4_100_000, 4_100_001, 4_100_002, 4_100_003]
        .into_iter()
        .chain(FIRST_MATRIX_SEED..=LAST_MATRIX_SEED)
        .collect::<HashSet<_>>();
    let mut mixes = vec![(
        runtime.reservoir.numbers[..runtime.initial_count].to_vec(),
        runtime.initial_weights.clone(),
    )];
    for admission in 1..=state.admissions {
        let (_, payload) = read_evidence(
            &admission_path(&runtime.out, admission),
            &runtime.source,
            ADMISSION_KIND,
        )?;
        let parsed = parse_admission(&payload, runtime.source.card_count)?;
        mixes.push((parsed.after_numbers, parsed.after_weights));
    }
    struct RaceCheck {
        schedule: Vec<ScheduleEntry>,
        prefixes: HashMap<u32, Vec<u8>>,
        active: Vec<Candidate>,
        family_size: u32,
        previous_depth: u32,
    }
    let mut races: HashMap<(u32, u32, u32), RaceCheck> = HashMap::new();
    for reference in &state.refs {
        if !matches!(
            reference.kind,
            SCREEN_KIND | CONFIRMATION_KIND | RETEST_KIND
        ) {
            continue;
        }
        let phase = match reference.kind {
            SCREEN_KIND => Phase::Screen,
            CONFIRMATION_KIND => Phase::Confirmation,
            RETEST_KIND => Phase::Retest,
            _ => unreachable!(),
        };
        let path = look_path(
            &runtime.out,
            phase,
            reference.search,
            reference.ordinal,
            reference.depth,
        );
        let (header, payload) = read_evidence(&path, &runtime.source, reference.kind)?;
        if header.payload_crc != reference.payload_crc
            || header.matrix_generation != reference.generation
            || header.search != reference.search
            || header.ordinal != reference.ordinal
            || header.depth != reference.depth
        {
            return Err("look header differs from its checkpoint reference".into());
        }
        let (stored_schedule, rows) = parse_look(&header, &payload)?;
        let key = (reference.kind, reference.search, reference.ordinal);
        if let std::collections::hash_map::Entry::Vacant(entry) = races.entry(key) {
            let (kind, maximum) = match reference.kind {
                SCREEN_KIND => ("screen", *SCREEN_DEPTHS.last().unwrap()),
                CONFIRMATION_KIND => ("confirmation", *CONFIRMATION_DEPTHS.last().unwrap()),
                RETEST_KIND => ("queue-retest", *CONFIRMATION_DEPTHS.last().unwrap()),
                _ => unreachable!(),
            };
            let seeds = (0..maximum)
                .map(|position| {
                    race_seed(
                        &runtime.kingdom.id,
                        runtime.source.reservoir_crc,
                        runtime.source.pairs_crc,
                        reference.search,
                        kind,
                        reference.ordinal,
                        position,
                        &mut used,
                    )
                    .0
                })
                .collect::<Vec<_>>();
            let (numbers, weights) = mixes
                .get(reference.generation as usize)
                .ok_or("look matrix generation is unavailable")?;
            let schedule = weighted_schedule(numbers, weights, &seeds)?;
            let active = rows
                .iter()
                .map(|row| row.candidate.clone())
                .collect::<Vec<_>>();
            if active.windows(2).any(|pair| pair[0].rank >= pair[1].rank)
                || active.len() > header.family_size as usize
            {
                return Err("look candidates are not in reservoir rank order".into());
            }
            entry.insert(RaceCheck {
                schedule,
                prefixes: active
                    .iter()
                    .map(|candidate| (candidate.number, Vec::new()))
                    .collect(),
                active,
                family_size: header.family_size,
                previous_depth: 0,
            });
        }
        let race = races.get_mut(&key).expect("inserted race");
        if header.family_size != race.family_size
            || header.previous_depth != race.previous_depth
            || rows.iter().map(|row| &row.candidate).ne(race.active.iter())
            || stored_schedule
                != race.schedule[header.previous_depth as usize..header.depth as usize]
        {
            return Err("look schedule prefix, family, or active set differs".into());
        }
        let alpha = if reference.kind == SCREEN_KIND {
            SCREEN_ALPHA
        } else {
            FAMILY_ALPHA / f64::from(header.family_size)
        };
        let mut next = Vec::new();
        for row in rows {
            let prefix = race
                .prefixes
                .get_mut(&row.candidate.number)
                .ok_or("look candidate is absent from its race")?;
            prefix.extend_from_slice(&row.points);
            let expected = confidence(prefix, alpha)?;
            let decision = if expected.upper <= THRESHOLD {
                1
            } else if expected.lower > THRESHOLD {
                2
            } else {
                0
            };
            if row.bounds.mean.to_bits() != expected.mean.to_bits()
                || row.bounds.lower.to_bits() != expected.lower.to_bits()
                || row.bounds.upper.to_bits() != expected.upper.to_bits()
                || row.decision != decision
            {
                return Err("look confidence or decision differs from its score prefix".into());
            }
            if decision == 0 {
                next.push(row.candidate);
            }
        }
        race.active = next;
        race.previous_depth = header.depth;
    }
    Ok(())
}

fn scientific_evidence_paths(root: &Path) -> Result<HashSet<PathBuf>, String> {
    fn visit(root: &Path, held: &Path, paths: &mut HashSet<PathBuf>) -> Result<(), String> {
        for entry in
            fs::read_dir(held).map_err(|error| format!("read {}: {error}", held.display()))?
        {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.is_dir() {
                visit(root, &path, paths)?;
            } else if path
                .extension()
                .is_some_and(|extension| matches!(extension.to_str(), Some("hpl" | "hpa" | "hpd")))
            {
                paths.insert(
                    path.strip_prefix(root)
                        .map_err(|_| "PSRO evidence path is outside its root")?
                        .to_path_buf(),
                );
            }
        }
        Ok(())
    }
    let mut paths = HashSet::new();
    visit(root, root, &mut paths)?;
    Ok(paths)
}

fn verify_complete(runtime: &Runtime, state: &State) -> Result<(), String> {
    if !state.complete || state.phase != Phase::Complete || state.clean_searches != 2 {
        return Err("PSRO checkpoint is not complete after two clean searches".into());
    }
    let replay = replay_transitions(runtime)?;
    require_replayed_state(state, &replay)?;
    let expected_payload = decisions_payload(runtime, &replay)?;
    let (decisions_header, decisions) = read_evidence(
        &runtime.out.join("decisions.hpd"),
        &runtime.source,
        DECISIONS_KIND,
    )?;
    validate_decisions_payload(&decisions)?;
    let mut expected_decisions_header = base_header(&runtime.source, &replay.state, DECISIONS_KIND);
    expected_decisions_header.ordinal = 0;
    let expected_header =
        CommonHeader::decode(&file_bytes(expected_decisions_header, &expected_payload)?)?;
    if decisions != expected_payload || decisions_header != expected_header {
        return Err("PSRO decisions differ from independently replayed transitions".into());
    }
    let mut expected_refs = replay.state.refs.clone();
    expected_refs.push(FileRef {
        kind: DECISIONS_KIND,
        generation: replay.state.generation,
        search: replay.state.search,
        ordinal: 0,
        depth: 0,
        payload_crc: decisions_header.payload_crc,
    });
    if state.refs != expected_refs {
        return Err(
            "final checkpoint references differ from independently replayed transitions".into(),
        );
    }
    verify_look_evidence(runtime, state)?;
    let mut expected_paths = replay
        .state
        .refs
        .iter()
        .map(|reference| match reference.kind {
            SCREEN_KIND => look_path(
                Path::new(""),
                Phase::Screen,
                reference.search,
                reference.ordinal,
                reference.depth,
            ),
            CONFIRMATION_KIND => look_path(
                Path::new(""),
                Phase::Confirmation,
                reference.search,
                reference.ordinal,
                reference.depth,
            ),
            RETEST_KIND => look_path(
                Path::new(""),
                Phase::Retest,
                reference.search,
                reference.ordinal,
                reference.depth,
            ),
            ADMISSION_KIND => PathBuf::from(format!("admission-{:04}.hpa", reference.ordinal)),
            _ => unreachable!("replayed scientific reference"),
        })
        .collect::<HashSet<_>>();
    expected_paths.insert(PathBuf::from("decisions.hpd"));
    if scientific_evidence_paths(&runtime.out)? != expected_paths {
        return Err("PSRO output contains a missing or extra scientific race".into());
    }
    if state.admissions > 0 {
        let selection = ReservoirSelection {
            source_checksum: runtime.source.reservoir_crc,
            numbers: replay.state.matrix_numbers.clone(),
            bytes: 0,
        };
        matrix::verify_files(
            &runtime.kingdom,
            &selection,
            replay.state.matrix_numbers.len(),
            &runtime.out.join("pairs.hgm"),
            &runtime.out.join("purchases.hgm"),
            &runtime.out.join("matrix.hgm"),
        )?;
    }
    Ok(())
}

fn run_verify(options: Options) -> Result<(), String> {
    let (runtime, state, _) = prepare(&options, 1, false)?;
    verify_complete(&runtime, &state)?;
    println!(
        "{}",
        serde_json::json!({"command":"psro-verify","valid":true,"searches":state.search,"admissions":state.admissions,"matrixSize":state.matrix_numbers.len()})
    );
    Ok(())
}

pub(crate) fn run(command: &str, args: &[String]) -> Result<(), String> {
    let options = parse_options(command, args)?;
    match command {
        "psro" => run_psro(options),
        "psro-verify" => run_verify(options),
        _ => Err(format!("unknown PSRO command {command}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confidence_bits_are_pinned_at_all_protocol_depths() {
        for (depth, expected) in [
            (8, (0x0000000000000000, 0x3ff0000000000000)),
            (16, (0x3fb0a67000000000, 0x3fedeb3200000000)),
            (32, (0x3fd34f1c00000000, 0x3fe6587200000000)),
            (64, (0x3fd9ef9c00000000, 0x3fe3083200000000)),
            (128, (0x3fdd090e00000000, 0x3fe17b7900000000)),
            (256, (0x3fde88c000000000, 0x3fe0bba000000000)),
            (512, (0x3fdf456a00000000, 0x3fe05d4b00000000)),
        ] {
            let held = confidence(&vec![2; depth], SCREEN_ALPHA).expect("confidence");
            assert_eq!((held.lower.to_bits(), held.upper.to_bits()), expected);
        }
        for (depth, expected_lower) in [
            (400, 0x3fef795300000000),
            (800, 0x3fefbcef00000000),
            (1_600, 0x3fefde8800000000),
            (3_200, 0x3fefef4800000000),
            (6_400, 0x3feff7a500000000),
        ] {
            let held = confidence(&vec![4; depth], 0.025).expect("confidence");
            assert_eq!(
                (held.lower.to_bits(), held.upper.to_bits()),
                (expected_lower, 1.0f64.to_bits())
            );
        }
    }

    #[test]
    fn schedule_uses_prefix_stable_numeric_ties() {
        let seeds = (1..=10).collect::<Vec<_>>();
        let schedule = weighted_schedule(&[10, 2, 99], &[0.5, 0.5, 0.0], &seeds).expect("schedule");
        assert_eq!(
            schedule
                .iter()
                .map(|entry| entry.opponent)
                .collect::<Vec<_>>(),
            vec![2, 10, 2, 10, 2, 10, 2, 10, 2, 10]
        );
        for prefix in 1..=schedule.len() {
            assert_eq!(
                weighted_schedule(&[10, 2, 99], &[0.5, 0.5, 0.0], &seeds[..prefix]).unwrap(),
                schedule[..prefix]
            );
        }
    }

    #[test]
    fn seed_preimages_and_collision_nonces_are_deterministic() {
        let mut used = [4_100_000, 4_200_001].into_iter().collect();
        let first = race_seed("balance-tuning-005", 11, 22, 1, "screen", 1, 0, &mut used);
        assert_eq!(
            first.1,
            "rust-psro-v1:balance-tuning-005:11:22:1:screen:1:0:nonce:0"
        );
        let mut collision = HashSet::from([first.0]);
        let second = race_seed(
            "balance-tuning-005",
            11,
            22,
            1,
            "screen",
            1,
            0,
            &mut collision,
        );
        assert!(second.1.ends_with("nonce:1"));
        assert_ne!(first.0, second.0);
    }

    #[test]
    fn queue_order_uses_every_tie_field() {
        let record = |number, rank, lower, mean, upper| QueueRecord {
            candidate: Candidate { number, rank },
            blocks: 400,
            source_search: 1,
            source_race: 1,
            bounds: Bounds { lower, mean, upper },
        };
        let mut queue = vec![
            record(9, 4, 0.6, 0.7, 0.8),
            record(8, 3, 0.6, 0.7, 0.8),
            record(7, 2, 0.6, 0.7, 0.81),
            record(6, 1, 0.6, 0.71, 0.7),
            record(5, 0, 0.61, 0.6, 0.7),
        ];
        order_queue(&mut queue);
        assert_eq!(
            queue
                .iter()
                .map(|entry| entry.candidate.number)
                .collect::<Vec<_>>(),
            vec![5, 6, 7, 8, 9]
        );
    }

    #[test]
    fn confidence_classifies_every_terminal_status_at_real_protocol_caps() {
        let classify = |scores: Vec<u8>, alpha: f64| {
            let held = confidence(&scores, alpha).unwrap();
            if held.upper <= THRESHOLD {
                1
            } else if held.lower > THRESHOLD {
                2
            } else {
                0
            }
        };
        let threshold_edge = |count: usize| {
            (0..count)
                .map(|index| {
                    if (index + 1) * 51 / 100 > index * 51 / 100 {
                        4
                    } else {
                        0
                    }
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(classify(vec![0; 512], SCREEN_ALPHA), 1);
        assert_eq!(classify(vec![4; 512], SCREEN_ALPHA), 2);
        assert_eq!(classify(threshold_edge(512), SCREEN_ALPHA), 0);
        assert_eq!(classify(vec![0; 6_400], 0.025), 1);
        assert_eq!(classify(vec![4; 400], 0.025), 2);
        assert_eq!(classify(threshold_edge(6_400), 0.025), 0);
    }

    #[test]
    fn asymmetric_expansion_keeps_the_prior_strategy_score() {
        let pair = |first, second, point| PairResult {
            first,
            second,
            points: vec![point; 125],
            purchases: [vec![0], vec![0]],
            damage: [[0; 5]; 2],
        };
        let existing = vec![pair(10, 20, 1)];
        let added = vec![pair(10, 30, 3), pair(20, 30, 4)];
        let grown = grow_pairs(&existing, &added, 2).unwrap();
        assert_eq!(
            grown
                .iter()
                .map(|row| (row.first, row.second, row.points[0]))
                .collect::<Vec<_>>(),
            vec![(10, 20, 1), (10, 30, 3), (20, 30, 4)]
        );
        let rows = matrix::pair_rows(&grown);
        assert_eq!(rows[PAIRS_ROW_BYTES as usize + 8], 3);
    }

    #[test]
    fn checkpoint_round_trip_rejects_reserved_bytes() {
        let state = State {
            complete: false,
            phase: Phase::Admission,
            search: 3,
            look_index: 2,
            retest_ordinal: 1,
            admissions: 2,
            generation: 2,
            clean_searches: 0,
            matrix_numbers: vec![1, 2],
            matrix_weights: vec![0.25, 0.75],
            fixed_family: vec![Candidate { number: 3, rank: 4 }],
            active: Vec::new(),
            queue: vec![QueueRecord {
                candidate: Candidate { number: 4, rank: 5 },
                blocks: 400,
                source_search: 3,
                source_race: 1,
                bounds: Bounds {
                    mean: 0.7,
                    lower: 0.6,
                    upper: 0.8,
                },
            }],
            refs: vec![FileRef {
                kind: 1,
                generation: 0,
                search: 1,
                ordinal: 1,
                depth: 8,
                payload_crc: 9,
            }],
            race_ordinal: 1,
            previous_depth: 400,
            next_depth: 0,
        };
        let bytes = checkpoint_payload(&state);
        assert_eq!(parse_checkpoint(&bytes).expect("checkpoint"), state);
        let mut corrupt = bytes;
        corrupt[60] = 1;
        assert!(parse_checkpoint(&corrupt).is_err());
    }
}
