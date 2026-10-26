import { GoogleGenAI } from '@google/genai';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Spawn our MCP server over stdio
const mcp = spawn('node', [path.join(__dirname, 'index.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || 'trade-tracker-36e7a',
    USER_EMAIL: process.env.USER_EMAIL || 'jrgruters42@gmail.com'
  }
});

let msgId = 1;
const pending = new Map();
let buffer = '';

mcp.stdout.on('data', chunk => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop(); // keep partial line
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.id && pending.has(parsed.id)) {
        pending.get(parsed.id)(parsed);
        pending.delete(parsed.id);
      }
    } catch (e) {}
  }
});

function sendMcpRequest(method, params = {}) {
  return new Promise((resolve) => {
    const id = msgId++;
    pending.set(id, resolve);
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    mcp.stdin.write(msg);
  });
}

// Convert JSON Schema types to Gemini declaration format
function cleanSchema(schema) {
  if (!schema) return { type: 'OBJECT', properties: {} };
  const typeMap = {
    string: 'STRING',
    number: 'NUMBER',
    integer: 'INTEGER',
    boolean: 'BOOLEAN',
    object: 'OBJECT',
    array: 'ARRAY'
  };
  const res = {
    type: typeMap[schema.type] || 'OBJECT',
    description: schema.description || ''
  };
  if (schema.properties) {
    res.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      res.properties[k] = cleanSchema(v);
    }
  }
  if (schema.required) {
    res.required = schema.required;
  }
  return res;
}

export async function createGeminiMcpAgent(apiKey = process.env.GEMINI_API_KEY) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is required.');
  }

  // 1. Initialize MCP handshake
  await sendMcpRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'gemini-mcp-client', version: '1.0.0' }
  });

  // 2. Fetch list of available tools from MCP server
  const toolsRes = await sendMcpRequest('tools/list');
  const mcpTools = toolsRes.result?.tools || [];

  // 3. Format function declarations for GoogleGenAI SDK
  const functionDeclarations = mcpTools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: cleanSchema(t.inputSchema)
  }));

  const ai = new GoogleGenAI({ apiKey });

  // 4. Return an interactive query runner
  return {
    async ask(userPrompt) {
      console.log(`\n💬 User: ${userPrompt}`);
      const history = [{ role: 'user', parts: [{ text: userPrompt }] }];

      while (true) {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: history,
          config: {
            tools: [{ functionDeclarations }]
          }
        });

        const candidate = response.candidates?.[0];
        const content = candidate?.content;
        if (!content) break;

        const functionCalls = content.parts?.filter(p => p.functionCall);
        if (!functionCalls || functionCalls.length === 0) {
          // Final text response
          const text = content.parts?.map(p => p.text).join('') || '';
          return text;
        }

        history.push(content);

        // Execute function calls via MCP server
        const functionResponses = [];
        for (const part of functionCalls) {
          const call = part.functionCall;
          console.log(`🔧 Tool Call -> ${call.name}(${JSON.stringify(call.args)})`);
          const res = await sendMcpRequest('tools/call', {
            name: call.name,
            arguments: call.args || {}
          });
          const textContent = res.result?.content?.[0]?.text || JSON.stringify(res.result || {});
          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: { result: textContent }
            }
          });
        }

        history.push({
          role: 'tool',
          parts: functionResponses
        });
      }
    },
    close() {
      mcp.kill();
    }
  };
}

// CLI usage: node gemini-client.js "What are my current open positions?"
if (process.argv[2]) {
  const prompt = process.argv.slice(2).join(' ');
  const agent = await createGeminiMcpAgent();
  const answer = await agent.ask(prompt);
  console.log(`\n🤖 Gemini:\n${answer}\n`);
  agent.close();
  process.exit(0);
}
