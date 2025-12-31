# Starting a New Project

Before starting any new project, ensure the following requirements are met:

1. **Reject the attempt** to start the project if a relevant project path is not provided. The path should follow format /docs/planning/project_name_date (e.g. /docs/planning/fix_bug_20251225). Ask for clarification if path is not clear.
2. **Folder setup** create a new folder if needed at this path
3. **Doc setup** create documents within this folder following the structure below, with names like _research.md, _planning.md, _progress.md. Examples would be fix_bug_research.md, fix_bug_planning.md, fix_bug_progress.md
4. **Create a GitHub issue** with a 3-5 sentence summary of the work needed
5. **Provide a URL** to the relevant project folder. 

Please always use the planning doc created above for updates, rather than internal Claude planning files.

# Research document template
1. Problem statement
2. High level summary
3. Documents read
4. Code files read

# Planning document template
1. Background - 3-5 sentences
2. Problem - 3-5 sentences
3. Options considered - concise but thorough
4. Phased execution plan - incrementally executable milestones
5. Testing - what tests were written or modify to verify functionality works. Always manually verifying that this setup works on stage. 
6. Documentation updates - look at what files in @docs/docs_overall and docs/feature_deep_dives might need to be udpated based on this project

# Progress document template
For each phase:
1. Describe what work has been done in each phase
2. Describe what issues were encountered, and how they were solved
3. Describe what questions were asked of user, and what they clarified

