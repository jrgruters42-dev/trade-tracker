# Caruso / Minervini Trade Tracker - Model Context Protocol (MCP) Server

Connect your live trading journal directly to Claude Desktop, Cursor, Zed, or any MCP-compatible AI agent.

## Tools Provided

1. **`get_open_positions`**: View current open positions, stops, shares, risk metrics, and unrealized P&L.
2. **`get_account_summary`**: View total equity, starting equity, Roth balances, benchmarks, and settings.
3. **`get_closed_trades`**: Analyze past trades, win/loss stats, holding periods, and exit performance.
4. **`get_daily_journal_entries`**: Inspect daily equity history, drawdowns, market exposure %, and FOMO notes.
5. **`add_daily_journal_entry`**: Log today's closing snapshot directly from Claude or Cursor.
6. **`update_account_equity`**: Update your current account balance after market close.
7. **`add_open_position`**: Enter a new trade position into the journal via natural language.

---

## Configuration

### Claude Desktop (`claude_desktop_config.json`)

On macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`  
On Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "trade-tracker": {
      "command": "node",
      "args": [
        "/path/to/trade-tracker/mcp-server/index.js"
      ],
      "env": {
        "FIREBASE_PROJECT_ID": "trade-tracker-36e7a",
        "USER_EMAIL": "jrgruters42@gmail.com",
        "FIREBASE_SERVICE_ACCOUNT_KEY": "/path/to/service-account.json"
      }
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "trade-tracker": {
      "command": "node",
      "args": ["mcp-server/index.js"],
      "env": {
        "FIREBASE_PROJECT_ID": "trade-tracker-36e7a",
        "USER_EMAIL": "jrgruters42@gmail.com"
      }
    }
  }
}
```

---

## Service Account Authentication
To connect without interactive browser prompts:
1. Go to Firebase Console (`https://console.firebase.google.com/project/trade-tracker-36e7a/settings/serviceaccounts/adminsdk`)
2. Click **Generate new private key**.
3. Pass the path in `GOOGLE_APPLICATION_CREDENTIALS` or set `FIREBASE_SERVICE_ACCOUNT_KEY` to the file content.
