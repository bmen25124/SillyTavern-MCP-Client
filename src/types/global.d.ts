import { EventEmitter } from 'stream';
import { AutoModeOptions } from './types';

declare global {
  interface ToolContent {
    responseContent: {
      parts: {
        functionCall: {
          name: string;
          args: Record<string, unknown>;
        };
      }[];
    };
  }

  interface SillyTavernContext {
    eventSource: EventEmitter;
    getRequestHeaders: () => {
      'Content-Type': string;
      'X-CSRF-Token': any;
    };
    renderExtensionTemplateAsync: (
      extensionName: string,
      templateId: string,
      templateData?: object,
      sanitize?: boolean,
      localize?: boolean,
    ) => Promise<string>;
    extensionSettings: {
      mcp: {
        enabled: boolean;
      };
    };
    saveSettingsDebounced: () => void;
    registerFunctionTool: (options: {
      name: string;
      displayName: string;
      description: string;
      parameters: Record<string, unknown>;
      action: (parameters: Record<string, unknown>) => Promise<unknown>;
      formatMessage: (parameters: Record<string, unknown>) => Promise<string>;
    }) => void;
    unregisterFunctionTool: (name: string) => void;
    callGenericPopup: (
      content: JQuery<HTMLElement> | string | Element,
      type: POPUP_TYPE,
      inputValue?: string,
      popupOptions?: PopupOptions,
    ) => Promise<POPUP_RESULT | string | (boolean | null)>;
    Popup: {
      show: {
        confirm: (message: string, title?: string) => Promise<boolean>;
      };
    };
    /**
     * Sets a prompt injection to insert custom text into any outgoing prompt. For use in UI extensions.
     * @param {string} key Prompt injection id.
     * @param {string} value Prompt injection value.
     * @param {number} position Insertion position. 0 is after story string, 1 is in-chat with custom depth.
     * @param {number} depth Insertion depth. 0 represets the last message in context. Expected values up to MAX_INJECTION_DEPTH.
     * @param {boolean} scan Should the prompt be included in the world info scan.
     * @param {number} role Extension prompt role. Defaults to SYSTEM.
     * @param {(function(): Promise<boolean>|boolean)} filter Filter function to determine if the prompt should be injected.
     */
    setExtensionPrompt: (
      key: string,
      value: string,
      position: number,
      depth: number,
      scan?: boolean,
      role?: number,
      filter?: () => Promise<boolean> | boolean,
    ) => void;
    extensionPrompts: Record<string, any>;
    registerFunctionToolsOpenAI: (data: object) => Promise<void>;
    invokeFunctionTools: (data: ToolContent) => Promise<ToolInvocationResult>;
    saveFunctionToolInvocations: (invocations: any[]) => Promise<void>;

    chat: Record<
      number,
      {
        mes: string;
        is_system: boolean;
        extra?: {
          tool_invocations?: any[];
        };
      }
    >;
    deleteLastMessage(): Promise<void>;
    mainApi: string;
  }

  const SillyTavern: {
    getContext(): SillyTavernContext;
  };
}

export {};
