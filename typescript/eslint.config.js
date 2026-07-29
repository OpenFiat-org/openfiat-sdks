import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    // Build tooling runs in Node and legitimately uses its globals. Scoped
    // to `scripts/` rather than declared globally: the published library
    // targets browsers too, so `process` being undefined there is a real
    // error worth keeping.
    files: ["scripts/**/*.mjs", "scripts/**/*.js"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
);
