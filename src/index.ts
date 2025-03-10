import { MCPClient } from './mcp-client';
import { EventNames, POPUP_TYPE } from './types/types';

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

  $('#mcp_manage_tools').on('click', async function () {
    const template = await context.renderExtensionTemplateAsync(
      `third-party/${extensionName}`,
      'templates/tools',
    );

    const popup = $(template);
    const connectedServers = MCPClient.getConnectedServers();
    const toolsList = popup.find('#mcp-tools-list');

    // Clear and populate tools list
    toolsList.empty();

    if (connectedServers.length === 0) {
      toolsList.append('<div class="no-servers">No connected MCP servers found.</div>');
    } else {
      for (const serverName of connectedServers) {
        const tools = MCPClient.getServerTools(serverName);
        if (tools && tools.length > 0) {
          const serverSection = $(`
            <div class="server-tools-section">
              <h4>${serverName}</h4>
              <div class="tools-list"></div>
            </div>
          `);

          const toolsList = serverSection.find('.tools-list');
          tools.forEach(tool => {
            const toolItem = $(`
              <div class="tool-item">
                <div class="tool-header">
                  <span class="tool-name">${tool.name}</span>
                </div>
                <div class="tool-description">${tool.description || 'No description available'}</div>
              </div>
            `);
            toolsList.append(toolItem);
          });

          popup.find('#mcp-tools-list').append(serverSection);
        }
      }
    }

    context.callGenericPopup(popup, POPUP_TYPE.DISPLAY);
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
