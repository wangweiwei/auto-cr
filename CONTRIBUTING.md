# Contributing Guide

Thanks for your interest in contributing to **auto-cr**! This document is inspired by the contribution workflow of projects such as Chakra UI. Please take a moment to read the guidelines below before submitting a pull request or filing an issue.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Project Setup](#project-setup)
3. [Creating a Branch](#creating-a-branch)
4. [Development Workflow](#development-workflow)
5. [Writing Rules](#writing-rules)
6. [Testing & Linting](#testing--linting)
7. [Commit Message Convention](#commit-message-convention)
8. [Submitting Changes](#submitting-changes)
9. [Release Process](#release-process)
10. [Getting Help](#getting-help)

## Code of Conduct

Participation in this project is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md). Please read it to make sure you understand the expectations for everyone who interacts with the repository.

## Project Setup

This repository is a pnpm workspace with two packages:

- `packages/auto-cr-rules`: rule SDK and built-in lint rules.
- `packages/auto-cr-cmd`: CLI entry point.

To get started:

```bash
pnpm install
pnpm run build
```

The first command installs dependencies across the workspace. The second ensures both packages compile successfully.

## Creating a Branch

Before you begin, create a feature branch from `main` (or the appropriate base branch).

```bash
git checkout -b feat/my-feature
```

Use descriptive names such as `feat/...`, `fix/...`, or `docs/...` to clarify the intent of the change.

## Development Workflow

- For CLI development, run:

  ```bash
  pnpm --filter auto-cr-cmd run dev
  ```

- To execute the CLI locally, use:

  ```bash
  pnpm --filter auto-cr-cmd run cli -- <args>
  ```

- To build the rule package in watch mode (if needed), you can run:

  ```bash
  pnpm --filter auto-cr-rules run build -- --watch
  ```

## Writing Rules

When adding new rules:

1. Prefer implementing them in `packages/auto-cr-rules`.
2. Use the helpers provided by the SDK (`defineRule`, `createRuleContext`, etc.).
3. Include documentation updates in the README under "扩展规则" or any related section.
4. Consider adding example usage for custom rule authors.

## Testing & Linting

Run linting before submitting a pull request. If you add tests (recommended), ensure they pass locally.

```bash
pnpm run format
pnpm run build
```

Additional scripts (e.g., unit tests) can be added in the future; please follow the workspace conventions.

## Commit Message Convention

We recommend using a lightweight Conventional Commit style, for example:

```
feat: add foo rule to warn about bar
fix: handle missing tsconfig gracefully
docs: update README with publishing flow
```

This keeps the history clean and simplifies change log generation in the future.

## Submitting Changes

1. Ensure your branch is up to date with the target branch.
2. Run `pnpm run build` to confirm the workspace compiles.
3. Commit with meaningful messages.
4. Open a pull request describing the motivation and key changes.
5. Reference related issues when applicable.

## Release Process

Maintainers can release new versions using the scripts provided in `package.json`:

```bash
pnpm run publish    # bumps versions, builds, publishes both packages
```

To specify a different version bump type, set `VERSION_TYPE` before running `pnpm run publish`, or execute `pnpm run version minor`/`major` as needed.

Remember to verify the change log or release notes before announcing a new release. Add manual steps here if your team follows a more formal process.

## Getting Help

If you have questions, feel free to open an issue or reach out to the maintainers at [INSERT CONTACT EMAIL].
