#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
// Import types - RequestHandlerExtra may not be available in all SDK versions
// import type { RequestHandlerExtra, ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";

/**
 * Session-aware transport wrapper that ensures proper response routing
 * in multi-user environments by maintaining strict session isolation.
 */

// Context for each request within a session
interface RequestContext {
    sessionId: string;
    authSessionId: string;
    requestId: string;
    mcpServer: Server;
    startTime: number;
}

// Session data for each user session
interface SessionTransportData {
    transport: StreamableHTTPServerTransport;
    mcpServer: Server;
    sessionId: string;
    authSessionId: string;
    createdAt: Date;
    lastActivity: Date;
    requestCount: number;
}

export class SessionAwareTransportManager {
    private sessions: Map<string, SessionTransportData> = new Map();
    private requestContextStorage = new AsyncLocalStorage<RequestContext>();
    private cleanupInterval: NodeJS.Timeout;

    constructor() {
        // Clean up inactive sessions every 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanupInactiveSessions();
        }, 5 * 60 * 1000);
    }

    /**
     * Creates or retrieves a session-specific MCP server and transport
     */
    async getOrCreateSession(
        sessionId: string | undefined,
        req: Request,
        res: Response,
        isInitializeRequest: boolean,
        baseServerConfig: { name: string; version: string },
        serverCapabilities: any,
        toolHandlers: Map<any, (request: any, extra?: any) => Promise<any>>
    ): Promise<{ sessionData: SessionTransportData; isNewSession: boolean }> {
        
        // Handle initialization requests (create new session)
        if (!sessionId && isInitializeRequest) {
            const newSessionId = randomUUID();
            const authSessionId = 'auth-' + newSessionId;
            
            console.log(`🆕 Creating new isolated session: ${newSessionId}`);
            
            // Create a completely isolated MCP server instance for this session
            const mcpServer = new Server(baseServerConfig, serverCapabilities);
            
            console.log(`🔧 Registering ${toolHandlers.size} tool handlers for session ${newSessionId}`);
            // Register all tool handlers for this session's server
            for (const [schema, handler] of toolHandlers) {
                console.log(`📝 Registering handler for schema:`, schema?.type || 'unknown');
                mcpServer.setRequestHandler(schema, handler);
            }
            console.log(`✅ All handlers registered for session ${newSessionId}`);
            
            // Create session-specific transport
            const transport = new SessionAwareStreamableTransport(
                newSessionId,
                authSessionId,
                this.requestContextStorage
            );
            
            // Connect the isolated server to the isolated transport
            console.log(`🔗 Connecting MCP server to transport for session ${newSessionId}`);
            await mcpServer.connect(transport);
            console.log(`✅ MCP server connected successfully for session ${newSessionId}`);
            
            const sessionData: SessionTransportData = {
                transport,
                mcpServer,
                sessionId: newSessionId,
                authSessionId,
                createdAt: new Date(),
                lastActivity: new Date(),
                requestCount: 0
            };
            
            this.sessions.set(newSessionId, sessionData);
            
            console.log(`✅ Session created and server connected: ${newSessionId}`);
            console.log(`📊 Active sessions: ${this.sessions.size}`);
            
            return { sessionData, isNewSession: true };
        }
        
        // Handle requests with existing session ID
        if (sessionId && this.sessions.has(sessionId)) {
            const sessionData = this.sessions.get(sessionId)!;
            sessionData.lastActivity = new Date();
            sessionData.requestCount++;
            
            console.log(`🔄 Using existing session: ${sessionId} (requests: ${sessionData.requestCount})`);
            return { sessionData, isNewSession: false };
        }
        
        throw new Error(`Invalid session ID: ${sessionId || 'undefined'}`);
    }
    
    /**
     * Handles a request within a session context
     */
    async handleSessionRequest(
        sessionData: SessionTransportData,
        req: Request,
        res: Response,
        requestBody: any
    ): Promise<void> {
        const requestId = requestBody.id || randomUUID();
        const requestContext: RequestContext = {
            sessionId: sessionData.sessionId,
            authSessionId: sessionData.authSessionId,
            requestId,
            mcpServer: sessionData.mcpServer,
            startTime: Date.now()
        };
        
        console.log(`🌐 Processing request in session context:`);
        console.log(`   Session ID: ${sessionData.sessionId}`);
        console.log(`   Auth Session ID: ${sessionData.authSessionId}`);
        console.log(`   Request ID: ${requestId}`);
        console.log(`   Method: ${req.method}`);
        
        // Execute request within session-isolated context
        return this.requestContextStorage.run(requestContext, async () => {
            try {
                // Use the session-specific transport to handle the request
                await sessionData.transport.handleRequest(req, res, requestBody);
                
                const duration = Date.now() - requestContext.startTime;
                console.log(`✅ Request completed successfully for session ${sessionData.sessionId} (${duration}ms)`);
                
            } catch (error) {
                const duration = Date.now() - requestContext.startTime;
                console.error(`❌ Request failed for session ${sessionData.sessionId} (${duration}ms):`, error);
                
                // Only send error response if headers haven't been sent
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: 'Internal server error in session context',
                            data: { sessionId: sessionData.sessionId }
                        },
                        id: requestId,
                    });
                }
                throw error;
            }
        });
    }
    
    /**
     * Gets the current request context (for use in tool handlers)
     */
    getCurrentRequestContext(): RequestContext | undefined {
        return this.requestContextStorage.getStore();
    }
    
    /**
     * Closes a specific session and cleans up resources
     */
    async closeSession(sessionId: string): Promise<boolean> {
        const sessionData = this.sessions.get(sessionId);
        if (!sessionData) {
            return false;
        }
        
        console.log(`🔒 Closing session: ${sessionId}`);
        
        // Close transport connection
        if (sessionData.transport && typeof sessionData.transport.close === 'function') {
            await sessionData.transport.close();
        }
        
        // Remove from active sessions
        this.sessions.delete(sessionId);
        
        console.log(`📊 Remaining active sessions: ${this.sessions.size}`);
        return true;
    }
    
    /**
     * Cleanup inactive sessions (older than 1 hour with no activity)
     */
    private async cleanupInactiveSessions(): Promise<void> {
        const now = Date.now();
        const maxAge = 60 * 60 * 1000; // 1 hour
        let cleanedCount = 0;
        
        for (const [sessionId, sessionData] of this.sessions.entries()) {
            const age = now - sessionData.lastActivity.getTime();
            if (age > maxAge) {
                await this.closeSession(sessionId);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`🧹 Cleaned up ${cleanedCount} inactive sessions`);
        }
    }
    
    /**
     * Get session statistics
     */
    getSessionStats(): { totalSessions: number; sessions: Array<{ sessionId: string; authSessionId: string; requestCount: number; age: number }> } {
        const now = Date.now();
        const sessions = Array.from(this.sessions.entries()).map(([sessionId, data]) => ({
            sessionId,
            authSessionId: data.authSessionId,
            requestCount: data.requestCount,
            age: now - data.createdAt.getTime()
        }));
        
        return {
            totalSessions: this.sessions.size,
            sessions
        };
    }
    
    /**
     * Cleanup resources
     */
    async destroy(): Promise<void> {
        // Clear cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        // Close all sessions
        const sessionIds = Array.from(this.sessions.keys());
        for (const sessionId of sessionIds) {
            await this.closeSession(sessionId);
        }
    }
}

/**
 * Custom StreamableHTTPTransport that maintains session context
 */
class SessionAwareStreamableTransport extends StreamableHTTPServerTransport {
    public readonly sessionId: string;
    private authSessionId: string;
    private requestContextStorage: AsyncLocalStorage<RequestContext>;
    
    constructor(
        sessionId: string,
        authSessionId: string,
        requestContextStorage: AsyncLocalStorage<RequestContext>
    ) {
        super({
            sessionIdGenerator: () => sessionId,
            onsessioninitialized: (id: string) => {
                console.log(`🔗 Transport session initialized: ${id}`);
            }
        });
        
        this.sessionId = sessionId;
        this.authSessionId = authSessionId;
        this.requestContextStorage = requestContextStorage;
    }
    
    /**
     * Override handleRequest to ensure context preservation
     */
    async handleRequest(req: Request, res: Response, requestBody: any): Promise<void> {
        // Ensure we maintain the session context throughout the request
        const currentContext = this.requestContextStorage.getStore();
        
        if (!currentContext) {
            throw new Error(`No request context available for session ${this.sessionId}`);
        }
        
        console.log(`🔄 Transport handling request for session ${this.sessionId}`);
        console.log(`   Request Context: ${JSON.stringify({
            sessionId: currentContext.sessionId,
            authSessionId: currentContext.authSessionId,
            requestId: currentContext.requestId
        })}`);
        
        // Call parent implementation within preserved context
        return this.requestContextStorage.run(currentContext, async () => {
            await super.handleRequest(req, res, requestBody);
        });
    }
    
    /**
     * Override send to ensure response routing
     */
    async send(message: any): Promise<void> {
        const currentContext = this.requestContextStorage.getStore();
        
        console.log(`📤 Sending response for session ${this.sessionId}`);
        if (currentContext) {
            console.log(`   Request ID: ${currentContext.requestId}`);
            console.log(`   Session Context: ${currentContext.sessionId} -> ${currentContext.authSessionId}`);
        } else {
            console.warn(`⚠️  No context available when sending response for session ${this.sessionId}`);
        }
        
        // Ensure context is preserved during send
        if (currentContext) {
            return this.requestContextStorage.run(currentContext, async () => {
                await super.send(message);
            });
        } else {
            await super.send(message);
        }
    }
    
    /**
     * Custom close method
     */
    async close(): Promise<void> {
        console.log(`🔒 Closing transport for session ${this.sessionId}`);
        // Call parent close if it exists
        if (super.close && typeof super.close === 'function') {
            await super.close();
        }
    }
}

export { RequestContext, SessionTransportData };