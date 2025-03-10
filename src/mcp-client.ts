import { McpSseClient, McpTool } from './mcp-sse-client';

/**
 * A class for interacting with MCP servers.
 */
interface ServerConfig {
  type?: string;
  url?: string;
  [key: string]: any;
}

interface ServerData {
  name: string;
  config: ServerConfig;
}
const PLUGIN_ID = 'mcp';

export class MCPClient {
  /**
   * A map of connected MCP servers.
   */
  static #connectedServers: Map<string, ServerConfig> = new Map();

  /**
   * A map of MCP server tools.
   */
  static #serverTools: Map<string, McpTool[]> = new Map();

  /**
   * A map of SSE clients for MCP servers.
   */
  static #sseClients: Map<string, McpSseClient> = new Map();

  static async getServers(): Promise<ServerData[]> {
    const context = SillyTavern.getContext();
    const response = await fetch(`/api/plugins/${PLUGIN_ID}/servers`, {
      method: 'GET',
      headers: context.getRequestHeaders(),
    });

    if (!response.ok) {
      console.error('[MCPClient] Failed to fetch servers:', response.statusText);
      return [];
    }

    const servers = await response.json();
    return servers;
  }

  /**
   * Fetches tools from an MCP server and registers them with the context.
   * @param serverName The name of the server to fetch tools from.
   * @returns Whether the tools were fetched and registered successfully.
   */
  static async #fetchTools(serverName: string): Promise<boolean> {
    try {
      const context = SillyTavern.getContext();
      let tools: McpTool[] = [];

      // Check if this server uses SSE transport
      const config = this.#connectedServers.get(serverName);
      if (config && config.type === 'sse' && this.#sseClients.has(serverName)) {
        // Use SSE transport
        try {
          const client = this.#sseClients.get(serverName)!;
          const toolsResponse = await client.listTools();
          tools = toolsResponse.tools || [];
          console.log(`[MCPClient] Successfully fetched tools for server "${serverName}" via SSE:`, tools);
        } catch (error) {
          console.error(`[MCPClient] Error fetching tools via SSE for server "${serverName}":`, error);
          return false;
        }
      } else {
        // Use HTTP transport
        const response = await fetch(`/api/plugins/${PLUGIN_ID}/servers/${serverName}/list-tools`, {
          method: 'GET',
          headers: context.getRequestHeaders(),
        });

        if (!response.ok) {
          console.error(`[MCPClient] Failed to fetch tools for server "${serverName}":`, response.statusText);
          return false;
        }

        tools = await response.json();
      }

      if (!Array.isArray(tools) || tools.length === 0) {
        console.log(`[MCPClient] No tools found for server "${serverName}"`);
        return true;
      }

      // Store the tools for this server
      this.#serverTools.set(serverName, tools);

      return true;
    } catch (error) {
      console.error(`[MCPClient] Error fetching tools for server "${serverName}":`, error);
      return false;
    }
  }

  static registerTools(name: string): void {
    const tools = this.#serverTools.get(name);
    if (tools) {
      for (const tool of tools) {
        this.#registerMcpTool(name, tool);
      }

      console.log(`[MCPClient] Registered ${tools.length} tools for server "${name}"`);
    }
  }

  /**
   * Registers an MCP tool with the context.
   * @param serverName The name of the server the tool belongs to.
   * @param tool The tool to register.
   */
  static #registerMcpTool(serverName: string, tool: McpTool): void {
    const context = SillyTavern.getContext();
    const toolId = `mcp_${serverName}_${tool.name}`;

    context.registerFunctionTool({
      name: toolId,
      displayName: `${serverName}: ${tool.name}`,
      description: tool.description || `Tool from MCP server "${serverName}"`,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
      action: async (parameters: any) => {
        return await this.callTool(serverName, tool.name, parameters);
      },
      formatMessage: async (parameters: any) => {
        return `Calling MCP tool "${tool.name}" on server "${serverName}"`;
      },
    });

    console.log(`[MCPClient] Registered tool "${tool.name}" from server "${serverName}"`);
  }

  /**
   * Adds a new MCP server configuration.
   * @param name The name of the server to add.
   * @param config The server configuration.
   * @returns Whether the server was added successfully.
   */
  static async addServer(name: string, config: ServerConfig): Promise<boolean> {
    try {
      const context = SillyTavern.getContext();
      const response = await fetch(`/api/plugins/${PLUGIN_ID}/servers`, {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
          name,
          config,
        }),
      });

      const data = await response.json();

      if (data.success) {
        console.log(`[MCPClient] Added server "${name}"`);

        if (context.extensionSettings.mcp?.enabled) {
          console.log(`[MCPClient] Auto-starting server "${name}"`);
          await this.connect(name, config);

          if (!this.#serverTools.has(name)) {
            await this.#fetchTools(name);
          }

          this.registerTools(name);
        }

        return true;
      } else {
        console.error(`[MCPClient] Failed to add server "${name}":`, data.error);
        return false;
      }
    } catch (error) {
      console.error(`[MCPClient] Error adding server "${name}":`, error);
      return false;
    }
  }

  /**
   * Connects to an MCP server.
   * @param name The name of the server to connect to.
   * @param config The server configuration.
   * @returns Whether the connection was successful.
   */
  static async connect(name: string, config: ServerConfig): Promise<boolean> {
    try {
      const context = SillyTavern.getContext();
      const response = await fetch(`/api/plugins/${PLUGIN_ID}/servers/${name}/start`, {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify(config),
      });

      const data = await response.json();

      if (data.success) {
        this.#connectedServers.set(name, config);
        console.log(`[MCPClient] Connected to server "${name}"`);

        // If this is an SSE transport, create an SSE connection
        if (config.type === 'sse' && config.url) {
          await this.createSseConnection(name, config.url);
        }

        return true;
      } else {
        console.error(`[MCPClient] Failed to connect to server "${name}":`, data.error);
        return false;
      }
    } catch (error) {
      console.error(`[MCPClient] Error connecting to server "${name}":`, error);
      return false;
    }
  }

  /**
   * Disconnects from an MCP server. Also unregisters all tools for this server.
   * @param name The name of the server to disconnect from.
   * @returns Whether the disconnection was successful.
   */
  static async disconnect(name: string): Promise<boolean> {
    try {
      const context = SillyTavern.getContext();
      // If this is an SSE connection, close it
      if (this.#sseClients.has(name)) {
        this.closeSseConnection(name);
      }

      const response = await fetch(`/api/plugins/${PLUGIN_ID}/servers/${name}/stop`, {
        method: 'POST',
        headers: context.getRequestHeaders(),
      });

      const data = await response.json();

      if (data.success) {
        this.#connectedServers.delete(name);
        console.log(`[MCPClient] Disconnected from server "${name}"`);

        // Unregister all tools for this server
        this.#unregisterServerTools(name);

        return true;
      } else {
        console.error(`[MCPClient] Failed to disconnect from server "${name}":`, data.error);
        return false;
      }
    } catch (error) {
      console.error(`[MCPClient] Error disconnecting from server "${name}":`, error);
      return false;
    }
  }

  /**
   * Unregisters all tools for a server from the context.
   * @param serverName The name of the server to unregister tools for.
   */
  static #unregisterServerTools(serverName: string): void {
    const context = SillyTavern.getContext();
    const tools = this.#serverTools.get(serverName) || [];

    for (const tool of tools) {
      const toolId = `mcp_${serverName}_${tool.name}`;
      context.unregisterFunctionTool(toolId);
      console.log(`[MCPClient] Unregistered tool "${tool.name}" from server "${serverName}"`);
    }

    this.#serverTools.delete(serverName);
    console.log(`[MCPClient] Unregistered all tools for server "${serverName}"`);
  }

  /**
   * Deletes an MCP server configuration.
   * @param name The name of the server to delete.
   * @returns Whether the deletion was successful.
   */
  static async deleteServer(name: string): Promise<boolean> {
    try {
      const context = SillyTavern.getContext();
      // First disconnect if connected
      if (this.isConnected(name)) {
        await this.disconnect(name);
      }

      const response = await fetch(`/api/plugins/${PLUGIN_ID}/servers/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: context.getRequestHeaders(),
      });

      const data = await response.json();

      if (data.success) {
        console.log(`[MCPClient] Deleted server "${name}"`);
        return true;
      } else {
        console.error(`[MCPClient] Failed to delete server "${name}":`, data.error);
        return false;
      }
    } catch (error) {
      console.error(`[MCPClient] Error deleting server "${name}":`, error);
      return false;
    }
  }

  /**
   * Gets a list of connected MCP servers.
   * @returns A list of connected MCP server names.
   */
  static getConnectedServers(): string[] {
    return Array.from(this.#connectedServers.keys());
  }

  /**
   * Handles MCP tools and server connections
   * @param enabled Whether to enable or disable MCP functionality
   */
  static async handleTools(enabled: boolean): Promise<void> {
    const context = SillyTavern.getContext();
    if (context.extensionSettings.mcp?.enabled !== enabled) {
      return;
    }

    if (enabled) {
      // For each configured server
      const allServers = await this.getServers();
      for (const server of allServers) {
        const { name, config } = server;
        // Connect to server if not already connected
        if (!this.isConnected(name)) {
          await this.connect(name, config);
        }

        // Fetch tools if we don't have them cached
        if (!this.#serverTools.has(name)) {
          await this.#fetchTools(name);
        }

        // Register tools
        this.registerTools(name);
      }
    } else {
      // When disabling, disconnect servers and unregister tools
      const connectedServers = this.getConnectedServers();
      for (const serverName of connectedServers) {
        // Disconnect server
        await this.disconnect(serverName);
      }
    }
  }

  /**
   * Checks if an MCP server is connected.
   * @param name The name of the server to check.
   * @returns Whether the server is connected.
   */
  static isConnected(name: string): boolean {
    return this.#connectedServers.has(name);
  }

  /**
   * Creates an SSE connection to an MCP server.
   * @param serverName The name of the server to connect to.
   * @param url The URL to connect to.
   * @returns Whether the connection was successful.
   */
  static async createSseConnection(serverName: string, url: string): Promise<boolean> {
    try {
      if (this.#sseClients.has(serverName)) {
        console.log(`[MCPClient] SSE connection for server "${serverName}" already exists`);
        return true;
      }

      console.log(`[MCPClient] Creating SSE connection for server "${serverName}" to URL "${url}"`);

      // Create a new SSE client
      const client = new McpSseClient(url);

      // Connect to the server
      const success = await client.connect();

      if (!success) {
        throw new Error(`Failed to connect to MCP server "${serverName}" via SSE`);
      }

      // Store the client
      this.#sseClients.set(serverName, client);

      console.log(`[MCPClient] SSE connection established for server "${serverName}"`);

      return true;
    } catch (error) {
      console.error(`[MCPClient] Error creating SSE connection for server "${serverName}":`, error);
      return false;
    }
  }

  /**
   * Closes an SSE connection to an MCP server.
   * @param serverName The name of the server to disconnect from.
   */
  static closeSseConnection(serverName: string): void {
    const client = this.#sseClients.get(serverName);
    if (!client) return;

    try {
      // Close the SSE client
      client.close();

      // Remove the client from the map
      this.#sseClients.delete(serverName);

      console.log(`[MCPClient] Closed SSE connection for server "${serverName}"`);
    } catch (error) {
      console.error(`[MCPClient] Error closing SSE connection for server "${serverName}":`, error);
    }
  }

  /**
   * Sends a JSON-RPC request to an MCP server via SSE.
   * @param serverName The name of the server to send the request to.
   * @param method Method name
   * @param params Method parameters
   * @returns Response from the server
   */
  static async sendSseJsonRpcRequest(serverName: string, method: string, params: any): Promise<any> {
    const client = this.#sseClients.get(serverName);
    if (!client) {
      throw new Error(`No SSE connection for server "${serverName}"`);
    }

    try {
      return await client.sendJsonRpcRequest(method, params);
    } catch (error) {
      console.error(`[MCPClient] Error sending SSE request for server "${serverName}":`, error);
      throw error;
    }
  }

  /**
   * Calls a tool on an MCP server.
   * @param serverName The name of the server to call the tool on.
   * @param toolName The name of the tool to call.
   * @param args The arguments to pass to the tool.
   * @returns The result of the tool call.
   */
  static async callTool(serverName: string, toolName: string, args: any): Promise<any> {
    try {
      const context = SillyTavern.getContext();
      if (!this.isConnected(serverName)) {
        throw new Error(`MCP server "${serverName}" is not connected.`);
      }

      // Check if this server uses SSE transport
      const config = this.#connectedServers.get(serverName);
      if (config && config.type === 'sse' && this.#sseClients.has(serverName)) {
        // Use SSE transport
        const response = await this.sendSseJsonRpcRequest(serverName, 'tools/call', {
          name: toolName,
          arguments: args,
        });

        if (response.result) {
          console.log(
            `[MCPClient] Successfully called tool "${toolName}" on server "${serverName}" via SSE:`,
            response.result,
          );
          return response.result;
        } else if (response.error) {
          console.error(
            `[MCPClient] Failed to call tool "${toolName}" on server "${serverName}" via SSE:`,
            response.error,
          );
          throw new Error(response.error.message || 'Unknown error');
        } else {
          console.error(
            `[MCPClient] Unexpected response from tool "${toolName}" on server "${serverName}" via SSE:`,
            response,
          );
          throw new Error('Unexpected response format');
        }
      } else {
        // Use HTTP transport
        const response = await fetch(`/api/plugins/${PLUGIN_ID}/servers/${serverName}/call-tool`, {
          method: 'POST',
          body: JSON.stringify({
            toolName,
            arguments: args,
          }),
          headers: context.getRequestHeaders(),
        });

        const data = await response.json();

        if (data.success) {
          console.log(`[MCPClient] Successfully called tool "${toolName}" on server "${serverName}":`, data.result);
          return data.result;
        } else {
          console.error(`[MCPClient] Failed to call tool "${toolName}" on server "${serverName}":`, data.error);
          throw new Error(data.error || 'Unknown error');
        }
      }
    } catch (error) {
      console.error(`[MCPClient] Error calling tool "${toolName}" on server "${serverName}":`, error);
      throw error;
    }
  }
}
