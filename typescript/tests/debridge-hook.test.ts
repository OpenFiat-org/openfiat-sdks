import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AUTHORITY_PLACEHOLDER,
  DELIVER_CONTRIBUTION_DISCRIMINATOR,
  WALLET_PLACEHOLDER,
  buildDeliverContributionHook,
  buildSolanaHook,
  decodeSolanaHook,
  encodeExternalInstruction,
  type ExternalInstruction,
} from "../src/debridge/hook.js";
import { fakePubkey } from "./onchain-helpers.js";

const programId = fakePubkey(1);
const saleConfig = fakePubkey(2);
const usdcVault = fakePubkey(3);
const presaleVault = fakePubkey(4);
const presaleVaultAuthority = fakePubkey(5);
const openMint = fakePubkey(6);
const usdcMint = fakePubkey(7);
const banRecord = fakePubkey(8);
const usdcTokenProgram = fakePubkey(9);
const openTokenProgram = fakePubkey(10);
const recipient = fakePubkey(11);

const fixture = {
  saleNonce: 7n,
  recipient,
  usdcAmount: 250_000_000n,
  programId,
  saleConfig,
  usdcVault,
  presaleVault,
  presaleVaultAuthority,
  openMint,
  usdcMint,
  banRecord,
  tokenPrograms: { usdc: usdcTokenProgram, open: openTokenProgram },
};

describe("buildDeliverContributionHook", () => {
  const hook = buildDeliverContributionHook(fixture);

  it("produces the DLN API's solana_serialized_instructions envelope (nested data.instructions, per the live create-tx Swagger spec)", () => {
    expect(hook.type).toBe("solana_serialized_instructions");
    expect(hook.data.instructions.startsWith("0x")).toBe(true);
    expect(hook.data.instructions.length % 2).toBe(0);
  });

  it("round-trips through decodeSolanaHook to a single ExternalInstruction targeting the presale program", () => {
    const [decoded] = decodeSolanaHook(hook);
    expect(decoded).toBeDefined();
    expect(decoded?.instruction.programId.equals(programId)).toBe(true);
  });

  it("carries the deliver_contribution discriminator and args (sale_nonce, recipient, usdc_amount) in the instruction data", () => {
    const [decoded] = decodeSolanaHook(hook);
    const data = decoded!.instruction.data;

    expect(Array.from(data.subarray(0, 8))).toEqual(Array.from(DELIVER_CONTRIBUTION_DISCRIMINATOR));

    const saleNonce = data.readBigUInt64LE(8);
    const decodedRecipient = new PublicKey(data.subarray(16, 48));
    const usdcAmount = data.readBigUInt64LE(48);

    expect(saleNonce).toBe(fixture.saleNonce);
    expect(decodedRecipient.equals(recipient)).toBe(true);
    expect(usdcAmount).toBe(fixture.usdcAmount);
    expect(data.length).toBe(56);
  });

  it("marks payer and source_usdc as executor-provided placeholders, not hardcoded accounts", () => {
    const [decoded] = decodeSolanaHook(hook);
    const keys = decoded!.instruction.keys;

    // payer
    expect(keys[0]?.pubkey.equals(AUTHORITY_PLACEHOLDER)).toBe(true);
    expect(keys[0]?.isSigner).toBe(true);
    expect(keys[0]?.isWritable).toBe(true);

    // source_usdc
    expect(keys[4]?.pubkey.equals(WALLET_PLACEHOLDER)).toBe(true);
    expect(keys[4]?.isSigner).toBe(false);
    expect(keys[4]?.isWritable).toBe(true);

    // Neither placeholder is a real, caller-supplied account: nothing in the
    // fixture equals either placeholder, so their presence can only have
    // come from the substitution mechanism, not from passing a real key through.
    for (const p of [programId, saleConfig, usdcVault, presaleVault, presaleVaultAuthority, openMint, usdcMint, banRecord, usdcTokenProgram, openTokenProgram, recipient]) {
      expect(p.equals(AUTHORITY_PLACEHOLDER)).toBe(false);
      expect(p.equals(WALLET_PLACEHOLDER)).toBe(false);
    }
  });

  it("derives recipient_open (ATA) and contribution (PDA) exactly as the presale program would", () => {
    const [decoded] = decodeSolanaHook(hook);
    const keys = decoded!.instruction.keys;

    const [expectedRecipientOpen] = PublicKey.findProgramAddressSync(
      [recipient.toBytes(), openTokenProgram.toBytes(), openMint.toBytes()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const [expectedContribution] = PublicKey.findProgramAddressSync(
      [Buffer.from("contribution"), saleConfig.toBytes(), recipient.toBytes()],
      programId,
    );

    expect(keys[10]?.pubkey.equals(expectedRecipientOpen)).toBe(true);
    expect(keys[10]?.isWritable).toBe(true);
    expect(keys[11]?.pubkey.equals(expectedContribution)).toBe(true);
    expect(keys[11]?.isWritable).toBe(true);
  });

  it("passes every remaining account through in the exact order deliver_contribution's IDL declares", () => {
    const [decoded] = decodeSolanaHook(hook);
    const keys = decoded!.instruction.keys;

    expect(keys.length).toBe(16);
    expect(keys[1]?.pubkey.equals(banRecord)).toBe(true);
    expect(keys[2]?.pubkey.equals(saleConfig)).toBe(true);
    expect(keys[2]?.isWritable).toBe(true);
    expect(keys[3]?.pubkey.equals(usdcMint)).toBe(true);
    expect(keys[5]?.pubkey.equals(usdcVault)).toBe(true);
    expect(keys[6]?.pubkey.equals(openMint)).toBe(true);
    expect(keys[7]?.pubkey.equals(presaleVaultAuthority)).toBe(true);
    expect(keys[8]?.pubkey.equals(presaleVault)).toBe(true);
    expect(keys[9]?.pubkey.equals(recipient)).toBe(true);
    expect(keys[9]?.isSigner).toBe(false);
    expect(keys[12]?.pubkey.equals(usdcTokenProgram)).toBe(true);
    expect(keys[13]?.pubkey.equals(openTokenProgram)).toBe(true);
    expect(keys[14]?.pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(keys[15]?.pubkey.toBase58()).toBe("11111111111111111111111111111111");
  });

  it("defaults reward/expense to 0n/undefined and round-trips whatever is passed", () => {
    const [decodedDefault] = decodeSolanaHook(hook);
    expect(decodedDefault?.reward).toBe(0n);
    expect(decodedDefault?.expense).toBeUndefined();

    const withEconomics = buildDeliverContributionHook({ ...fixture, reward: 12_345n, expense: 2_039_280n });
    const [decoded] = decodeSolanaHook(withEconomics);
    expect(decoded?.reward).toBe(12_345n);
    expect(decoded?.expense).toBe(2_039_280n);
  });
});

describe("ExternalInstruction encode/decode (general round trip)", () => {
  it("round-trips pubkey_substitutions (both SubmissionAuthWallet and BySeeds) and data_substitutions", () => {
    const instruction = buildDeliverContributionHook(fixture); // reuse a real instruction shape
    const [decodedIx] = decodeSolanaHook(instruction);
    const ix = decodedIx!.instruction;

    const ei: ExternalInstruction = {
      reward: 999n,
      expense: 111n,
      executePolicy: "mandatoryBlock",
      pubkeySubstitutions: [
        { kind: "submissionAuthWallet", accountIndex: 4, tokenMint: usdcMint },
        {
          kind: "bySeeds",
          accountIndex: 10,
          programId: ASSOCIATED_TOKEN_PROGRAM_ID,
          seeds: [
            { kind: "arbitrary", bytes: recipient.toBytes() },
            { kind: "submissionAuth" },
          ],
          bump: 254,
        },
      ],
      dataSubstitutions: [
        { kind: "submissionAuthWalletAmount", accountIndex: 4, offset: 48, isBigEndian: false, subtraction: 5000n },
      ],
      instruction: ix,
    };

    const hook = buildSolanaHook([ei]);
    const [decoded] = decodeSolanaHook(hook);

    expect(decoded?.reward).toBe(999n);
    expect(decoded?.expense).toBe(111n);
    expect(decoded?.executePolicy).toBe("mandatoryBlock");
    expect(decoded?.pubkeySubstitutions).toEqual(ei.pubkeySubstitutions);
    expect(decoded?.dataSubstitutions).toEqual(ei.dataSubstitutions);
  });

  it("concatenates multiple instructions and decodes each back out in order", () => {
    const [decodedIx] = decodeSolanaHook(buildDeliverContributionHook(fixture));
    const ix = decodedIx!.instruction;
    const a: ExternalInstruction = {
      reward: 1n,
      expense: undefined,
      executePolicy: "empty",
      pubkeySubstitutions: [],
      dataSubstitutions: [],
      instruction: ix,
    };
    const b: ExternalInstruction = { ...a, reward: 2n };

    const hook = buildSolanaHook([a, b]);
    const decoded = decodeSolanaHook(hook);

    expect(decoded).toHaveLength(2);
    expect(decoded[0]?.reward).toBe(1n);
    expect(decoded[1]?.reward).toBe(2n);
  });

  // A real `solana_serialized_instructions` example straight from deBridge's
  // own docs ("Integrating Hooks" -> "DlnHook encoding example").
  // Canonical URL: https://docs.debridge.com/dln-details/integration-guidelines/order-creation/hooks/integrating-hooks
  // — that exact page 404s as of this test being written. Fallback/archive
  // citation for the same content (same "Source:" URL, confirmed live):
  // https://docs.debridge.com/llms-full.txt (search for "DlnHook encoding example").
  // Decoding it cleanly to zero leftover bytes, with recognizable
  // placeholders and well-known program ids, and then *re-encoding* the
  // decode back to the identical original bytes, is the strongest evidence
  // available in this environment that the wire format above — both
  // decoder and encoder — matches the real one; this repo can't reach a
  // live deBridge executor to confirm it any harder.
  it("decodes deBridge's own worked DlnHook example with zero leftover bytes, and re-encodes it byte-for-byte", () => {
    const hex =
      "000000000000000001000000000000000000000000010000000000000000010000000000000000135d3e6be2a2ae5274cfe4007df2f62ed31c618f048337fd1435ca2dee2a0d5d12000000000000001968562fef0aab1b1d8f99d44306595cd4ba41d7cc899c007a774d23ad702ff60101fd97b70d573d364ef44769540777b1ecdc21b88ff7def38c45d020e271c589dc00010000000000000000000000000000000000000000000000000000000000000000000062584959deb8a728a91cebdc187b545d920479265052145f31fb80c73fac5aea00009845350d27001686985bbc5c4a3646c928d7de27ddab09f2de56d21537201c4300019845350d27001686985bbc5c4a3646c928d7de27ddab09f2de56d21537201c4300010c1e5ba8fe0ec5c5e44d12c2b6317a8781ca19ddb0e1532b136f418e1d588f9500010c1e5ba8fe0ec5c5e44d12c2b6317a8781ca19ddb0e1532b136f418e1d588f95000106ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a900000000000000000000000000000000000000000000000000000000000000000000000006a7d517187bd16635dad40455fdc2c0c124c68f215675a5dbbacb5f0800000000008c97258f4e2489f1bb3d1029148e0d830b5a1399daff1084048e7bd8dbe9f8590000ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000974d0b69f43d964da48af118a28037ab921a95eae1e637497b22867ce416255a00016be7362bf52e4ea29063d29ab43a832253ed7c68b62cf68e8d706a2f9531c1eb0001c6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d610000040000000000000000736f6c";
    const data = `0x${hex}`;

    const [decoded, ...rest] = decodeSolanaHook({ type: "solana_serialized_instructions", data: { instructions: data } });

    expect(rest).toHaveLength(0);
    expect(decoded?.instruction.keys).toHaveLength(18);
    expect(decoded?.instruction.keys[0]?.pubkey.equals(AUTHORITY_PLACEHOLDER)).toBe(true);
    expect(decoded?.instruction.keys[0]?.isSigner).toBe(true);
    expect(decoded?.instruction.keys[1]?.pubkey.equals(WALLET_PLACEHOLDER)).toBe(true);
    expect(decoded?.instruction.keys[11]?.pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);

    // The encoder direction: re-encoding what we just decoded must reproduce
    // deBridge's original bytes exactly, not just decode without throwing.
    const reEncoded = encodeExternalInstruction(decoded!);
    expect(reEncoded.toString("hex")).toBe(hex);
  });
});
