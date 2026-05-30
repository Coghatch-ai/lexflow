// lint-staged.config.mjs
//
// eslint.config.js ignores the vendored bolt POC UI (app/src/pages/**,
// app/src/components/**, mockData). If lint-staged handed those paths to
// eslint, eslint would warn "file ignored by config" and the warning would
// fail --max-warnings 0. Mirror the ignore list here so eslint only ever
// sees files it's configured to lint.

const ESLINT_IGNORED_SEGMENTS = [
  "/app/src/pages/",
  "/app/src/components/",
  "/app/src/lib/mockData.ts",
];

function shouldLint(file) {
  return !ESLINT_IGNORED_SEGMENTS.some((seg) => file.includes(seg));
}

export default {
  "**/*.{ts,tsx}": (files) => {
    const target = files.filter(shouldLint);
    if (target.length === 0) return [];
    const quoted = target.map((f) => JSON.stringify(f)).join(" ");
    return [
      `eslint --max-warnings 0 --no-warn-ignored --fix ${quoted}`,
      `prettier --write ${quoted}`,
    ];
  },
  "**/*.{json,md,yaml,yml,css}": ["prettier --write"],
};
