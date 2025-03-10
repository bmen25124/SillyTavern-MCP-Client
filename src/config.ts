// @ts-ignore
import { chat_completion_sources } from '../../../../openai.js';

import {
  name1,
  name2,
  amount_gen,
  max_context,
  updateMessageBlock,
  // @ts-ignore
} from '../../../../../script.js';

import {
  textgen_types,
  getLogprobsNumber,
  replaceMacrosInList,
  // @ts-ignore
} from '../../../../textgen-settings.js';

export const extensionName = 'SillyTavern-Magic-Translation';
export const context = SillyTavern.getContext();

/**
 * Sends an echo message using the SlashCommandParser's echo command.
 */
export async function st_echo(severity: string, message: string): Promise<void> {
  // @ts-ignore
  await SillyTavern.getContext().SlashCommandParser.commands['echo'].callback({ severity: severity }, message);
}

export function st_getLogprobsNumber(type?: string): number {
  return getLogprobsNumber(type);
}

export function st_replaceMacrosInList(str: string): string {
  return replaceMacrosInList(str);
}

export function st_updateMessageBlock(messageId: number, message: object, { rerenderMessage = true } = {}): void {
  updateMessageBlock(messageId, message, { rerenderMessage });
}

export { name1, name2, chat_completion_sources, textgen_types, amount_gen, max_context };
