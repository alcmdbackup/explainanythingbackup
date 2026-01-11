# Querying Logs in Honeycomb

This guide replaces the Grafana LogCLI-based `query-logs.sh` script. Honeycomb provides a web UI and API for querying logs and traces.

## Quick Start: Query by Request ID

### Via Honeycomb UI (Recommended)

1. Go to [ui.honeycomb.io](https://ui.honeycomb.io)
2. Select the `explainanything` dataset
3. In the Query Builder:
   - Add filter: `requestId = <your-request-id>`
   - Or use the search bar: `requestId:<your-request-id>`
4. Set time range (default: last 1 hour)
5. Click "Run Query"

### Via Honeycomb API

```bash
# Set your API key
export HONEYCOMB_API_KEY="your-api-key"

# Query by request ID (last 1 hour)
curl -s "https://api.honeycomb.io/1/query_results/explainanything" \
  -H "X-Honeycomb-Team: $HONEYCOMB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "filters": [
        {"column": "requestId", "op": "=", "value": "YOUR_REQUEST_ID"}
      ],
      "time_range": 3600
    }
  }' | jq
```

## Common Queries

### Find All Errors (Last Hour)

**UI Filter:** `severity = ERROR` or `level = error`

**API:**
```bash
curl -s "https://api.honeycomb.io/1/query_results/explainanything" \
  -H "X-Honeycomb-Team: $HONEYCOMB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "filters": [{"column": "severity", "op": "=", "value": "ERROR"}],
      "time_range": 3600
    }
  }'
```

### Trace a Slow Request

1. In Honeycomb UI, go to **Traces**
2. Filter by: `duration_ms > 1000`
3. Click on a trace to see the waterfall view
4. Use **BubbleUp** to identify slow spans

### Find Logs by User

**UI Filter:** `userId = <user-id>`

## Key Differences from LogCLI

| LogCLI (Grafana Loki) | Honeycomb |
|-----------------------|-----------|
| `logcli query '{...}'` | Web UI or REST API |
| LogQL syntax | Simple filter UI + BubbleUp |
| Stream-based | Event-based |
| `--since=1h` | Time range selector in UI |

## BubbleUp: Honeycomb's Killer Feature

When debugging issues, use **BubbleUp** to automatically identify what's different about slow/failing requests:

1. Run a query for your problem (e.g., errors, slow requests)
2. Click "BubbleUp" in the query results
3. Honeycomb shows which attributes correlate with the problem
4. Example: "90% of errors have `region=us-west-2` vs 10% baseline"

## Useful Links

- [Honeycomb Query Builder Docs](https://docs.honeycomb.io/investigate/query/)
- [Honeycomb API Reference](https://docs.honeycomb.io/api/)
- [BubbleUp Documentation](https://docs.honeycomb.io/investigate/bubbleup/)

## Migration from LogCLI

The old `scripts/query-logs.sh` used Grafana Loki's LogCLI. That script is now archived.

**Old workflow:**
```bash
./scripts/query-logs.sh <request-id> 1h
```

**New workflow:**
1. Open Honeycomb UI
2. Filter: `requestId = <request-id>`
3. Set time range
4. Run query + use BubbleUp for analysis
