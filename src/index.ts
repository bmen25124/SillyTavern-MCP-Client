import { EventNames } from 'sillytavern-utils-lib/types';
import { POPUP_TYPE } from 'sillytavern-utils-lib/types/popup';
import { st_echo } from 'sillytavern-utils-lib/config';
import { MCPClient, McpTool, ServerConfig } from './mcp-client.js';

const extensionName = 'SillyTavern-MCP-Client';
const globalContext = SillyTavern.getContext();
const EXTENSION_SETTINGS_KEY = 'mcp';

interface ExtensionSettings {
  enabled: boolean;
}

function getExtensionSettings(): ExtensionSettings {
  const context = SillyTavern.getContext();
  return context.extensionSettings[EXTENSION_SETTINGS_KEY] as ExtensionSettings;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: false,
};

function initializeDefaultSettings(): void {
  globalContext.extensionSettings[EXTENSION_SETTINGS_KEY] =
    globalContext.extensionSettings?.[EXTENSION_SETTINGS_KEY] || {};

  function initializeRecursively(target: any, defaults: any): boolean {
    let anyChange = false;

    for (const key of Object.keys(defaults)) {
      if (target[key] === undefined) {
        target[key] = defaults[key];
        anyChange = true;
      } else if (typeof defaults[key] === 'object' && defaults[key] !== null) {
        target[key] = target[key] || {};
        if (initializeRecursively(target[key], defaults[key])) {
          anyChange = true;
        }
      }
    }

    return anyChange;
  }

  if (initializeRecursively(globalContext.extensionSettings[EXTENSION_SETTINGS_KEY], DEFAULT_SETTINGS)) {
    globalContext.saveSettingsDebounced();
  }
}

async function handleUIChanges(): Promise<void> {
  const settingsHtml: string = await globalContext.renderExtensionTemplateAsync(
    `third-party/${extensionName}`,
    'templates/settings',
  );
  $('#extensions_settings').append(settingsHtml);

  const settings = getExtensionSettings();
  $('#mcp_enabled')
    .prop('checked', settings.enabled)
    .on('change', async function () {
      const toggle = $(this);
      const label = toggle.parent('.checkbox_label');
      const labelSpan = label.find('span');
      const originalSpanText = labelSpan.text();

      // Show loading state
      toggle.prop('disabled', true);
      labelSpan.html('<i class="fa-solid fa-spinner fa-spin"></i> Updating...');

      const enabled: boolean = toggle.prop('checked');
      settings.enabled = enabled;
      globalContext.saveSettingsDebounced();

      // Use MCPClient's handleTools method to manage tool registration
      try {
        await MCPClient.handleTools(enabled);
        // Show success state briefly
        labelSpan.html('<i class="fa-solid fa-check"></i> Updated');
      } catch (error) {
        console.error(`[MCPClient] Error handling MCP tools:`, error);
        // Show error state and revert toggle
        labelSpan.html('<i class="fa-solid fa-exclamation-triangle"></i> Failed');
        st_echo('error', `[MCPClient] Error handling MCP tools: ${error}`);
      }

      // Reset label after delay
      setTimeout(() => {
        labelSpan.text(originalSpanText);
        toggle.prop('disabled', false);
      }, 1500);
    });

  /**
   * Creates and shows a popup from a template
   * @param templatePath The path to the template (without the extension)
   * @returns The popup content element
   */
  async function createAndShowPopup(templatePath: string): Promise<HTMLElement> {
    const content = await globalContext.renderExtensionTemplateAsync(`third-party/${extensionName}`, templatePath);

    // Create popup content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    const popupContent = tempDiv.firstElementChild as HTMLElement;

    // Show popup first so template is in the DOM
    globalContext.callGenericPopup($(popupContent), POPUP_TYPE.DISPLAY);

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
        const isConnected = MCPClient.isConnected(server.name);
        // Clone server template
        const serverNode = serverTemplate.content.cloneNode(true) as DocumentFragment;
        const serverSection = serverNode.querySelector('.server-tools-section')!;
        if (!isConnected) serverSection.classList.add('disabled');

        // Set server name and enabled state
        (serverSection.querySelector('h4') as HTMLHeadingElement).textContent = server.name;
        const serverToggle = serverSection.querySelector('.server-toggle') as HTMLInputElement;
        serverToggle.checked = isConnected;
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

          const enabled = serverToggle.checked;
          try {
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
            await st_echo('error', `Failed to ${enabled ? 'enable' : 'disable'} server "${server.name}"`);
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
          const confirm = await globalContext.Popup.show.confirm(
            `Are you sure you want to delete the selected server?`,
            name,
          );
          if (confirm) {
            try {
              await MCPClient.deleteServer(name);
              console.log(`Server "${name}" removed successfully`);
              await populateToolsList(popupContent);
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
    const addButton = popupContent.querySelector('#add-server') as HTMLButtonElement;
    const submitButton = popupContent.querySelector('#submit-server') as HTMLButtonElement;
    const serverInput = $('#server-input');

    // Enable add button initially
    addButton.disabled = false;

    // Enable submit button only when there's input
    serverInput.on('input', () => {
      submitButton.disabled = !serverInput.val();
    });

    addButton.addEventListener('click', () => {
      $('#add-server-form').show();
      addButton.disabled = true;
    });

    popupContent.querySelector('#cancel-server')?.addEventListener('click', () => {
      $('#add-server-form').hide();
      serverInput.val('');
      addButton.disabled = false;
      submitButton.disabled = true;
    });

    popupContent.querySelector('#submit-server')?.addEventListener('click', async () => {
      const submitButton = popupContent.querySelector('#submit-server') as HTMLButtonElement;
      const input = $('#server-input').val() as string;
      if (!input) return;

      // Show loading state
      const originalText = submitButton.innerHTML;
      submitButton.disabled = true;
      submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding...';

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

        await MCPClient.addServer(serverName, config);
        console.log(`Server "${serverName}" added successfully`);

        // If we get here, either server was added successfully with no connection
        // attempt, or it was added and connected successfully
        await st_echo('success', `Server "${serverName}" added successfully`);

        // Show success state briefly
        submitButton.innerHTML = '<i class="fa-solid fa-check"></i> Success';
        submitButton.style.background = 'var(--active)';

        // Hide form and reset input
        $('#add-server-form').hide();
        $('#server-input').val('');
        await populateToolsList(popupContent);
      } catch (error) {
        console.error('Error adding server:', error);

        if ((error as any).isConnectError) {
          // Server was added but failed to connect
          await st_echo('warning', (error as Error).message);

          // Show warning state
          submitButton.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Added With Warning';
          submitButton.style.background = 'var(--warning)';

          // Still hide form and update UI since server was added
          $('#add-server-form').hide();
          $('#server-input').val('');
          await populateToolsList(popupContent);
        } else {
          // Failed to add server
          await st_echo('error', `Error adding server: ${(error as Error).message}`);

          // Show error state
          submitButton.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Error';
          submitButton.style.background = 'var(--error)';
        }
      }

      // Reset button after delay
      setTimeout(() => {
        submitButton.innerHTML = originalText;
        submitButton.style.background = '';
        // Enable button if there's input
        submitButton.disabled = !serverInput.val();
        addButton.disabled = false;
      }, 1500);
    });

    // Add reload all tools button handler
    popupContent.querySelector('#reload-all-tools')?.addEventListener('click', async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      const originalText = button.innerHTML;

      // Show loading state
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing';
      button.disabled = true;

      try {
        await MCPClient.reloadAllTools();

        // Show success state
        button.innerHTML = '<i class="fa-solid fa-check"></i> Success';
        button.style.background = 'var(--active)';
        console.log('Successfully reloaded all tools');
        await st_echo('success', 'Successfully reloaded all tools');

        // Refresh the tools list
        await populateToolsList(popupContent);

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

    // Add settings button handler
    popupContent.querySelector('#open-server-settings')?.addEventListener('click', async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      const originalText = button.innerHTML;

      // Show loading state
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Opening';
      button.disabled = true;

      try {
        await MCPClient.openServerSettings();

        // Show success state
        button.innerHTML = '<i class="fa-solid fa-check"></i> Success';
        button.style.background = 'var(--active)';
      } catch (error) {
        console.error('Error opening settings:', error);
        button.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Error';
        button.style.background = 'var(--warning)';
        await st_echo('error', 'Error opening settings');
      }

      // Reset button after delay
      setTimeout(() => {
        button.innerHTML = originalText;
        button.style.background = '';
        button.disabled = false;
      }, 1500);
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
  try {
    await MCPClient.handleTools(settings.enabled);
  } catch (error) {
    await st_echo('error', `Error handling tools: ${(error as Error).message}`);
  }
}

function initializeEvents() {
  globalContext.eventSource.on(
    EventNames.CHAT_COMPLETION_SETTINGS_READY,
    async (payload: { tools?: any[]; chat_completion_source: string }) => {
      if (!payload.tools) {
        return;
      }

      const removeTitle = (obj: any) => {
        if (typeof obj !== 'object' || obj === null) return;
        if (obj.title) {
          delete obj.title;
        }

        // Process properties if they exist
        if (obj.properties) {
          Object.values(obj.properties).forEach((prop) => removeTitle(prop));
        }

        // Process items for arrays
        if (obj.items) {
          removeTitle(obj.items);
        }

        // Process allOf, anyOf, oneOf if they exist
        ['allOf', 'anyOf', 'oneOf'].forEach((key) => {
          if (Array.isArray(obj[key])) {
            obj[key].forEach((item) => removeTitle(item));
          }
        });
      };

      payload.tools.forEach((tool) => {
        removeTitle(tool.function.parameters);
      });

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
