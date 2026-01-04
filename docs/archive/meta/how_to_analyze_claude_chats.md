# How to Analyze Claude Code Chat History

This guide covers extracting and analyzing Claude Code CLI conversation history.

## Installation

Install the `claude-conversation-extractor` tool:

```bash
pipx install claude-conversation-extractor
```

This provides four CLI commands:
- `claude-extract` - Main extraction tool
- `claude-start` - Interactive UI
- `claude-search` - Search conversations
- `claude-logs` - Alias for extract

## Where Claude Code Stores Conversations

Claude Code saves conversations in:
- **Index**: `~/.claude/history.jsonl`
- **Full data**: `~/.claude/projects/<project-path>/`

Note: By default, Claude Code deletes history after 30 days. Modify `~/.claude/settings.json` to change retention.

## Common Commands

### List Available Sessions

```bash
# List all sessions
claude-extract --list

# List most recent 20 sessions
claude-extract --list --limit 20
```

### Extract Recent Sessions

```bash
# Extract 20 most recent sessions to Desktop
claude-extract --recent 20 --output ~/Desktop/claude-chat-logs

# Include tool calls and system messages (recommended for full context)
claude-extract --recent 20 --output ~/Desktop/claude-chat-logs --detailed
```

### Extract Specific Sessions

```bash
# Extract session #1 (most recent)
claude-extract --extract 1

# Extract multiple specific sessions
claude-extract --extract 1,3,5
```

### Extract All Sessions

```bash
claude-extract --all --output ~/Desktop/claude-chat-logs
```

### Output Formats

```bash
# Markdown (default, human-readable)
claude-extract --recent 10 --format markdown

# JSON (for programmatic analysis)
claude-extract --recent 10 --format json

# HTML (for browser viewing)
claude-extract --recent 10 --format html
```

## Searching Conversations

```bash
# Smart text search
claude-search "error handling"

# Regex search
claude-extract --search-regex "import.*supabase"

# Filter by date range
claude-extract --search "bug" --search-date-from 2025-01-01 --search-date-to 2025-01-31

# Filter by speaker
claude-extract --search "database" --search-speaker human
claude-extract --search "database" --search-speaker assistant
```

## Interactive Mode

For a visual interface:

```bash
claude-start
# or
claude-extract --interactive
```

## Understanding Output Files

Extracted markdown files include:
- **Session metadata** (date, project path, session ID)
- **Human messages** prefixed with 👤
- **Claude responses** prefixed with 🤖
- **Tool calls** (with `--detailed` flag)

Files prefixed with `agent-` are subagent sessions spawned by Claude Code's Task tool.

## Example Workflow

```bash
# 1. Install the tool
pipx install claude-conversation-extractor

# 2. List recent sessions to see what's available
claude-extract --list --limit 10

# 3. Extract recent sessions with full detail
claude-extract --recent 20 --output ~/Desktop/claude-logs --detailed --format markdown

# 4. Search for specific topics across all history
claude-search "authentication"
```

## Tips

- Use `--detailed` to include tool calls and system messages for complete context
- Markdown format is best for reading; JSON for analysis scripts
- Agent sessions (prefixed `agent-`) are sub-conversations spawned during complex tasks
- Run extractions regularly since history expires after 30 days by default
