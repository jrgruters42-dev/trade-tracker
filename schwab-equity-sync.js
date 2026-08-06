#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

const TOKEN_FILE = path.join(__dirname, '.schwab-tokens.json');
const SETTINGS_FILE = path.join(__dirname, '.schwab-sync-settings.json');
const AUTHORIZE_URL = 'https://api.schwabapi.com/v1/oauth/authorize';
const TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token';
const TRADER_URL = 'https://api.schwabapi.com/trader/v1';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writePrivateJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

async function responseJson(response, label) {
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = { raw: text }; }
  if (!response.ok) {
    const detail = body.error_description || body.error?.message || body.message || body.raw || response.statusText;
    throw new Error(`${label} failed (${response.status}): ${detail}`);
  }
  return body;
}

async function exchangeToken(parameters) {
  const key = required('SCHWAB_APP_KEY');
  const secret = required('SCHWAB_APP_SECRET');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(parameters),
  });
  const token = await responseJson(response, 'Schwab token request');
  const previous = readJson(TOKEN_FILE, {});
  const saved = {
    ...previous,
    ...token,
    refresh_token: token.refresh_token || previous.refresh_token,
    obtained_at: Date.now(),
    expires_at: Date.now() + (Number(token.expires_in || 1800) * 1000),
  };
  writePrivateJson(TOKEN_FILE, saved);
  return saved;
}

async function authorize() {
  const callback = required('SCHWAB_CALLBACK_URL');
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', required('SCHWAB_APP_KEY'));
  url.searchParams.set('redirect_uri', callback);
  console.log('\nOpen this URL in your browser and approve access:\n');
  console.log(url.toString());
  console.log('\nAfter approval, the browser may show a certificate or connection error.');
  console.log('That is okay. Copy the ENTIRE URL from the browser address bar.\n');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const redirected = (await rl.question('Paste the entire redirected URL here: ')).trim();
  rl.close();
  const code = new URL(redirected).searchParams.get('code');
  if (!code) throw new Error('The pasted URL does not contain an authorization code.');
  await exchangeToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callback,
  });
  console.log('\nSchwab authorization saved privately.');
}

async function accessToken() {
  let token = readJson(TOKEN_FILE);
  if (!token?.refresh_token) {
    await authorize();
    token = readJson(TOKEN_FILE);
  }
  if (token.access_token && Date.now() < Number(token.expires_at || 0) - 60_000) {
    return token.access_token;
  }
  token = await exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
  });
  return token.access_token;
}

async function schwabGet(route) {
  const response = await fetch(`${TRADER_URL}${route}`, {
    headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' },
  });
  if (response.status === 401) {
    console.log('Schwab authorization expired. Reauthorizing...');
    await authorize();
    return schwabGet(route);
  }
  return responseJson(response, `Schwab ${route}`);
}

async function chooseAccount() {
  const accounts = await schwabGet('/accounts/accountNumbers');
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('No Schwab accounts were returned.');
  const settings = readJson(SETTINGS_FILE, {});
  if (settings.accountHash && accounts.some(a => a.hashValue === settings.accountHash)) return settings.accountHash;

  console.log('\nSchwab accounts available:');
  accounts.forEach((account, index) => {
    const suffix = String(account.accountNumber || '').slice(-4) || 'unknown';
    console.log(`  ${index + 1}. Account ending in ${suffix}`);
  });
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question('\nWhich account should supply Trading Account ($)? ')).trim();
  rl.close();
  const selected = accounts[Number(answer) - 1];
  if (!selected) throw new Error('Invalid account selection.');
  writePrivateJson(SETTINGS_FILE, { ...settings, accountHash: selected.hashValue });
  return selected.hashValue;
}

function findEquity(payload) {
  const account = payload?.securitiesAccount || payload;
  const balances = account?.currentBalances || {};
  const candidates = [
    ['liquidationValue', balances.liquidationValue],
    ['equity', balances.equity],
    ['accountValue', balances.accountValue],
  ];
  const found = candidates.find(([, value]) => Number.isFinite(Number(value)));
  if (!found) throw new Error('Schwab response did not contain a recognized current-equity value.');
  return { field: found[0], value: Number(found[1]) };
}

async function getEquity() {
  const hash = await chooseAccount();
  return findEquity(await schwabGet(`/accounts/${encodeURIComponent(hash)}`));
}

async function firebaseToken() {
  const apiKey = required('FIREBASE_API_KEY');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: required('FIREBASE_SYNC_EMAIL'),
      password: required('FIREBASE_SYNC_PASSWORD'),
      returnSecureToken: true,
    }),
  });
  return (await responseJson(response, 'Firebase sign-in')).idToken;
}

async function writeFirebase(value) {
  const base = required('FIREBASE_DATABASE_URL').replace(/\/$/, '');
  const token = await firebaseToken();
  const response = await fetch(`${base}/tradeData/accountSize.json?auth=${encodeURIComponent(token)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  await responseJson(response, 'Firebase account-size write');
}

async function runOnce(write) {
  const equity = await getEquity();
  console.log(`\nSchwab equity (${equity.field}): ${equity.value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`);
  if (!write) {
    console.log('Dry run only: Firebase was not changed.');
    return;
  }
  await writeFirebase(equity.value);
  console.log('Trading Account ($) updated successfully.');
}

async function main() {
  const command = process.argv[2] || 'dry-run';
  if (command === 'authorize') return authorize();
  if (command === 'dry-run') return runOnce(false);
  if (command === 'write-once') return runOnce(true);
  if (command === 'sync') {
    await runOnce(true);
    setInterval(() => runOnce(true).catch(error => console.error(`[${new Date().toISOString()}] ${error.message}`)), 60_000);
    return;
  }
  throw new Error('Usage: node schwab-equity-sync.js [authorize|dry-run|write-once|sync]');
}

main().catch(error => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});
