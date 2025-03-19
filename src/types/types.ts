export interface ToolDefinitionOpenAI {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: object;
    toString: () => string;
  };
}
