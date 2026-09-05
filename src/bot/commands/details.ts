import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { Command } from './types.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';
import { AI_MODELS } from '@/config/constants.js';

export const detailsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('details')
    .setDescription('View server join anniversary, bot uptime, telemetry, and system stats'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const client = interaction.client;
    const guild = interaction.guild;
    const uptimeSec = Math.floor(process.uptime());
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);

    const memUsage = process.memoryUsage();
    const rssMb = (memUsage.rss / 1024 / 1024).toFixed(1);
    const heapMb = (memUsage.heapUsed / 1024 / 1024).toFixed(1);

    const botMember = guild ? await guild.members.fetch(client.user.id).catch(() => null) : null;
    const joinedAtTs = botMember?.joinedTimestamp ? Math.floor(botMember.joinedTimestamp / 1000) : null;
    const guildCreatedTs = guild ? Math.floor(guild.createdTimestamp / 1000) : null;

    const embed = LuminEmbedBuilder.brand({
      title: '⚡ Lumin AI Bot Telemetry & Status',
      description:
        `**Next-Generation Multi-Model Server Companion**\n` +
        `• **Version**: \`v4.0.0 (Zero-Legacy Rebuild)\`\n` +
        `• **Gateway Ping**: \`${client.ws.ping}ms\`\n` +
        `• **Uptime**: \`${days}d ${hours}h ${minutes}m\`\n` +
        `• **Memory RSS / Heap**: \`${rssMb} MB / ${heapMb} MB\`\n` +
        `• **Guilds Serving**: \`${client.guilds.cache.size.toLocaleString()}\`\n` +
        `• **Cached Users**: \`${client.users.cache.size.toLocaleString()}\`\n\n` +
        `### 🤖 Active AI Stack\n` +
        `• **Primary Engine**: \`${AI_MODELS.FLASH}\` (Streaming Dialogue)\n` +
        `• **Ultra-Fast Utility**: \`${AI_MODELS.FLASH_LITE}\` (Routing & Tools)\n` +
        `• **Local / Reasoning**: \`${AI_MODELS.GEMMA_9B}\` & \`${AI_MODELS.GEMMA_27B}\`\n` +
        `• **Document Embeddings**: \`${AI_MODELS.EMBEDDING}\`\n\n` +
        (guild
          ? `### 🏰 Server Information\n` +
            `• **Server Created**: <t:${guildCreatedTs}:D> (<t:${guildCreatedTs}:R>)\n` +
            `• **Lumin Joined**: ${joinedAtTs ? `<t:${joinedAtTs}:D> (<t:${joinedAtTs}:R>)` : 'N/A'}`
          : '')
    });

    await interaction.reply({ embeds: [embed] });
  }
};
