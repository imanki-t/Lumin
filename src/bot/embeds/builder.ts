import { EmbedBuilder, User, ColorResolvable } from 'discord.js';

export const THEME_COLORS = {
  PRIMARY: 0x5865f2,
  SUCCESS: 0x57f287,
  WARNING: 0xfee75c,
  DANGER: 0xed4245,
  INFO: 0x5865f2,
  DARK: 0x2b2d31
} as const;

export class LuminEmbedBuilder {
  /**
   * Creates a standard brand embed for Lumin replies
   */
  public static brand(options?: {
    title?: string;
    description?: string;
    user?: User;
    color?: ColorResolvable;
  }): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(options?.color || THEME_COLORS.PRIMARY)
      .setTimestamp();

    if (options?.title) {
      embed.setTitle(options.title);
    }

    if (options?.description) {
      embed.setDescription(options.description);
    }

    if (options?.user) {
      embed.setFooter({
        text: `Requested by ${options.user.username}`,
        iconURL: options.user.displayAvatarURL()
      });
    } else {
      embed.setFooter({ text: 'Lumin AI • Next-Gen Server Companion' });
    }

    return embed;
  }

  /**
   * Creates a success embed
   */
  public static success(message: string, title: string = 'Success'): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(THEME_COLORS.SUCCESS)
      .setTitle(`✅ ${title}`)
      .setDescription(message)
      .setTimestamp();
  }

  /**
   * Creates an error / failure embed
   */
  public static error(message: string, title: string = 'Error'): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(THEME_COLORS.DANGER)
      .setTitle(`❌ ${title}`)
      .setDescription(message)
      .setTimestamp();
  }

  /**
   * Creates an informational alert embed
   */
  public static info(message: string, title: string = 'Information'): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(THEME_COLORS.INFO)
      .setTitle(`ℹ️ ${title}`)
      .setDescription(message)
      .setTimestamp();
  }

  /**
   * Creates a warning embed
   */
  public static warning(message: string, title: string = 'Warning'): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(THEME_COLORS.WARNING)
      .setTitle(`⚠️ ${title}`)
      .setDescription(message)
      .setTimestamp();
  }

  /**
   * Formats a paginated search or list embed
   */
  public static paged(options: {
    title: string;
    items: string[];
    currentPage: number;
    totalPages: number;
    footerPrefix?: string;
  }): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(THEME_COLORS.PRIMARY)
      .setTitle(options.title)
      .setDescription(options.items.join('\n\n') || 'No items to display.')
      .setFooter({
        text: `${options.footerPrefix ? options.footerPrefix + ' • ' : ''}Page ${options.currentPage} of ${options.totalPages}`
      })
      .setTimestamp();
  }
}
