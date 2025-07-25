# Environment Variables Configuration

This Gmail MCP Server now supports configuration via environment variables, making it ideal for containerized deployments and multi-account setups.

## Environment Variables

### OAuth Client Configuration
- `GMAIL_CLIENT_ID` - OAuth2 client ID from Google Cloud Console
- `GMAIL_CLIENT_SECRET` - OAuth2 client secret from Google Cloud Console  
- `GMAIL_REDIRECT_URI` - OAuth2 redirect URI (optional, defaults to http://localhost:3000/oauth2callback)

### User Credentials
- `GMAIL_ACCESS_TOKEN` - OAuth2 access token for the user
- `GMAIL_REFRESH_TOKEN` - OAuth2 refresh token for the user
- `GMAIL_EXPIRY_DATE` - Token expiry timestamp (optional)

### Multi-Account Support
For multiple Gmail accounts, use the `GMAIL_ACCOUNT_PREFIX` environment variable:

```bash
# Account 1
GMAIL_ACCOUNT_PREFIX=ACCOUNT1
GMAIL_ACCOUNT1_CLIENT_ID=your_client_id_1
GMAIL_ACCOUNT1_CLIENT_SECRET=your_client_secret_1
GMAIL_ACCOUNT1_ACCESS_TOKEN=your_access_token_1
GMAIL_ACCOUNT1_REFRESH_TOKEN=your_refresh_token_1

# Account 2  
GMAIL_ACCOUNT_PREFIX=ACCOUNT2
GMAIL_ACCOUNT2_CLIENT_ID=your_client_id_2
GMAIL_ACCOUNT2_CLIENT_SECRET=your_client_secret_2
GMAIL_ACCOUNT2_ACCESS_TOKEN=your_access_token_2
GMAIL_ACCOUNT2_REFRESH_TOKEN=your_refresh_token_2
```

## Docker Example

```dockerfile
# Dockerfile
FROM node:20-bookworm
COPY . /app
WORKDIR /app
RUN npm install
CMD ["node", "dist/index.js"]
```

```bash
# Run with environment variables
docker run -e GMAIL_CLIENT_ID=your_client_id \
           -e GMAIL_CLIENT_SECRET=your_client_secret \
           -e GMAIL_ACCESS_TOKEN=your_access_token \
           -e GMAIL_REFRESH_TOKEN=your_refresh_token \
           your-gmail-mcp-image
```

## Fallback Behavior

The server will:
1. **First** try to load configuration from environment variables
2. **Fallback** to file-based configuration if env vars are not found
3. **Error** if neither environment variables nor files are available

This maintains backward compatibility with existing file-based setups while enabling modern environment-based configuration.

## Integration with Existing OAuth Flows

This approach works perfectly with existing OAuth integration systems where:
- OAuth tokens are stored in a database
- Multiple users/organizations need Gmail access
- Credentials need to be injected dynamically per request/session

Simply set the appropriate environment variables before starting the MCP server process.
