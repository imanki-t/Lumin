import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { Command } from './types.js';
import { reminderRepo } from '@/core/database/repositories/index.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';
import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';

export const reminderCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('Manage automated reminders')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Create a new reminder')
        .addStringOption((opt) =>
          opt.setName('time').setDescription('When to remind you (e.g. "in 30 mins", "tomorrow at 4pm", "2 hours")').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('message').setDescription('What to remind you about').setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('recurring')
            .setDescription('Repeat interval')
            .addChoices(
              { name: 'None (One-time)', value: 'none' },
              { name: 'Daily', value: 'daily' },
              { name: 'Weekly', value: 'weekly' },
              { name: 'Monthly', value: 'monthly' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('View your active reminders')
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete a reminder by ID')
        .addStringOption((opt) => opt.setName('id').setDescription('Reminder ID').setRequired(true))
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      await interaction.deferReply({ ephemeral: true });

      const timeInput = interaction.options.getString('time', true);
      const message = interaction.options.getString('message', true);
      const recurring = (interaction.options.getString('recurring') as any) || 'none';

      // Parse relative time or use Flash-Lite ISO extractor
      let dueAt = parseSimpleDuration(timeInput);

      if (!dueAt) {
        const router = AIRouter.get();
        const nowIso = new Date().toISOString();
        const prompt = `Current UTC datetime: "${nowIso}".
Given time expression: "${timeInput}".
Extract target datetime in ISO 8601 UTC format. Return ONLY the ISO string, nothing else.`;

        try {
          const res = await router.generateContent([{ role: 'user', parts: [{ text: prompt }] }], {
            model: AI_MODELS.FLASH_LITE,
            temperature: 0.1
          });
          const parsedIso = res.text.trim();
          const d = new Date(parsedIso);
          if (!isNaN(d.getTime()) && d.getTime() > Date.now()) {
            dueAt = d;
          }
        } catch {
          // Fallback
        }
      }

      if (!dueAt || dueAt.getTime() <= Date.now()) {
        await interaction.editReply({
          embeds: [LuminEmbedBuilder.error('Could not understand or schedule that time in the future. Try "in 15m", "2 hours", "tomorrow".')]
        });
        return;
      }

      const created = await reminderRepo.createReminder({
        userId: interaction.user.id,
        guildId: interaction.guildId || undefined,
        channelId: interaction.channelId,
        message,
        remindAt: dueAt
      });

      const discordTimestamp = Math.floor(dueAt.getTime() / 1000);
      await interaction.editReply({
        embeds: [
          LuminEmbedBuilder.success(
            `Reminder scheduled for <t:${discordTimestamp}:F> (<t:${discordTimestamp}:R>).\n` +
              `• **Message**: ${message}\n` +
              `• **Recurring**: \`${recurring}\`\n` +
              `• **ID**: \`${created.id}\``,
            'Reminder Set'
          )
        ]
      });
      return;
    }

    if (sub === 'list') {
      await interaction.deferReply({ ephemeral: true });
      const reminders = await reminderRepo.getUserReminders(interaction.user.id);

      if (reminders.length === 0) {
        await interaction.editReply({
          embeds: [LuminEmbedBuilder.info('You have no active reminders scheduled.')]
        });
        return;
      }

      const items = reminders.map((r, i) => {
        const ts = Math.floor(new Date(r.remindAt).getTime() / 1000);
        return `**${i + 1}.** ${r.message}\nDue: <t:${ts}:R> | ID: \`${r.id}\``;
      });

      await interaction.editReply({
        embeds: [
          LuminEmbedBuilder.brand({
            title: '⏰ Your Active Reminders',
            description: items.join('\n\n'),
            user: interaction.user
          })
        ]
      });
      return;
    }

    if (sub === 'delete') {
      const id = interaction.options.getString('id', true);
      const deleted = await reminderRepo.deleteReminder(id, interaction.user.id);
      if (deleted) {
        await interaction.reply({
          embeds: [LuminEmbedBuilder.success(`Reminder \`${id}\` has been deleted.`)],
          ephemeral: true
        });
      } else {
        await interaction.reply({
          embeds: [LuminEmbedBuilder.error(`Reminder \`${id}\` not found or not owned by you.`)],
          ephemeral: true
        });
      }
    }
  }
};

function parseSimpleDuration(input: string): Date | null {
  const match = input.trim().match(/^(?:in\s+)?(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours|d|day|days)$/i);
  if (!match) return null;

  const amount = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const now = Date.now();

  if (unit.startsWith('m')) return new Date(now + amount * 60 * 1000);
  if (unit.startsWith('h')) return new Date(now + amount * 3600 * 1000);
  if (unit.startsWith('d')) return new Date(now + amount * 86400 * 1000);
  return null;
}
