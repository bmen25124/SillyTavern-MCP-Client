/**
 * A client for interacting with MCP servers via SSE.
 */
interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

interface ClientInfo {
  name: string;
  version: string;
}

interface Capabilities {
  prompts: Record<string, any>;
  resources: Record<string, any>;
  tools: Record<string, any>;
}

interface JsonRpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: any;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

interface ToolParams {
  name: string;
  arguments: Record<string, any>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

const context = SillyTavern.getContext();

export class McpSseClient {
  /**
   * The URL of the MCP server.
   */
  #url: string;

  /**
   * The EventSource connection to the MCP server.
   */
  #eventSource: EventSource | null = null;

  /**
   * A map of pending requests.
   */
  #pendingRequests: Map<number, PendingRequest> = new Map();

  /**
   * The request timeout in milliseconds.
   */
  #requestTimeout: number = 30000;

  /**
   * Client information for MCP server.
   */
  #clientInfo: ClientInfo = {
    name: 'sillytavern-client',
    version: '1.0.0',
  };

  /**
   * Client capabilities for MCP server.
   */
  #capabilities: Capabilities = {
    prompts: {},
    resources: {},
    tools: {},
  };

  /**
   * Protocol version for MCP server.
   */
  #protocolVersion: string = '2024-11-05';

  /**
   * Creates a new McpSseClient.
   * @param url The URL of the MCP server.
   */
  constructor(url: string) {
    this.#url = url;
  }

  /**
   * Connects to the MCP server.
   * @returns Whether the connection was successful.
   */
  async connect(): Promise<boolean> {
    try {
      if (this.#eventSource) {
        console.log('[McpSseClient] Already connected');
        return true;
      }

      console.log(`[McpSseClient] Connecting to ${this.#url}`);

      // Create a new EventSource connection
      this.#eventSource = new EventSource(this.#url);

      // Set up event handlers
      this.#eventSource.onopen = () => {
        console.log('[McpSseClient] Connection opened');
      };

      this.#eventSource.onerror = (error: Event) => {
        console.error('[McpSseClient] Connection error:', error);
        this.close();
      };

      this.#eventSource.onmessage = (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data) as JsonRpcResponse;
          console.log('[McpSseClient] Received message:', message);

          // Check if this is a response to a pending request
          if (message.jsonrpc === '2.0' && message.id !== undefined) {
            const pendingRequest = this.#pendingRequests.get(message.id);
            if (pendingRequest) {
              // Clear the timeout
              if (pendingRequest.timeoutId) {
                clearTimeout(pendingRequest.timeoutId);
              }

              // Resolve or reject the promise
              if (message.error) {
                pendingRequest.reject(new Error(`JSON-RPC error ${message.error.code}: ${message.error.message}`));
              } else {
                pendingRequest.resolve(message);
              }

              // Remove from pending requests
              this.#pendingRequests.delete(message.id);
            }
          }
        } catch (error) {
          console.error('[McpSseClient] Error parsing message:', error);
        }
      };

      // Send initialization message
      await this.sendJsonRpcRequest(
        'initialize',
        {
          clientInfo: this.#clientInfo,
          capabilities: this.#capabilities,
          protocolVersion: this.#protocolVersion,
        },
        true,
      );

      return true;
    } catch (error) {
      console.error('[McpSseClient] Error connecting:', error);
      return false;
    }
  }

  /**
   * Closes the connection to the MCP server.
   */
  close(): void {
    if (!this.#eventSource) {
      return;
    }

    try {
      // Send shutdown request
      this.sendJsonRpcRequest('shutdown', {}, true).catch((error) => {
        console.error('[McpSseClient] Error sending shutdown request:', error);
      });

      // Close the EventSource connection
      this.#eventSource.close();
      this.#eventSource = null;

      // Reject all pending requests
      for (const [id, pendingRequest] of this.#pendingRequests.entries()) {
        if (pendingRequest.timeoutId) {
          clearTimeout(pendingRequest.timeoutId);
        }
        pendingRequest.reject(new Error('Connection closed'));
        this.#pendingRequests.delete(id);
      }

      console.log('[McpSseClient] Connection closed');
    } catch (error) {
      console.error('[McpSseClient] Error closing connection:', error);
    }
  }

  /**
   * Sends a JSON-RPC request to the MCP server.
   * @param method Method name
   * @param params Method parameters
   * @param ignoreConnectionCheck Whether to ignore the connection check
   * @returns Response from the server
   */
  async sendJsonRpcRequest(
    method: string,
    params: any,
    ignoreConnectionCheck: boolean = false,
  ): Promise<JsonRpcResponse> {
    if (!ignoreConnectionCheck && !this.#eventSource) {
      throw new Error('Not connected');
    }

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      try {
        // For initialization and shutdown, we don't need to wait for a response
        const isSpecialMethod = method === 'initialize' || method === 'shutdown';

        // Send the request via fetch
        (async () => {
          try {
            const url = new URL(this.#url);
            const response = await fetch(`${url.origin}${url.pathname}`, {
              method: 'POST',
              headers: context.getRequestHeaders(),
              body: JSON.stringify(request),
            });

            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            // For special methods, resolve immediately
            if (isSpecialMethod) {
              resolve({
                jsonrpc: '2.0',
                id: request.id,
                result: { success: true },
              });
              return;
            }

            // For regular methods, store the request and wait for a response via EventSource
            // Set up timeout
            const timeoutId = setTimeout(() => {
              if (this.#pendingRequests.has(request.id)) {
                this.#pendingRequests.delete(request.id);
                reject(new Error(`Request timed out after ${this.#requestTimeout}ms`));
              }
            }, this.#requestTimeout);

            // Store the request
            this.#pendingRequests.set(request.id, { resolve, reject, timeoutId });
          } catch (error) {
            console.error('[McpSseClient] Error sending request:', error);

            // Clean up the pending request
            if (this.#pendingRequests.has(request.id)) {
              const pendingRequest = this.#pendingRequests.get(request.id)!;
              if (pendingRequest.timeoutId) {
                clearTimeout(pendingRequest.timeoutId);
              }
              this.#pendingRequests.delete(request.id);
            }

            reject(error);
          }
        })();
      } catch (error) {
        console.error('[McpSseClient] Error preparing request:', error);
        reject(error);
      }
    });
  }

  /**
   * Lists tools available from the MCP server.
   * @returns List of tools
   */
  async listTools(): Promise<{ tools: Array<McpTool> }> {
    try {
      const response = await this.sendJsonRpcRequest('tools/list', {});
      return response.result || { tools: [] };
    } catch (error) {
      console.error('[McpSseClient] Error listing tools:', error);
      throw error;
    }
  }

  /**
   * Calls a tool on the MCP server.
   * @param params Tool parameters
   * @returns Tool result
   */
  async callTool(params: ToolParams): Promise<any> {
    try {
      const response = await this.sendJsonRpcRequest('tools/call', params);
      return response.result;
    } catch (error) {
      console.error('[McpSseClient] Error calling tool:', error);
      throw error;
    }
  }

  /**
   * Lists resources available from the MCP server.
   * @returns List of resources
   */
  async listResources(): Promise<{ resources: Array<object> }> {
    try {
      const response = await this.sendJsonRpcRequest('resources/list', {});
      return response.result || { resources: [] };
    } catch (error) {
      console.error('[McpSseClient] Error listing resources:', error);
      throw error;
    }
  }

  /**
   * Lists resource templates available from the MCP server.
   * @returns List of resource templates
   */
  async listResourceTemplates(): Promise<{ resourceTemplates: Array<object> }> {
    try {
      const response = await this.sendJsonRpcRequest('resources/list-templates', {});
      return response.result || { resourceTemplates: [] };
    } catch (error) {
      console.error('[McpSseClient] Error listing resource templates:', error);
      throw error;
    }
  }

  /**
   * Reads a resource from the MCP server.
   * @param uri Resource URI
   * @returns Resource contents
   */
  async readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    try {
      const response = await this.sendJsonRpcRequest('resources/read', { uri });
      return response.result || { contents: [] };
    } catch (error) {
      console.error('[McpSseClient] Error reading resource:', error);
      throw error;
    }
  }
}
