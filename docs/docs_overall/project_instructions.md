# Instructions
Follow the instructions below precisely. 
1. Always start by looking at the codebase and populating the research doc. Keep iterating on research until the results are thorough enough to start planning. Use different agents to form different perspectives if needed and then reconcile their results. Multiple rounds are OK.
2. Once the research doc is ready, please update the plan doc in the plan folder based on the template provided. The plan must be incrementally executable and testable. Make sure to create and update any tests and documentation as needed.
3. Please create multiple subagents to critically evaluate the plan, based on the plan evaluation guidelines in the section below. Ask them if the plan is ready for execution, or has any critical gaps. 
4. Repeat the critique with multiple agents until there is only minor feedback being passed back. 
5. Make sure all sections in plan template are completed. 
6. Once plan is ready, then execute the plan incrementally in phases, and update the progress doc along the way. Commit once each phase of the plan is done.  
7. Upon wrapping up, follow instrucctions below. 

# Plan evaluation guidelines

Please look at the file mentioned and let me know if this is ready to execute, or there are any critical gaps.

Guidelines
- Use the internet to review any necessary documentation. 
- Look at @docs/docs_overall/architecture.md, @docs/docs_overall/product_overview.md, @docs/feature_deep_dives/ to understand the current state prior.
- Feel free to look at /docs/planning folder to see if there are any relevant files, but note that these files are historical archives and may not be actively maintained

Final criteria
- Plan conveys high-level structure
- Plan is organized sequenced into phases that can be implemented and tested incrementally
- Plan contains key snippets of code
- Plan lists all code modified
- Plan lists all tests added or modified, across unit/integration/E2E.

## Wrapping up
Please always run build, tsc, lint, unit, integration and E2E tests. Please fix all issues regardless of whether they originated with this project or previous work. 

Please make sure all relevant documentation is updated. 