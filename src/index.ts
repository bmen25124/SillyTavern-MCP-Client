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
    const content = await context.renderExtensionTemplateAsync(`third-party/${extensionName}`, 'templates/tools');

    // Create popup content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    const popupContent = tempDiv.firstElementChild as HTMLElement;

    // Show popup first so template is in the DOM
    context.callGenericPopup($(popupContent), POPUP_TYPE.DISPLAY);

    const toolsList = popupContent.querySelector('#mcp-tools-list')!;
    const serverTemplate = popupContent.querySelector('#server-section-template') as HTMLTemplateElement;

    // Clear and populate tools list
    toolsList.innerHTML = '';

    const allServers = await MCPClient.getServers();

    if (allServers.length === 0) {
      const noServers = document.createElement('div');
      noServers.className = 'no-servers';
      noServers.textContent = 'No MCP servers found.';
      toolsList.appendChild(noServers);
    } else {
      for (const server of allServers) {
        // Clone server template
        const serverNode = serverTemplate.content.cloneNode(true) as DocumentFragment;
        const serverSection = serverNode.querySelector('.server-tools-section')!;
        if (!server.enabled) serverSection.classList.add('disabled');

        // Set server name and enabled state
        (serverSection.querySelector('h4') as HTMLHeadingElement).textContent = server.name;
        const serverToggle = serverSection.querySelector('.server-toggle') as HTMLInputElement;
        serverToggle.checked = server.enabled;
        (serverToggle as HTMLInputElement & { dataset: DOMStringMap }).dataset.server = server.name;

        // Add server toggle handler
        serverToggle.addEventListener('change', async () => {
          const enabled = serverToggle.checked;
          const section = serverToggle.closest('.server-tools-section') as HTMLElement;
          section.classList.toggle('disabled', !enabled);

          // Get all servers and update disabled list
          const disabledServers = Array.from(popupContent.querySelectorAll('.server-toggle'))
            .filter((toggle) => !(toggle as HTMLInputElement).checked)
            .map((toggle) => (toggle as HTMLInputElement & { dataset: DOMStringMap }).dataset.server!);

          await MCPClient.updateDisabledServers(disabledServers);
        });

        // Add tools if available
        const tools = MCPClient.getServerTools(server.name);
        if (tools && tools.length > 0) {
          const toolsList = serverSection.querySelector('.tools-list') as HTMLElement;
          tools.forEach((tool) => {
            const toolItem = document.createElement('div');
            toolItem.className = 'tool-item';
            toolItem.innerHTML = `
              <div class="tool-header">
                <span class="tool-name">${tool.name}</span>
                <label class="checkbox_label">
                  <input type="checkbox" class="tool-toggle" ${tool._enabled ? 'checked' : ''} />
                  <span>Enable</span>
                </label>
              </div>
              <div class="tool-description">${tool.description || 'No description available'}</div>
            `;

            const toolToggle = toolItem.querySelector('.tool-toggle') as HTMLInputElement & { dataset: DOMStringMap };
            toolToggle.dataset.server = server.name;
            toolToggle.dataset.tool = tool.name;

            toolsList.appendChild(toolItem);
          });
        }

        toolsList.appendChild(serverSection);
      }
    }

    // Add toggle handler for tools after content is populated
    popupContent.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      if (!target.classList.contains('tool-toggle')) return;

      const serverName = target.dataset.server!;
      const tools = MCPClient.getServerTools(serverName);
      if (!tools) return;

      // Collect all disabled tools for this server
      const disabledTools = tools
        .filter((tool) => {
          const checkbox = popupContent.querySelector(
            `input.tool-toggle[data-server="${serverName}"][data-tool="${tool.name}"]`,
          ) as HTMLInputElement;
          return !checkbox.checked;
        })
        .map((tool) => tool.name);

      await MCPClient.updateDisabledTools(serverName, disabledTools);
    });
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
