/**
 * `OPEN_MINT` is a transcription, and this is the only thing stopping it
 * from being a wrong one.
 *
 * `openfiat-core` pins the OPEN mint as a compile-time constant
 * (`crates/chain/src/programs.rs`) so that a node operator cannot name
 * the token their own stake is denominated in. That protection stops at
 * the repository boundary: a client that retypes the base58 string to
 * build a stake or a vote has re-created exactly the configurable value
 * the constant exists to abolish. Exporting the mint moves the copy back
 * to one place — and a single copy is only worth having if something
 * checks it against the original.
 *
 * So this reads `programs/devnet-addresses.json` from a real
 * `openfiat-core` working copy. That file is the record of what was
 * actually deployed; `programs.rs` calls it that, transcribes from it,
 * and re-reads it in its own test, so agreeing with the record is
 * transitively agreeing with the constant — and the record is JSON,
 * where the constant is Rust source a regex would have to guess at.
 *
 * # Why this one may skip when the Rust guard may not
 *
 * The Rust SDK checks the same value against `openfiat_chain::PROGRAM_IDS`,
 * a cargo git dependency that is fetched on every build, so it asserts
 * unconditionally (see `rust/src/onchain/mod.rs`). Nothing equivalent
 * exists here: `@openfiat/sdk` does not depend on `openfiat-core`, and
 * the `typescript-sdk` CI job checks out this repository alone. Failing
 * would make a green build impossible for everyone; passing quietly
 * would make the guard decorative. It skips, loudly, naming the paths it
 * looked in and what to do about it — and it does run for real in CI, in
 * the `typescript-sdk-live-node` job, which checks `openfiat-core` out
 * beside this package for exactly this kind of cross-repository proof.
 */
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { OPEN_MINT } from "../src/onchain/constants.js";

/**
 * Where an `openfiat-core` working copy sits, relative to this file.
 *
 * Two layouts, both real. CI's `typescript-sdk-live-node` job checks
 * `openfiat-core` out *inside* this repository's workspace; a developer
 * clones the two repositories side by side. Neither is more correct, so
 * both are tried before concluding there is nothing to check against.
 */
const CANDIDATE_RECORDS = [
  "../../openfiat-core/programs/devnet-addresses.json",
  "../../../openfiat-core/programs/devnet-addresses.json",
].map((relative) => fileURLToPath(new URL(relative, import.meta.url)));

/** The deployment record, or `null` when no `openfiat-core` is reachable. */
function findDeploymentRecord(): { path: string; json: unknown } | null {
  for (const path of CANDIDATE_RECORDS) {
    if (existsSync(path)) return { path, json: JSON.parse(readFileSync(path, "utf8")) };
  }
  return null;
}

/**
 * A recorded address, or a thrown error naming what was missing.
 *
 * Deliberately not a `null` return: a record that exists but has lost the
 * key is a different situation from one that is not there at all. The
 * first means the deployment record changed shape and this test is now
 * reading the wrong place — a failure. Only the second is a skip.
 */
function recorded(json: unknown, section: string, key: string): string {
  const sectionValue = (json as Record<string, unknown>)[section];
  const value =
    typeof sectionValue === "object" && sectionValue !== null
      ? (sectionValue as Record<string, unknown>)[key]
      : undefined;
  if (typeof value !== "string") {
    throw new Error(
      `devnet-addresses.json has no string at ${section}.${key} — the deployment ` +
        `record changed shape, so this test is no longer checking anything`,
    );
  }
  return value;
}

const record = findDeploymentRecord();

describe("the exported OPEN mint", () => {
  it("is the mint openfiat-core recorded deploying", (ctx) => {
    if (!record) {
      console.warn(
        `SKIPPING the OPEN mint check: no openfiat-core working copy at ` +
          `${CANDIDATE_RECORDS.join(" or ")}. Clone ` +
          `https://github.com/OpenFiat-org/openfiat-core beside this repository ` +
          `(or into it, as CI's typescript-sdk-live-node job does) and re-run. ` +
          `Until then nothing is checking OPEN_MINT against what was deployed.`,
      );
      ctx.skip();
      return;
    }

    expect(
      OPEN_MINT.toBase58(),
      `OPEN_MINT disagrees with ${record.path}, so every stake, vote and reward ` +
        `built by this SDK targets an associated token account of the wrong token`,
    ).toBe(recorded(record.json, "devnet", "mint"));
  });

  it("is reachable from the package entry point, not only from the module", async () => {
    // `constants.ts` is imported directly above, which proves the constant
    // exists and proves nothing about whether a consumer can reach it:
    // `src/index.ts` re-exports `onchain` as a namespace, and a name that
    // never joins that namespace is one nobody outside this repository can
    // import. `packaging.test.ts` then holds `dist` to the same surface.
    const { onchain } = await import("../src/index.js");
    expect(onchain.OPEN_MINT.equals(OPEN_MINT)).toBe(true);
  });
});
