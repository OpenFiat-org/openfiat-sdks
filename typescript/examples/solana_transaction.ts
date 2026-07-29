/**
 * Building, signing, and submitting a real Solana transaction through
 * an OpenFiat node (OFS-4300): fetch the current blockhash, construct
 * and sign a transaction entirely client-side with `@solana/web3.js`,
 * then submit it via `sendTransaction` — the node never sees an
 * unsigned instruction or a private key.
 *
 * Run against a local node with `pnpm tsx examples/solana_transaction.ts`.
 * By default it targets `http://localhost:7080` — start one with
 * `CLI_HTTP_ADDR=127.0.0.1:7080 cargo run -p openfiat-cli` from
 * `openfiat-core`.
 *
 * A freshly started node has no `RpcConnected` mode configured and no
 * peer has announced a blockhash yet, so `getLatestBlockhash` returns
 * an application error until one of those exists. This example falls
 * back to a locally-generated blockhash so it can still demonstrate the
 * sign-and-submit flow end to end — real usage should retry
 * `getLatestBlockhash` (or point at an `RpcConnected` node) instead.
 */
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { Client, chain } from "../src/index.js";

async function main() {
  const endpoint = process.env.OPENFIAT_NODE_URL ?? "http://localhost:7080";
  const client = new Client({ endpoint, timeoutMs: 30_000 });

  const status = await chain.getChainStatus(client);
  console.log(`node chain mode: ${status.mode}`);

  let blockhash: string;
  try {
    const latest = await chain.getLatestBlockhash(client);
    console.log(`using the node's own blockhash (slot ${latest.slot})`);
    blockhash = latest.blockhash;
  } catch {
    console.log("node has no blockhash yet (see this example's own doc comment) — using a local one");
    blockhash = Keypair.generate().publicKey.toBase58();
  }

  const payer = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const transaction = new Transaction({
    feePayer: payer.publicKey,
    blockhash,
    lastValidBlockHeight: 0,
  }).add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient as PublicKey,
      lamports: 1_000,
    }),
  );
  transaction.sign(payer);

  await chain.sendTransaction(client, new Uint8Array(transaction.serialize()));
  console.log(`submitted — signature: ${transaction.signature?.toString("base64")}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
