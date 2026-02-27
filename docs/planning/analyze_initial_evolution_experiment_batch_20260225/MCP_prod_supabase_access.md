# MCP Production Supabase Access Plan

## Background

We need to query the production Supabase database for evolution experiment analysis. The existing `query-prod.ts` script (PR #566) uses a `readonly_local` PostgreSQL role with direct connection, but:
- Direct connection (`db.*.supabase.co:5432`) resolves to IPv6-only — unreachable from this network
- The Supabase pooler (`pooler.supabase.com:6543`) doesn't support custom PostgreSQL roles (Supavisor only knows Supabase-managed roles)
- The workaround (connect as `postgres` via pooler + `SET ROLE readonly_local`) is dangerous: if the `SET ROLE` is forgotten or fails, you have full write access to production

## Problem

We need a safe, reliable way to run read-only SQL against production that:
1. Works over IPv4 (HTTPS, not direct PostgreSQL)
2. Doesn't require managing connection strings or passwords locally
3. Can't accidentally grant write access

## Approach: Supabase MCP Server for Production

Add a second Supabase MCP server entry pointing at the production project. The MCP server:
- Connects over HTTPS (no IPv4/IPv6 issues)
- Authenticates via Supabase OAuth (no local credentials needed)
- Permissions controlled via Claude Code's deny/allow list in `.claude/settings.json`

## Implementation

### Step 1: Add MCP server entry

In `.claude/settings.json`, add to `mcpServers`:

```json
"supabase-prod": {
  "type": "http",
  "url": "https://mcp.supabase.com/mcp?project_ref=qbxhivoezkfbjbsctdzo"
}
```

### Step 2: Configure permissions

The dev Supabase MCP server already has these permission rules:
- **Deny**: `mcp__supabase__execute_sql`, `mcp__supabase__apply_migration`
- **Allow**: `mcp__supabase__list_tables`

For the prod server, the tool names will be prefixed with `mcp__supabase-prod__`. We need to:
- **Allow**: `mcp__supabase-prod__list_tables`, `mcp__supabase-prod__execute_sql` (for read-only queries)
- **Deny**: `mcp__supabase-prod__apply_migration`

### Step 3: Authenticate

On first use, the MCP server will prompt for Supabase OAuth login. This is a one-time step that grants access based on your Supabase dashboard permissions.

### Step 4: Run analysis queries

Use the MCP `execute_sql` tool directly to run the same queries from `analyze-experiments.ts` against production.

## Safety Considerations

| Concern | Mitigation |
|---------|-----------|
| Accidental writes via `execute_sql` | The `readonly_local` role approach had DB-level enforcement. MCP `execute_sql` runs as the project's service role. Writes are possible if explicitly attempted. |
| Mitigation for write risk | Add a PreToolUse hook that blocks `execute_sql` calls containing INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE keywords |
| Credential exposure | No credentials stored locally — OAuth handled by MCP server |
| Wrong project | Tool names include server name (`supabase-prod` vs `supabase`), making it clear which DB you're querying |

## Optional: PreToolUse Hook for Write Protection

To add app-level write protection (defense in depth):

```bash
#!/bin/bash
# .claude/hooks/block-prod-writes.sh
# Block write operations via the prod Supabase MCP execute_sql tool

if [[ "$TOOL_NAME" == "mcp__supabase-prod__execute_sql" ]]; then
  SQL_UPPER=$(echo "$INPUT" | tr '[:lower:]' '[:upper:]')
  for keyword in INSERT UPDATE DELETE DROP ALTER TRUNCATE CREATE GRANT REVOKE; do
    if echo "$SQL_UPPER" | grep -q "\b${keyword}\b"; then
      echo "BLOCKED: Write operation detected in production query ($keyword)"
      exit 1
    fi
  done
fi
```

Hook config in `.claude/settings.json`:
```json
{
  "matcher": "mcp__supabase-prod__execute_sql",
  "hooks": [
    {
      "type": "command",
      "command": "bash .claude/hooks/block-prod-writes.sh"
    }
  ]
}
```

## Comparison: MCP vs Direct PostgreSQL

| Aspect | MCP Server | Direct PostgreSQL (query-prod.ts) |
|--------|-----------|----------------------------------|
| Transport | HTTPS (IPv4) | TCP port 5432 (IPv6-only) or pooler |
| Auth | Supabase OAuth | Connection string + password |
| Write protection | Permission deny list + hook | DB-level role enforcement |
| Local credentials | None | `.env.prod.readonly` with password |
| Tooling | Claude Code MCP tools | CLI script with REPL |
| Works on this network | Yes | No (IPv6 unreachable) |

## Next Steps

1. Add `supabase-prod` MCP server to settings
2. Add permission rules (allow execute_sql, deny apply_migration)
3. Optionally add the write-blocking PreToolUse hook
4. Authenticate via OAuth
5. Run evolution analysis queries against production
