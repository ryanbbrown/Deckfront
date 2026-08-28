use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

const BINARY: &str = env!("CARGO_BIN_EXE_hexdeck-goldfish");
const TOP: usize = 6;
const PAIR_ROW_BYTES: usize = 133;
const PURCHASE_ROW_BYTES: usize = 92;
const MATRIX_ROW_BYTES: usize = 60;

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
        "hexdeck-matrix-{name}-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&path).expect("temporary directory");
    path
}

fn matrix(out: &Path, threads: usize) -> Output {
    Command::new(BINARY)
        .args([
            "matrix",
            "--kingdom-file",
            fixture("balance-tuning-005.json")
                .to_str()
                .expect("kingdom path"),
            "--reservoir",
            fixture("balance-tuning-005-reservoir.hgf")
                .to_str()
                .expect("reservoir path"),
            "--out",
            out.to_str().expect("out path"),
            "--threads",
            &threads.to_string(),
            "--top",
            &TOP.to_string(),
        ])
        .output()
        .expect("matrix command")
}

fn verify(out: &Path, kingdom: &Path, reservoir: &Path, top: Option<usize>) -> Output {
    let mut command = Command::new(BINARY);
    command.args([
        "matrix-verify",
        "--kingdom-file",
        kingdom.to_str().expect("kingdom path"),
        "--reservoir",
        reservoir.to_str().expect("reservoir path"),
        "--out",
        out.to_str().expect("out path"),
    ]);
    if let Some(top) = top {
        command.args(["--top", &top.to_string()]);
    }
    command.output().expect("matrix-verify command")
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("u32"))
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                0xedb8_8320 ^ (crc >> 1)
            } else {
                crc >> 1
            };
        }
    }
    crc ^ u32::MAX
}

fn repair_crc(bytes: &mut [u8]) {
    let crc = crc32(&bytes[64..]);
    bytes[24..28].copy_from_slice(&crc.to_le_bytes());
}

fn clone_output(source: &Path, name: &str) -> PathBuf {
    let target = temporary(name);
    for file in ["pairs.hgm", "purchases.hgm", "matrix.hgm"] {
        fs::copy(source.join(file), target.join(file)).expect("copy output");
    }
    target
}

fn expect_rejected(out: &Path, kingdom: &Path, reservoir: &Path, top: Option<usize>) {
    let output = verify(out, kingdom, reservoir, top);
    assert!(
        !output.status.success(),
        "verification unexpectedly passed: {}",
        String::from_utf8_lossy(&output.stdout)
    );
}

#[test]
fn matrix_outputs_are_thread_stable_ranked_and_verified() {
    let root = temporary("stable");
    let mut outputs = Vec::new();
    for (index, threads) in [1, 4, 10, 1].into_iter().enumerate() {
        let out = root.join(index.to_string());
        let result = matrix(&out, threads);
        assert!(
            result.status.success(),
            "matrix failed: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        outputs.push(out);
    }
    for file in ["pairs.hgm", "purchases.hgm", "matrix.hgm"] {
        let expected = fs::read(outputs[0].join(file)).expect("first output");
        for out in outputs.iter().skip(1) {
            assert_eq!(fs::read(out.join(file)).expect("held output"), expected);
        }
    }
    let verified = verify(
        &outputs[0],
        &fixture("balance-tuning-005.json"),
        &fixture("balance-tuning-005-reservoir.hgf"),
        Some(TOP),
    );
    assert!(
        verified.status.success(),
        "verify failed: {}",
        String::from_utf8_lossy(&verified.stderr)
    );

    let reservoir = fs::read(fixture("balance-tuning-005-reservoir.hgf")).expect("reservoir");
    let matrix = fs::read(outputs[0].join("matrix.hgm")).expect("matrix");
    let weights = (0..TOP)
        .map(|rank| {
            let expected_number = read_u32(&reservoir, 64 + rank * 124);
            let offset = 64 + rank * MATRIX_ROW_BYTES;
            assert_eq!(read_u32(&matrix, offset), expected_number);
            u64::from_le_bytes(
                matrix[offset + 52..offset + 60]
                    .try_into()
                    .expect("weight bytes"),
            )
        })
        .collect::<HashSet<_>>();
    assert_eq!(weights.len(), TOP);

    let purchases = fs::read(outputs[0].join("purchases.hgm")).expect("purchases");
    assert_eq!(read_u32(&purchases, 8), PURCHASE_ROW_BYTES as u32);
    assert_eq!(read_u32(&purchases, 64 + 8), 0);
    assert_eq!(read_u32(&purchases, 64 + 8 + 15 * 4), 0);
    fs::remove_dir_all(root).expect("remove stable temporary directory");
}

#[test]
fn matrix_verify_rejects_corrupt_or_mismatched_evidence() {
    let baseline = temporary("rejections");
    let result = matrix(&baseline, 1);
    assert!(
        result.status.success(),
        "matrix failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    let kingdom = fixture("balance-tuning-005.json");
    let reservoir = fixture("balance-tuning-005-reservoir.hgf");

    for file in ["pairs.hgm", "purchases.hgm", "matrix.hgm"] {
        let out = clone_output(&baseline, &format!("flip-{file}"));
        let path = out.join(file);
        let mut bytes = fs::read(&path).expect("file");
        bytes[64] ^= 1;
        fs::write(path, bytes).expect("flipped file");
        expect_rejected(&out, &kingdom, &reservoir, Some(TOP));
    }

    let mutate_file = |name: &str, file: &str, change: fn(&mut Vec<u8>)| {
        let out = clone_output(&baseline, name);
        let path = out.join(file);
        let mut bytes = fs::read(&path).expect("file");
        change(&mut bytes);
        fs::write(path, bytes).expect("mutated file");
        expect_rejected(&out, &kingdom, &reservoir, Some(TOP));
    };
    mutate_file("point-five", "pairs.hgm", |bytes| {
        bytes[64 + 8] = 5;
        repair_crc(bytes);
    });
    mutate_file("matrix-cell", "matrix.hgm", |bytes| {
        bytes[64 + 4 + 8] ^= 1;
        repair_crc(bytes);
    });
    mutate_file("matrix-weight", "matrix.hgm", |bytes| {
        bytes[64 + 52] ^= 1;
        repair_crc(bytes);
    });
    mutate_file("purchase-pair", "purchases.hgm", |bytes| {
        let left = bytes[64..64 + PURCHASE_ROW_BYTES].to_vec();
        let right = bytes[64 + PURCHASE_ROW_BYTES..64 + 2 * PURCHASE_ROW_BYTES].to_vec();
        bytes[64..64 + PURCHASE_ROW_BYTES].copy_from_slice(&right);
        bytes[64 + PURCHASE_ROW_BYTES..64 + 2 * PURCHASE_ROW_BYTES].copy_from_slice(&left);
        repair_crc(bytes);
    });
    mutate_file("source", "pairs.hgm", |bytes| bytes[28] ^= 1);
    mutate_file("seed", "pairs.hgm", |bytes| bytes[32] ^= 1);
    mutate_file("kind", "pairs.hgm", |bytes| bytes[4] ^= 1);
    mutate_file("row-bytes", "pairs.hgm", |bytes| bytes[8] ^= 1);

    expect_rejected(&baseline, &kingdom, &reservoir, Some(TOP + 1));
    expect_rejected(&baseline, &kingdom, &reservoir, None);

    let wrong_fingerprint = temporary("reservoir-fingerprint").join("reservoir.hgf");
    let mut bytes = fs::read(&reservoir).expect("reservoir");
    bytes[48] ^= 1;
    fs::write(&wrong_fingerprint, bytes).expect("wrong fingerprint reservoir");
    expect_rejected(&baseline, &kingdom, &wrong_fingerprint, Some(TOP));

    let truncated = temporary("reservoir-truncated").join("reservoir.hgf");
    let mut bytes = fs::read(&reservoir).expect("reservoir");
    bytes.pop();
    fs::write(&truncated, bytes).expect("truncated reservoir");
    expect_rejected(&baseline, &kingdom, &truncated, Some(TOP));

    let out_of_range = temporary("reservoir-range").join("reservoir.hgf");
    let mut bytes = fs::read(&reservoir).expect("reservoir");
    bytes[64..68].copy_from_slice(&12_972_960u32.to_le_bytes());
    repair_crc(&mut bytes);
    fs::write(&out_of_range, bytes).expect("out-of-range reservoir");
    expect_rejected(&baseline, &kingdom, &out_of_range, Some(TOP));

    let duplicate = temporary("reservoir-duplicate").join("reservoir.hgf");
    let mut bytes = fs::read(&reservoir).expect("reservoir");
    let first = bytes[64..68].to_vec();
    bytes[64 + 124..64 + 124 + 4].copy_from_slice(&first);
    repair_crc(&mut bytes);
    fs::write(&duplicate, bytes).expect("duplicate reservoir");
    expect_rejected(&baseline, &kingdom, &duplicate, Some(TOP));

    let reordered = temporary("kingdom-order").join("kingdom.json");
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&kingdom).expect("kingdom")).expect("json");
    value["orderedCardIds"]
        .as_array_mut()
        .expect("ordered ids")
        .swap(0, 1);
    fs::write(&reordered, serde_json::to_vec(&value).expect("json bytes"))
        .expect("reordered kingdom");
    expect_rejected(&baseline, &reordered, &reservoir, Some(TOP));

    assert_eq!(
        read_u32(&fs::read(baseline.join("pairs.hgm")).expect("pairs"), 8),
        PAIR_ROW_BYTES as u32
    );
    fs::remove_dir_all(baseline).expect("remove rejection temporary directory");
}
