use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const BINARY: &str = env!("CARGO_BIN_EXE_hexdeck-goldfish");
const KINGDOM: &str = "balance-tuning-005";
const MATRIX_SIZE: &str = "2";
const CANDIDATE_LIMIT: &str = "20";

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(name)
}

fn temporary(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "hexdeck-psro-{name}-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&path).expect("temporary directory");
    path
}

fn initial_matrix(root: &Path, threads: usize) -> PathBuf {
    let out = root.join("initial-matrix");
    let output = Command::new(BINARY)
        .args([
            "matrix",
            "--kingdom",
            KINGDOM,
            "--reservoir",
            fixture("balance-tuning-005-psro-reservoir.hgf")
                .to_str()
                .unwrap(),
            "--out",
            out.to_str().unwrap(),
            "--threads",
            &threads.to_string(),
            "--top",
            MATRIX_SIZE,
        ])
        .output()
        .expect("matrix command");
    assert!(
        output.status.success(),
        "matrix failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    out
}

fn psro(matrix: &Path, out: &Path, threads: usize, environment: Option<(&str, &str)>) -> Output {
    let mut command = Command::new(BINARY);
    command.args([
        "psro",
        "--kingdom",
        KINGDOM,
        "--top-file",
        fixture("balance-tuning-005-psro-top.hgf").to_str().unwrap(),
        "--reservoir",
        fixture("balance-tuning-005-psro-reservoir.hgf")
            .to_str()
            .unwrap(),
        "--matrix-dir",
        matrix.to_str().unwrap(),
        "--out",
        out.to_str().unwrap(),
        "--threads",
        &threads.to_string(),
        "--matrix-size",
        MATRIX_SIZE,
        "--candidate-limit",
        CANDIDATE_LIMIT,
    ]);
    if let Some((name, value)) = environment {
        command.env(name, value);
    }
    command.output().expect("PSRO command")
}

fn psro_report(
    matrix: &Path,
    out: &Path,
    threads: usize,
    environment: Option<(&str, &str)>,
    report: &Path,
) -> Output {
    let mut command = Command::new(BINARY);
    command.args([
        "psro",
        "--kingdom",
        KINGDOM,
        "--top-file",
        fixture("balance-tuning-005-psro-top.hgf").to_str().unwrap(),
        "--reservoir",
        fixture("balance-tuning-005-psro-reservoir.hgf")
            .to_str()
            .unwrap(),
        "--matrix-dir",
        matrix.to_str().unwrap(),
        "--out",
        out.to_str().unwrap(),
        "--threads",
        &threads.to_string(),
        "--matrix-size",
        MATRIX_SIZE,
        "--candidate-limit",
        CANDIDATE_LIMIT,
        "--report",
        report.to_str().unwrap(),
    ]);
    if let Some((name, value)) = environment {
        command.env(name, value);
    }
    command.output().expect("PSRO report command")
}

fn psro_handshake_report(
    matrix: &Path,
    out: &Path,
    threads: usize,
    report: &Path,
    acknowledgement_delay: Duration,
) -> Output {
    let mut child = Command::new(BINARY)
        .args([
            "psro",
            "--kingdom",
            KINGDOM,
            "--top-file",
            fixture("balance-tuning-005-psro-top.hgf").to_str().unwrap(),
            "--reservoir",
            fixture("balance-tuning-005-psro-reservoir.hgf")
                .to_str()
                .unwrap(),
            "--matrix-dir",
            matrix.to_str().unwrap(),
            "--out",
            out.to_str().unwrap(),
            "--threads",
            &threads.to_string(),
            "--matrix-size",
            MATRIX_SIZE,
            "--candidate-limit",
            CANDIDATE_LIMIT,
            "--report",
            report.to_str().unwrap(),
        ])
        .env("HEXDECK_PSRO_HANDSHAKE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("PSRO handshake command");
    let mut input = child.stdin.take().expect("PSRO stdin");
    let output = child.stdout.take().expect("PSRO stdout");
    let errors = child.stderr.take().expect("PSRO stderr");
    let drain = std::thread::spawn(move || {
        let mut stderr = Vec::new();
        BufReader::new(errors)
            .read_to_end(&mut stderr)
            .expect("read PSRO stderr");
        stderr
    });
    let mut stdout = Vec::new();
    let mut delayed = false;
    for line in BufReader::new(output).lines() {
        let line = line.expect("PSRO stdout line");
        stdout.extend_from_slice(line.as_bytes());
        stdout.push(b'\n');
        let Some(handshake) = line.strip_prefix("checkpoint ") else {
            continue;
        };
        let ordinal = handshake
            .split_whitespace()
            .next()
            .expect("checkpoint ordinal");
        if !delayed {
            std::thread::sleep(acknowledgement_delay);
            delayed = true;
        }
        writeln!(input, "committed {ordinal}").expect("checkpoint acknowledgement");
        input.flush().expect("flush checkpoint acknowledgement");
    }
    drop(input);
    let status = child.wait().expect("PSRO handshake wait");
    let stderr = drain.join().expect("join PSRO stderr drain");
    Output {
        status,
        stdout,
        stderr,
    }
}

fn verify_threads(matrix: &Path, out: &Path, threads: Option<usize>) -> Output {
    let mut command = Command::new(BINARY);
    command.args([
        "psro-verify",
        "--kingdom",
        KINGDOM,
        "--top-file",
        fixture("balance-tuning-005-psro-top.hgf").to_str().unwrap(),
        "--reservoir",
        fixture("balance-tuning-005-psro-reservoir.hgf")
            .to_str()
            .unwrap(),
        "--matrix-dir",
        matrix.to_str().unwrap(),
        "--out",
        out.to_str().unwrap(),
        "--matrix-size",
        MATRIX_SIZE,
        "--candidate-limit",
        CANDIDATE_LIMIT,
    ]);
    if let Some(threads) = threads {
        command.args(["--threads", &threads.to_string()]);
    }
    command.output().expect("PSRO verify")
}

fn verify(matrix: &Path, out: &Path) -> Output {
    verify_threads(matrix, out, None)
}

fn self_play_backfill(matrix: &Path, out: &Path, threads: usize) -> Output {
    Command::new(BINARY)
        .args([
            "self-play-backfill",
            "--kingdom",
            KINGDOM,
            "--top-file",
            fixture("balance-tuning-005-psro-top.hgf").to_str().unwrap(),
            "--reservoir",
            fixture("balance-tuning-005-psro-reservoir.hgf")
                .to_str()
                .unwrap(),
            "--matrix-dir",
            matrix.to_str().unwrap(),
            "--out",
            out.to_str().unwrap(),
            "--threads",
            &threads.to_string(),
            "--matrix-size",
            MATRIX_SIZE,
            "--candidate-limit",
            CANDIDATE_LIMIT,
        ])
        .output()
        .expect("self-play backfill")
}

fn copy_tree(source: &Path, target: &Path) {
    fs::create_dir_all(target).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let path = entry.unwrap().path();
        let destination = target.join(path.file_name().unwrap());
        if path.is_dir() {
            copy_tree(&path, &destination);
        } else {
            fs::copy(path, destination).unwrap();
        }
    }
}

fn evidence(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn visit(root: &Path, held: &Path, files: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(held).expect("read evidence directory") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                visit(root, &path, files);
            } else {
                files.insert(
                    path.strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                    fs::read(path).unwrap(),
                );
            }
        }
    }
    let mut files = BTreeMap::new();
    visit(root, root, &mut files);
    files
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320u32 & 0u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}

fn write_empty_family_reservoir(source: &Path, target: &Path, admitted: u32) {
    let bytes = fs::read(source).expect("reservoir fixture");
    let row_bytes = word(&bytes, 8) as usize;
    let row_count = word(&bytes, 20) as usize;
    let rows = bytes[64..]
        .chunks_exact(row_bytes)
        .take(row_count)
        .collect::<Vec<_>>();
    let mut selected = rows[..2].to_vec();
    selected.push(
        rows.iter()
            .copied()
            .find(|row| word(row, 0) == admitted)
            .expect("admitted candidate row"),
    );
    let payload = selected.into_iter().flatten().copied().collect::<Vec<_>>();
    let mut subset = bytes[..64].to_vec();
    subset[20..24].copy_from_slice(&3u32.to_le_bytes());
    subset[24..28].copy_from_slice(&crc32(&payload).to_le_bytes());
    subset.extend_from_slice(&payload);
    fs::write(target, subset).expect("empty-family reservoir fixture");
}

fn reseal(bytes: &mut [u8]) {
    let payload_bytes = bytes.len() - 128;
    let payload_crc = crc32(&bytes[128..]);
    bytes[16..20].copy_from_slice(&(payload_bytes as u32).to_le_bytes());
    bytes[20..24].copy_from_slice(&payload_crc.to_le_bytes());
}

fn word(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

fn update_checkpoint_reference(out: &Path, identity: [u32; 5], old_crc: u32, new_crc: u32) {
    if old_crc == new_crc {
        return;
    }
    let path = out.join("checkpoint.hpc");
    let mut bytes = fs::read(&path).unwrap();
    let payload = &mut bytes[128..];
    let matrix_count = word(payload, 28) as usize;
    let fixed_count = word(payload, 32) as usize;
    let active_count = word(payload, 36) as usize;
    let queue_count = word(payload, 40) as usize;
    let reference_count = word(payload, 44) as usize;
    let start = 96 + matrix_count * 12 + (fixed_count + active_count) * 8 + queue_count * 48;
    let mut found = false;
    for index in 0..reference_count {
        let offset = start + index * 24;
        let actual = [
            word(payload, offset),
            word(payload, offset + 4),
            word(payload, offset + 8),
            word(payload, offset + 12),
            word(payload, offset + 16),
        ];
        if actual == identity {
            assert_eq!(word(payload, offset + 20), old_crc);
            payload[offset + 20..offset + 24].copy_from_slice(&new_crc.to_le_bytes());
            found = true;
        }
    }
    assert!(found, "checkpoint reference was not found");
    reseal(&mut bytes);
    fs::write(path, bytes).unwrap();
}

fn corrupt_semantically<F>(baseline: &Path, target: &Path, relative: &str, mutate: F)
where
    F: FnOnce(&mut Vec<u8>),
{
    copy_tree(baseline, target);
    let path = target.join(relative);
    let mut bytes = fs::read(&path).unwrap();
    let identity = [
        u32::from_le_bytes(bytes[8..12].try_into().unwrap()),
        u32::from_le_bytes(bytes[40..44].try_into().unwrap()),
        u32::from_le_bytes(bytes[44..48].try_into().unwrap()),
        u32::from_le_bytes(bytes[48..52].try_into().unwrap()),
        u32::from_le_bytes(bytes[52..56].try_into().unwrap()),
    ];
    let old_crc = u32::from_le_bytes(bytes[20..24].try_into().unwrap());
    mutate(&mut bytes);
    reseal(&mut bytes);
    let new_crc = u32::from_le_bytes(bytes[20..24].try_into().unwrap());
    fs::write(path, bytes).unwrap();
    update_checkpoint_reference(target, identity, old_crc, new_crc);
}

fn assert_timing_equation(report: &Path) {
    let report: serde_json::Value =
        serde_json::from_slice(&fs::read(report).unwrap()).expect("timing report");
    let transitions = report["transitions"].as_array().expect("transitions");
    let transition_ms = transitions
        .iter()
        .map(|transition| {
            let game = transition["gameMs"].as_f64().expect("gameMs");
            let evaluate = transition["evaluateMs"].as_f64().expect("evaluateMs");
            let elapsed = transition["elapsedMs"]
                .as_f64()
                .expect("transition elapsedMs");
            assert!((game + evaluate - elapsed).abs() < 1e-6);
            elapsed
        })
        .sum::<f64>();
    let other_ms = report["otherMs"].as_f64().expect("otherMs");
    assert!(other_ms >= 0.0);
    let measured = report["startupMs"].as_f64().expect("startupMs")
        + transition_ms
        + report["evidenceWriteMs"].as_f64().expect("evidenceWriteMs")
        + report["finalizeMs"].as_f64().expect("finalizeMs")
        + other_ms;
    assert!((measured - report["elapsedMs"].as_f64().expect("elapsedMs")).abs() < 1e-6);
}

fn assert_bounded_replay_ignores(
    matrix: &Path,
    root: &Path,
    name: &str,
    checkpoint_write: u64,
    relative: &Path,
) {
    let out = root.join(name);
    let stopped = psro(
        matrix,
        &out,
        4,
        Some((
            "HEXDECK_PSRO_TEST_STOP_AFTER_CHECKPOINT_WRITE",
            &checkpoint_write.to_string(),
        )),
    );
    assert!(!stopped.status.success());
    let corrupt = out.join(relative);
    fs::create_dir_all(corrupt.parent().unwrap()).unwrap();
    fs::write(corrupt, b"corrupt beyond checkpoint").unwrap();
    let stopped = psro(
        matrix,
        &out,
        4,
        Some(("HEXDECK_PSRO_TEST_STOP_AFTER_RESUME_REPLAY", "1")),
    );
    assert!(!stopped.status.success());
    assert!(
        String::from_utf8_lossy(&stopped.stderr)
            .contains("test stop after bounded PSRO resume replay")
    );
}

fn committed_look_games(out: &Path) -> u64 {
    evidence(out)
        .into_iter()
        .filter(|(path, _)| path.ends_with(".hpl"))
        .map(|(_, bytes)| {
            let rows = u32::from_le_bytes(bytes[64..68].try_into().unwrap()) as u64;
            let suffix = u32::from_le_bytes(bytes[72..76].try_into().unwrap()) as u64;
            rows * suffix * 2
        })
        .sum()
}

#[test]
fn process_outputs_are_thread_restart_and_repeat_stable() {
    let root = temporary("stable");
    let matrix = initial_matrix(&root, 4);
    let baseline = root.join("baseline");
    let baseline_report = root.join("baseline-report.json");
    let checkpoint_write_log = root.join("checkpoint-write-count.txt");
    let result = psro_report(
        &matrix,
        &baseline,
        1,
        Some((
            "HEXDECK_PSRO_TEST_CHECKPOINT_WRITE_LOG",
            checkpoint_write_log.to_str().unwrap(),
        )),
        &baseline_report,
    );
    assert!(
        result.status.success(),
        "PSRO failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_timing_equation(&baseline_report);
    let admissions = [1].map(|ordinal| {
        let bytes = fs::read(baseline.join(format!("admission-{ordinal:04}.hpa"))).unwrap();
        (
            u32::from_le_bytes(bytes[140..144].try_into().unwrap()),
            u32::from_le_bytes(bytes[144..148].try_into().unwrap()),
        )
    });
    assert_eq!(admissions, [(1_681_382, 13)]);
    assert!(baseline.join("retest-0001/confirmation-0400.hpl").exists());
    assert!(baseline.join("search-0003/screen-0128.hpl").exists());
    let final_matrix = fs::read(baseline.join("matrix.hgm")).unwrap();
    let size = u32::from_le_bytes(final_matrix[16..20].try_into().unwrap()) as usize;
    let row_bytes = u32::from_le_bytes(final_matrix[8..12].try_into().unwrap()) as usize;
    let support = (0..size)
        .filter_map(|rank| {
            let offset = 64 + rank * row_bytes;
            let number = u32::from_le_bytes(final_matrix[offset..offset + 4].try_into().unwrap());
            let weight = f64::from_le_bytes(
                final_matrix[offset + 4 + size * 8..offset + 12 + size * 8]
                    .try_into()
                    .unwrap(),
            );
            (weight > 1e-6).then_some(number)
        })
        .collect::<Vec<_>>();
    assert_eq!(support, vec![1_681_382]);
    assert!(verify(&matrix, &baseline).status.success());
    assert!(verify_threads(&matrix, &baseline, Some(4)).status.success());
    let decisions = fs::read(baseline.join("decisions.hpd")).unwrap();
    let decision_count = u32::from_le_bytes(decisions[136..140].try_into().unwrap()) as usize;
    let terminal_statuses = (0..decision_count)
        .map(|index| (decisions[160 + index * 56], decisions[161 + index * 56]))
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(
        terminal_statuses,
        std::collections::HashSet::from([(0, 0), (0, 1), (0, 2), (1, 2), (2, 1)])
    );
    let expected = evidence(&baseline);

    let handshake = root.join("handshake-delay");
    let handshake_report = root.join("handshake-delay-report.json");
    let delay = Duration::from_millis(3_000);
    let output = psro_handshake_report(&matrix, &handshake, 1, &handshake_report, delay);
    assert!(
        output.status.success(),
        "handshake run failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(evidence(&handshake), expected);
    assert_timing_equation(&handshake_report);
    let handshake_timing: serde_json::Value =
        serde_json::from_slice(&fs::read(&handshake_report).unwrap()).expect("handshake report");
    let handshake_other_ms = handshake_timing["otherMs"].as_f64().unwrap();
    let handshake_write_ms = handshake_timing["evidenceWriteMs"].as_f64().unwrap();
    assert!(handshake_other_ms >= 2_500.0);
    assert!(handshake_write_ms < handshake_other_ms / 2.0);

    let empty_reservoir = root.join("empty-family-reservoir.hgf");
    write_empty_family_reservoir(
        &fixture("balance-tuning-005-psro-reservoir.hgf"),
        &empty_reservoir,
        admissions[0].0,
    );
    let empty_matrix = root.join("empty-family-matrix");
    let output = Command::new(BINARY)
        .args([
            "matrix",
            "--kingdom",
            KINGDOM,
            "--reservoir",
            empty_reservoir.to_str().unwrap(),
            "--out",
            empty_matrix.to_str().unwrap(),
            "--threads",
            "4",
            "--top",
            MATRIX_SIZE,
        ])
        .output()
        .expect("empty-family matrix");
    assert!(output.status.success());
    let empty_out = root.join("empty-family");
    let empty_top = fixture("balance-tuning-005-psro-top.hgf");
    let empty_args = [
        "--kingdom",
        KINGDOM,
        "--top-file",
        empty_top.to_str().unwrap(),
        "--reservoir",
        empty_reservoir.to_str().unwrap(),
        "--matrix-dir",
        empty_matrix.to_str().unwrap(),
        "--out",
        empty_out.to_str().unwrap(),
        "--matrix-size",
        MATRIX_SIZE,
        "--candidate-limit",
        "1",
    ];
    let output = Command::new(BINARY)
        .arg("psro")
        .args(empty_args)
        .args(["--threads", "4"])
        .output()
        .expect("empty-family PSRO");
    assert!(
        output.status.success(),
        "empty-family PSRO failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(empty_out.join("decisions.hpd").is_file());
    assert!(
        evidence(&empty_out)
            .keys()
            .filter(|path| path.ends_with(".hpl"))
            .all(|path| path.starts_with("search-0001/"))
    );
    let output = Command::new(BINARY)
        .arg("psro-verify")
        .args(empty_args)
        .args(["--threads", "4"])
        .output()
        .expect("empty-family PSRO verify");
    assert!(
        output.status.success(),
        "empty-family verification failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    for (name, threads) in [("four", 4), ("ten", 10), ("repeat", 1)] {
        let out = root.join(name);
        let output = psro(&matrix, &out, threads, None);
        assert!(
            output.status.success(),
            "{name} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            evidence(&out),
            expected,
            "scientific bytes differ for {name}"
        );
    }

    let checkpoint_write_count = fs::read_to_string(&checkpoint_write_log)
        .expect("checkpoint write count")
        .parse::<u64>()
        .expect("checkpoint write ordinal");
    let mut admission_checkpoint = None;
    let mut retest_checkpoint = None;
    for checkpoint_write in (1..=checkpoint_write_count).map(|value| value.to_string()) {
        let out = root.join(format!("restart-{checkpoint_write}"));
        let stopped = psro(
            &matrix,
            &out,
            4,
            Some((
                "HEXDECK_PSRO_TEST_STOP_AFTER_CHECKPOINT_WRITE",
                &checkpoint_write,
            )),
        );
        assert!(!stopped.status.success());
        let checkpoint = fs::read(out.join("checkpoint.hpc")).unwrap();
        let payload = &checkpoint[128..];
        if payload[1] == 3 && admission_checkpoint.is_none() {
            let next_admission = word(payload, 16) + 1;
            if !out
                .join(format!("admission-{next_admission:04}.hpa"))
                .exists()
            {
                admission_checkpoint = Some(checkpoint_write.parse::<u64>().unwrap());
            }
        }
        if payload[1] == 2 && word(payload, 8) == 0 && retest_checkpoint.is_none() {
            retest_checkpoint = Some((
                checkpoint_write.parse::<u64>().unwrap(),
                word(payload, 48),
                word(payload, 56),
            ));
        }
        let committed = evidence(&out);
        let partial = out.join("search-0001/partial.hpl.tmp");
        fs::create_dir_all(partial.parent().unwrap()).unwrap();
        fs::write(&partial, b"partial").unwrap();
        let replayed = psro(
            &matrix,
            &out,
            4,
            Some(("HEXDECK_PSRO_TEST_STOP_AFTER_RESUME_REPLAY", "1")),
        );
        assert!(!replayed.status.success());
        assert!(
            String::from_utf8_lossy(&replayed.stderr)
                .contains("test stop after bounded PSRO resume replay")
        );
        assert!(!partial.exists());
        for (path, bytes) in committed {
            if path != "checkpoint.hpc" {
                assert_eq!(
                    fs::read(out.join(&path))
                        .unwrap_or_else(|error| panic!("read committed {path}: {error}")),
                    bytes,
                    "committed evidence was replayed: {path}"
                );
            }
        }
        let resumed = psro(&matrix, &out, 4, None);
        assert!(
            resumed.status.success(),
            "resume failed: {}",
            String::from_utf8_lossy(&resumed.stderr)
        );
        assert_eq!(evidence(&out), expected);
    }

    assert_bounded_replay_ignores(
        &matrix,
        &root,
        "bounded-screen-replay",
        2,
        Path::new("search-0001/screen-0016.hpl"),
    );
    assert_bounded_replay_ignores(
        &matrix,
        &root,
        "bounded-admission-replay",
        admission_checkpoint.expect("admission checkpoint boundary"),
        Path::new("admission-0001.hpa"),
    );
    let (checkpoint_write, race, depth) =
        retest_checkpoint.expect("queue-retest checkpoint boundary");
    assert_bounded_replay_ignores(
        &matrix,
        &root,
        "bounded-retest-replay",
        checkpoint_write,
        &PathBuf::from(format!("retest-{race:04}/confirmation-{depth:04}.hpl")),
    );

    let adopted = root.join("adopt-renamed");
    let stopped = psro(
        &matrix,
        &adopted,
        4,
        Some(("HEXDECK_PSRO_TEST_STOP_AFTER_RENAME", "1:8")),
    );
    assert!(!stopped.status.success());
    let renamed = fs::read(adopted.join("search-0001/screen-0008.hpl")).expect("renamed look");
    let adopted_report = root.join("adopted-report.json");
    let resumed = psro_report(&matrix, &adopted, 4, None, &adopted_report);
    assert!(
        resumed.status.success(),
        "adoption failed: {}",
        String::from_utf8_lossy(&resumed.stderr)
    );
    assert_eq!(
        fs::read(adopted.join("search-0001/screen-0008.hpl")).unwrap(),
        renamed
    );
    assert_timing_equation(&adopted_report);
    assert_eq!(evidence(&adopted), expected);

    let adopted_admission = root.join("adopt-admission");
    let stopped = psro(
        &matrix,
        &adopted_admission,
        4,
        Some(("HEXDECK_PSRO_TEST_STOP_AFTER_ADMISSION_RENAME", "1")),
    );
    assert!(!stopped.status.success());
    let admission =
        fs::read(adopted_admission.join("admission-0001.hpa")).expect("renamed admission");
    let admission_report = root.join("admission-report.json");
    let resumed = psro_report(&matrix, &adopted_admission, 4, None, &admission_report);
    assert!(
        resumed.status.success(),
        "admission adoption failed: {}",
        String::from_utf8_lossy(&resumed.stderr)
    );
    assert_eq!(
        fs::read(adopted_admission.join("admission-0001.hpa")).unwrap(),
        admission
    );
    assert_timing_equation(&admission_report);
    assert_eq!(evidence(&adopted_admission), expected);

    for (name, stop) in [
        (
            "complete-checkpoint",
            "HEXDECK_PSRO_TEST_STOP_AFTER_COMPLETE_CHECKPOINT",
        ),
        (
            "renamed-decisions",
            "HEXDECK_PSRO_TEST_STOP_AFTER_DECISIONS_RENAME",
        ),
    ] {
        let out = root.join(name);
        let stopped = psro(&matrix, &out, 4, Some((stop, "1")));
        assert!(!stopped.status.success());
        if name == "complete-checkpoint" {
            assert!(!out.join("decisions.hpd").exists());
        } else {
            assert!(out.join("decisions.hpd").exists());
        }
        let resumed = psro(&matrix, &out, 4, None);
        assert!(
            resumed.status.success(),
            "decisions resume failed: {}",
            String::from_utf8_lossy(&resumed.stderr)
        );
        assert_eq!(evidence(&out), expected);
    }

    let mid_confirmation = root.join("mid-confirmation-count");
    let stopped = psro(
        &matrix,
        &mid_confirmation,
        4,
        Some(("HEXDECK_PSRO_TEST_STOP_AFTER_TRANSITION", "8")),
    );
    assert!(!stopped.status.success());
    let committed_games = committed_look_games(&mid_confirmation);
    let report = root.join("resume-report.json");
    let resumed = psro_report(&matrix, &mid_confirmation, 4, None, &report);
    assert!(resumed.status.success());
    assert_timing_equation(&report);
    let report: serde_json::Value =
        serde_json::from_slice(&fs::read(report).unwrap()).expect("resume report");
    let resumed_games = report["totalGames"].as_u64().expect("total games");
    assert!(committed_games > 0 && resumed_games > 0);
    assert_eq!(committed_games + resumed_games, 19_476);
    assert_eq!(evidence(&mid_confirmation), expected);

    let missing_self_play = root.join("missing-self-play");
    copy_tree(&baseline, &missing_self_play);
    fs::remove_file(missing_self_play.join("self-play-v1.hst")).unwrap();
    assert!(!verify(&matrix, &missing_self_play).status.success());
    let resumed = psro(&matrix, &missing_self_play, 4, None);
    assert!(resumed.status.success());
    assert_eq!(evidence(&missing_self_play), expected);

    let rebuilt = root.join("rebuilt-matrix");
    copy_tree(&baseline, &rebuilt);
    fs::remove_file(rebuilt.join("matrix.hgm")).unwrap();
    let resumed = psro(&matrix, &rebuilt, 4, None);
    assert!(resumed.status.success());
    assert_eq!(evidence(&rebuilt), expected);

    let corrupt_self_play = root.join("corrupt-self-play");
    copy_tree(&baseline, &corrupt_self_play);
    let self_play_path = corrupt_self_play.join("self-play-v1.hst");
    let mut self_play_bytes = fs::read(&self_play_path).unwrap();
    self_play_bytes[128] ^= 1;
    fs::write(&self_play_path, &self_play_bytes).unwrap();
    let resumed = psro(&matrix, &corrupt_self_play, 4, None);
    assert!(!resumed.status.success());
    assert_eq!(fs::read(self_play_path).unwrap(), self_play_bytes);

    let corrupt_admission = root.join("corrupt-admission");
    copy_tree(&baseline, &corrupt_admission);
    let path = corrupt_admission.join("admission-0001.hpa");
    let mut bytes = fs::read(&path).unwrap();
    bytes[128] ^= 1;
    fs::write(&path, bytes.clone()).unwrap();
    let resumed = psro(&matrix, &corrupt_admission, 4, None);
    assert!(!resumed.status.success());
    assert_eq!(fs::read(path).unwrap(), bytes);

    let missing_decisions = root.join("missing-decisions");
    copy_tree(&baseline, &missing_decisions);
    fs::remove_file(missing_decisions.join("decisions.hpd")).unwrap();
    assert!(!psro(&matrix, &missing_decisions, 4, None).status.success());

    let mismatched_decisions = root.join("mismatched-decisions-reference");
    copy_tree(&baseline, &mismatched_decisions);
    let path = mismatched_decisions.join("decisions.hpd");
    let mut bytes = fs::read(&path).unwrap();
    bytes[128] ^= 1;
    reseal(&mut bytes);
    fs::write(&path, bytes).unwrap();
    assert!(
        !psro(&matrix, &mismatched_decisions, 4, None)
            .status
            .success()
    );

    let corrupt_decisions = root.join("corrupt-decisions");
    copy_tree(&baseline, &corrupt_decisions);
    let path = corrupt_decisions.join("decisions.hpd");
    let mut bytes = fs::read(&path).unwrap();
    bytes[128] ^= 1;
    fs::write(&path, &bytes).unwrap();
    let resumed = psro(&matrix, &corrupt_decisions, 4, None);
    assert!(!resumed.status.success());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    fs::remove_file(corrupt_decisions.join("self-play-v1.hst")).unwrap();
    let backfill = self_play_backfill(&matrix, &corrupt_decisions, 4);
    assert!(
        backfill.status.success(),
        "structural backfill failed: {}",
        String::from_utf8_lossy(&backfill.stderr)
    );
    let summary: serde_json::Value = serde_json::from_slice(&backfill.stdout).unwrap();
    assert_eq!(summary["scoredStrategyCount"], 1);
    assert_eq!(fs::read(path).unwrap(), bytes);

    let omitted = root.join("semantic-omitted-candidate");
    corrupt_semantically(
        &baseline,
        &omitted,
        "search-0003/screen-0008.hpl",
        |bytes| {
            let row_count = u32::from_le_bytes(bytes[64..68].try_into().unwrap()) as usize;
            let row_bytes = u32::from_le_bytes(bytes[68..72].try_into().unwrap()) as usize;
            assert!(row_count > 1);
            bytes.truncate(bytes.len() - row_bytes);
            bytes[64..68].copy_from_slice(&((row_count - 1) as u32).to_le_bytes());
        },
    );
    assert!(!verify(&matrix, &omitted).status.success());

    let admitted_screen = root.join("semantic-admitted-screen");
    corrupt_semantically(
        &baseline,
        &admitted_screen,
        "search-0003/screen-0008.hpl",
        |bytes| {
            let schedule = u32::from_le_bytes(bytes[72..76].try_into().unwrap()) as usize;
            let first_row = 128 + schedule * 8;
            bytes[first_row..first_row + 4].copy_from_slice(&1_681_382u32.to_le_bytes());
            bytes[first_row + 4..first_row + 8].copy_from_slice(&13u32.to_le_bytes());
        },
    );
    assert!(!verify(&matrix, &admitted_screen).status.success());

    let wrong_depth = root.join("semantic-wrong-depth");
    corrupt_semantically(
        &baseline,
        &wrong_depth,
        "search-0001/screen-0016.hpl",
        |bytes| bytes[56..60].copy_from_slice(&0u32.to_le_bytes()),
    );
    assert!(!verify(&matrix, &wrong_depth).status.success());

    let changed_family = root.join("semantic-confirmation-family");
    corrupt_semantically(
        &baseline,
        &changed_family,
        "search-0001/confirmation-0400.hpl",
        |bytes| {
            let family = u32::from_le_bytes(bytes[60..64].try_into().unwrap());
            bytes[60..64].copy_from_slice(&(family + 1).to_le_bytes());
        },
    );
    assert!(!verify(&matrix, &changed_family).status.success());

    let dropped_queue = root.join("semantic-dropped-queue");
    corrupt_semantically(&baseline, &dropped_queue, "admission-0001.hpa", |bytes| {
        let count = u32::from_le_bytes(bytes[156..160].try_into().unwrap()) as usize;
        assert!(count > 1);
        let last = 184 + (count - 1) * 4;
        bytes.drain(last..last + 4);
        bytes[156..160].copy_from_slice(&((count - 1) as u32).to_le_bytes());
    });
    assert!(!verify(&matrix, &dropped_queue).status.success());

    let wrong_strongest = root.join("semantic-wrong-strongest");
    corrupt_semantically(&baseline, &wrong_strongest, "admission-0001.hpa", |bytes| {
        let count = u32::from_le_bytes(bytes[156..160].try_into().unwrap()) as usize;
        assert!(count > 1);
        let second = u32::from_le_bytes(bytes[188..192].try_into().unwrap());
        bytes[140..144].copy_from_slice(&second.to_le_bytes());
        bytes[144..148].copy_from_slice(&12u32.to_le_bytes());
    });
    assert!(!verify(&matrix, &wrong_strongest).status.success());

    let false_clean = root.join("semantic-false-clean");
    corrupt_semantically(&baseline, &false_clean, "decisions.hpd", |bytes| {
        let payload = &mut bytes[128..];
        let decision_count = u32::from_le_bytes(payload[8..12].try_into().unwrap()) as usize;
        let admission_count = u32::from_le_bytes(payload[12..16].try_into().unwrap()) as usize;
        let snapshot_count = u32::from_le_bytes(payload[16..20].try_into().unwrap()) as usize;
        let mut offset = 32 + decision_count * 56;
        for _ in 0..admission_count {
            let queue_count =
                u32::from_le_bytes(payload[offset + 28..offset + 32].try_into().unwrap()) as usize;
            offset += 56 + queue_count * 4;
        }
        for _ in 0..snapshot_count {
            let count =
                u32::from_le_bytes(payload[offset + 4..offset + 8].try_into().unwrap()) as usize;
            offset += 8 + count * 12;
        }
        assert_eq!(
            u32::from_le_bytes(payload[offset + 4..offset + 8].try_into().unwrap()),
            0
        );
        payload[offset + 4..offset + 8].copy_from_slice(&1u32.to_le_bytes());
    });
    assert!(!verify(&matrix, &false_clean).status.success());

    fs::remove_dir_all(root).expect("remove temporary directory");
}

#[test]
fn verifier_rejects_corrupt_evidence_and_wrong_test_knobs() {
    let root = temporary("reject");
    let matrix = initial_matrix(&root, 2);
    let out = root.join("out");
    assert!(psro(&matrix, &out, 2, None).status.success());

    let wrong = Command::new(BINARY)
        .args([
            "psro-verify",
            "--kingdom",
            KINGDOM,
            "--top-file",
            fixture("balance-tuning-005-psro-top.hgf").to_str().unwrap(),
            "--reservoir",
            fixture("balance-tuning-005-psro-reservoir.hgf")
                .to_str()
                .unwrap(),
            "--matrix-dir",
            matrix.to_str().unwrap(),
            "--out",
            out.to_str().unwrap(),
            "--matrix-size",
            MATRIX_SIZE,
            "--candidate-limit",
            "19",
        ])
        .output()
        .unwrap();
    assert!(!wrong.status.success());

    let truncated = root.join("truncated-atomic-write");
    let result = psro(
        &matrix,
        &truncated,
        2,
        Some(("HEXDECK_PSRO_TEST_TRUNCATE_TEMPORARY", "1")),
    );
    assert!(!result.status.success());
    assert!(!truncated.join("checkpoint.hpc").exists());
    assert!(truncated.join("checkpoint.hpc.tmp").exists());

    let look = out.join("search-0001/screen-0008.hpl");
    let mut bytes = fs::read(&look).unwrap();
    bytes[128] ^= 1;
    fs::write(&look, bytes).unwrap();
    assert!(!verify(&matrix, &out).status.success());
    fs::remove_dir_all(root).expect("remove temporary directory");
}
