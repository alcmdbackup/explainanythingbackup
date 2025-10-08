# Background
Think of a topic like a Wikipedia page, but instead of there being only one main article, there can be N articles. Articles within a topic can be:
- **Independent**: Created from scratch with no lineage
- **Derived**: Created by forking (editing) an existing article within the topic

Forking means making edits to an existing article and saving the result as a new article, preserving the parent-child relationship.

# Objectives
1. Track version lineage for derived articles within individual topics
2. Show diffs between derived articles and their ancestors
3. Score articles within each topic based on novelty and feedback, with derived articles inheriting credit from their predecessors

# Key Requirements

## Article Types
- **Root articles**: Independent articles created from scratch (no parents)
- **Derived articles**: Articles created by forking existing articles (have parent lineage)

## Lineage Tracking
- Each derived article maintains reference to its immediate parent
- Support linear chains: A → B → C → D
- Support branching: A → B, A → C (multiple children from same parent)
- No merging (multiple parents) in initial version

## Diffing
- Only applicable to derived articles vs their ancestors
- Must support diff visualization between any two articles in the same lineage chain
- Independent articles cannot be diffed (no shared ancestry)

## Scoring System
- All articles receive base scores from novelty metrics and user feedback
- Derived articles inherit some credit from their parent lineage
- Credit inheritance mechanism needs definition (TBD) 
