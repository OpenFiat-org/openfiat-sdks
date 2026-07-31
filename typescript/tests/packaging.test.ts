/**
 * The published package has two faces and they must not disagree.
 *
 * `package.json` resolves `types` to `./src/index.ts` and `import` to
 * `./dist/index.js`. That split is deliberate — see
 * `scripts/assert-dts.mjs` for why declarations are not trusted to come
 * out of the bundler intact — but it means a consumer type-checks against
 * one artefact and executes another. When those drift, `tsc --noEmit`,
 * `vitest run` and `eslint` are all green in the consuming app and the
 * import is `undefined` at runtime.
 *
 * That is not hypothetical. It happened the day `reference` was added:
 * a `dist` built before it was still in place, so
 * `import { reference } from "@openfiat/sdk"` type-checked and then threw
 * a TypeError on the first property access, on a merchant-facing screen.
 * Nothing in three green toolchains looked at the file that actually runs.
 *
 * So this compares the two surfaces directly, including the members of
 * every namespace re-export — a missing function inside `advertisements`
 * is exactly as silent as a missing top-level export, and rather more
 * likely, since namespaces are where new methods get added.
 */
import { describe, expect, it } from "vitest";

/**
 * Every runtime name a consumer can reach through this entry point,
 * namespace members included as `namespace.member`.
 *
 * Types do not appear here and cannot: they are erased before either
 * artefact exists. This checks the half that can be `undefined` at three
 * in the morning, which is the half the type-checker never sees.
 */
async function surfaceOf(entry: string): Promise<Set<string>> {
  const module: Record<string, unknown> = await import(entry);
  const names = new Set<string>();
  for (const [name, value] of Object.entries(module)) {
    names.add(name);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const member of Object.keys(value)) names.add(`${name}.${member}`);
    }
  }
  return names;
}

/**
 * Fails loudly rather than skipping when `dist` is absent.
 *
 * A missing bundle is not "nothing to check" — it is the same failure
 * this test exists to catch, in its most complete form: `import` resolves
 * to a file that does not exist while `types` resolves to one that does.
 * `pnpm install` runs `prepare`, which builds it, so an absent `dist`
 * means something skipped that and a consumer would too.
 */
async function requireBundle(entry: string): Promise<Set<string>> {
  try {
    return await surfaceOf(entry);
  } catch (error) {
    throw new Error(
      `cannot load ${entry}, which is what \`import "@openfiat/sdk"\` resolves to. ` +
        `Run \`pnpm build\` (or \`pnpm install\`, which runs it) before the tests. ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

describe("the built bundle and the sources agree", () => {
  it("exports from dist everything the src entry point exports", async () => {
    const source = await surfaceOf("../src/index.js");
    const bundle = await requireBundle("../dist/index.js");

    const missing = [...source].filter((name) => !bundle.has(name)).sort();
    expect(
      missing,
      "these are importable and type-check against src, and are undefined at runtime",
    ).toEqual([]);
  });

  it("exports from dist nothing the src entry point does not", async () => {
    // The other direction is a weaker fault but still a real one: a name
    // only in `dist` is one a consumer can call and cannot type, and it
    // is usually the fingerprint of a stale bundle rather than a
    // deliberate addition.
    const source = await surfaceOf("../src/index.js");
    const bundle = await requireBundle("../dist/index.js");

    const stale = [...bundle].filter((name) => !source.has(name)).sort();
    expect(stale, "left over from an older build of this package").toEqual([]);
  });

  it("keeps the Node-only entry point in step too", async () => {
    // `@openfiat/sdk/node` is a second entry with the same split, and it
    // is the one carrying wallet file I/O — the last place a consumer
    // should meet an undefined function.
    const source = await surfaceOf("../src/node.js");
    const bundle = await requireBundle("../dist/node.js");

    expect([...source].filter((name) => !bundle.has(name)).sort()).toEqual([]);
  });

  it("carries the reference read, which is the one that got through", async () => {
    // Named rather than left to the set comparison above. A regression
    // that dropped this specific export would be caught either way, but
    // a failure that says "reference.getReferenceData is missing from
    // dist" tells the next person what broke and where to look.
    const bundle = await requireBundle("../dist/index.js");
    expect(bundle.has("reference")).toBe(true);
    expect(bundle.has("reference.getReferenceData")).toBe(true);
  });
});
