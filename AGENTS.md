# Repository Agent Rules

## Workflow

- Before starting any task, identify whether an available Cursor skill applies.
- If a skill applies, read its `SKILL.md` first and follow it before answering, planning, or editing.
- No spec, no code: do not write implementation code until the relevant behavior is documented or confirmed.
- No approved plan, no execute: for code development, get the user's plan approval before making changes.
- Treat documentation as the source of truth. If docs and code conflict, assume the code is wrong.
- Reverse sync bug fixes: when a bug reveals a documentation gap, update the documentation before updating code.

## Project Context

- This repository contains the `@openclaw/hierarchical` OpenClaw plugin.
- Core TypeScript source files live in `src/*.ts`.
- Tests live under `tests/`.
- Auxiliary validation scripts live in `scripts/*.mjs`.
- Plugin metadata is declared in `package.json` and `openclaw.plugin.json`.

## Change Boundaries

- Keep edits focused on the requested behavior and nearby ownership boundaries.
- Prefer existing TypeScript and OpenClaw plugin patterns over introducing new abstractions.
- Do not revert or overwrite unrelated user changes.
- Do not touch unrelated untracked files unless the user explicitly asks.

## Validation

- After code changes, run the most relevant unit tests or repository validation command available.
- After documentation-only changes, reread the edited document to verify accuracy.
- If validation cannot be run, explain why in the final response.
