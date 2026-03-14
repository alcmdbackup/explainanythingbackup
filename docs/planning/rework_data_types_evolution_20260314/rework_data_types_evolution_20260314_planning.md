# Rework Data Types Evolution Plan

## Background
I want to rework the core types within evolution pipeline to make things easier to maintain. I want to rework the core types within evolution to clean up architecture & other things downstream.

## Requirements (from GH Issue #NNN)
Split types into core_entities and supporting_types, with key entities and their types defined in core_entities

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` - Core data model may need updates to reflect new type organization
- `evolution/docs/evolution/architecture.md` - Architecture references to type files may need updating
- `evolution/docs/evolution/entity_diagram.md` - Entity relationships may need updates if types change
- `evolution/docs/evolution/reference.md` - Key files section will need updates for new type file locations
