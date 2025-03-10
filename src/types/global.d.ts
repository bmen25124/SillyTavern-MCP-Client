import { EventEmitter } from 'stream';
import { AutoModeOptions } from './types';

declare global {
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
  }

  const SillyTavern: {
    getContext(): SillyTavernContext;
  };
}

export {};
