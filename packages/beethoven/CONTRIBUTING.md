# Contributing to Beethoven

Thanks for your interest in contributing. This repo focuses on a stable, audited interface for protocol-agnostic CPI actions on Solana. The most common contribution is adding a new protocol integration.

## Ways to contribute

- Protocol integrations (new actions or new protocols)
- Bug fixes and performance improvements
- Documentation improvements tied to code changes
- Tests that improve coverage or safety

## Development setup

### Requirements

- Rust toolchain (stable and nightly)
- Solana CLI (for program tests)

### Common commands

```bash
make format
make clippy
make test
make test-upstream
```

`make test` builds the SBF program in `program-test` and runs the tests. `make test-upstream` uses upstream BPF features.

## Adding a protocol integration

### 1) Create the protocol module

Add a new module under `src/programs/<your_protocol>` with:

- `*_PROGRAM_ID` constant
- Account parsing struct(s) per action
- Trait implementation(s) for each action

### 2) Wire the protocol into the action context

For each action you support:

- Add a new enum variant in `src/traits/<action>.rs`
- Extend the detection logic in `try_from_*_context`
- Guard all new code with a feature flag (e.g., `your_protocol`)

### 3) Update features

Add your feature flag to `Cargo.toml` and gate all protocol-specific code with `#[cfg(feature = "your_protocol")]`.

### 4) Add or update tests

Add tests that validate account parsing and instruction building. If protocol tests rely on program-test fixtures, include them under `program-test` or `fixtures`.

## Pull request guidelines

- Keep PRs focused and well-scoped
- Run the checks listed above before submitting
- Include a short description of the protocol action(s) added or changed
- If adding a protocol, confirm feature gating is in place
- If adding new accounts or instructions, include tests or a clear test plan

## Reporting issues

Please use the GitHub issue templates. For security-sensitive reports, avoid filing a public issue and contact the maintainers directly.
