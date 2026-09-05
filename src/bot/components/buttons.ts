import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';

export class LuminButtons {
  /**
   * Quick action buttons displayed below bot AI responses (if enabled in user/server settings)
   */
  public static responseActions(contextId: string, userId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`act:retry:${contextId}:${userId}`)
        .setLabel('Retry')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄'),
      new ButtonBuilder()
        .setCustomId(`act:clear:${contextId}:${userId}`)
        .setLabel('Clear Context')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🧹'),
      new ButtonBuilder()
        .setCustomId(`act:settings:${userId}`)
        .setLabel('Settings')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⚙️')
    );
  }

  /**
   * Navigation pagination row
   */
  public static pagination(options: {
    prefix: string;
    currentPage: number;
    totalPages: number;
    userId: string;
  }): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`page:${options.prefix}:first:${options.userId}`)
        .setEmoji('⏮️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(options.currentPage <= 1),
      new ButtonBuilder()
        .setCustomId(`page:${options.prefix}:prev:${options.currentPage - 1}:${options.userId}`)
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(options.currentPage <= 1),
      new ButtonBuilder()
        .setCustomId(`page:${options.prefix}:noop`)
        .setLabel(`${options.currentPage} / ${options.totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`page:${options.prefix}:next:${options.currentPage + 1}:${options.userId}`)
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(options.currentPage >= options.totalPages),
      new ButtonBuilder()
        .setCustomId(`page:${options.prefix}:last:${options.totalPages}:${options.userId}`)
        .setEmoji('⏭️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(options.currentPage >= options.totalPages)
    );
  }

  /**
   * Generic confirm/cancel buttons
   */
  public static confirmation(options: {
    actionId: string;
    userId: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cnf:yes:${options.actionId}:${options.userId}`)
        .setLabel(options.confirmLabel || 'Confirm')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`cnf:no:${options.actionId}:${options.userId}`)
        .setLabel(options.cancelLabel || 'Cancel')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
    );
  }

  /**
   * Akinator 5-choice answer row
   */
  public static akinatorChoices(gameId: string, userId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`aki:${gameId}:yes:${userId}`)
        .setLabel('Yes')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`aki:${gameId}:probably:${userId}`)
        .setLabel('Probably')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`aki:${gameId}:dontknow:${userId}`)
        .setLabel("Don't Know")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`aki:${gameId}:probablynot:${userId}`)
        .setLabel('Probably Not')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`aki:${gameId}:no:${userId}`)
        .setLabel('No')
        .setStyle(ButtonStyle.Danger)
    );
  }

  /**
   * Would You Rather option buttons
   */
  public static wouldYouRather(gameId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`wyr:${gameId}:opt_a`)
        .setLabel('Option A')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🅰️'),
      new ButtonBuilder()
        .setCustomId(`wyr:${gameId}:opt_b`)
        .setLabel('Option B')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🅱️'),
      new ButtonBuilder()
        .setCustomId(`wyr:${gameId}:next`)
        .setLabel('Next Dilemma')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏭️')
    );
  }
}
