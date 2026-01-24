# SKILL: auto-cr-cli

Use this skill when you need to run auto-cr on JavaScript/TypeScript code or explain how to configure it.

## Inputs

- Paths to scan (files or directories).
- Optional config: `.autocrrc.json` / `.autocrrc.js`.
- Optional ignore: `.autocrignore.json` / `.autocrignore.js`.
- Optional custom rules directory: `--rule-dir`.
- Optional output format: `--output text|json`.
- Optional language: `--language zh|en`.
- Optional tsconfig override: `--tsconfig <path>`.
- Optional stdin mode: `--stdin` to read paths from STDIN.

## Steps

1. Run a scan:
   `npx auto-cr-cmd --language en <path>`
2. JSON output for CI or scripts:
   `npx auto-cr-cmd --output json <path>`
3. Custom rules:
   `npx auto-cr-cmd --rule-dir <dir> <path>`
4. Config and ignore files:
   `npx auto-cr-cmd --config .autocrrc.json --ignore-path .autocrignore.json <path>`
5. Read paths from STDIN (newline or NUL separated):
   `git diff --name-only -z | npx auto-cr-cmd --stdin --output json`

## Output (JSON quick reference)

- `summary.scannedFiles`, `summary.filesWithErrors`, `summary.filesWithWarnings`, `summary.filesWithOptimizing`
- `summary.violationTotals` (counts by severity)
- `files[].filePath`, `files[].severityCounts`, `files[].totalViolations`, `files[].errorViolations`
- `files[].violations[]` with `tag`, `ruleName`, `severity`, `message`, optional `line`, optional `code`, and `suggestions`
- `notifications[]`

Exit code is `1` when errors are found, otherwise `0`.

## Notes

- Scans `.ts` / `.tsx` / `.js` / `.jsx`; `.d.ts` is skipped.
- Directory scans skip `node_modules` by default.
- Text output goes to `stderr`; JSON output goes to `stdout`.
- STDIN is read automatically when piped (use `--stdin` to force).
- Use `AUTO_CR_WORKERS=0|1|N` to control parallelism.

## References

- `README.md`
- `docs/config.md`
- `examples/` for rule demos and custom rules layout
