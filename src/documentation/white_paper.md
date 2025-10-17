## Goal
Produce high quality content through larger-scale AI generation combined with human feedback.

## Overview
AI generates content --> human feedback --> better content --> etc

Objective is to maximize this feedback loop to the maximum extent, to create content that is as high-quality as possible. Even if this is unusual and uncomfortable from a UX perspective, this is worth pursuing. 

## Key principles
1. **AI driven content generation** - Rely on LLM-based content generation rather than human writing & editing, since it is significantly faster and cheaper. It is easier for AI to generate/edit and have humans provide feedback, rather than humans do this directly.
2. **Everyone is a direct content creator** - while previously only a few "power" users could be editors, now with AI many more people can directly edit. To facilitate this, editing CTAs should be visible by default, not hidden.
3. **Maximize feedback collection to drive improvements** - force frequent feedback, gather questions from Q&A, tags, etc to maximize the ability to use LLMs/algorithms to automatically generate better content. 
3. **Attribution** - The person who first creates or pioneers content content on the platform receives attribution for all downstream uses and derivatives. 
4. **Growth** - Define growth in terms of content creation and content consumption. Use economic incentives around attribution and links to drive content creation. Cater to agents and SEO to drive content consumption.

### **Attribution**
- **Meaning** - who produced a given piece of content, which could be a small paragraph in an article or an entire article
- **Algorithmic Fairness** - platform should be able to account for original authorship by directly comparing raw content, as this is more reliable than looking at actions taken like forking, citing other articles, etc
- **Protections** - Despite attribution being based on comparing raw content, we should still make it difficult to get external content into the platform. Make copy/paste window small. All links consumed by prompt and agent must be recorded. Agents can also be used later to verify potential plagiarism. 

### **Feedback**
- Feedback can be collected in many forms (e.g. votes, comments, questions in Q&A) - we will use ML or other means to analyze quality of content

### **Article scoring**
- **Aggregated scoring of similar articles** - Within a given topic, it is critical that article be scored based on the content of similar articles. This will allow the bootstrapping of much better content overall. Think of DAG - like voting.