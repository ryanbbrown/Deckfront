use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::io::{self, BufRead, Write};

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
        #[serde(default)]
        payload: Value,
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
        rng = 1_664_525_u32
            .wrapping_mul(rng)
            .wrapping_add(1_013_904_223);
        let swap = ((u64::from(rng) * (index as u64 + 1)) >> 32) as usize;
        deck.swap(index, swap);
    }
    deck
}

fn parse_thread_budget() -> Result<usize, String> {
    let mut threads = 1_usize;
    let mut cpu_request = 1_usize;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let value = args
            .next()
            .ok_or_else(|| format!("{arg} needs a value"))?
            .parse::<usize>()
            .map_err(|_| format!("{arg} must be a positive integer"))?;
        match arg.as_str() {
            "--threads" => threads = value,
            "--cpu-request" => cpu_request = value,
            _ => return Err(format!("unknown option {arg}")),
        }
    }
    if threads == 0 || cpu_request == 0 || threads > cpu_request {
        return Err(format!(
            "threads ({threads}) must be positive and no greater than CPU request ({cpu_request})"
        ));
    }
    Ok(threads)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _threads = parse_thread_budget().map_err(io::Error::other)?;
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line?;
        let parsed = serde_json::from_str::<Request>(&line);
        let output = match parsed {
            Err(error) => serde_json::to_value(failure::<Value>("invalid_json", error.to_string()))?,
            Ok(Request::Hello {
                protocol_version,
                scorer_version,
                rule_fingerprint,
            }) => {
                if protocol_version != PROTOCOL_VERSION || scorer_version != SCORER_VERSION {
                    serde_json::to_value(failure::<Value>(
                        "version_mismatch",
                        format!(
                            "expected protocol {PROTOCOL_VERSION} and scorer {SCORER_VERSION}"
                        ),
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
            Ok(Request::ScoreBatch { payload }) => serde_json::to_value(failure::<Value>(
                "score_protocol_unavailable",
                format!(
                    "native score batches require the generated compact kingdom schema; received {} bytes",
                    payload.to_string().len()
                ),
            ))?,
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
        assert_eq!(shuffle(11, (0..10).collect()), vec![1, 3, 7, 6, 5, 4, 0, 8, 9, 2]);
    }
}
