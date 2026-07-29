/**
 * Fails the build if the declaration bundle came out degenerate.
 *
 * `tsup --dts` emitted a complete 55 KB `dist/index.d.ts` locally and a
 * 1.02 KB stub in CI from the same commit and the same lockfile. The stub
 * was missing every type re-export, so consumers failed with "has no
 * exported member ServiceRecord" while the SDK's own build reported
 * success. A build that silently produces unusable types is worse than
 * one that fails: the breakage surfaced in a different repository, on an
 * unrelated pull request, as a wall of TS2305s.
 *
 * Consumers now resolve types from `src`, so this is defence in depth
 * rather than the primary fix. It stays because `dist/*.d.ts` is still
 * published, and anything reachable can be depended on by accident.
 *
 * The check is deliberately about SHAPE, not size alone: a threshold on
 * bytes would pass a file that happens to be long and still exports the
 * wrong things.
 */

import { readFileSync } from "node:fs";

/** Names that must survive bundling. Each is a type a consumer in this
 *  workspace already imports; if the re-export chain from `./types.js`
 *  breaks, every one of them disappears together. */
const REQUIRED = [
  "ServiceRecord",
  "ServiceType",
  "ServicePricing",
  "ProviderEarnings",
  "EarningsChallenge",
  "Amount",
  "SubscriptionUpdate",
  "SubscriptionDestination",
];

// tsup names the declaration after the format it accompanies: `.d.ts`
// beside ESM output, `.d.cts` beside CJS. Which of them exists depends on
// the formats requested, so check every candidate and require at least one
// rather than hardcoding a name — a missing file and a degenerate file are
// different failures and should not be reported as the same one.
const candidates = ["dist/index.d.ts", "dist/index.d.cts"];

const found = candidates
  .map((path) => {
    try {
      return { path, source: readFileSync(path, "utf8") };
    } catch {
      return null;
    }
  })
  .filter((entry) => entry !== null);

if (found.length === 0) {
  console.error(
    `assert-dts: no declaration bundle found. Looked for:\n` +
      candidates.map((c) => `  - ${c}`).join("\n") +
      `\n\nRun this after a build that emits declarations.`
  );
  process.exit(1);
}

// Every emitted declaration must be complete, not just one of them.
const { path: target, source } = found.reduce((worst, entry) =>
  entry.source.length < worst.source.length ? entry : worst,
);

const missing = REQUIRED.filter((name) => !new RegExp(`\\b${name}\\b`).test(source));

if (missing.length > 0) {
  console.error(
    `assert-dts: ${target} is ${source.length} bytes and is missing ` +
      `${missing.length} of ${REQUIRED.length} expected type names:\n` +
      missing.map((n) => `  - ${n}`).join("\n") +
      `\n\nThe declaration bundle built but does not describe the package. ` +
      `This is the failure mode that broke openfiat-app's typecheck while ` +
      `this build reported success. Do not publish it.`
  );
  process.exit(1);
}

console.log(
  `assert-dts: ${target} ok — ${source.length} bytes, all ${REQUIRED.length} expected type names present`
);
