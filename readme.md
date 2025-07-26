An extension of [MCP](https://modelcontextprotocol.io/introduction) for [SillyTavern](https://docs.sillytavern.app/). A possible solution of https://github.com/SillyTavern/SillyTavern/issues/3335

> **⚠️ Important:** This extension requires the [SillyTavern MCP Server plugin](https://github.com/bmen25124/SillyTavern-MCP-Server) to be installed first!

> Make sure you only installing trusted MCP servers.

![manage tools](images/manage_tools.png)

## Installation

**Prerequisites:**
1. **Install the MCP Server plugin first** - Go to [SillyTavern MCP Server](https://github.com/bmen25124/SillyTavern-MCP-Server) and install it

**Then install this client extension:**
1. Install via the SillyTavern extension installer:

```txt
https://github.com/bmen25124/SillyTavern-MCP-Client
```
2. Install MCP servers via extension menu.
3. Enable `Enable function calling` in sampler settings.

## Demo

https://github.com/user-attachments/assets/659c5112-c2d0-425d-a6fc-e4b47b517066

## Example JSONs

### stdio
```json
{
  "mcpServers": {
    "name": {
      "command": "npx ...",
      "type": "stdio",
      "env": {
        "CUSTOM_ENV": "value"
      }
    }
  }
}
```

### SSE
```json
{
  "mcpServers": {
    "name": {
      "url": "http://0.0.0.0:3000/sse",
      "type": "sse"
    }
  }
}
```

### Streamable HTTP
```json
{
  "mcpServers": {
    "name": {
      "url": "http://0.0.0.0:3000/mcp",
      "type": "streamableHttp"
    }
  }
}
```

## FAQ

### I'm getting "MCP Server plugin not found" error
This means you haven't installed the required [SillyTavern MCP Server plugin](https://github.com/bmen25124/SillyTavern-MCP-Server) yet. Install it first, restart SillyTavern, then try again.

### Where can I find more servers?
[Check out the server list](https://github.com/punkpeye/awesome-mcp-servers).

### I need to change the server configuration, how can I do that?
Press `Settings` button to open location of `mcp_settings.json` with your File Explorer. Edit the file. Disconnect and reconnect via `Enable Server` tickbox.

### I'm getting an error when I try to connect to the MCP server.
Check out SillyTavern console for more information. Possible errors:
- Read twice the readme of MCP server.
- Missing arguments.
- Invalid `env` param. You might need to set the API key if it's required.
