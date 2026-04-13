# Further Speedup Research

## Problem Statement
This project encompasses several improvements to the evolution pipeline: recovering and documenting research from a crashed branch about judging accuracy, adding timeline visualization for generate_from_seed_article invocations, debugging slow Qwen judge model performance, clarifying the budget buffer parameter naming, and configuring thinking mode for the OSS 20B model to improve speed.

## Requirements (from GH Issue #NNN)
- Pull in the research and planning documents from branch feat/estimate_match_noise_evolution_20260411 - some progress on this branch was lost when my minicomputer crashed. Compare that implementation to the implementation of feat/improve_setup_judging_20260412, which was recreated from memory and then merged, so see if there are any notable differences.
- Also, please copy in the research doc from feat/estimate_match_noise_evolution_20260411, take the key findings and populate them in a docs/research/judging_accuracy_20260412.md for future reference on judges
- Help me add a "timeline" view, similar to what we have for a run, for the invocations of generate_from_seed_article, so I can see why it is taking a certain amount of time to finish
- Debug why judge model for QWEN is so slow. Verify that it was the model called on Run 4133123e-c9fa-4c52-9289-26dcfb95ce61 in staging. See why it isn't faster than OSS 20B. Test both those models side-by-side locally using a script, and see how their response times compare.
- Check for me how our Budget Buffer After Parallel (0-1) value is used. Rename if needed to make it more clear.
- Use web docs to disable thinking mode or put it into "low" thinking mode for OSS 20B model, wherever it is used. Run tests to verify this makes a difference.

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/cost_optimization.md
- evolution/docs/data_model.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/agents/overview.md
- evolution/docs/logging.md
- evolution/docs/entities.md
- evolution/docs/metrics.md
- evolution/docs/arena.md
- evolution/docs/reference.md
- evolution/docs/visualization.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md

## Code Files Read
- [list of code files reviewed]
