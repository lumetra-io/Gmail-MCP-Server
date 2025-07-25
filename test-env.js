#!/usr/bin/env node

// Test script to verify environment variable loading
process.env.GMAIL_CLIENT_ID = "test_client_id";
process.env.GMAIL_CLIENT_SECRET = "test_client_secret";
process.env.GMAIL_ACCESS_TOKEN = "test_access_token";
process.env.GMAIL_REFRESH_TOKEN = "test_refresh_token";
process.env.GMAIL_EXPIRY_DATE = "1234567890";

console.log("Testing environment variable loading...");
console.log("GMAIL_CLIENT_ID:", process.env.GMAIL_CLIENT_ID);
console.log("GMAIL_CLIENT_SECRET:", process.env.GMAIL_CLIENT_SECRET ? "***HIDDEN***" : "NOT SET");
console.log("GMAIL_ACCESS_TOKEN:", process.env.GMAIL_ACCESS_TOKEN ? "***HIDDEN***" : "NOT SET");
console.log("GMAIL_REFRESH_TOKEN:", process.env.GMAIL_REFRESH_TOKEN ? "***HIDDEN***" : "NOT SET");

// Test account prefix
process.env.GMAIL_ACCOUNT_PREFIX = "ACCOUNT1";
process.env.GMAIL_ACCOUNT1_CLIENT_ID = "account1_client_id";
process.env.GMAIL_ACCOUNT1_CLIENT_SECRET = "account1_client_secret";

const accountPrefix = process.env.GMAIL_ACCOUNT_PREFIX || '';
const envPrefix = accountPrefix ? `GMAIL_${accountPrefix}_` : 'GMAIL_';

console.log("\nTesting multi-account support...");
console.log("Account prefix:", accountPrefix);
console.log("Env prefix:", envPrefix);
console.log("Account1 Client ID:", process.env[`${envPrefix}CLIENT_ID`]);

console.log("\nEnvironment variable loading test completed successfully!");
