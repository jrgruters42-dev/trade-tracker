import { onRequest } from 'firebase-functions/v2/https';
import admin from 'firebase-admin';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const TARGET_USER_EMAIL = 'jrgruters42@gmail.com';

// Active sessions map
const transports = new Map();

// Helper to resolve user document in Firestore
async function getTargetUserDocRef() {
  try {
    const user = await admin.auth().getUserByEmail(TARGET_USER_EMAIL);
    return db.collection('users').doc(user.uid);
  } catch (err) {
    const snap = await db.collection('users').limit(1).get();
    if (!snap.empty) return snap.docs[0].ref;
    throw new Error('User record not found in Firestore.');
  }
}

function createMcpServer() {
  const server = new Server(
    {
      name: 'trade-tracker-mcp',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'get_open_positions',
          description: 'Fetch all currently open trading positions with entry price, stop loss, current price, shares, and risk metrics.',
          inputSchema: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: 'Optional ticker symbol (e.g. AAPL, NVDA) to filter by' }
            }
          }
        },
        {
          name: 'get_account_summary',
          description: 'Fetch current account equity, starting account, Roth balances, SPY Jan 1 benchmark, and settings.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_closed_trades',
          description: 'Fetch historical closed trades with P&L, return %, holding period, and exit notes.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Maximum number of trades to return (default: 20)' },
              symbol: { type: 'string', description: 'Optional ticker symbol to filter by' }
            }
          }
        },
        {
          name: 'get_daily_journal_entries',
          description: 'Fetch daily equity journal snapshots including account equity, daily % change, drawdown, exposure %, and FOMO notes.',
          inputSchema: {
            type: 'object',
            properties: {
              days: { type: 'number', description: 'Number of recent trading days to fetch (default: 30)' }
            }
          }
        },
        {
          name: 'add_daily_journal_entry',
          description: "Log or update today's daily journal entry (equity, drawdown, exposure %, FOMO index, and notes).",
          inputSchema: {
            type: 'object',
            required: ['accountValue'],
            properties: {
              date: { type: 'string', description: 'Date in YYYY-MM-DD format (defaults to current date)' },
              accountValue: { type: 'number', description: 'Total current account liquidation value ($)' },
              exposure: { type: 'number', description: 'Current market exposure percentage (e.g. 50 for 50%)' },
              drawdown: { type: 'number', description: 'Current drawdown % from peak equity (e.g. -2.5)' },
              fomo: { type: 'string', description: 'FOMO rating or $NCFD closing index level' },
              notes: { type: 'string', description: 'Daily market observations, execution thoughts, or trade notes' }
            }
          }
        },
        {
          name: 'update_account_equity',
          description: 'Update the main Trading Account equity balance ($) in settings/main.',
          inputSchema: {
            type: 'object',
            required: ['accountSize'],
            properties: {
              accountSize: { type: 'number', description: 'New total trading account balance ($)' }
            }
          }
        },
        {
          name: 'add_open_position',
          description: 'Add a new open position to the trade tracker.',
          inputSchema: {
            type: 'object',
            required: ['symbol', 'shares', 'entryPrice', 'stopLoss'],
            properties: {
              symbol: { type: 'string', description: 'Stock ticker symbol (uppercase)' },
              shares: { type: 'number', description: 'Number of shares' },
              entryPrice: { type: 'number', description: 'Execution entry price ($)' },
              stopLoss: { type: 'number', description: 'Initial stop loss price ($)' },
              setup: { type: 'string', description: 'Setup type (e.g. Caruso, Breakout, Pullback)' },
              notes: { type: 'string', description: 'Trade rationale or technical notes' }
            }
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const userDoc = await getTargetUserDocRef();

    switch (name) {
      case 'get_open_positions': {
        const snapshot = await userDoc.collection('openPositions').get();
        let positions = snapshot.docs.map(doc => ({
          _id: doc.id,
          ...((doc.data() && doc.data().payload) || doc.data())
        }));
        if (args?.symbol) {
          positions = positions.filter(p => String(p.symbol || '').toUpperCase() === String(args.symbol).toUpperCase());
        }
        return { content: [{ type: 'text', text: JSON.stringify(positions, null, 2) }] };
      }

      case 'get_account_summary': {
        const doc = await userDoc.collection('settings').doc('main').get();
        const settings = doc.exists ? ((doc.data() && doc.data().payload) || doc.data()) : {};
        return { content: [{ type: 'text', text: JSON.stringify(settings, null, 2) }] };
      }

      case 'get_closed_trades': {
        const limit = args?.limit || 20;
        const snapshot = await userDoc.collection('closedTrades').get();
        let trades = snapshot.docs.map(doc => ({
          _id: doc.id,
          ...((doc.data() && doc.data().payload) || doc.data())
        }));
        if (args?.symbol) {
          trades = trades.filter(t => String(t.symbol || '').toUpperCase() === String(args.symbol).toUpperCase());
        }
        trades.sort((a, b) => new Date(b.dateClosed || b.date || 0) - new Date(a.dateClosed || a.date || 0));
        return { content: [{ type: 'text', text: JSON.stringify(trades.slice(0, limit), null, 2) }] };
      }

      case 'get_daily_journal_entries': {
        const days = args?.days || 30;
        const snapshot = await userDoc.collection('dailyEquityEntries').get();
        let entries = snapshot.docs.map(doc => ({
          _id: doc.id,
          ...((doc.data() && doc.data().payload) || doc.data())
        }));
        entries.sort((a, b) => new Date(b.date) - new Date(a.date));
        return { content: [{ type: 'text', text: JSON.stringify(entries.slice(0, days), null, 2) }] };
      }

      case 'add_daily_journal_entry': {
        const today = args.date || new Date().toISOString().split('T')[0];
        const docId = `journal-${today}`;
        const docRef = userDoc.collection('dailyEquityEntries').doc(docId);
        const existing = await docRef.get();
        const prevData = existing.exists ? (existing.data().payload || existing.data()) : {};

        const payload = {
          date: today,
          accountValue: Number(args.accountValue),
          exposure: args.exposure !== undefined ? Number(args.exposure) : (prevData.exposure || 0),
          drawdown: args.drawdown !== undefined ? Number(args.drawdown) : (prevData.drawdown || 0),
          fomo: args.fomo !== undefined ? String(args.fomo) : (prevData.fomo || ''),
          notes: args.notes !== undefined ? String(args.notes) : (prevData.notes || ''),
          _syncId: docId,
          _syncOrder: Date.now()
        };

        const revision = existing.exists ? ((existing.data().revision || 0) + 1) : 1;
        await docRef.set({
          payload,
          revision,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return { content: [{ type: 'text', text: `Logged daily journal entry for ${today} ($${args.accountValue.toLocaleString()})` }] };
      }

      case 'update_account_equity': {
        const settingsRef = userDoc.collection('settings').doc('main');
        const settingsDoc = await settingsRef.get();
        const sPayload = settingsDoc.exists ? (settingsDoc.data().payload || {}) : {};
        sPayload.accountSize = Number(args.accountSize);
        const sRev = settingsDoc.exists ? ((settingsDoc.data().revision || 0) + 1) : 1;

        await settingsRef.set({
          payload: sPayload,
          revision: sRev,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return { content: [{ type: 'text', text: `Trading Account equity updated to $${Number(args.accountSize).toLocaleString()}` }] };
      }

      case 'add_open_position': {
        const posId = Date.now();
        const docId = `position-${posId}`;
        const docRef = userDoc.collection('openPositions').doc(docId);
        const payload = {
          id: posId,
          symbol: String(args.symbol).toUpperCase(),
          shares: Number(args.shares),
          entryPrice: Number(args.entryPrice),
          stopLoss: Number(args.stopLoss),
          currentPrice: Number(args.entryPrice),
          setup: args.setup || 'Caruso',
          notes: args.notes || '',
          dateAdded: new Date().toISOString().split('T')[0],
          _syncId: docId,
          _syncOrder: posId
        };

        await docRef.set({ payload, revision: 1, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        return { content: [{ type: 'text', text: `Added open position: ${payload.shares} shares of ${payload.symbol} @ $${payload.entryPrice}` }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}

// HTTP / SSE Handler for Remote MCP
export const mcp = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1'
  },
  async (req, res) => {
    // Basic API Key / Bearer Auth protection
    const expectedKey = process.env.MCP_SECRET_KEY || 'trade-tracker-mcp-key';
    const authHeader = req.headers['authorization'] || '';
    const queryKey = req.query.key;

    if (
      authHeader !== `Bearer ${expectedKey}` &&
      req.headers['x-mcp-key'] !== expectedKey &&
      queryKey !== expectedKey
    ) {
      res.status(401).json({
        error: 'Unauthorized. Provide Bearer token or ?key= query parameter matching your MCP_SECRET_KEY.'
      });
      return;
    }

    if (req.method === 'GET') {
      // Establish SSE session
      const transport = new SSEServerTransport('/mcp/messages', res);
      const server = createMcpServer();
      await server.connect(transport);

      const sessionId = transport.sessionId;
      transports.set(sessionId, transport);

      transport.onclose = () => {
        transports.delete(sessionId);
      };
      return;
    }

    if (req.method === 'POST') {
      // Inbound messages to existing SSE session
      const sessionId = req.query.sessionId;
      if (!sessionId || !transports.has(sessionId)) {
        res.status(404).send('Session not found or expired.');
        return;
      }
      const transport = transports.get(sessionId);
      await transport.handlePostMessage(req, res);
      return;
    }

    res.status(405).send('Method Not Allowed');
  }
);
