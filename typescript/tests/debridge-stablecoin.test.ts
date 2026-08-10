import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID } from "../src/debridge/hook.js";
import {
  CHAIN_STABLECOIN_TOKENS,
  DEBRIDGE_CHAIN_IDS,
  MAINNET_SOLANA_STABLECOIN_MINTS,
  SOLANA_CHAIN_ID,
  SOLANA_STABLECOIN_MINTS,
  TOKEN_PROGRAM_ID,
  buildStablecoinDepositOrder,
  buildStablecoinWithdrawOrder,
  deriveAssociatedTokenAddress,
} from "../src/debridge/stablecoin.js";
import { fakePubkey } from "./onchain-helpers.js";

const recipientR = fakePubkey(21);
const tronRecipientT = "TXYZabc1234567890TronAddressPlaceholder01";

describe("buildStablecoinDepositOrder", () => {
  it("Ethereum USDC -> Solana USDC to recipient R: correct dst chain/mint/recipient, no dlnHook", () => {
    const order = buildStablecoinDepositOrder({
      srcChainId: DEBRIDGE_CHAIN_IDS.ethereum,
      srcToken: CHAIN_STABLECOIN_TOKENS.ethereum.USDC!,
      amount: 250_000_000n, // 250 USDC, 6 decimals
      stablecoin: "USDC",
      solanaRecipient: recipientR,
    });

    expect(order.srcChainId).toBe(String(DEBRIDGE_CHAIN_IDS.ethereum));
    expect(order.dstChainId).toBe(String(SOLANA_CHAIN_ID));
    expect(order.dstChainId).toBe("7565164");
    expect(order.dstChainTokenOut).toBe(MAINNET_SOLANA_STABLECOIN_MINTS.USDC.mint.toBase58());
    expect(order.dstChainTokenOut).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    const expectedAta = deriveAssociatedTokenAddress(recipientR, MAINNET_SOLANA_STABLECOIN_MINTS.USDC.mint, TOKEN_PROGRAM_ID);
    expect(order.dstChainTokenOutRecipient).toBe(expectedAta.toBase58());

    // Cross-check against the raw ATA formula directly, not just the helper.
    const [rawAta] = PublicKey.findProgramAddressSync(
      [recipientR.toBytes(), TOKEN_PROGRAM_ID.toBytes(), MAINNET_SOLANA_STABLECOIN_MINTS.USDC.mint.toBytes()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    expect(order.dstChainTokenOutRecipient).toBe(rawAta.toBase58());

    expect(order.dstChainOrderAuthorityAddress).toBe(recipientR.toBase58());

    // The key SP-C invariant: this is a plain transfer, not SP-B's hook mechanism.
    expect(order.dlnHook).toBeUndefined();
    expect("dlnHook" in order).toBe(false);
  });

  it("rejects a non-positive amount", () => {
    expect(() =>
      buildStablecoinDepositOrder({
        srcChainId: DEBRIDGE_CHAIN_IDS.ethereum,
        srcToken: CHAIN_STABLECOIN_TOKENS.ethereum.USDC!,
        amount: 0n,
        stablecoin: "USDC",
        solanaRecipient: recipientR,
      }),
    ).toThrow();
  });

  it("supports a devnet mint override without touching the mainnet table", () => {
    const devnetUsdc = fakePubkey(99);
    const order = buildStablecoinDepositOrder({
      srcChainId: DEBRIDGE_CHAIN_IDS.ethereum,
      srcToken: CHAIN_STABLECOIN_TOKENS.ethereum.USDC!,
      amount: 1_000_000n,
      stablecoin: "USDC",
      solanaRecipient: recipientR,
      solanaMints: { USDC: { mint: devnetUsdc, tokenProgram: TOKEN_PROGRAM_ID } },
    });

    expect(order.dstChainTokenOut).toBe(devnetUsdc.toBase58());
    expect(order.dstChainTokenOut).not.toBe(MAINNET_SOLANA_STABLECOIN_MINTS.USDC.mint.toBase58());
    // The shared mainnet/devnet registry itself is untouched by a one-off override.
    expect(SOLANA_STABLECOIN_MINTS.mainnet.USDC.mint.equals(MAINNET_SOLANA_STABLECOIN_MINTS.USDC.mint)).toBe(true);
    expect(SOLANA_STABLECOIN_MINTS.devnet.USDC).toBeUndefined();
  });
});

describe("buildStablecoinWithdrawOrder", () => {
  it("Solana USDT -> Tron USDT to recipient T: correct src chain/mint, dst chain/token/recipient, no dlnHook", () => {
    const owner = fakePubkey(22);
    const order = buildStablecoinWithdrawOrder({
      solanaOwner: owner,
      amount: 500_000_000n, // 500 USDT
      stablecoin: "USDT",
      dstChainId: DEBRIDGE_CHAIN_IDS.tron,
      dstToken: CHAIN_STABLECOIN_TOKENS.tron.USDT!,
      dstRecipient: tronRecipientT,
    });

    expect(order.srcChainId).toBe(String(SOLANA_CHAIN_ID));
    expect(order.srcChainTokenIn).toBe(MAINNET_SOLANA_STABLECOIN_MINTS.USDT.mint.toBase58());
    expect(order.srcChainTokenIn).toBe("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

    expect(order.dstChainId).toBe(String(DEBRIDGE_CHAIN_IDS.tron));
    expect(order.dstChainId).toBe("100000026");
    expect(order.dstChainTokenOut).toBe(CHAIN_STABLECOIN_TOKENS.tron.USDT);
    expect(order.dstChainTokenOutRecipient).toBe(tronRecipientT);
    expect(order.srcChainOrderAuthorityAddress).toBe(owner.toBase58());

    expect(order.dlnHook).toBeUndefined();
    expect("dlnHook" in order).toBe(false);
  });

  it("a high-value USDT-on-Tron withdraw keeps exact BigInt precision (no Number rounding)", () => {
    const owner = fakePubkey(23);
    // 12,345,678,901.234567 USDT in base units — comfortably past
    // Number.MAX_SAFE_INTEGER (9,007,199,254,740,991), so any accidental
    // `Number(amount)` round-trip in the implementation would corrupt this.
    const hugeAmount = 12_345_678_901_234_567n;
    expect(hugeAmount).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));

    const order = buildStablecoinWithdrawOrder({
      solanaOwner: owner,
      amount: hugeAmount,
      stablecoin: "USDT",
      dstChainId: DEBRIDGE_CHAIN_IDS.tron,
      dstToken: CHAIN_STABLECOIN_TOKENS.tron.USDT!,
      dstRecipient: tronRecipientT,
    });

    expect(order.srcChainTokenInAmount).toBe("12345678901234567");
    expect(BigInt(order.srcChainTokenInAmount)).toBe(hugeAmount);
    expect(order.dlnHook).toBeUndefined();
  });

  it("rejects a non-positive amount", () => {
    expect(() =>
      buildStablecoinWithdrawOrder({
        solanaOwner: fakePubkey(24),
        amount: -1n,
        stablecoin: "USDT",
        dstChainId: DEBRIDGE_CHAIN_IDS.tron,
        dstToken: CHAIN_STABLECOIN_TOKENS.tron.USDT!,
        dstRecipient: tronRecipientT,
      }),
    ).toThrow();
  });
});

describe("deposit amount precision", () => {
  it("carries a large deposit amount through as an exact decimal string", () => {
    const hugeAmount = 98_765_432_109_876_543n;
    const order = buildStablecoinDepositOrder({
      srcChainId: DEBRIDGE_CHAIN_IDS.bsc,
      srcToken: CHAIN_STABLECOIN_TOKENS.bsc.USDC!,
      amount: hugeAmount,
      stablecoin: "USDC",
      solanaRecipient: recipientR,
    });
    expect(order.srcChainTokenInAmount).toBe("98765432109876543");
    expect(BigInt(order.srcChainTokenInAmount)).toBe(hugeAmount);
  });
});

describe("DEBRIDGE_CHAIN_IDS / CHAIN_STABLECOIN_TOKENS coverage", () => {
  it("covers EVM majors, BSC, and Tron, and excludes Bitcoin", () => {
    const keys = Object.keys(DEBRIDGE_CHAIN_IDS);
    for (const chain of ["ethereum", "bsc", "polygon", "arbitrum", "optimism", "avalanche", "base", "tron", "solana"]) {
      expect(keys).toContain(chain);
    }
    expect(keys.map((k) => k.toLowerCase())).not.toContain("bitcoin");
  });

  it("every non-Solana chain lists at least one stablecoin token address", () => {
    for (const [chain, tokens] of Object.entries(CHAIN_STABLECOIN_TOKENS)) {
      expect(Object.keys(tokens).length, `${chain} should list at least one stablecoin`).toBeGreaterThan(0);
    }
  });
});
