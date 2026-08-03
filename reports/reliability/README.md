# Reliability reports

This directory holds the generated output of `npm run reliability:test`:

- `latest.json` — machine-readable report (see `ReliabilityReport` in
  `scripts/reliability/types.ts`).
- `latest.md` — the same report, readable by a non-technical operator.

Both files are regenerated (overwritten) on every run and are **gitignored**
— only this `README.md` and `.gitkeep` are tracked, so the directory exists
in a fresh clone without ever committing timestamped run noise. See
[docs/RELIABILITY_TESTING.md](../../docs/RELIABILITY_TESTING.md) for the full
design.
