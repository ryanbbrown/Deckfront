use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

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

fn verify(matrix: &Path, out: &Path) -> Output {
    Command::new(BINARY)
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
            CANDIDATE_LIMIT,
        ])
        .output()
        .expect("PSRO verify")
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

#[test]
fn process_outputs_are_thread_restart_and_repeat_stable() {
    let root = temporary("stable");
    let matrix = initial_matrix(&root, 4);
    let baseline = root.join("baseline");
    let result = psro(&matrix, &baseline, 1, None);
    assert!(
        result.status.success(),
        "PSRO failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    let admissions = [1, 2].map(|ordinal| {
        let bytes = fs::read(baseline.join(format!("admission-{ordinal:04}.hpa"))).unwrap();
        (
            u32::from_le_bytes(bytes[140..144].try_into().unwrap()),
            u32::from_le_bytes(bytes[144..148].try_into().unwrap()),
        )
    });
    assert_eq!(admissions, [(1_681_382, 13), (10_681_409, 22)]);
    assert!(baseline.join("retest-0001/confirmation-0400.hpl").exists());
    assert!(baseline.join("search-0004/screen-0512.hpl").exists());
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
    assert_eq!(support, vec![10_681_409]);
    assert!(verify(&matrix, &baseline).status.success());
    let expected = evidence(&baseline);

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

    for transition in ["1", "8"] {
        let out = root.join(format!("restart-{transition}"));
        let stopped = psro(
            &matrix,
            &out,
            4,
            Some(("HEXDECK_PSRO_TEST_STOP_AFTER_TRANSITION", transition)),
        );
        assert!(!stopped.status.success());
        let committed = evidence(&out);
        let partial = out.join("search-0001/partial.hpl.tmp");
        fs::write(&partial, b"partial").unwrap();
        let resumed = psro(&matrix, &out, 4, None);
        assert!(
            resumed.status.success(),
            "resume failed: {}",
            String::from_utf8_lossy(&resumed.stderr)
        );
        assert!(!partial.exists());
        for (path, bytes) in committed {
            if path != "checkpoint.hpc" {
                assert_eq!(
                    fs::read(out.join(path)).unwrap(),
                    bytes,
                    "committed evidence was replayed"
                );
            }
        }
        assert_eq!(evidence(&out), expected);
    }

    let adopted = root.join("adopt-renamed");
    let stopped = psro(
        &matrix,
        &adopted,
        4,
        Some(("HEXDECK_PSRO_TEST_STOP_AFTER_RENAME", "1:8")),
    );
    assert!(!stopped.status.success());
    let renamed = fs::read(adopted.join("search-0001/screen-0008.hpl")).expect("renamed look");
    let resumed = psro(&matrix, &adopted, 4, None);
    assert!(
        resumed.status.success(),
        "adoption failed: {}",
        String::from_utf8_lossy(&resumed.stderr)
    );
    assert_eq!(
        fs::read(adopted.join("search-0001/screen-0008.hpl")).unwrap(),
        renamed
    );
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
    let resumed = psro(&matrix, &adopted_admission, 4, None);
    assert!(
        resumed.status.success(),
        "admission adoption failed: {}",
        String::from_utf8_lossy(&resumed.stderr)
    );
    assert_eq!(
        fs::read(adopted_admission.join("admission-0001.hpa")).unwrap(),
        admission
    );
    assert_eq!(evidence(&adopted_admission), expected);

    let rebuilt = root.join("rebuilt-matrix");
    copy_tree(&baseline, &rebuilt);
    fs::remove_file(rebuilt.join("matrix.hgm")).unwrap();
    let resumed = psro(&matrix, &rebuilt, 4, None);
    assert!(resumed.status.success());
    assert_eq!(evidence(&rebuilt), expected);

    let corrupt_admission = root.join("corrupt-admission");
    copy_tree(&baseline, &corrupt_admission);
    let path = corrupt_admission.join("admission-0001.hpa");
    let mut bytes = fs::read(&path).unwrap();
    bytes[128] ^= 1;
    fs::write(&path, bytes.clone()).unwrap();
    let resumed = psro(&matrix, &corrupt_admission, 4, None);
    assert!(!resumed.status.success());
    assert_eq!(fs::read(path).unwrap(), bytes);

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

    let look = out.join("search-0001/screen-0008.hpl");
    let mut bytes = fs::read(&look).unwrap();
    bytes[128] ^= 1;
    fs::write(&look, bytes).unwrap();
    assert!(!verify(&matrix, &out).status.success());
    fs::remove_dir_all(root).expect("remove temporary directory");
}
