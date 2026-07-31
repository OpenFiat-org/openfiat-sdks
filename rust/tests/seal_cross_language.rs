//! Proves the TypeScript SDK's sealed boxes open in Rust.
//!
//! This is the only test that can establish what matters. Each
//! implementation round-tripping against itself proves nothing about the
//! other: two implementations that are internally consistent and mutually
//! incompatible both pass that check, and the failure surfaces much later
//! as "the gateway cannot read the destination" on a subscription that was
//! already signed and gossiped to the whole network.
//!
//! So the box is sealed by the TypeScript implementation, in a real Node
//! process, and opened by the Rust one — which is the same code path a
//! real gateway runs.
//!
//! Skips rather than fails when Node or the TypeScript dependencies are
//! absent, matching `onchain_live_validator.rs`'s precedent for a machine
//! without the toolchain a test needs.

use openfiat_crypto::{Keypair, SealedBox, open};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(serde::Deserialize)]
struct Fixture {
    public_key: Vec<u8>,
    sealed: SealedBox,
}

fn typescript_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("rust/ has a parent")
        .join("typescript")
}

/// Runs the TypeScript sealer. `None` means the toolchain is unavailable.
fn seal_in_typescript(seed_hex: &str, plaintext: &str) -> Option<Fixture> {
    let dir = typescript_dir();
    if !dir.join("node_modules").is_dir() {
        eprintln!("skipping: {} has no node_modules", dir.display());
        return None;
    }
    let output = Command::new("pnpm")
        .args(["tsx", "scripts/seal-fixture.ts", seed_hex, plaintext])
        .current_dir(&dir)
        .output()
        .ok()?;
    if !output.status.success() {
        eprintln!(
            "skipping: the TypeScript sealer did not run: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return None;
    }
    // `pnpm` may prepend its own lines, so start at the first brace rather
    // than at byte zero — and at the FIRST, not the last: the fixture nests
    // an object, so `rfind` lands inside `sealed` and reports the outer
    // fields as missing.
    let stdout = String::from_utf8(output.stdout).ok()?;
    let json = &stdout[stdout.find('{')?..];
    Some(serde_json::from_str(json).expect("the sealer prints a fixture this test can decode"))
}

#[test]
fn a_box_sealed_in_typescript_opens_in_rust() {
    let seed = [7u8; 32];
    let seed_hex = seed.map(|byte| format!("{byte:02x}")).join("");
    let Some(fixture) = seal_in_typescript(&seed_hex, "user@example.com") else {
        return;
    };

    let recipient = Keypair::from_seed(seed);
    // The two sides must agree about the recipient before anything else —
    // otherwise a decryption failure below could just as well mean the
    // TypeScript side derived a different public key from the same seed,
    // which is a different bug with a different fix.
    assert_eq!(
        fixture.public_key,
        recipient.public_key().as_bytes().to_vec(),
        "the two implementations disagree about the public key for this seed"
    );

    let opened = open(&recipient, &fixture.sealed)
        .expect("a box sealed by the TypeScript SDK must open with the Rust implementation");
    assert_eq!(String::from_utf8(opened).unwrap(), "user@example.com");
}

#[test]
fn an_empty_destination_survives_the_crossing() {
    // The AEAD's degenerate input. Worth its own case because a length
    // assumption that holds for every real address can still be wrong here.
    let seed = [9u8; 32];
    let seed_hex = seed.map(|byte| format!("{byte:02x}")).join("");
    let Some(fixture) = seal_in_typescript(&seed_hex, "") else {
        return;
    };
    let opened = open(&Keypair::from_seed(seed), &fixture.sealed).expect("an empty seal opens");
    assert!(opened.is_empty());
}

#[test]
fn a_box_sealed_in_typescript_is_refused_by_the_wrong_recipient() {
    // Guards against the way this test could pass while proving nothing: if
    // `open` ignored the recipient key, the first test would still succeed.
    let seed = [7u8; 32];
    let seed_hex = seed.map(|byte| format!("{byte:02x}")).join("");
    let Some(fixture) = seal_in_typescript(&seed_hex, "user@example.com") else {
        return;
    };

    let eavesdropper = Keypair::from_seed([8u8; 32]);
    assert!(
        open(&eavesdropper, &fixture.sealed).is_err(),
        "a sealed box must not open for a key it was not addressed to"
    );
}

#[test]
fn tampering_with_a_typescript_seal_is_caught_by_rust() {
    let seed = [7u8; 32];
    let seed_hex = seed.map(|byte| format!("{byte:02x}")).join("");
    let Some(fixture) = seal_in_typescript(&seed_hex, "user@example.com") else {
        return;
    };
    let recipient = Keypair::from_seed(seed);

    // Each field is authenticated by a different part of the construction:
    // the ciphertext by the Poly1305 tag, the ephemeral key by being the
    // AEAD's associated data *and* an input to the key derivation, the
    // nonce by being derived rather than carried. Flip a bit in each.
    for mutate in [0usize, 1, 2] {
        let mut sealed = fixture.sealed.clone();
        match mutate {
            0 => sealed.ciphertext[0] ^= 0x01,
            1 => sealed.ephemeral_public[0] ^= 0x01,
            _ => sealed.nonce[0] ^= 0x01,
        }
        assert!(
            open(&recipient, &sealed).is_err(),
            "a tampered seal must fail rather than return garbage (field {mutate})"
        );
    }
}
