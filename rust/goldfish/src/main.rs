use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::io::{self, BufRead, Write};

mod equilibrium;
mod kernel;
mod matrix;
mod psro;
mod reservoir;
mod self_play;

const PROTOCOL_VERSION: u32 = 1;
const SCORER_VERSION: &str = "native-goldfish-v1";

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Request {
    Hello {
        protocol_version: u32,
        scorer_version: String,
        rule_fingerprint: String,
    },
    Shuffle {
        seed: u32,
        deck: Vec<i32>,
    },
    CompareUtf16 {
        left: String,
        right: String,
    },
    StableHash {
        text: String,
    },
    ScoreBatch {
        payload: kernel::BatchInput,
    },
    LoadCompetitive {
        payload: kernel::CompetitiveLoadInput,
    },
    ScoreCompetitive {
        payload: kernel::CompetitiveScoreInput,
    },
    ScoreSeatBias {
        payload: kernel::SeatBiasScoreInput,
    },
    FixtureCompetitive {
        payload: kernel::CompetitiveFixtureInput,
    },
}

#[derive(Debug, Serialize)]
struct Response<T: Serialize> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ProtocolError>,
}

#[derive(Debug, Serialize)]
struct ProtocolError {
    code: &'static str,
    message: String,
}

fn success<T: Serialize>(result: T) -> Response<T> {
    Response {
        ok: true,
        result: Some(result),
        error: None,
    }
}

fn failure<T: Serialize>(code: &'static str, message: impl Into<String>) -> Response<T> {
    Response {
        ok: false,
        result: None,
        error: Some(ProtocolError {
            code,
            message: message.into(),
        }),
    }
}

fn compare_utf16(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

pub(crate) fn stable_hash_value(text: &str) -> u32 {
    let mut hash = 0x811c9dc5_u32;
    for unit in text.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

fn stable_hash(text: &str) -> String {
    let mut hash = 0x811c9dc5_u32;
    let mut length = 0_u32;
    for unit in text.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(0x01000193);
        length = length.wrapping_add(1);
    }
    format!("{hash:08x}{length:x}")
}

fn shuffle(seed: u32, mut deck: Vec<i32>) -> Vec<i32> {
    let mut rng = seed;
    for index in (1..deck.len()).rev() {
        rng = 1_664_525_u32.wrapping_mul(rng).wrapping_add(1_013_904_223);
        let swap = ((u64::from(rng) * (index as u64 + 1)) >> 32) as usize;
        deck.swap(index, swap);
    }
    deck
}

struct RuntimeOptions {
    thread_budget: usize,
}

fn parse_runtime_options(args: &[String]) -> Result<RuntimeOptions, String> {
    let mut threads = 1_usize;
    let mut cpu_request = 1_usize;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let value = args
            .get(index + 1)
            .ok_or_else(|| format!("{arg} needs a value"))?
            .parse::<usize>()
            .map_err(|_| format!("{arg} must be a positive integer"))?;
        match arg.as_str() {
            "--threads" => threads = value,
            "--cpu-request" => cpu_request = value,
            _ => return Err(format!("unknown option {arg}")),
        }
        index += 2;
    }
    if threads == 0 || cpu_request == 0 || threads > cpu_request {
        return Err(format!(
            "threads ({threads}) must be positive and no greater than CPU request ({cpu_request})"
        ));
    }
    Ok(RuntimeOptions {
        thread_budget: threads,
    })
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(command @ ("matrix" | "matrix-verify")) = args.first().map(String::as_str) {
        return matrix::run(command, &args[1..])
            .map_err(|message| io::Error::other(message).into());
    }
    if let Some(command @ ("psro" | "psro-verify" | "self-play-backfill")) =
        args.first().map(String::as_str)
    {
        return psro::run(command, &args[1..]).map_err(|message| io::Error::other(message).into());
    }
    if let Some(command) = args.first().filter(|value| !value.starts_with("--")) {
        return reservoir::run(command, &args[1..])
            .map_err(|message| io::Error::other(message).into());
    }
    let options = parse_runtime_options(&args).map_err(io::Error::other)?;
    let thread_budget = options.thread_budget;
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    let mut competitive_session: Option<kernel::CompetitiveSession> = None;
    for line in stdin.lock().lines() {
        let line = line?;
        let parsed = serde_json::from_str::<Request>(&line);
        let output = match parsed {
            Err(error) => {
                serde_json::to_value(failure::<Value>("invalid_json", error.to_string()))?
            }
            Ok(Request::Hello {
                protocol_version,
                scorer_version,
                rule_fingerprint,
            }) => {
                if protocol_version != PROTOCOL_VERSION || scorer_version != SCORER_VERSION {
                    serde_json::to_value(failure::<Value>(
                        "version_mismatch",
                        format!("expected protocol {PROTOCOL_VERSION} and scorer {SCORER_VERSION}"),
                    ))?
                } else if rule_fingerprint.is_empty() {
                    serde_json::to_value(failure::<Value>(
                        "rule_fingerprint",
                        "rule fingerprint must not be empty",
                    ))?
                } else {
                    serde_json::to_value(success(serde_json::json!({
                        "protocolVersion": PROTOCOL_VERSION,
                        "scorerVersion": SCORER_VERSION,
                        "ruleFingerprint": rule_fingerprint,
                    })))?
                }
            }
            Ok(Request::Shuffle { seed, deck }) => {
                serde_json::to_value(success(serde_json::json!({ "deck": shuffle(seed, deck) })))?
            }
            Ok(Request::CompareUtf16 { left, right }) => {
                let sign = match compare_utf16(&left, &right) {
                    Ordering::Less => -1,
                    Ordering::Equal => 0,
                    Ordering::Greater => 1,
                };
                serde_json::to_value(success(serde_json::json!({ "sign": sign })))?
            }
            Ok(Request::StableHash { text }) => {
                serde_json::to_value(success(serde_json::json!({ "hash": stable_hash(&text) })))?
            }
            Ok(Request::ScoreBatch { payload }) if payload.threads != thread_budget => {
                serde_json::to_value(failure::<Value>(
                    "thread_budget",
                    "payload threads must equal the process thread budget",
                ))?
            }
            Ok(Request::ScoreBatch { payload }) => match kernel::score_batch(payload) {
                Ok(scores) => {
                    serde_json::to_value(success(serde_json::json!({ "scores": scores })))?
                }
                Err(message) => serde_json::to_value(failure::<Value>("score_error", message))?,
            },
            Ok(Request::LoadCompetitive { payload }) if payload.threads != thread_budget => {
                serde_json::to_value(failure::<Value>(
                    "thread_budget",
                    "competitive payload threads must equal the process thread budget",
                ))?
            }
            Ok(Request::LoadCompetitive { payload }) => {
                let load_id = payload.load_id.clone();
                let strategy_count = payload.strategies.len();
                match kernel::load_competitive(payload) {
                    Ok(session) => {
                        competitive_session = Some(session);
                        serde_json::to_value(success(serde_json::json!({
                            "loadId": load_id,
                            "strategyCount": strategy_count,
                        })))?
                    }
                    Err(message) => {
                        serde_json::to_value(failure::<Value>("competitive_load_error", message))?
                    }
                }
            }
            Ok(Request::ScoreCompetitive { payload }) => match &competitive_session {
                Some(session) => match kernel::score_competitive(session, payload) {
                    Ok(score) => serde_json::to_value(success(score))?,
                    Err(message) => {
                        serde_json::to_value(failure::<Value>("competitive_score_error", message))?
                    }
                },
                None => serde_json::to_value(failure::<Value>(
                    "competitive_not_loaded",
                    "load competitive strategies before scoring",
                ))?,
            },
            Ok(Request::ScoreSeatBias { payload }) => match &competitive_session {
                Some(session) => match kernel::score_seat_bias(session, payload) {
                    Ok(score) => serde_json::to_value(success(score))?,
                    Err(message) => {
                        serde_json::to_value(failure::<Value>("seat_bias_score_error", message))?
                    }
                },
                None => serde_json::to_value(failure::<Value>(
                    "competitive_not_loaded",
                    "load competitive strategies before seat-bias scoring",
                ))?,
            },
            Ok(Request::FixtureCompetitive { payload }) => match &competitive_session {
                Some(session) => match kernel::fixture_competitive(session, payload) {
                    Ok(result) => serde_json::to_value(success(result))?,
                    Err(message) => serde_json::to_value(failure::<Value>(
                        "competitive_fixture_error",
                        message,
                    ))?,
                },
                None => serde_json::to_value(failure::<Value>(
                    "competitive_not_loaded",
                    "load competitive strategies before fixture evaluation",
                ))?,
            },
        };
        serde_json::to_writer(&mut stdout, &output)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_utf16_code_unit_order() {
        assert_eq!(compare_utf16("a", "A"), Ordering::Greater);
        assert_eq!(compare_utf16("x😀", "x￿"), Ordering::Less);
    }

    #[test]
    fn hashes_utf16_like_typescript() {
        assert_eq!(stable_hash("hello"), "4f9f2cab5");
        assert_eq!(stable_hash("😀"), "cb31c4b82");
    }

    #[test]
    fn shuffles_with_the_kernel_lcg() {
        assert_eq!(
            shuffle(11, (0..10).collect()),
            vec![1, 3, 7, 6, 5, 4, 0, 8, 9, 2]
        );
    }
}
