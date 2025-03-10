import { MCPClient } from './mcp-client';
import { EventNames } from './types/types';

const extensionName = 'SillyTavern-MCP-Client';
const context = SillyTavern.getContext();

const DEFAULT_SETTINGS: { enabled: boolean } = {
  enabled: false,
};

function initializeDefaultSettings(): void {
  context.extensionSettings.mcp = context.extensionSettings.mcp || {};

  let anyChange: boolean = false;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    // @ts-ignore
    if (context.extensionSettings.mcp[key] === undefined) {
      // @ts-ignore
      context.extensionSettings.mcp[key] = DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS];
      anyChange = true;
    }
  }

  if (anyChange) {
    context.saveSettingsDebounced();
  }
}

async function handleUIChanges(): Promise<void> {
  const settings: string = await context.renderExtensionTemplateAsync(
    `third-party/${extensionName}`,
    'templates/settings',
  );
  $('#extensions_settings').append(settings);

  $('#mcp_enabled')
    .prop('checked', context.extensionSettings.mcp.enabled)
    .on('change', async function () {
      const enabled: boolean = $(this).prop('checked');
      context.extensionSettings.mcp.enabled = enabled;
      context.saveSettingsDebounced();

      // Use MCPClient's handleTools method to manage tool registration
      await MCPClient.handleTools(enabled);
    });

  // Initial tool registration if enabled
  await MCPClient.handleTools(context.extensionSettings.mcp.enabled);
}

function initializeEvents() {
  context.eventSource.on(
    EventNames.CHAT_COMPLETION_SETTINGS_READY,
    async (payload: { tools?: any[]; chat_completion_source: string }) => {
      if (!payload.tools) {
        return;
      }

      const removeProps = (obj: any) => {
        if (typeof obj !== 'object' || obj === null) return;
        delete obj.additionalProperties;
        delete obj.default;

        // Process properties if they exist
        if (obj.properties) {
          if (obj.type === 'object' && Object.keys(obj.properties).length === 0) {
            obj.properties = {
              _dummy: {
                type: 'string',
                description: 'This is a placeholder property to satisfy MakerSuite requirements.',
              },
            };
          }
          Object.values(obj.properties).forEach((prop) => removeProps(prop));
        }

        // Process items for arrays
        if (obj.items) {
          removeProps(obj.items);
        }

        // Process allOf, anyOf, oneOf if they exist
        ['allOf', 'anyOf', 'oneOf'].forEach((key) => {
          if (Array.isArray(obj[key])) {
            obj[key].forEach((item) => removeProps(item));
          }
        });
      };

      // makersuite is a special kid, we need to remove "additionalProperties" and "default" from all levels. Also doesn't accept empty params
      if (payload.chat_completion_source === 'makersuite') {
        payload.tools.forEach((tool) => {
          removeProps(tool.function.parameters);
        });
      }
    },
  );
}

initializeDefaultSettings();
handleUIChanges();
initializeEvents();
