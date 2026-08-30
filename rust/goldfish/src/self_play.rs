use crate::kernel::{Kingdom, competitive_game};
use crate::matrix::{FIRST_MATRIX_SEED, LAST_MATRIX_SEED, crc32};
use crate::reservoir::DecodedStrategy;
use rayon::prelude::*;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

const MAGIC: &[u8; 4] = b"HST1";
const VERSION: u32 = 1;
const HEADER_BYTES: usize = 128;
const PROTOCOL: &str = "equilibrium-self-play-v1";
const SEED_COUNT: u32 = 125;
const GAMES_PER_SEED: u32 = 2;
const PLAYER_POSITIONS: u32 = 2;
const PLAYER_SIDES_PER_POSITION: u32 = SEED_COUNT * GAMES_PER_SEED;
pub(crate) const FILE_NAME: &str = "self-play-v1.hst";
const TURN_LIMIT: i16 = 30;
const ACTION_CAP: i16 = 200;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PositionTelemetry {
    pub(crate) player_sides: u32,
    pub(crate) purchases: Vec<u32>,
    pub(crate) damage: [u32; 5],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SelfPlayRow {
    pub(crate) number: u32,
    pub(crate) first: PositionTelemetry,
    pub(crate) second: PositionTelemetry,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Source {
    pub(crate) reservoir_crc: u32,
    pub(crate) pairs_crc: u32,
    pub(crate) purchases_crc: u32,
    pub(crate) matrix_crc: u32,
    pub(crate) generation: u32,
    pub(crate) fingerprint: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Header {
    payload_bytes: u32,
    payload_crc: u32,
    row_count: u32,
    row_bytes: u32,
    card_count: u32,
    source: Source,
}

impl Header {
    fn encode(&self) -> Result<[u8; HEADER_BYTES], String> {
        if !self.source.fingerprint.is_ascii() || self.source.fingerprint.len() > 16 {
            return Err("self-play fingerprint must fit 16 ASCII bytes".into());
        }
        if PROTOCOL.len() > 32 {
            return Err("self-play protocol does not fit its header field".into());
        }
        let mut bytes = [0; HEADER_BYTES];
        bytes[..4].copy_from_slice(MAGIC);
        for (offset, value) in [
            (4, VERSION),
            (8, HEADER_BYTES as u32),
            (12, self.payload_bytes),
            (16, self.payload_crc),
            (20, self.row_count),
            (24, self.row_bytes),
            (28, self.card_count),
            (32, self.source.reservoir_crc),
            (36, self.source.pairs_crc),
            (40, self.source.purchases_crc),
            (44, self.source.matrix_crc),
            (48, FIRST_MATRIX_SEED),
            (52, LAST_MATRIX_SEED),
            (56, SEED_COUNT),
            (60, GAMES_PER_SEED),
            (64, PLAYER_POSITIONS),
            (68, PLAYER_SIDES_PER_POSITION * PLAYER_POSITIONS),
            (72, self.source.generation),
            (76, 0),
        ] {
            bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        bytes[80..80 + self.source.fingerprint.len()]
            .copy_from_slice(self.source.fingerprint.as_bytes());
        bytes[96..96 + PROTOCOL.len()].copy_from_slice(PROTOCOL.as_bytes());
        Ok(bytes)
    }

    fn decode(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() < HEADER_BYTES || &bytes[..4] != MAGIC {
            return Err("self-play magic is invalid".into());
        }
        let word = |offset: usize| {
            u32::from_le_bytes(
                bytes[offset..offset + 4]
                    .try_into()
                    .expect("u32 header word"),
            )
        };
        if word(4) != VERSION || word(8) != HEADER_BYTES as u32 {
            return Err("self-play version or header size is invalid".into());
        }
        if word(48) != FIRST_MATRIX_SEED
            || word(52) != LAST_MATRIX_SEED
            || word(56) != SEED_COUNT
            || word(60) != GAMES_PER_SEED
            || word(64) != PLAYER_POSITIONS
            || word(68) != PLAYER_SIDES_PER_POSITION * PLAYER_POSITIONS
            || word(76) != 0
        {
            return Err("self-play protocol counters are invalid".into());
        }
        let padded = |start: usize, end: usize, label: &str| -> Result<String, String> {
            let held = &bytes[start..end];
            let length = held
                .iter()
                .position(|byte| *byte == 0)
                .unwrap_or(held.len());
            if held[length..].iter().any(|byte| *byte != 0) {
                return Err(format!("self-play {label} padding is invalid"));
            }
            let text = std::str::from_utf8(&held[..length])
                .map_err(|_| format!("self-play {label} is not ASCII"))?;
            if !text.is_ascii() {
                return Err(format!("self-play {label} is not ASCII"));
            }
            Ok(text.to_owned())
        };
        let fingerprint = padded(80, 96, "fingerprint")?;
        if padded(96, 128, "protocol")? != PROTOCOL {
            return Err("self-play protocol tag is invalid".into());
        }
        Ok(Self {
            payload_bytes: word(12),
            payload_crc: word(16),
            row_count: word(20),
            row_bytes: word(24),
            card_count: word(28),
            source: Source {
                reservoir_crc: word(32),
                pairs_crc: word(36),
                purchases_crc: word(40),
                matrix_crc: word(44),
                generation: word(72),
                fingerprint,
            },
        })
    }
}

fn row_bytes(card_count: usize) -> usize {
    4 + 2 * (4 + 4 * card_count + 20)
}

fn add_position(target: &mut PositionTelemetry, source: &crate::kernel::CompetitiveTelemetry) {
    target.player_sides += 1;
    for (total, count) in target.purchases.iter_mut().zip(&source.purchases) {
        *total += u32::try_from(*count).expect("competitive purchases are nonnegative");
    }
    for (family, total) in target.damage.iter_mut().enumerate() {
        *total += u32::try_from(source.family_damage[family])
            .expect("competitive family damage is nonnegative");
    }
}

pub(crate) fn play_one(kingdom: &Kingdom, strategy: &DecodedStrategy) -> SelfPlayRow {
    let blank = || PositionTelemetry {
        player_sides: 0,
        purchases: vec![0; strategy.desired.len()],
        damage: [0; 5],
    };
    let mut first = blank();
    let mut second = blank();
    for seed in FIRST_MATRIX_SEED..=LAST_MATRIX_SEED {
        for first_indigo in [false, true] {
            let game = competitive_game(
                kingdom,
                &strategy.kernel,
                &strategy.kernel,
                seed,
                first_indigo,
                false,
                TURN_LIMIT,
                ACTION_CAP,
            );
            let first_seat = usize::from(first_indigo);
            add_position(&mut first, &game.seats[first_seat]);
            add_position(&mut second, &game.seats[1 - first_seat]);
        }
    }
    debug_assert_eq!(first.player_sides, PLAYER_SIDES_PER_POSITION);
    debug_assert_eq!(second.player_sides, PLAYER_SIDES_PER_POSITION);
    SelfPlayRow {
        number: strategy.number,
        first,
        second,
    }
}

pub(crate) fn play_rows(
    kingdom: &Kingdom,
    strategies: &[DecodedStrategy],
    pool: &rayon::ThreadPool,
) -> Vec<SelfPlayRow> {
    pool.install(|| {
        strategies
            .par_iter()
            .map(|strategy| play_one(kingdom, strategy))
            .collect()
    })
}

fn encode_rows(rows: &[SelfPlayRow], card_count: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(rows.len() * row_bytes(card_count));
    for row in rows {
        if row.first.purchases.len() != card_count || row.second.purchases.len() != card_count {
            return Err("self-play purchase vector differs from kingdom card count".into());
        }
        bytes.extend_from_slice(&row.number.to_le_bytes());
        for position in [&row.first, &row.second] {
            bytes.extend_from_slice(&position.player_sides.to_le_bytes());
            for count in &position.purchases {
                bytes.extend_from_slice(&count.to_le_bytes());
            }
            for damage in position.damage {
                bytes.extend_from_slice(&damage.to_le_bytes());
            }
        }
    }
    Ok(bytes)
}

fn get_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("u32 row word"))
}

fn decode_rows(bytes: &[u8], row_count: usize, card_count: usize) -> Vec<SelfPlayRow> {
    let width = row_bytes(card_count);
    (0..row_count)
        .map(|row| {
            let mut offset = row * width;
            let number = get_u32(bytes, offset);
            offset += 4;
            let mut position = || {
                let player_sides = get_u32(bytes, offset);
                offset += 4;
                let purchases = (0..card_count)
                    .map(|_| {
                        let value = get_u32(bytes, offset);
                        offset += 4;
                        value
                    })
                    .collect();
                let mut damage = [0; 5];
                for value in &mut damage {
                    *value = get_u32(bytes, offset);
                    offset += 4;
                }
                PositionTelemetry {
                    player_sides,
                    purchases,
                    damage,
                }
            };
            let first = position();
            let second = position();
            SelfPlayRow {
                number,
                first,
                second,
            }
        })
        .collect()
}

fn bytes(rows: &[SelfPlayRow], card_count: usize, source: &Source) -> Result<Vec<u8>, String> {
    let payload = encode_rows(rows, card_count)?;
    let header = Header {
        payload_bytes: u32::try_from(payload.len())
            .map_err(|_| "self-play payload is too large")?,
        payload_crc: crc32(&payload),
        row_count: u32::try_from(rows.len()).map_err(|_| "too many self-play rows")?,
        row_bytes: u32::try_from(row_bytes(card_count)).expect("self-play row size fits u32"),
        card_count: u32::try_from(card_count).map_err(|_| "too many kingdom cards")?,
        source: source.clone(),
    };
    let mut result = header.encode()?.to_vec();
    result.extend_from_slice(&payload);
    Ok(result)
}

fn write_synced(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    let mut file =
        File::create(path).map_err(|error| format!("create {}: {error}", path.display()))?;
    file.write_all(contents)
        .map_err(|error| format!("write {}: {error}", path.display()))?;
    file.flush()
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("sync {}: {error}", path.display()))
}

pub(crate) fn write_temporary(
    final_path: &Path,
    rows: &[SelfPlayRow],
    card_count: usize,
    source: &Source,
) -> Result<PathBuf, String> {
    let temporary = PathBuf::from(format!("{}.tmp", final_path.display()));
    let contents = bytes(rows, card_count, source)?;
    write_synced(&temporary, &contents)?;
    let decoded = read(
        &temporary,
        rows.iter()
            .map(|row| row.number)
            .collect::<Vec<_>>()
            .as_slice(),
        card_count,
        source,
    )?;
    if decoded != rows {
        return Err("temporary self-play rows differ after verification".into());
    }
    Ok(temporary)
}

pub(crate) fn publish_temporary(temporary: &Path, final_path: &Path) -> Result<(), String> {
    fs::rename(temporary, final_path)
        .map_err(|error| format!("publish {}: {error}", final_path.display()))?;
    let parent = final_path.parent().ok_or("self-play path has no parent")?;
    File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("sync {}: {error}", parent.display()))
}

pub(crate) fn write_atomic(
    path: &Path,
    rows: &[SelfPlayRow],
    card_count: usize,
    source: &Source,
) -> Result<(), String> {
    if path.exists() {
        let expected = rows.iter().map(|row| row.number).collect::<Vec<_>>();
        let held = read(path, &expected, card_count, source)?;
        if held != rows {
            return Err(format!(
                "{} contains different self-play telemetry",
                path.display()
            ));
        }
        return Ok(());
    }
    let temporary = write_temporary(path, rows, card_count, source)?;
    publish_temporary(&temporary, path)
}

pub(crate) fn verify_strategy_bounds(
    rows: &[SelfPlayRow],
    strategies: &[DecodedStrategy],
    all_card_ids: &[String],
) -> Result<(), String> {
    if rows.len() != strategies.len() {
        return Err("self-play rows differ from strategy count".into());
    }
    for (row, strategy) in rows.iter().zip(strategies) {
        if row.number != strategy.number || strategy.desired.len() != all_card_ids.len() {
            return Err("self-play row differs from its decoded strategy".into());
        }
        for position in [&row.first, &row.second] {
            for (card, count) in position.purchases.iter().enumerate() {
                let id = &all_card_ids[card];
                let desired = strategy.desired[card];
                if (desired == 0 && *count != 0)
                    || ((id == "copper" || id == "scrap") && *count != 0)
                    || *count > position.player_sides * desired
                {
                    return Err(format!(
                        "self-play purchase count for strategy {} card {id} is invalid",
                        row.number
                    ));
                }
            }
        }
    }
    Ok(())
}

pub(crate) fn read(
    path: &Path,
    numbers: &[u32],
    card_count: usize,
    source: &Source,
) -> Result<Vec<SelfPlayRow>, String> {
    let contents = fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    let header = Header::decode(&contents)?;
    if header.source != *source
        || header.card_count as usize != card_count
        || header.row_count as usize != numbers.len()
        || header.row_bytes as usize != row_bytes(card_count)
        || contents.len() != HEADER_BYTES + header.payload_bytes as usize
        || header.payload_bytes as usize != numbers.len() * row_bytes(card_count)
    {
        return Err(format!(
            "{} self-play header or source differs",
            path.display()
        ));
    }
    let payload = &contents[HEADER_BYTES..];
    if crc32(payload) != header.payload_crc {
        return Err(format!("{} self-play payload CRC differs", path.display()));
    }
    let rows = decode_rows(payload, numbers.len(), card_count);
    for (index, row) in rows.iter().enumerate() {
        if row.number != numbers[index]
            || row.first.player_sides != PLAYER_SIDES_PER_POSITION
            || row.second.player_sides != PLAYER_SIDES_PER_POSITION
        {
            return Err(format!(
                "{} self-play row order or player-side count differs",
                path.display()
            ));
        }
        for position in [&row.first, &row.second] {
            if position
                .damage
                .iter()
                .any(|value| *value > PLAYER_SIDES_PER_POSITION * 50)
            {
                return Err(format!(
                    "{} self-play damage exceeds its game bound",
                    path.display()
                ));
            }
        }
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source() -> Source {
        Source {
            reservoir_crc: 1,
            pairs_crc: 2,
            purchases_crc: 3,
            matrix_crc: 4,
            generation: 5,
            fingerprint: "abc".into(),
        }
    }

    fn row() -> SelfPlayRow {
        SelfPlayRow {
            number: 17,
            first: PositionTelemetry {
                player_sides: 250,
                purchases: vec![1, 2],
                damage: [3, 4, 5, 6, 7],
            },
            second: PositionTelemetry {
                player_sides: 250,
                purchases: vec![8, 9],
                damage: [10, 11, 12, 13, 14],
            },
        }
    }

    #[test]
    fn format_round_trip_pins_header_and_both_positions() {
        let contents = bytes(&[row()], 2, &source()).expect("self-play bytes");
        assert_eq!(&contents[..4], b"HST1");
        assert_eq!(u32::from_le_bytes(contents[4..8].try_into().unwrap()), 1);
        assert_eq!(
            u32::from_le_bytes(contents[68..72].try_into().unwrap()),
            500
        );
        let path =
            std::env::temp_dir().join(format!("hexdeck-self-play-{}.hst", std::process::id()));
        fs::write(&path, contents).expect("write fixture");
        assert_eq!(
            read(&path, &[17], 2, &source()).expect("read fixture"),
            vec![row()]
        );
        fs::remove_file(path).expect("remove fixture");
    }

    #[test]
    fn format_rejects_wrong_source_and_crc() {
        let mut contents = bytes(&[row()], 2, &source()).expect("self-play bytes");
        let path = std::env::temp_dir().join(format!(
            "hexdeck-self-play-corrupt-{}.hst",
            std::process::id()
        ));
        contents[HEADER_BYTES + 1] ^= 1;
        fs::write(&path, &contents).expect("write corrupt fixture");
        assert!(
            read(&path, &[17], 2, &source())
                .unwrap_err()
                .contains("CRC")
        );
        fs::write(&path, bytes(&[row()], 2, &source()).unwrap()).expect("write valid fixture");
        let mut other = source();
        other.matrix_crc += 1;
        assert!(
            read(&path, &[17], 2, &other)
                .unwrap_err()
                .contains("source differs")
        );
        fs::remove_file(path).expect("remove fixture");
    }
}
