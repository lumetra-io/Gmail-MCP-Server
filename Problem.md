The Response Routing Problem

  User2 can execute tools successfully because:
  - Tool execution happens in the correct AsyncLocalStorage context
  - The Gmail API calls work properly
  - The business logic completes successfully

  But User2 doesn't receive responses because:

  1. AsyncLocalStorage Context Loss During Response Delivery

  When the tool completes execution, the response must travel back through the MCP SDK's transport layer. However, the AsyncLocalStorage context that links the
   response to User2's HTTP connection gets lost during this async journey.

  2. Transport Instance Confusion (src/index.ts:626-681)

  The server creates separate StreamableHTTPServerTransport instances per session, but the MCP SDK internally manages request-to-response mapping. When User2's
   response is ready, it may get routed to User1's transport instance instead.

  3. Session-to-HTTP Connection Mismatch

  The critical flow breakdown happens here:

  User2 Request → Correct Tool Execution → Response Generated →
  ❌ Lost in Transport Routing → User2's HTTP connection times out

  4. Race Condition in Response Delivery

  Looking at lines 692-712, the requestContextStorage.run() creates the context, but when transport.handleRequest() completes asynchronously, the context may
  have switched to User1's session by the time the response is actually sent.

  5. Request ID Collision

  The MCP SDK uses request IDs to route responses back to connections. In a multi-user scenario, request IDs might collide or get mapped to the wrong session's
   transport.

  The exact sequence:
  1. User2 sends request → Gets assigned to correct transport
  2. Tool executes successfully in User2's context
  3. Response is generated
  4. Critical failure point: Response routing loses track of which HTTP connection (User1 vs User2) should receive it
  5. Response gets lost or sent to User1's connection
  6. User2's HTTP connection keeps waiting indefinitely

  This explains why you see successful tool execution in the logs but User2 never receives the response - the response is generated but fails to reach the
  correct HTTP connection due to session isolation failures in the transport layer.