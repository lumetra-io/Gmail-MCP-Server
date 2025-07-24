# Gmail AutoAuth MCP Server

A Model Context Protocol (MCP) server for Gmail integration in Claude Desktop with auto authentication support. This server enables AI assistants to manage Gmail through natural language interactions.

![](https://badge.mcpx.dev?type=server 'MCP Server')
[![smithery badge](https://smithery.ai/badge/@gongrzhe/server-gmail-autoauth-mcp)](https://smithery.ai/server/@gongrzhe/server-gmail-autoauth-mcp)


## Features

- Send emails with subject, content, **attachments**, and recipients
- **Full attachment support** - send and receive file attachments
- **Download email attachments** to local filesystem
- Support for HTML emails and multipart messages with both HTML and plain text versions
- Full support for international characters in subject lines and email content
- Read email messages by ID with advanced MIME structure handling
- **Enhanced attachment display** showing filenames, types, sizes, and download IDs
- Search emails with various criteria (subject, sender, date range)
- **Comprehensive label management with ability to create, update, delete and list labels**
- List all available Gmail labels (system and user-defined)
- List emails in inbox, sent, or custom labels
- Mark emails as read/unread
- Move emails to different labels/folders
- Delete emails
- **Batch operations for efficiently processing multiple emails at once**
- Full integration with Gmail API
- Simple OAuth2 authentication flow with auto browser launch
- Support for both Desktop and Web application credentials
- Global credential storage for convenience
- **Multiple transport modes**: Stdio, HTTP (Streamable), and SSE
- **Official MCP SDK integration** with proper protocol compliance
- **Advanced session management** with complete multi-user isolation
- **Session-aware architecture** ensuring proper response routing in concurrent environments

## Installation & Authentication

### Installing via Smithery

To install Gmail AutoAuth for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@gongrzhe/server-gmail-autoauth-mcp):

```bash
npx -y @smithery/cli install @gongrzhe/server-gmail-autoauth-mcp --client claude
```

### Installing Manually
1. Create a Google Cloud Project and obtain credentials:

   a. Create a Google Cloud Project:
      - Go to [Google Cloud Console](https://console.cloud.google.com/)
      - Create a new project or select an existing one
      - Enable the Gmail API for your project

   b. Create OAuth 2.0 Credentials:
      - Go to "APIs & Services" > "Credentials"
      - Click "Create Credentials" > "OAuth client ID"
      - Choose either "Desktop app" or "Web application" as application type
      - Give it a name and click "Create"
      - For Web application, add `http://localhost:3000/oauth2callback` to the authorized redirect URIs
      - Download the JSON file of your client's OAuth keys
      - Rename the key file to `gcp-oauth.keys.json`

2. Run Authentication:

   You can authenticate in two ways:

   a. Global Authentication (Recommended):
   ```bash
   # First time: Place gcp-oauth.keys.json in your home directory's .gmail-mcp folder
   mkdir -p ~/.gmail-mcp
   mv gcp-oauth.keys.json ~/.gmail-mcp/

   # Run authentication from anywhere
   npx @gongrzhe/server-gmail-autoauth-mcp auth
   ```

   b. Local Authentication:
   ```bash
   # Place gcp-oauth.keys.json in your current directory
   # The file will be automatically copied to global config
   npx @gongrzhe/server-gmail-autoauth-mcp auth
   ```

   The authentication process will:
   - Look for `gcp-oauth.keys.json` in the current directory or `~/.gmail-mcp/`
   - If found in current directory, copy it to `~/.gmail-mcp/`
   - Open your default browser for Google authentication
   - Save credentials as `~/.gmail-mcp/credentials.json`

   > **Note**: 
   > - After successful authentication, credentials are stored globally in `~/.gmail-mcp/` and can be used from any directory
   > - Both Desktop app and Web application credentials are supported
   > - For Web application credentials, make sure to add `http://localhost:3000/oauth2callback` to your authorized redirect URIs

3. Configure in Claude Desktop:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": [
        "@gongrzhe/server-gmail-autoauth-mcp"
      ]
    }
  }
}
```

### Docker Support

If you prefer using Docker:

1. Authentication:
```bash
docker run -i --rm \
  --mount type=bind,source=/path/to/gcp-oauth.keys.json,target=/gcp-oauth.keys.json \
  -v mcp-gmail:/gmail-server \
  -e GMAIL_OAUTH_PATH=/gcp-oauth.keys.json \
  -e "GMAIL_CREDENTIALS_PATH=/gmail-server/credentials.json" \
  -p 3000:3000 \
  mcp/gmail auth
```

2. Usage:
```json
{
  "mcpServers": {
    "gmail": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "mcp-gmail:/gmail-server",
        "-e",
        "GMAIL_CREDENTIALS_PATH=/gmail-server/credentials.json",
        "mcp/gmail"
      ]
    }
  }
}
```

### Cloud Server Authentication

For cloud server environments (like n8n), you can specify a custom callback URL during authentication:

```bash
npx @gongrzhe/server-gmail-autoauth-mcp auth https://gmail.gongrzhe.com/oauth2callback
```

#### Setup Instructions for Cloud Environment

1. **Configure Reverse Proxy:**
   - Set up your n8n container to expose a port for authentication
   - Configure a reverse proxy to forward traffic from your domain (e.g., `gmail.gongrzhe.com`) to this port

2. **DNS Configuration:**
   - Add an A record in your DNS settings to resolve your domain to your cloud server's IP address

3. **Google Cloud Platform Setup:**
   - In your Google Cloud Console, add your custom domain callback URL (e.g., `https://gmail.gongrzhe.com/oauth2callback`) to the authorized redirect URIs list

4. **Run Authentication:**
   ```bash
   npx @gongrzhe/server-gmail-autoauth-mcp auth https://gmail.gongrzhe.com/oauth2callback
   ```

5. **Configure in your application:**
   ```json
   {
     "mcpServers": {
       "gmail": {
         "command": "npx",
         "args": [
           "@gongrzhe/server-gmail-autoauth-mcp"
         ]
       }
     }
   }
   ```

This approach allows authentication flows to work properly in environments where localhost isn't accessible, such as containerized applications or cloud servers.

## Available Tools

The server provides the following tools that can be used through Claude Desktop:

### 1. Send Email (`send_email`)

Sends a new email immediately. Supports plain text, HTML, or multipart emails **with optional file attachments**.

Basic Email:
```json
{
  "to": ["recipient@example.com"],
  "subject": "Meeting Tomorrow",
  "body": "Hi,\n\nJust a reminder about our meeting tomorrow at 10 AM.\n\nBest regards",
  "cc": ["cc@example.com"],
  "bcc": ["bcc@example.com"],
  "mimeType": "text/plain"
}
```

**Email with Attachments:**
```json
{
  "to": ["recipient@example.com"],
  "subject": "Project Files",
  "body": "Hi,\n\nPlease find the project files attached.\n\nBest regards",
  "attachments": [
    "/path/to/document.pdf",
    "/path/to/spreadsheet.xlsx",
    "/path/to/presentation.pptx"
  ]
}
```

HTML Email Example:
```json
{
  "to": ["recipient@example.com"],
  "subject": "Meeting Tomorrow",
  "mimeType": "text/html",
  "body": "<html><body><h1>Meeting Reminder</h1><p>Just a reminder about our <b>meeting tomorrow</b> at 10 AM.</p><p>Best regards</p></body></html>"
}
```

Multipart Email Example (HTML + Plain Text):
```json
{
  "to": ["recipient@example.com"],
  "subject": "Meeting Tomorrow",
  "mimeType": "multipart/alternative",
  "body": "Hi,\n\nJust a reminder about our meeting tomorrow at 10 AM.\n\nBest regards",
  "htmlBody": "<html><body><h1>Meeting Reminder</h1><p>Just a reminder about our <b>meeting tomorrow</b> at 10 AM.</p><p>Best regards</p></body></html>"
}
```

### 2. Draft Email (`draft_email`)
Creates a draft email without sending it. **Also supports attachments**.

```json
{
  "to": ["recipient@example.com"],
  "subject": "Draft Report",
  "body": "Here's the draft report for your review.",
  "cc": ["manager@example.com"],
  "attachments": ["/path/to/draft_report.docx"]
}
```

### 3. Read Email (`read_email`)
Retrieves the content of a specific email by its ID. **Now shows enhanced attachment information**.

```json
{
  "messageId": "182ab45cd67ef"
}
```

**Enhanced Response includes attachment details:**
```
Subject: Project Files
From: sender@example.com
To: recipient@example.com
Date: Thu, 19 Jun 2025 10:30:00 -0400

Email body content here...

Attachments (2):
- document.pdf (application/pdf, 245 KB, ID: ANGjdJ9fkTs-i3GCQo5o97f_itG...)
- spreadsheet.xlsx (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, 89 KB, ID: BWHkeL8gkUt-j4HDRp6o98g_juI...)
```

### 4. **Download Attachment (`download_attachment`)**
**NEW**: Downloads email attachments to your local filesystem.

```json
{
  "messageId": "182ab45cd67ef",
  "attachmentId": "ANGjdJ9fkTs-i3GCQo5o97f_itG...",
  "savePath": "/path/to/downloads",
  "filename": "downloaded_document.pdf"
}
```

Parameters:
- `messageId`: The ID of the email containing the attachment
- `attachmentId`: The attachment ID (shown in enhanced email display)
- `savePath`: Directory to save the file (optional, defaults to current directory)
- `filename`: Custom filename (optional, uses original filename if not provided)

### 5. Search Emails (`search_emails`)
Searches for emails using Gmail search syntax.

```json
{
  "query": "from:sender@example.com after:2024/01/01 has:attachment",
  "maxResults": 10
}
```

### 6. Modify Email (`modify_email`)
Adds or removes labels from emails (move to different folders, archive, etc.).

```json
{
  "messageId": "182ab45cd67ef",
  "addLabelIds": ["IMPORTANT"],
  "removeLabelIds": ["INBOX"]
}
```

### 7. Delete Email (`delete_email`)
Permanently deletes an email.

```json
{
  "messageId": "182ab45cd67ef"
}
```

### 8. List Email Labels (`list_email_labels`)
Retrieves all available Gmail labels.

```json
{}
```

### 9. Create Label (`create_label`)
Creates a new Gmail label.

```json
{
  "name": "Important Projects",
  "messageListVisibility": "show",
  "labelListVisibility": "labelShow"
}
```

### 10. Update Label (`update_label`)
Updates an existing Gmail label.

```json
{
  "id": "Label_1234567890",
  "name": "Urgent Projects",
  "messageListVisibility": "show",
  "labelListVisibility": "labelShow"
}
```

### 11. Delete Label (`delete_label`)
Deletes a Gmail label.

```json
{
  "id": "Label_1234567890"
}
```

### 12. Get or Create Label (`get_or_create_label`)
Gets an existing label by name or creates it if it doesn't exist.

```json
{
  "name": "Project XYZ",
  "messageListVisibility": "show",
  "labelListVisibility": "labelShow"
}
```

### 13. Batch Modify Emails (`batch_modify_emails`)
Modifies labels for multiple emails in efficient batches.

```json
{
  "messageIds": ["182ab45cd67ef", "182ab45cd67eg", "182ab45cd67eh"],
  "addLabelIds": ["IMPORTANT"],
  "removeLabelIds": ["INBOX"],
  "batchSize": 50
}
```

### 14. Batch Delete Emails (`batch_delete_emails`)
Permanently deletes multiple emails in efficient batches.

```json
{
  "messageIds": ["182ab45cd67ef", "182ab45cd67eg", "182ab45cd67eh"],
  "batchSize": 50
}
```

## Advanced Search Syntax

The `search_emails` tool supports Gmail's powerful search operators:

| Operator | Example | Description |
|----------|---------|-------------|
| `from:` | `from:john@example.com` | Emails from a specific sender |
| `to:` | `to:mary@example.com` | Emails sent to a specific recipient |
| `subject:` | `subject:"meeting notes"` | Emails with specific text in the subject |
| `has:attachment` | `has:attachment` | Emails with attachments |
| `after:` | `after:2024/01/01` | Emails received after a date |
| `before:` | `before:2024/02/01` | Emails received before a date |
| `is:` | `is:unread` | Emails with a specific state |
| `label:` | `label:work` | Emails with a specific label |

You can combine multiple operators: `from:john@example.com after:2024/01/01 has:attachment`

## Advanced Features

### **Email Attachment Support**

The server provides comprehensive attachment functionality:

- **Sending Attachments**: Include file paths in the `attachments` array when sending or drafting emails
- **Attachment Detection**: Automatically detects MIME types and file sizes
- **Download Capability**: Download any email attachment to your local filesystem
- **Enhanced Display**: View detailed attachment information including filenames, types, sizes, and download IDs
- **Multiple Formats**: Support for all common file types (documents, images, archives, etc.)
- **RFC822 Compliance**: Uses Nodemailer for proper MIME message formatting

**Supported File Types**: All standard file types including PDF, DOCX, XLSX, PPTX, images (PNG, JPG, GIF), archives (ZIP, RAR), and more.

### Email Content Extraction

The server intelligently extracts email content from complex MIME structures:

- Prioritizes plain text content when available
- Falls back to HTML content if plain text is not available
- Handles multi-part MIME messages with nested parts
- **Processes attachments information (filename, type, size, download ID)**
- Preserves original email headers (From, To, Subject, Date)

### International Character Support

The server fully supports non-ASCII characters in email subjects and content, including:
- Turkish, Chinese, Japanese, Korean, and other non-Latin alphabets
- Special characters and symbols
- Proper encoding ensures correct display in email clients

### Comprehensive Label Management

The server provides a complete set of tools for managing Gmail labels:

- **Create Labels**: Create new labels with customizable visibility settings
- **Update Labels**: Rename labels or change their visibility settings
- **Delete Labels**: Remove user-created labels (system labels are protected)
- **Find or Create**: Get a label by name or automatically create it if not found
- **List All Labels**: View all system and user labels with detailed information
- **Label Visibility Options**: Control how labels appear in message and label lists

Label visibility settings include:
- `messageListVisibility`: Controls whether the label appears in the message list (`show` or `hide`)
- `labelListVisibility`: Controls how the label appears in the label list (`labelShow`, `labelShowIfUnread`, or `labelHide`)

These label management features enable sophisticated organization of emails directly through Claude, without needing to switch to the Gmail interface.

### Batch Operations

The server includes efficient batch processing capabilities:

- Process up to 50 emails at once (configurable batch size)
- Automatic chunking of large email sets to avoid API limits
- Detailed success/failure reporting for each operation
- Graceful error handling with individual retries
- Perfect for bulk inbox management and organization tasks

## Security Notes

- OAuth credentials are stored securely in your local environment (`~/.gmail-mcp/`)
- The server uses offline access to maintain persistent authentication
- Never share or commit your credentials to version control
- Regularly review and revoke unused access in your Google Account settings
- Credentials are stored globally but are only accessible by the current user
- **Attachment files are processed locally and never stored permanently by the server**

## Troubleshooting

1. **OAuth Keys Not Found**
   - Make sure `gcp-oauth.keys.json` is in either your current directory or `~/.gmail-mcp/`
   - Check file permissions

2. **Invalid Credentials Format**
   - Ensure your OAuth keys file contains either `web` or `installed` credentials
   - For web applications, verify the redirect URI is correctly configured

3. **Port Already in Use**
   - If port 3000 is already in use, please free it up before running authentication
   - You can find and stop the process using that port

4. **Batch Operation Failures**
   - If batch operations fail, they automatically retry individual items
   - Check the detailed error messages for specific failures
   - Consider reducing the batch size if you encounter rate limiting

5. **Attachment Issues**
   - **File Not Found**: Ensure attachment file paths are correct and accessible
   - **Permission Errors**: Check that the server has read access to attachment files
   - **Size Limits**: Gmail has a 25MB attachment size limit per email
   - **Download Failures**: Verify you have write permissions to the download directory

6. **Session Management Issues (HTTP Transport)**
   - **"0 tools" discovered**: Ensure you're using POST /mcp with proper initialization
   - **No response received**: Check session ID is being passed in `mcp-session-id` header
   - **Cross-user interference**: Use the session monitoring endpoints to verify session isolation
   - **Session cleanup**: Use `DELETE /sessions/:id` for manual cleanup if needed
   - **Memory usage**: Monitor `/health` endpoint for session statistics

7. **Multi-User Deployment Issues**
   - **Response routing conflicts**: Verify each user gets a unique session ID during initialization
   - **Authentication conflicts**: Each session maintains isolated auth state - no sharing between users
   - **Tool registration failures**: Check server logs for handler registration errors during session creation
   - **Context loss**: AsyncLocalStorage context is preserved automatically - no manual intervention needed

## Transport Modes

The Gmail MCP Server supports multiple transport modes for different integration scenarios:

### 1. Standard Stdio Transport (Default)
The default transport mode for MCP client integration via stdin/stdout:

```bash
# Run with default stdio transport
npm start
# or
node dist/index.js
```

### 2. HTTP Transport (Session-Aware Streamable HTTP)
Modern MCP Streamable HTTP transport (protocol version 2025-03-26) with **advanced multi-user session isolation** for web applications and concurrent user environments:

```bash
# Run with HTTP transport
npm run start:http
# or
node dist/index.js --http
```

#### **🔒 Session Isolation Features**
- **Complete User Isolation**: Each user gets their own dedicated MCP server instance
- **Response Routing Guarantee**: Responses are guaranteed to reach the correct user
- **Context Preservation**: AsyncLocalStorage maintains context through all async operations
- **Automatic Session Cleanup**: Inactive sessions are cleaned up after 1 hour
- **Concurrent User Support**: Supports multiple users simultaneously without interference

The HTTP server provides the following endpoints:

- **ALL /mcp** - MCP Streamable HTTP endpoint (supports GET, POST, DELETE)
- **GET /health** - Health check with session statistics
- **GET /sessions** - Session management and monitoring
- **DELETE /sessions/:id** - Manual session cleanup
- **GET /** - API documentation and usage examples

#### Example HTTP Usage:

```bash
# Initialize a new MCP session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {"tools": {}},
      "clientInfo": {"name": "test-client", "version": "1.0.0"}
    }
  }'

# The response will include a session ID for subsequent requests
# Use the mcp-session-id header for follow-up requests

# Check server health and session statistics
curl http://localhost:3000/health

# Monitor active sessions
curl http://localhost:3000/sessions

# Manual session cleanup (if needed)
curl -X DELETE http://localhost:3000/sessions/SESSION_ID
```

#### **🌐 Multi-User Docker Deployment**

The session-aware HTTP transport is specifically designed for multi-user environments like Docker deployments:

```bash
# Run in Docker with HTTP transport for multiple users
docker run -p 3000:3000 mcp/gmail --http

# Each user gets isolated authentication and session management
# User1 → Isolated MCP Server Instance 1 → Dedicated Transport 1
# User2 → Isolated MCP Server Instance 2 → Dedicated Transport 2
# No cross-user interference or response routing conflicts
```

**Note**: This implementation uses a custom `SessionAwareTransportManager` built on top of the official MCP SDK's `StreamableHTTPServerTransport` for complete session isolation and proper response routing in multi-user scenarios.

### 3. SSE Transport (Server-Sent Events) 
Legacy transport mode for backwards compatibility (protocol version 2024-11-05):

```bash
# Run with SSE transport
npm run start:sse
# or
node dist/index.js --sse
```

The SSE server provides the following endpoints:

- **GET /sse** - SSE connection endpoint
- **POST /messages** - Message handling endpoint  
- **GET /health** - Health check endpoint

**Note**: This implementation uses the official MCP SDK's `SSEServerTransport`. SSE transport is deprecated in favor of Streamable HTTP.

### Transport Configuration

- **Port**: Set the `PORT` environment variable (default: 3000)
- **CORS**: HTTP transport includes CORS headers for web browser compatibility
- **Authentication**: All transport modes use the same OAuth2 authentication flow

#### Environment Variables:
```bash
PORT=8080 npm run start:http  # Run HTTP transport on port 8080
```

## 🏗️ Session-Aware Architecture

### **Multi-User Session Isolation**

The Gmail MCP Server implements a sophisticated session-aware architecture that ensures complete isolation between concurrent users:

#### **Core Components**

1. **SessionAwareTransportManager** (`src/session-aware-transport.ts`)
   - Manages isolated MCP server instances per user session
   - Provides request-response correlation and context preservation
   - Handles automatic session cleanup and monitoring

2. **SessionAwareStreamableTransport**
   - Custom transport that extends MCP SDK's `StreamableHTTPServerTransport`
   - Ensures context preservation through AsyncLocalStorage
   - Guarantees response delivery to the correct user session

3. **Complete Request Isolation**
   - Each user session gets a dedicated `Server` instance
   - Independent tool handler registration per session
   - Isolated authentication state and Gmail API clients

#### **Session Lifecycle**

```typescript
// Session Creation (User1 initializes)
User1 → POST /mcp (initialize) → Creates Session A
├── Dedicated MCP Server Instance A
├── Isolated Transport A  
├── Independent Tool Handlers A
└── Separate AsyncLocalStorage Context A

// Concurrent Session (User2 initializes)  
User2 → POST /mcp (initialize) → Creates Session B
├── Dedicated MCP Server Instance B
├── Isolated Transport B
├── Independent Tool Handlers B  
└── Separate AsyncLocalStorage Context B

// Response Guarantee
User1 Request → Session A → MCP Server A → Transport A → User1 Response ✅
User2 Request → Session B → MCP Server B → Transport B → User2 Response ✅
```

#### **Session Management APIs**

```bash
# Monitor active sessions
GET /health
{
  "activeSessions": {
    "streamable": 2,
    "details": [
      {"sessionId": "abc-123", "authSessionId": "auth-abc-123", "requestCount": 5},
      {"sessionId": "def-456", "authSessionId": "auth-def-456", "requestCount": 2}
    ]
  }
}

# Detailed session information
GET /sessions
{
  "totalSessions": 2,
  "sessions": [
    {"sessionId": "abc-123", "requestCount": 5, "age": 300000},
    {"sessionId": "def-456", "requestCount": 2, "age": 120000}
  ]
}

# Manual session cleanup
DELETE /sessions/abc-123
```

#### **Performance Characteristics**

- **Memory Usage**: ~2-5MB per active session
- **Session Cleanup**: Automatic after 1 hour of inactivity
- **Concurrent Users**: Tested up to 10+ simultaneous users
- **Response Time**: <1ms overhead per request for session management

### **Solved Issues**

✅ **Multi-User Response Routing**: Eliminated response conflicts between users  
✅ **Tool Discovery**: All 17 Gmail tools properly discoverable per session  
✅ **Authentication Isolation**: Each user maintains independent auth state  
✅ **Context Preservation**: AsyncLocalStorage maintained through async operations  
✅ **Session Cleanup**: Automatic resource management and cleanup

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.


## Testing & Development

### **Connection Testing**

Use the included test script to verify MCP server functionality:

```bash
# Test HTTP transport connection and tool discovery
node test-connection.js

# Test with custom server URL
MCP_SERVER_URL=http://localhost:3006 node test-connection.js
```

The test script verifies:
- ✅ MCP initialization and session creation
- ✅ Tool discovery (should show all 17 Gmail tools)
- ✅ Health endpoint functionality
- ✅ Session isolation and management

### **Running evals**

The evals package loads an mcp client that then runs the index.ts file, so there is no need to rebuild between tests. You can load environment variables by prefixing the npx command. Full documentation can be found [here](https://www.mcpevals.io/docs).

```bash
OPENAI_API_KEY=your-key  npx mcp-eval src/evals/evals.ts src/index.ts
```

### **Multi-User Testing**

To test multi-user scenarios:

```bash
# Terminal 1: Start server
PORT=3006 node dist/index.js --http

# Terminal 2: User1 test
curl -X POST http://localhost:3006/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"user1","version":"1.0.0"}}}'

# Terminal 3: User2 test  
curl -X POST http://localhost:3006/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"user2","version":"1.0.0"}}}'

# Verify session isolation
curl http://localhost:3006/sessions
```

## License

MIT

## Support

If you encounter any issues or have questions, please file an issue on the GitHub repository.
