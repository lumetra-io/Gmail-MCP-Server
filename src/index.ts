#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { google, gmail_v1 } from 'googleapis';
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import express from 'express';
import { randomUUID } from 'node:crypto';
import open from 'open';
import os from 'os';
import crypto from 'crypto';
import { createEmailMessage, createEmailWithNodemailer } from "./utl.js";
import { createLabel, updateLabel, deleteLabel, listLabels, findLabelByName, getOrCreateLabel, GmailLabel } from "./label-manager.js";
import { AsyncLocalStorage } from 'node:async_hooks';

// Define the shape of the context for each request
interface AppContext {
    gmail: gmail_v1.Gmail | null;
    oauth2Client: OAuth2Client | null;
    sessionId?: string;
    userId?: string;
}

// Create a new AsyncLocalStorage instance with the defined type
const asyncLocalStorage = new AsyncLocalStorage<AppContext>();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration paths
let CONFIG_DIR = path.join(os.homedir(), '.gmail-mcp');
let OAUTH_PATH = process.env.GMAIL_OAUTH_PATH || path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
let CREDENTIALS_PATH = process.env.GMAIL_CREDENTIALS_PATH || path.join(CONFIG_DIR, 'credentials.json');

// Function to update paths for session-specific storage
function updatePaths(storagePath: string, sessionId?: string) {
    if (sessionId) {
        CONFIG_DIR = path.join(storagePath, sessionId);
    } else {
        CONFIG_DIR = storagePath;
    }
    OAUTH_PATH = process.env.GMAIL_OAUTH_PATH || path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
    CREDENTIALS_PATH = process.env.GMAIL_CREDENTIALS_PATH || path.join(CONFIG_DIR, 'credentials.json');
}

// Type definitions for Gmail API responses
interface GmailMessagePart {
    partId?: string;
    mimeType?: string;
    filename?: string;
    headers?: Array<{
        name: string;
        value: string;
    }>;
    body?: {
        attachmentId?: string;
        size?: number;
        data?: string;
    };
    parts?: GmailMessagePart[];
}

interface EmailAttachment {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
}

interface EmailContent {
    text: string;
    html: string;
}

// Session-based OAuth2 configuration - no global client
// Store per-session credentials in AsyncLocalStorage

/**
 * Recursively extract email body content from MIME message parts
 * Handles complex email structures with nested parts
 */
function extractEmailContent(messagePart: GmailMessagePart): EmailContent {
    // Initialize containers for different content types
    let textContent = '';
    let htmlContent = '';

    // If the part has a body with data, process it based on MIME type
    if (messagePart.body && messagePart.body.data) {
        const content = Buffer.from(messagePart.body.data, 'base64').toString('utf8');

        // Store content based on its MIME type
        if (messagePart.mimeType === 'text/plain') {
            textContent = content;
        } else if (messagePart.mimeType === 'text/html') {
            htmlContent = content;
        }
    }

    // If the part has nested parts, recursively process them
    if (messagePart.parts && messagePart.parts.length > 0) {
        for (const part of messagePart.parts) {
            const { text, html } = extractEmailContent(part);
            if (text) textContent += text;
            if (html) htmlContent += html;
        }
    }

    // Return both plain text and HTML content
    return { text: textContent, html: htmlContent };
}

async function loadCredentials(storagePath?: string, sessionId?: string): Promise<OAuth2Client | null> {
    if (storagePath || sessionId) {
        updatePaths(storagePath || path.join(os.homedir(), '.gmail-mcp'), sessionId);
    }

    try {
        // Create config directory if it doesn't exist
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }

        // Check for OAuth keys in current directory first, then in config directory
        const localOAuthPath = path.join(process.cwd(), 'gcp-oauth.keys.json');

        if (fs.existsSync(localOAuthPath) && !fs.existsSync(OAUTH_PATH)) {
            // If found in current directory and not in config, copy to config directory
            fs.copyFileSync(localOAuthPath, OAUTH_PATH);
            console.log('OAuth keys found in current directory, copied to global config.');
        }

        if (!fs.existsSync(OAUTH_PATH)) {
            // Don't exit if the file doesn't exist, just warn
            console.warn(`Warning: OAuth keys file not found for session ${sessionId || 'default'}. Please run the setup_authentication tool.`);
            return null; // Return null instead of undefined
        }

        const keysContent = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
        const keys = keysContent.installed || keysContent.web;

        if (!keys) {
            console.error('Error: Invalid OAuth keys file format. File should contain either "installed" or "web" credentials.');
            return null; // Return null instead of undefined
        }

        // Use the first redirect URI from the stored configuration, or command line override
        const callback = process.argv[2] === 'auth' && process.argv[3]
            ? process.argv[3]
            : (keys.redirect_uris && keys.redirect_uris[0]) || "http://localhost:3456/oauth2callback";

        const sessionOauth2Client = new OAuth2Client({
            clientId: keys.client_id,
            clientSecret: keys.client_secret,
            redirectUri: callback
        });

        if (fs.existsSync(CREDENTIALS_PATH)) {
            const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
            sessionOauth2Client.setCredentials(credentials);
        }

        return sessionOauth2Client;
    } catch (error) {
        console.error('Error loading credentials:', error);
        return null;
    }
}

async function authenticate(sessionOauth2Client: OAuth2Client, sessionCredentialsPath: string) {
    const callbackUrl = (sessionOauth2Client as any).redirectUri || (sessionOauth2Client as any)._opts?.redirectUri;
    if (!callbackUrl) {
        throw new Error("OAuth2 Client is not configured with a callback URL.");
    }

    const parsedUrl = new URL(callbackUrl);
    const port = parsedUrl.port;

    if (!port) {
        throw new Error("Callback URL must have a port specified (e.g., http://localhost:3000).");
    }

    const server = http.createServer();
    server.listen(parseInt(port, 10), parsedUrl.hostname);

    return new Promise<void>((resolve, reject) => {
        const authUrl = sessionOauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/gmail.modify'],
        });

        console.log('Please visit this URL to authenticate:', authUrl);
        open(authUrl);

        const timeout = setTimeout(() => {
            server.close();
            reject(new Error('Authentication timed out after 5 minutes.'));
        }, 300000);

        server.on('close', () => {
            clearTimeout(timeout);
        });

        server.on('request', async (req, res) => {
            // Only handle requests to the specified callback path
            if (!req.url || !req.url.startsWith(parsedUrl.pathname)) {
                res.writeHead(404);
                res.end('Not Found');
                return;
            }

            const url = new URL(req.url, callbackUrl);
            const code = url.searchParams.get('code');

            if (!code) {
                res.writeHead(400);
                res.end('No code provided');
                server.close();
                reject(new Error('No code provided'));
                return;
            }

            try {
                const { tokens } = await sessionOauth2Client.getToken(code);
                sessionOauth2Client.setCredentials(tokens);
                fs.writeFileSync(sessionCredentialsPath, JSON.stringify(tokens));

                res.writeHead(200);
                res.end('Authentication successful! You can close this window.');
                server.close();
                resolve();
            } catch (error) {
                res.writeHead(500);
                res.end('Authentication failed');
                server.close();
                reject(error);
            }
        });
    });
}

// Schema definitions
const SendEmailSchema = z.object({
    to: z.array(z.string()).describe("List of recipient email addresses"),
    subject: z.string().describe("Email subject"),
    body: z.string().describe("Email body content (used for text/plain or when htmlBody not provided)"),
    htmlBody: z.string().optional().describe("HTML version of the email body"),
    mimeType: z.enum(['text/plain', 'text/html', 'multipart/alternative']).optional().default('text/plain').describe("Email content type"),
    cc: z.array(z.string()).optional().describe("List of CC recipients"),
    bcc: z.array(z.string()).optional().describe("List of BCC recipients"),
    threadId: z.string().optional().describe("Thread ID to reply to"),
    inReplyTo: z.string().optional().describe("Message ID being replied to"),
    attachments: z.array(z.string()).optional().describe("List of file paths to attach to the email"),
    sessionToken: z.string().optional().describe("Session token to authenticate the request (optional - if not provided, will use session-based auth)"),
});

const ReadEmailSchema = z.object({
    messageId: z.string().describe("ID of the email message to retrieve"),
});

const SearchEmailsSchema = z.object({
    query: z.string().describe("Gmail search query (e.g., 'from:example@gmail.com')"),
    maxResults: z.number().optional().describe("Maximum number of results to return"),
});

// Updated schema to include removeLabelIds
const ModifyEmailSchema = z.object({
    messageId: z.string().describe("ID of the email message to modify"),
    labelIds: z.array(z.string()).optional().describe("List of label IDs to apply"),
    addLabelIds: z.array(z.string()).optional().describe("List of label IDs to add to the message"),
    removeLabelIds: z.array(z.string()).optional().describe("List of label IDs to remove from the message"),
});

const DeleteEmailSchema = z.object({
    messageId: z.string().describe("ID of the email message to delete"),
});

// New schema for listing email labels
const ListEmailLabelsSchema = z.object({}).describe("Retrieves all available Gmail labels");

// Label management schemas
const CreateLabelSchema = z.object({
    name: z.string().describe("Name for the new label"),
    messageListVisibility: z.enum(['show', 'hide']).optional().describe("Whether to show or hide the label in the message list"),
    labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional().describe("Visibility of the label in the label list"),
}).describe("Creates a new Gmail label");

const UpdateLabelSchema = z.object({
    id: z.string().describe("ID of the label to update"),
    name: z.string().optional().describe("New name for the label"),
    messageListVisibility: z.enum(['show', 'hide']).optional().describe("Whether to show or hide the label in the message list"),
    labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional().describe("Visibility of the label in the label list"),
}).describe("Updates an existing Gmail label");

const DeleteLabelSchema = z.object({
    id: z.string().describe("ID of the label to delete"),
}).describe("Deletes a Gmail label");

const GetOrCreateLabelSchema = z.object({
    name: z.string().describe("Name of the label to get or create"),
    messageListVisibility: z.enum(['show', 'hide']).optional().describe("Whether to show or hide the label in the message list"),
    labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional().describe("Visibility of the label in the label list"),
}).describe("Gets an existing label by name or creates it if it doesn't exist");

// Schemas for batch operations
const BatchModifyEmailsSchema = z.object({
    messageIds: z.array(z.string()).describe("List of message IDs to modify"),
    addLabelIds: z.array(z.string()).optional().describe("List of label IDs to add to all messages"),
    removeLabelIds: z.array(z.string()).optional().describe("List of label IDs to remove from all messages"),
    batchSize: z.number().optional().default(50).describe("Number of messages to process in each batch (default: 50)"),
});

const BatchDeleteEmailsSchema = z.object({
    messageIds: z.array(z.string()).describe("List of message IDs to delete"),
    batchSize: z.number().optional().default(50).describe("Number of messages to process in each batch (default: 50)"),
});

const DownloadAttachmentSchema = z.object({
    messageId: z.string().describe("ID of the email message containing the attachment"),
    attachmentId: z.string().describe("ID of the attachment to download"),
    filename: z.string().optional().describe("Filename to save the attachment as (if not provided, uses original filename)"),
    savePath: z.string().optional().describe("Directory path to save the attachment (defaults to current directory)"),
});

// Schema for authentication setup
const SetupAuthenticationSchema = z.object({
    clientId: z.string().describe("Your Google Cloud OAuth Client ID"),
    clientSecret: z.string().describe("Your Google Cloud OAuth Client Secret"),
    callbackUrl: z.string().optional().default("http://localhost:3456/oauth2callback").describe("The OAuth2 callback URL. Defaults to http://localhost:3456/oauth2callback"),
    storagePath: z.string().optional().default(path.join(os.homedir(), '.gmail-mcp')).describe("The directory to store authentication files. Defaults to ~/.gmail-mcp"),
    userId: z.string().optional().describe("Optional user identifier for multi-user setups. If provided, credentials will be stored separately for this user."),
}).describe("Sets up and performs authentication with Google Cloud OAuth.");

// Schema for token-based authentication
const AuthenticateWithTokenSchema = z.object({
    sessionToken: z.string().describe("Session token received after successful authentication"),
}).describe("Authenticate using a previously received session token.");

// Session management for multi-user support with token-based authentication
interface SessionData {
    oauth2Client: OAuth2Client;
    gmail: gmail_v1.Gmail;
    userId?: string;
    sessionToken?: string;
    tokenCreatedAt?: Date;
}

const sessionStore = new Map<string, SessionData>();
const tokenToSessionMap = new Map<string, string>(); // Maps tokens to session IDs

// Global variable to track current request context (temporary solution)
let currentRequestContext: { mcpSessionId?: string; authSessionId?: string } = {};

// Helper function to get transport session ID from request context
function getTransportSessionId(): string | undefined {
    return currentRequestContext.mcpSessionId;
}

// Helper function to get or create session ID
function getCurrentSessionId(): string {
    const store = asyncLocalStorage.getStore();
    if (store?.sessionId) {
        return store.sessionId;
    }

    // Try to get from current request context
    if (currentRequestContext.authSessionId) {
        return currentRequestContext.authSessionId;
    }

    // Try to get from MCP transport
    const transportSessionId = getTransportSessionId();
    if (transportSessionId) {
        return 'auth-' + transportSessionId;
    }

    // Generate a new session ID if none exists
    return 'session-' + Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Helper function to get session ID based on client configuration
function getSessionIdFromConfig(clientId: string, callbackUrl: string): string {
    // Create a deterministic session ID based on client configuration
    // This allows the same user with same config to reuse the same session
    const hash = crypto.createHash('sha256').update(clientId + callbackUrl).digest('hex');
    return 'user-' + hash.substring(0, 16);
}

// Helper function to generate a secure session token
function generateSessionToken(): string {
    return 'mcp_token_' + crypto.randomUUID().replace(/-/g, '') + '_' + Date.now().toString(36);
}

// Helper function to store session data with token
function storeSessionData(sessionId: string, oauth2Client: OAuth2Client, gmail: gmail_v1.Gmail, userId?: string): string {
    const sessionToken = generateSessionToken();
    const sessionData: SessionData = {
        oauth2Client,
        gmail,
        userId,
        sessionToken,
        tokenCreatedAt: new Date()
    };

    sessionStore.set(sessionId, sessionData);
    tokenToSessionMap.set(sessionToken, sessionId);

    console.log(`Stored session data for: ${sessionId} (user: ${userId || 'auto'}) with token: ${sessionToken.substring(0, 20)}...`);
    return sessionToken;
}

// Helper function to get session data
function getSessionData(sessionId: string): SessionData | undefined {
    const data = sessionStore.get(sessionId);
    if (data) {
        console.log(`Retrieved session data for: ${sessionId} (user: ${data.userId || 'auto'})`);
    }
    return data;
}

// Helper function to validate session token
function validateSessionToken(token: string): { sessionId: string; sessionData: SessionData } | null {
    const sessionId = tokenToSessionMap.get(token);
    if (!sessionId) {
        console.log(`Invalid token provided: ${token.substring(0, 20)}...`);
        return null;
    }

    const sessionData = sessionStore.get(sessionId);
    if (!sessionData || sessionData.sessionToken !== token) {
        console.log(`Token mismatch for session: ${sessionId}`);
        return null;
    }

    // Check if token is expired (24 hours)
    const tokenAge = Date.now() - (sessionData.tokenCreatedAt?.getTime() || 0);
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    if (tokenAge > maxAge) {
        console.log(`Token expired for session: ${sessionId}`);
        // Clean up expired token
        tokenToSessionMap.delete(token);
        sessionStore.delete(sessionId);
        return null;
    }

    console.log(`Valid token verified for session: ${sessionId} (user: ${sessionData.userId || 'auto'})`);
    return { sessionId, sessionData };
}

// Helper function to get session-specific OAuth client
async function getSessionOAuthClient(sessionId: string): Promise<OAuth2Client | null> {
    const store = asyncLocalStorage.getStore();
    if (store?.oauth2Client) {
        return store.oauth2Client;
    }

    // Check session store first
    const sessionData = getSessionData(sessionId);
    if (sessionData) {
        return sessionData.oauth2Client;
    }

    // Try to load credentials for this session
    return await loadCredentials(undefined, sessionId);
}

// Proper MCP SDK HTTP/SSE transport implementation
async function startHttpServer(mcpServer: Server, transportMode: 'http' | 'sse') {
    const app = express();
    app.use(express.json());

    console.log(`Starting Gmail MCP Server with ${transportMode.toUpperCase()} transport...`);

    // Store transports for session management
    const transports = {
        streamable: {} as Record<string, StreamableHTTPServerTransport>,
        sse: {} as Record<string, SSEServerTransport>
    };

    if (transportMode === 'http') {
        // Modern Streamable HTTP endpoint with proper session management
        app.all('/mcp', async (req, res) => {
            try {
                // Set CORS headers
                res.header('Access-Control-Allow-Origin', '*');
                res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
                res.header('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');

                const sessionId = req.headers['mcp-session-id'] as string | undefined;
                let transport: StreamableHTTPServerTransport;

                if (sessionId && transports.streamable[sessionId]) {
                    // Reuse existing transport
                    transport = transports.streamable[sessionId];
                } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
                    // New initialization request
                    transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (sessionId: string) => {
                            transports.streamable[sessionId] = transport;
                            console.log(`New session initialized: ${sessionId}`);
                        }
                    });

                    // Clean up transport when closed
                    transport.onclose = () => {
                        if (transport.sessionId) {
                            const authSessionId = 'auth-' + transport.sessionId;
                            // Clean up auth session data
                            sessionStore.delete(authSessionId);
                            delete transports.streamable[transport.sessionId];
                            console.log(`MCP session closed: ${transport.sessionId}, cleaned auth session: ${authSessionId}`);
                        }
                    };

                    // Connect the server to the transport
                    await mcpServer.connect(transport);
                } else if (req.method === 'POST') {
                    // POST request without session ID for non-initialize requests
                    res.status(400).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32000,
                            message: 'Bad Request: Session ID required for non-initialize requests',
                        },
                        id: req.body.id || null,
                    });
                    return;
                } else {
                    // Other methods (GET/DELETE) require session ID
                    if (!sessionId || !transports.streamable[sessionId]) {
                        res.status(400).send('Invalid or missing session ID');
                        return;
                    }
                    transport = transports.streamable[sessionId];
                }

                // Set current request context before handling
                const mcpSessionId = transport.sessionId || sessionId;
                const authSessionId = 'auth-' + (mcpSessionId || 'default');

                currentRequestContext = { mcpSessionId, authSessionId };

                try {
                    // Handle the request through the proper MCP transport
                    await transport.handleRequest(req, res, req.body);
                } finally {
                    // Clear request context
                    currentRequestContext = {};
                }

            } catch (error: any) {
                console.error('Error handling Streamable HTTP request:', error);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: 'Internal server error',
                        },
                        id: null,
                    });
                }
            }
        });
    }

    if (transportMode === 'sse') {
        // Legacy SSE endpoint for backwards compatibility
        app.get('/sse', async (req, res) => {
            try {
                const transport = new SSEServerTransport('/messages', res);
                transports.sse[transport.sessionId] = transport;

                res.on("close", () => {
                    delete transports.sse[transport.sessionId];
                    console.log(`SSE session closed: ${transport.sessionId}`);
                });

                await mcpServer.connect(transport);
                console.log(`SSE session started: ${transport.sessionId}`);
            } catch (error) {
                console.error('Error starting SSE transport:', error);
                res.status(500).send('Failed to start SSE transport');
            }
        });

        // Legacy message endpoint for SSE clients
        app.post('/messages', async (req, res) => {
            try {
                const sessionId = req.query.sessionId as string;
                const transport = transports.sse[sessionId];
                if (transport) {
                    await transport.handlePostMessage(req, res, req.body);
                } else {
                    res.status(400).send('No transport found for sessionId');
                }
            } catch (error) {
                console.error('Error handling SSE message:', error);
                res.status(500).send('Error processing message');
            }
        });
    }

    // Handle CORS preflight for all endpoints
    app.options('*', (req, res) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
        res.sendStatus(200);
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            transport: transportMode,
            timestamp: new Date().toISOString(),
            version: '1.1.10',
            activeSessions: {
                streamable: Object.keys(transports.streamable).length,
                sse: Object.keys(transports.sse).length
            }
        });
    });

    // API documentation endpoint
    app.get('/', (req, res) => {
        res.json({
            name: 'Gmail MCP Server',
            version: '1.1.10',
            transport: transportMode,
            protocol: transportMode === 'http' ? 'Streamable HTTP (2025-03-26)' : 'SSE (deprecated)',
            endpoints: transportMode === 'http' ? {
                mcp: 'ALL /mcp - MCP Streamable HTTP endpoint',
                health: 'GET /health - Health check'
            } : {
                sse: 'GET /sse - SSE connection endpoint',
                messages: 'POST /messages - Message handling endpoint',
                health: 'GET /health - Health check'
            },
            documentation: 'https://modelcontextprotocol.io/docs'
        });
    });

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`Gmail MCP Server listening on port ${port}`);
        console.log(`Transport mode: ${transportMode}`);
        if (transportMode === 'http') {
            console.log(`Streamable HTTP endpoint: http://localhost:${port}/mcp`);
        } else {
            console.log(`SSE endpoint: http://localhost:${port}/sse`);
            console.log(`Messages endpoint: http://localhost:${port}/messages`);
        }
        console.log(`Health check: http://localhost:${port}/health`);
        console.log(`Documentation: http://localhost:${port}/`);
    });
}

// Main function
async function main() {
    // No global credential loading needed - will be done per session

    if (process.argv[2] === 'auth') {
        // For standalone auth, create a temporary session
        const tempSessionId = 'auth-' + Date.now();
        const tempOAuthClient = await loadCredentials(undefined, tempSessionId);
        if (!tempOAuthClient) {
            console.error('No OAuth configuration found. Please run setup_authentication first.');
            process.exit(1);
        }

        updatePaths(path.join(os.homedir(), '.gmail-mcp'), tempSessionId);
        await authenticate(tempOAuthClient, CREDENTIALS_PATH);
        console.log('Authentication completed successfully');
        process.exit(0);
    }

    // No global Gmail API initialization - will be done per session

    // Server implementation
    const mcpServer = new Server({
        name: "gmail",
        version: "1.0.0",
    }, {
        capabilities: {
            tools: {},
        },
    });

    // Tool handlers
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: "send_email",
                description: "Sends a new email",
                inputSchema: zodToJsonSchema(SendEmailSchema),
            },
            {
                name: "draft_email",
                description: "Draft a new email",
                inputSchema: zodToJsonSchema(SendEmailSchema),
            },
            {
                name: "read_email",
                description: "Retrieves the content of a specific email",
                inputSchema: zodToJsonSchema(ReadEmailSchema),
            },
            {
                name: "search_emails",
                description: "Searches for emails using Gmail search syntax",
                inputSchema: zodToJsonSchema(SearchEmailsSchema),
            },
            {
                name: "modify_email",
                description: "Modifies email labels (move to different folders)",
                inputSchema: zodToJsonSchema(ModifyEmailSchema),
            },
            {
                name: "delete_email",
                description: "Permanently deletes an email",
                inputSchema: zodToJsonSchema(DeleteEmailSchema),
            },
            {
                name: "list_email_labels",
                description: "Retrieves all available Gmail labels",
                inputSchema: zodToJsonSchema(ListEmailLabelsSchema),
            },
            {
                name: "batch_modify_emails",
                description: "Modifies labels for multiple emails in batches",
                inputSchema: zodToJsonSchema(BatchModifyEmailsSchema),
            },
            {
                name: "batch_delete_emails",
                description: "Permanently deletes multiple emails in batches",
                inputSchema: zodToJsonSchema(BatchDeleteEmailsSchema),
            },
            {
                name: "create_label",
                description: "Creates a new Gmail label",
                inputSchema: zodToJsonSchema(CreateLabelSchema),
            },
            {
                name: "update_label",
                description: "Updates an existing Gmail label",
                inputSchema: zodToJsonSchema(UpdateLabelSchema),
            },
            {
                name: "delete_label",
                description: "Deletes a Gmail label",
                inputSchema: zodToJsonSchema(DeleteLabelSchema),
            },
            {
                name: "get_or_create_label",
                description: "Gets an existing label by name or creates it if it doesn't exist",
                inputSchema: zodToJsonSchema(GetOrCreateLabelSchema),
            },
            {
                name: "download_attachment",
                description: "Downloads an email attachment to a specified location",
                inputSchema: zodToJsonSchema(DownloadAttachmentSchema),
            },
            {
                name: "setup_authentication",
                description: "Sets up and performs authentication with Google Cloud OAuth",
                inputSchema: zodToJsonSchema(SetupAuthenticationSchema),
            },
            {
                name: "authenticate_with_token",
                description: "Authenticate using a previously received session token",
                inputSchema: zodToJsonSchema(AuthenticateWithTokenSchema),
            },
        ],
    }))

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request: any, extra?: any) => {
        // Get the MCP session ID from current request context
        // This is the key to proper session isolation
        const mcpSessionId = currentRequestContext.mcpSessionId || 'default';
        const authSessionId = currentRequestContext.authSessionId || ('auth-' + mcpSessionId);

        console.log(`Processing request for MCP session: ${mcpSessionId}, Auth session: ${authSessionId}`);

        return asyncLocalStorage.run({ gmail: null, oauth2Client: null, sessionId: authSessionId }, async () => {
            const { name, arguments: args } = request.params;

            // For all tools except setup_authentication and authenticate_with_token, ensure we have a gmail client
            if (name !== 'setup_authentication' && name !== 'authenticate_with_token') {
                const store = asyncLocalStorage.getStore();
                let sessionOauth2Client: OAuth2Client | null = null;
                let gmailClient: gmail_v1.Gmail | null = null;

                // Check if request includes a session token
                const providedToken = args.sessionToken as string | undefined;

                if (providedToken) {
                    console.log(`Token-based authentication attempted with token: ${providedToken.substring(0, 20)}...`);
                    const tokenValidation = validateSessionToken(providedToken);

                    if (tokenValidation) {
                        console.log(`Token validated successfully for session: ${tokenValidation.sessionId}`);
                        sessionOauth2Client = tokenValidation.sessionData.oauth2Client;
                        gmailClient = tokenValidation.sessionData.gmail;

                        // Update the store with validated credentials
                        if (store) {
                            store.gmail = gmailClient;
                            store.oauth2Client = sessionOauth2Client;
                            store.sessionId = tokenValidation.sessionId;
                            store.userId = tokenValidation.sessionData.userId;
                        }
                    } else {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Error: Invalid or expired session token. Please authenticate again using setup_authentication.`,
                                },
                            ],
                        };
                    }
                } else if (!store || !store.gmail) {
                    // Fall back to session-based authentication
                    console.log(`No token provided, attempting session-based authentication for: ${authSessionId}`);
                    const sessionData = getSessionData(authSessionId);

                    if (sessionData) {
                        console.log(`Found existing auth session: ${authSessionId}`);
                        sessionOauth2Client = sessionData.oauth2Client;
                        gmailClient = sessionData.gmail;
                    } else {
                        console.log(`No existing auth session, loading credentials for: ${authSessionId}`);
                        // Attempt to load credentials for the current session
                        sessionOauth2Client = await getSessionOAuthClient(authSessionId);

                        // Do NOT fall back to other users' credentials
                        // Each session must authenticate independently

                        if (sessionOauth2Client) {
                            gmailClient = google.gmail({ version: 'v1', auth: sessionOauth2Client });
                            // Store in session store for future use (generate token)
                            const sessionToken = storeSessionData(authSessionId, sessionOauth2Client, gmailClient);
                            console.log(`Generated new session token for existing credentials: ${sessionToken.substring(0, 20)}...`);
                        }
                    }

                }

                if (!sessionOauth2Client || !gmailClient) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Error: No authentication found for session ${authSessionId}. Please authenticate using either:\n1. setup_authentication tool (first time)\n2. authenticate_with_token tool (with your session token)\n\nAnonymous access to other users' credentials is not allowed.`,
                            },
                        ],
                    };
                }

                // Update the store with the Gmail client (if not already done by token validation)
                const currentStore = asyncLocalStorage.getStore();
                if (currentStore && !currentStore.gmail) {
                    currentStore.gmail = gmailClient;
                    currentStore.oauth2Client = sessionOauth2Client;
                    currentStore.sessionId = authSessionId;
                }
            }

            const store = asyncLocalStorage.getStore();
            let gmail = store!.gmail;

            async function handleEmailAction(action: "send" | "draft", validatedArgs: any, gmail: gmail_v1.Gmail) {
                let message: string;

                try {
                    // Check if we have attachments
                    if (validatedArgs.attachments && validatedArgs.attachments.length > 0) {
                        // Use Nodemailer to create properly formatted RFC822 message
                        message = await createEmailWithNodemailer(validatedArgs);

                        if (action === "send") {
                            const encodedMessage = Buffer.from(message).toString('base64')
                                .replace(/\+/g, '-')
                                .replace(/\//g, '_')
                                .replace(/=+$/, '');

                            const result = await gmail.users.messages.send({
                                userId: 'me',
                                requestBody: {
                                    raw: encodedMessage,
                                    ...(validatedArgs.threadId && { threadId: validatedArgs.threadId })
                                }
                            });

                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `Email sent successfully with ID: ${result.data.id}`,
                                    },
                                ],
                            };
                        } else {
                            // For drafts with attachments, use the raw message
                            const encodedMessage = Buffer.from(message).toString('base64')
                                .replace(/\+/g, '-')
                                .replace(/\//g, '_')
                                .replace(/=+$/, '');

                            const messageRequest = {
                                raw: encodedMessage,
                                ...(validatedArgs.threadId && { threadId: validatedArgs.threadId })
                            };

                            const response = await gmail.users.drafts.create({
                                userId: 'me',
                                requestBody: {
                                    message: messageRequest,
                                },
                            });
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `Email draft created successfully with ID: ${response.data.id}`,
                                    },
                                ],
                            };
                        }
                    } else {
                        // For emails without attachments, use the existing simple method
                        message = createEmailMessage(validatedArgs);

                        const encodedMessage = Buffer.from(message).toString('base64')
                            .replace(/\+/g, '-')
                            .replace(/\//g, '_')
                            .replace(/=+$/, '');

                        // Define the type for messageRequest
                        interface GmailMessageRequest {
                            raw: string;
                            threadId?: string;
                        }

                        const messageRequest: GmailMessageRequest = {
                            raw: encodedMessage,
                        };

                        // Add threadId if specified
                        if (validatedArgs.threadId) {
                            messageRequest.threadId = validatedArgs.threadId;
                        }

                        if (action === "send") {
                            const response = await gmail.users.messages.send({
                                userId: 'me',
                                requestBody: messageRequest,
                            });
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `Email sent successfully with ID: ${response.data.id}`,
                                    },
                                ],
                            };
                        } else {
                            const response = await gmail.users.drafts.create({
                                userId: 'me',
                                requestBody: {
                                    message: messageRequest,
                                },
                            });
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `Email draft created successfully with ID: ${response.data.id}`,
                                    },
                                ],
                            };
                        }
                    }
                } catch (error: any) {
                    // Log attachment-related errors for debugging
                    if (validatedArgs.attachments && validatedArgs.attachments.length > 0) {
                        console.error(`Failed to send email with ${validatedArgs.attachments.length} attachments:`, error.message);
                    }
                    throw error;
                }
            }

            // Helper function to process operations in batches
            async function processBatches<T, U>(
                items: T[],
                batchSize: number,
                processFn: (batch: T[]) => Promise<U[]>
            ): Promise<{ successes: U[], failures: { item: T, error: Error }[] }> {
                const successes: U[] = [];
                const failures: { item: T, error: Error }[] = [];

                // Process in batches
                for (let i = 0; i < items.length; i += batchSize) {
                    const batch = items.slice(i, i + batchSize);
                    try {
                        const results = await processFn(batch);
                        successes.push(...results);
                    } catch (error) {
                        // If batch fails, try individual items
                        for (const item of batch) {
                            try {
                                const result = await processFn([item]);
                                successes.push(...result);
                            } catch (itemError) {
                                failures.push({ item, error: itemError as Error });
                            }
                        }
                    }
                }

                return { successes, failures };
            }

            try {
                switch (name) {
                    case "send_email":
                    case "draft_email": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const validatedArgs = SendEmailSchema.parse(args);
                        const action = name === "send_email" ? "send" : "draft";
                        return await handleEmailAction(action, validatedArgs, gmail);
                    }

                    case "read_email": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const validatedArgs = ReadEmailSchema.parse(args);
                        const response = await gmail!.users.messages.get({
                            userId: 'me',
                            id: validatedArgs.messageId,
                            format: 'full',
                        });

                        const headers = response.data.payload?.headers || [];
                        const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '';
                        const from = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value || '';
                        const to = headers.find((h: any) => h.name?.toLowerCase() === 'to')?.value || '';
                        const date = headers.find((h: any) => h.name?.toLowerCase() === 'date')?.value || '';
                        const threadId = response.data.threadId || '';

                        // Extract email content using the recursive function
                        const { text, html } = extractEmailContent(response.data.payload as GmailMessagePart || {});

                        // Use plain text content if available, otherwise use HTML content
                        // (optionally, you could implement HTML-to-text conversion here)
                        let body = text || html || '';

                        // If we only have HTML content, add a note for the user
                        const contentTypeNote = !text && html ?
                            '[Note: This email is HTML-formatted. Plain text version not available.]\n\n' : '';

                        // Get attachment information
                        const attachments: EmailAttachment[] = [];
                        const processAttachmentParts = (part: GmailMessagePart, path: string = '') => {
                            if (part.body && part.body.attachmentId) {
                                const filename = part.filename || `attachment-${part.body.attachmentId}`;
                                attachments.push({
                                    id: part.body.attachmentId,
                                    filename: filename,
                                    mimeType: part.mimeType || 'application/octet-stream',
                                    size: part.body.size || 0
                                });
                            }

                            if (part.parts) {
                                part.parts.forEach((subpart: GmailMessagePart) =>
                                    processAttachmentParts(subpart, `${path}/parts`)
                                );
                            }
                        };

                        if (response.data.payload) {
                            processAttachmentParts(response.data.payload as GmailMessagePart);
                        }

                        // Add attachment info to output if any are present
                        const attachmentInfo = attachments.length > 0 ?
                            `\n\nAttachments (${attachments.length}):\n` +
                            attachments.map(a => `- ${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)} KB, ID: ${a.id})`).join('\n') : '';

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Thread ID: ${threadId}\nSubject: ${subject}\nFrom: ${from}\nTo: ${to}\nDate: ${date}\n\n${contentTypeNote}${body}${attachmentInfo}`,
                                },
                            ],
                        };
                    }

                    case "search_emails": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const validatedArgs = SearchEmailsSchema.parse(args);
                        const response = await gmail!.users.messages.list({
                            userId: 'me',
                            q: validatedArgs.query,
                            maxResults: validatedArgs.maxResults || 10,
                        });

                        const messages = response.data.messages || [];
                        const results = await Promise.all(
                            messages.map(async (msg: any) => {
                                const detail = await gmail!.users.messages.get({
                                    userId: 'me',
                                    id: msg.id!,
                                    format: 'metadata',
                                    metadataHeaders: ['Subject', 'From', 'Date'],
                                });
                                const headers = detail.data.payload?.headers || [];
                                return {
                                    id: msg.id,
                                    subject: headers.find((h: any) => h.name === 'Subject')?.value || '',
                                    from: headers.find((h: any) => h.name === 'From')?.value || '',
                                    date: headers.find((h: any) => h.name === 'Date')?.value || '',
                                };
                            })
                        );

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: results.map((r: any) =>
                                        `ID: ${r.id}\nSubject: ${r.subject}\nFrom: ${r.from}\nDate: ${r.date}\n`
                                    ).join('\n'),
                                },
                            ],
                        };
                    }

                    // Updated implementation for the modify_email handler
                    case "modify_email": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const validatedArgs = ModifyEmailSchema.parse(args);

                        // Prepare request body
                        const requestBody: any = {};

                        if (validatedArgs.labelIds) {
                            requestBody.addLabelIds = validatedArgs.labelIds;
                        }

                        if (validatedArgs.addLabelIds) {
                            requestBody.addLabelIds = validatedArgs.addLabelIds;
                        }

                        if (validatedArgs.removeLabelIds) {
                            requestBody.removeLabelIds = validatedArgs.removeLabelIds;
                        }

                        await gmail.users.messages.modify({
                            userId: 'me',
                            id: validatedArgs.messageId,
                            requestBody: requestBody,
                        });

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Email ${validatedArgs.messageId} labels updated successfully`,
                                },
                            ],
                        };
                    }

                    case "delete_email": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const validatedArgs = DeleteEmailSchema.parse(args);
                        await gmail.users.messages.delete({
                            userId: 'me',
                            id: validatedArgs.messageId,
                        });

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Email ${validatedArgs.messageId} deleted successfully`,
                                },
                            ],
                        };
                    }

                    case "list_email_labels": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const labelResults = await listLabels(gmail);
                        const systemLabels = labelResults.system;
                        const userLabels = labelResults.user;

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Found ${labelResults.count.total} labels (${labelResults.count.system} system, ${labelResults.count.user} user):\n\n` +
                                        "System Labels:\n" +
                                        systemLabels.map((l: GmailLabel) => `ID: ${l.id}\nName: ${l.name}\n`).join('\n') +
                                        "\nUser Labels:\n" +
                                        userLabels.map((l: GmailLabel) => `ID: ${l.id}\nName: ${l.name}\n`).join('\n')
                                },
                            ],
                        };
                    }

                    case "batch_modify_emails": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const validatedArgs = BatchModifyEmailsSchema.parse(args);
                        const messageIds = validatedArgs.messageIds;
                        const batchSize = validatedArgs.batchSize || 50;

                        // Prepare request body
                        const requestBody: any = {};

                        if (validatedArgs.addLabelIds) {
                            requestBody.addLabelIds = validatedArgs.addLabelIds;
                        }

                        if (validatedArgs.removeLabelIds) {
                            requestBody.removeLabelIds = validatedArgs.removeLabelIds;
                        }

                        // Process messages in batches
                        const { successes, failures } = await processBatches(
                            messageIds,
                            batchSize,
                            async (batch) => {
                                const gmailClient = gmail!;
                                const results = await Promise.all(
                                    batch.map(async (messageId) => {
                                        const result = await gmailClient.users.messages.modify({
                                            userId: 'me',
                                            id: messageId,
                                            requestBody: requestBody,
                                        });
                                        return { messageId, success: true };
                                    })
                                );
                                return results;
                            }
                        );

                        // Generate summary of the operation
                        const successCount = successes.length;
                        const failureCount = failures.length;

                        let resultText = `Batch label modification complete.\n`;
                        resultText += `Successfully processed: ${successCount} messages\n`;

                        if (failureCount > 0) {
                            resultText += `Failed to process: ${failureCount} messages\n\n`;
                            resultText += `Failed message IDs:\n`;
                            resultText += failures.map(f => `- ${(f.item as string).substring(0, 16)}... (${f.error.message})`).join('\n');
                        }

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: resultText,
                                },
                            ],
                        };
                    }

                    case "batch_delete_emails": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const validatedArgs = BatchDeleteEmailsSchema.parse(args);
                        const messageIds = validatedArgs.messageIds;
                        const batchSize = validatedArgs.batchSize || 50;

                        // Process messages in batches
                        const { successes, failures } = await processBatches(
                            messageIds,
                            batchSize,
                            async (batch) => {
                                const results = await Promise.all(
                                    batch.map(async (messageId) => {
                                        await gmail!.users.messages.delete({
                                            userId: 'me',
                                            id: messageId,
                                        });
                                        return { messageId, success: true };
                                    })
                                );
                                return results;
                            }
                        );

                        // Generate summary of the operation
                        const successCount = successes.length;
                        const failureCount = failures.length;

                        let resultText = `Batch delete operation complete.\n`;
                        resultText += `Successfully deleted: ${successCount} messages\n`;

                        if (failureCount > 0) {
                            resultText += `Failed to delete: ${failureCount} messages\n\n`;
                            resultText += `Failed message IDs:\n`;
                            resultText += failures.map(f => `- ${(f.item as string).substring(0, 16)}... (${f.error.message})`).join('\n');
                        }

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: resultText,
                                },
                            ],
                        };
                    }

                    // New label management handlers
                    case "create_label": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const validatedArgs = CreateLabelSchema.parse(args);
                        const result = await createLabel(gmail, validatedArgs.name, {
                            messageListVisibility: validatedArgs.messageListVisibility,
                            labelListVisibility: validatedArgs.labelListVisibility,
                        });

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Label created successfully:\nID: ${result.id}\nName: ${result.name}\nType: ${result.type}`,
                                },
                            ],
                        };
                    }

                    case "update_label": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const validatedArgs = UpdateLabelSchema.parse(args);

                        // Prepare request body with only the fields that were provided
                        const updates: any = {};
                        if (validatedArgs.name) updates.name = validatedArgs.name;
                        if (validatedArgs.messageListVisibility) updates.messageListVisibility = validatedArgs.messageListVisibility;
                        if (validatedArgs.labelListVisibility) updates.labelListVisibility = validatedArgs.labelListVisibility;

                        const result = await updateLabel(gmail, validatedArgs.id, updates);

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Label updated successfully:\nID: ${result.id}\nName: ${result.name}\nType: ${result.type}`,
                                },
                            ],
                        };
                    }

                    case "delete_label": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const validatedArgs = DeleteLabelSchema.parse(args);
                        const result = await deleteLabel(gmail, validatedArgs.id);

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: result.message,
                                },
                            ],
                        };
                    }

                    case "get_or_create_label": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const validatedArgs = GetOrCreateLabelSchema.parse(args);
                        const result = await getOrCreateLabel(gmail, validatedArgs.name, {
                            messageListVisibility: validatedArgs.messageListVisibility,
                            labelListVisibility: validatedArgs.labelListVisibility,
                        });

                        const action = result.type === 'user' && result.name === validatedArgs.name ? 'found existing' : 'created new';

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Successfully ${action} label:\nID: ${result.id}\nName: ${result.name}\nType: ${result.type}`,
                                },
                            ],
                        };
                    }

                    case "download_attachment": {
                        if (!gmail) throw new Error("Gmail client not initialized.");
                        const validatedArgs = DownloadAttachmentSchema.parse(args);

                        try {
                            // Get the attachment data from Gmail API
                            const attachmentResponse = await gmail.users.messages.attachments.get({
                                userId: 'me',
                                messageId: validatedArgs.messageId,
                                id: validatedArgs.attachmentId,
                            });

                            if (!attachmentResponse.data.data) {
                                throw new Error('No attachment data received');
                            }

                            // Decode the base64 data
                            const data = attachmentResponse.data.data;
                            const buffer = Buffer.from(data, 'base64url');

                            // Determine save path and filename
                            const savePath = validatedArgs.savePath || process.cwd();
                            let filename = validatedArgs.filename;

                            if (!filename) {
                                // Get original filename from message if not provided
                                const messageResponse = await gmail.users.messages.get({
                                    userId: 'me',
                                    id: validatedArgs.messageId,
                                    format: 'full',
                                });

                                // Find the attachment part to get original filename
                                const findAttachment = (part: any): string | null => {
                                    if (part.body && part.body.attachmentId === validatedArgs.attachmentId) {
                                        return part.filename || `attachment-${validatedArgs.attachmentId}`;
                                    }
                                    if (part.parts) {
                                        for (const subpart of part.parts) {
                                            const found = findAttachment(subpart);
                                            if (found) return found;
                                        }
                                    }
                                    return null;
                                };

                                filename = findAttachment(messageResponse.data.payload) || `attachment-${validatedArgs.attachmentId}`;
                            }

                            // Ensure save directory exists
                            if (!fs.existsSync(savePath)) {
                                fs.mkdirSync(savePath, { recursive: true });
                            }

                            // Write file
                            const fullPath = path.join(savePath, filename);
                            fs.writeFileSync(fullPath, buffer);

                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `Attachment downloaded successfully:\nFile: ${filename}\nSize: ${buffer.length} bytes\nSaved to: ${fullPath}`,
                                    },
                                ],
                            };
                        } catch (error: any) {
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `Failed to download attachment: ${error.message}`,
                                    },
                                ],
                            };
                        }
                    }

                    case "setup_authentication": {
                        const validatedArgs = SetupAuthenticationSchema.parse(args);
                        const store = asyncLocalStorage.getStore();

                        // Use userId if provided, otherwise use the current auth session ID
                        const userSessionId = validatedArgs.userId || store?.sessionId || authSessionId;

                        console.log(`Setting up authentication for user session: ${userSessionId}`);

                        // Update paths to use user/session-specific storage
                        updatePaths(validatedArgs.storagePath, userSessionId);

                        // 1. Create the gcp-oauth.keys.json file
                        const oauthKeys = {
                            web: {
                                client_id: validatedArgs.clientId,
                                client_secret: validatedArgs.clientSecret,
                                redirect_uris: [validatedArgs.callbackUrl],
                                auth_uri: "https://accounts.google.com/o/oauth2/auth",
                                token_uri: "https://oauth2.googleapis.com/token",
                                auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
                            },
                        };

                        if (!fs.existsSync(CONFIG_DIR)) {
                            fs.mkdirSync(CONFIG_DIR, { recursive: true });
                        }

                        fs.writeFileSync(OAUTH_PATH, JSON.stringify(oauthKeys, null, 2));

                        // 2. Create session-specific oauth2Client
                        const sessionOauth2Client = new OAuth2Client({
                            clientId: validatedArgs.clientId,
                            clientSecret: validatedArgs.clientSecret,
                            redirectUri: validatedArgs.callbackUrl
                        });

                        // 3. Run the authentication flow
                        await authenticate(sessionOauth2Client, CREDENTIALS_PATH);

                        // 4. Initialize the Gmail API client with the new auth and update the store
                        const gmail = google.gmail({ version: 'v1', auth: sessionOauth2Client });

                        // Store in session store using the auth session ID (which ties to MCP session)
                        const sessionToken = storeSessionData(authSessionId, sessionOauth2Client, gmail, validatedArgs.userId);

                        if (store) {
                            store.gmail = gmail;
                            store.oauth2Client = sessionOauth2Client;
                            store.sessionId = authSessionId;
                            store.userId = validatedArgs.userId;
                        }

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `🎉 Authentication successful!\n\n` +
                                        `User: ${validatedArgs.userId || 'auto-detected'}\n` +
                                        `Session: ${authSessionId}\n` +
                                        `Callback URL: ${validatedArgs.callbackUrl}\n\n` +
                                        `🔑 Your Session Token: ${sessionToken}\n\n` +
                                        `⚠️  IMPORTANT: Save this token securely!\n` +
                                        `• Use this token to authenticate future requests\n` +
                                        `• Add 'sessionToken' parameter to your email requests\n` +
                                        `• Token expires in 24 hours\n` +
                                        `• Without this token, anonymous users cannot access your account`,
                                },
                            ],
                        };
                    }

                    case "authenticate_with_token": {
                        const validatedArgs = AuthenticateWithTokenSchema.parse(args);

                        const tokenValidation = validateSessionToken(validatedArgs.sessionToken);

                        if (!tokenValidation) {
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `❌ Authentication failed: Invalid or expired session token.\n\n` +
                                            `Please use setup_authentication to get a new token.`,
                                    },
                                ],
                            };
                        }

                        // Update the current session context with validated credentials
                        const store = asyncLocalStorage.getStore();
                        if (store && tokenValidation) {
                            store.gmail = tokenValidation.sessionData.gmail;
                            store.oauth2Client = tokenValidation.sessionData.oauth2Client;
                            store.sessionId = tokenValidation.sessionId;
                            store.userId = tokenValidation.sessionData.userId;
                        }

                        const expiryDate = tokenValidation.sessionData.tokenCreatedAt
                            ? new Date(tokenValidation.sessionData.tokenCreatedAt.getTime() + 24 * 60 * 60 * 1000).toLocaleString()
                            : 'Unknown';

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `✅ Token authentication successful!\n\n` +
                                        `User: ${tokenValidation.sessionData.userId || 'auto-detected'}\n` +
                                        `Session: ${tokenValidation.sessionId}\n` +
                                        `Token valid until: ${expiryDate}\n\n` +
                                        `You can now use Gmail tools with this session.`,
                                },
                            ],
                        };
                    }

                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: ${error.message}`,
                        },
                    ],
                };
            }
        });
    });
    // Determine transport mode from command line arguments
    const transportMode = process.argv.includes('--http') ? 'http' :
        process.argv.includes('--sse') ? 'sse' : 'stdio';

    if (transportMode === 'stdio') {
        // Default stdio transport
        const transport = new StdioServerTransport();
        await mcpServer.connect(transport);
    } else {
        // HTTP or SSE transport - start Express server
        await startHttpServer(mcpServer, transportMode as 'http' | 'sse');
    }
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
