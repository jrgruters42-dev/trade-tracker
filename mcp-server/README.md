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

---

## Connecting to Gemini

There are three ways to use this MCP server with Gemini:

### Method 1: Using the Included Gemini Runner (`gemini-client.js`)
A pre-configured bridge using `@google/genai` is already included in `mcp-server/gemini-client.js`.

1. Set your Gemini API key:
```bash
export GEMINI_API_KEY="your-gemini-api-key"
export FIREBASE_PROJECT_ID="trade-tracker-36e7a"
export USER_EMAIL="jrgruters42@gmail.com"
```

2. Ask Gemini anything directly in your terminal:
```bash
node mcp-server/gemini-client.js "What open positions do I currently have?"
node mcp-server/gemini-client.js "Summarize my account equity and any drawdown from my recent journal entries."
```
Gemini will automatically call `get_open_positions` or `get_account_summary`, parse your live journal, and respond.

---

### Method 2: In Gemini-Powered IDEs (Cursor / Windsurf / Zed)
If you are using Gemini models (e.g., `gemini-2.5-flash`, `gemini-2.5-pro`) inside **Cursor** or **Windsurf**:
Configure `.cursor/mcp.json` or Windsurf Settings -> MCP:

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
Select Gemini as your model in the chat panel, and it will have all the Trade Tracker MCP tools enabled.

---

### Method 3: In Google AI Studio / Custom Node.js Scripts
Import `createGeminiMcpAgent` from `gemini-client.js` in any Node.js project:

```javascript
import { createGeminiMcpAgent } from './mcp-server/gemini-client.js';

const agent = await createGeminiMcpAgent(process.env.GEMINI_API_KEY);
const reply = await agent.ask("Check my journal and tell me if I have any open Caruso breakout setups.");
console.log(reply);
agent.close();
```
