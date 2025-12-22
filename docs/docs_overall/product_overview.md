# Product Overview: ExplainAnything

## Vision

ExplainAnything is an AI-powered publishing and discovery platform that produces high-quality explanatory content through large-scale AI generation combined with human feedback.

**Core loop**: AI generates content → humans provide feedback → content improves → repeat.

## Principles

1. **AI-Driven Generation**: LLMs draft content faster/cheaper than humans. Easier for AI to write and humans to provide feedback.
2. **Everyone is a Creator**: AI makes editing accessible to all—not just power users. Editing CTAs are visible by default.
3. **Maximize Feedback**: Force frequent feedback, gather questions, tags, etc. to algorithmically improve content.
4. **Attribution**: Original creators receive credit for all downstream uses. Verified by comparing raw content algorithmically.
5. **Growth**: Measured by content creation and consumption. Attribution incentives drive creation; SEO and agents drive consumption.

## Features

### Search & Generation
- Enter any topic → receive comprehensive AI-generated explanation
- Vector similarity matching finds existing content before generating new
- Real-time streaming for instant feedback during generation

### Content Management
- Rich markdown with LaTeX math support
- Toggle between display and edit modes
- AI-assisted editing with diff visualization (in development)
- Save to personal library

### Smart Tagging
- AI automatically evaluates and tags content during generation
- Difficulty levels: Beginner, Normal, Expert
- Content length: Short, Medium, Long
- Teaching characteristics: examples, metaphors, sequential structure

### Analytics
- Track saves, views, engagement per explanation
- Performance metrics inform content ranking
- Background processing for scalability

### Internal Linking
- Headings and key terms auto-linked to related explanations
- Cross-content navigation enables discovery

## User Flow

1. User searches for a topic
2. System finds existing matches or generates new explanation
3. AI tags content automatically
4. Links to related content are added
5. User can save, edit, or provide feedback
6. Metrics update to improve future rankings

## Related Documentation

- **Architecture**: `architecture.md` - technical implementation
- **Tag System**: `tag_system.md` - tagging details
- **White Paper**: `white_paper.md` - product philosophy
