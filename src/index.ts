import { MCPClient, McpTool, ServerConfig } from './mcp-client';
import { EventNames, POPUP_TYPE } from './types/types';
import { st_echo } from './config';

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

  /**
   * Creates and shows a popup from a template
   * @param templatePath The path to the template (without the extension)
   * @returns The popup content element
   */
  async function createAndShowPopup(templatePath: string): Promise<HTMLElement> {
    const content = await context.renderExtensionTemplateAsync(`third-party/${extensionName}`, templatePath);

    // Create popup content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    const popupContent = tempDiv.firstElementChild as HTMLElement;

    // Show popup first so template is in the DOM
    context.callGenericPopup($(popupContent), POPUP_TYPE.DISPLAY);

    return popupContent;
  }

  /**
   * Populates the tools list in the popup
   * @param popupContent The popup content element
   */
  async function populateToolsList(popupContent: HTMLElement): Promise<void> {
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

        // Add accordion click handler
        const serverHeader = serverSection.querySelector('.server-header') as HTMLElement;
        serverHeader.addEventListener('click', (e) => {
          // Don't trigger accordion when clicking the toggle
          if ((e.target as HTMLElement).closest('.checkbox_label')) return;

          const toolsList = serverSection.querySelector('.tools-list') as HTMLElement;
          const chevron = serverHeader.querySelector('i') as HTMLElement;
          toolsList.classList.toggle('collapsed');
          chevron.style.transform = toolsList.classList.contains('collapsed') ? 'rotate(-90deg)' : '';
        });

        // Add server toggle handler
        serverToggle.addEventListener('change', async () => {
          const serverSection = serverToggle.closest('.server-tools-section') as HTMLElement;
          const label = serverToggle.closest('.checkbox_label') as HTMLElement;

          // Show loading state
          const labelSpan = label.querySelector('span')!;
          const originalSpanText = labelSpan.textContent;
          serverToggle.disabled = true;
          labelSpan.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';

          try {
            const enabled = serverToggle.checked;
            serverSection.classList.toggle('disabled', !enabled);

            // Get all servers and update disabled list
            const disabledServers = Array.from(popupContent.querySelectorAll('.server-toggle'))
              .filter((toggle) => !(toggle as HTMLInputElement).checked)
              .map((toggle) => (toggle as HTMLInputElement & { dataset: DOMStringMap }).dataset.server!);

            await MCPClient.updateDisabledServers(disabledServers);

            // Show success state briefly
            labelSpan.innerHTML = '<i class="fa-solid fa-check"></i> Updated';
          } catch (error) {
            console.error('Error updating server state:', error);
            // Show error state and revert toggle
            labelSpan.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Failed';
            serverToggle.checked = !serverToggle.checked;
            serverSection.classList.toggle('disabled', !serverToggle.checked);
            await st_echo('error', `Failed to ${serverToggle.checked ? 'enable' : 'disable'} server "${server.name}"`);
          }

          // Reset label after delay
          setTimeout(() => {
            labelSpan.textContent = originalSpanText;
            serverToggle.disabled = false;
          }, 1500);
        });

        // Add delete server handler
        const deleteButton = serverSection.querySelector('.delete-server') as HTMLButtonElement;
        deleteButton.addEventListener('click', async (e) => {
          e.stopPropagation(); // Prevent accordion from triggering
          const name = server.name;
          const confirm = await context.Popup.show.confirm(
            `Are you sure you want to delete the selected profile?`,
            name,
          );
          if (confirm) {
            try {
              const success = await MCPClient.deleteServer(name);
              if (success) {
                console.log(`Server "${name}" removed successfully`);
                await populateToolsList(popupContent);
              } else {
                console.error(`Failed to remove server "${name}"`);
                await st_echo('error', `Failed to remove server "${name}"`);
              }
            } catch (error) {
              console.error('Error removing server:', error);
              await st_echo('error', `Error removing server "${name}"`);
            }
          }
        });

        // Add tools if available
        const tools = await MCPClient.getServerTools(server.name);
        if (tools && tools.length > 0) {
          const toolsList = serverSection.querySelector('.tools-list') as HTMLElement;
          tools.forEach((tool: McpTool) => {
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
  }

  $('#mcp_manage_tools').on('click', async function () {
    const popupContent = await createAndShowPopup('templates/tools');
    await populateToolsList(popupContent);

    // Add server form handlers
    popupContent.querySelector('#add-server')?.addEventListener('click', () => {
      $('#add-server-form').show();
    });

    popupContent.querySelector('#cancel-server')?.addEventListener('click', () => {
      $('#add-server-form').hide();
      $('#server-input').val('');
    });

    popupContent.querySelector('#submit-server')?.addEventListener('click', async () => {
      const input = $('#server-input').val() as string;
      if (!input) return;

      let serverName = '';
      let config: ServerConfig;

      try {
        // Check if input is JSON
        if (input.trim().startsWith('{')) {
          const jsonConfig = JSON.parse(input);
          if (!jsonConfig.mcpServers) {
            throw new Error('Invalid config: missing mcpServers object');
          }

          const serverEntry = Object.entries(jsonConfig.mcpServers)[0];
          if (!serverEntry) {
            throw new Error('Invalid config: no server configuration found');
          }

          serverName = serverEntry[0];
          const serverConfig = serverEntry[1] as { command: string; args: string[]; env: Record<string, string> };
          config = { ...serverConfig, type: 'stdio' };
        } else {
          // Assume it's an command
          const parts = input.trim().split(' ');

          // Get the last part of the package name for server name
          const packageName = parts[parts.length - 1];
          serverName = packageName.split('/').pop()!;
          config = {
            command: parts[0],
            args: parts.slice(1),
            env: {},
            type: 'stdio',
          };
        }

        const success = await MCPClient.addServer(serverName, config);
        if (success) {
          console.log(`Server "${serverName}" added successfully`);
          await st_echo('success', `Server "${serverName}" added successfully`);
          $('#add-server-form').hide();
          $('#server-input').val('');
          await populateToolsList(popupContent);
        } else {
          console.error(`Failed to add server "${serverName}"`);
          await st_echo('error', `Failed to add server "${serverName}"`);
        }
      } catch (error) {
        console.error('Error adding server:', error);
        await st_echo('error', `Error adding server: ${(error as Error).message}`);
      }
    });

    // Add reload all tools button handler
    popupContent.querySelector('#reload-all-tools')?.addEventListener('click', async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      const originalText = button.innerHTML;

      // Show loading state
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing';
      button.disabled = true;

      try {
        const success = await MCPClient.reloadAllTools();

        if (success) {
          // Show success state
          button.innerHTML = '<i class="fa-solid fa-check"></i> Success';
          button.style.background = 'var(--active)';
          console.log('Successfully reloaded all tools');
          await st_echo('success', 'Successfully reloaded all tools');

          // Refresh the tools list
          await populateToolsList(popupContent);
        } else {
          // Show error state
          button.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Failed';
          button.style.background = 'var(--warning)';
          console.error('Failed to reload one or more tools');
          await st_echo('error', 'Failed to reload one or more tools');
        }

        // Reset button after delay
        setTimeout(() => {
          button.innerHTML = originalText;
          button.style.background = '';
          button.disabled = false;
        }, 1500);
      } catch (error) {
        console.error('Error reloading tools:', error);
        button.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Error';
        button.style.background = 'var(--warning)';
        await st_echo('error', 'Error reloading tools');

        // Reset button after delay
        setTimeout(() => {
          button.innerHTML = originalText;
          button.style.background = '';
          button.disabled = false;
        }, 1500);
      }
    });

    // Add toggle handler for tools after content is populated
    popupContent.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      if (!target.classList.contains('tool-toggle')) return;

      const label = target.closest('.checkbox_label') as HTMLElement;
      const labelSpan = label.querySelector('span')!;
      const originalSpanText = labelSpan.textContent;

      // Show loading state
      target.disabled = true;
      labelSpan.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';

      try {
        const serverName = target.dataset.server!;
        const tools = await MCPClient.getServerTools(serverName);
        if (!tools) throw new Error('Could not get server tools');

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

        // Show success state briefly
        labelSpan.innerHTML = '<i class="fa-solid fa-check"></i> Updated';
      } catch (error) {
        console.error('Error updating tool state:', error);
        // Show error state and revert toggle
        labelSpan.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Failed';
        target.checked = !target.checked;
        await st_echo('error', `Failed to update tool state`);
      }

      // Reset label after delay
      setTimeout(() => {
        labelSpan.textContent = originalSpanText;
        target.disabled = false;
      }, 1500);
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
