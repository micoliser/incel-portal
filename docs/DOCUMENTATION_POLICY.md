# Documentation Policy

## Purpose

This policy defines mandatory documentation behavior for all code changes in Incel Portal.

## Mandatory Rule

For this repository, every feature that is added, removed, or modified in either:

- backend API
- frontend portal

must be reflected in project documentation within the same change set.

## Minimum Required Documentation Updates

For every relevant code change:

1. Update README.md when user-facing behavior, setup, run commands, or project capabilities change.
2. Update docs/TECHNICAL_DOCUMENTATION.md when architecture, flow, constraints, or implementation details change.
3. Update API route and constraint sections when endpoint contracts are added or modified.
4. Update development and deployment instructions when environment/runtime requirements change.

## Pull Request Checklist

Before merging:

- [ ] API changes documented
- [ ] Frontend changes documented
- [ ] New constraints/rules documented
- [ ] Removed/deprecated behavior documented
- [ ] Setup/deploy command changes documented if applicable

## Enforcement Guideline

A feature change without documentation updates is considered incomplete.

## Scope

This applies to:

- feature development
- bug fixes that alter behavior
- refactors that change contracts or operational guidance
- schema changes and migration-impacting behavior
