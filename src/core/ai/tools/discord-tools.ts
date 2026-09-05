import { ToolContext } from './memory-tools.js';
import { Logger } from '@/core/logger/index.js';
import { guildRepo } from '@/core/database/repositories/index.js';

const logger = Logger.get('DiscordTools');

export async function handleCheckProfile(
  args: { user_id: string },
  context: ToolContext
): Promise<any> {
  if (!context.client) return { error: 'Client unavailable' };
  try {
    const user = await context.client.users.fetch(args.user_id).catch(() => null);
    if (!user) return { error: 'User not found' };

    let memberInfo = null;
    if (context.guildId) {
      const guild = context.client.guilds.cache.get(context.guildId);
      const member = await guild?.members.fetch(args.user_id).catch(() => null);
      if (member) {
        memberInfo = {
          nickname: member.nickname,
          joinedAt: member.joinedAt?.toISOString(),
          roles: member.roles.cache.map((r: any) => r.name).filter((n: string) => n !== '@everyone'),
          status: member.presence?.status || 'offline',
          activities: member.presence?.activities?.map((a: any) => `${a.type}: ${a.name}`) || []
        };
      }
    }

    return {
      username: user.username,
      displayName: user.displayName || user.username,
      id: user.id,
      bot: user.bot,
      createdAt: user.createdAt.toISOString(),
      avatarUrl: user.displayAvatarURL({ size: 256 }),
      guildMember: memberInfo
    };
  } catch (err: any) {
    logger.error('Error in handleCheckProfile', err);
    return { error: 'Failed to inspect profile' };
  }
}

export async function handleCreatePoll(
  args: { question: string; answers: string; duration_hours?: number; allow_multiselect?: boolean },
  context: ToolContext
): Promise<{ status: string; message: string }> {
  if (!context.client || !context.channelId) {
    return { status: 'error', message: 'Channel context unavailable' };
  }

  try {
    const channel = await context.client.channels.fetch(context.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return { status: 'error', message: 'Cannot create poll in this channel' };
    }

    const answerOptions = args.answers
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 10);

    if (answerOptions.length < 2) {
      return { status: 'error', message: 'Poll requires at least 2 answers' };
    }

    await channel.send({
      poll: {
        question: { text: args.question.slice(0, 300) },
        answers: answerOptions.map((text) => ({ text: text.slice(0, 55) })),
        allowMultiselect: !!args.allow_multiselect,
        duration: Math.min(Math.max(args.duration_hours || 24, 1), 168)
      }
    });

    return { status: 'success', message: 'Poll successfully created' };
  } catch (err: any) {
    logger.error('Error creating poll', err);
    return { status: 'error', message: 'Failed to create Discord poll' };
  }
}

export async function handleSendDM(
  args: { user_id: string; content: string },
  context: ToolContext
): Promise<{ status: string; message: string }> {
  if (!context.client) return { status: 'error', message: 'Client unavailable' };
  try {
    const user = await context.client.users.fetch(args.user_id).catch(() => null);
    if (!user) return { status: 'error', message: 'Target user not found' };

    await user.send(args.content);
    return { status: 'success', message: `DM sent to ${user.username}` };
  } catch (err: any) {
    logger.warn('Failed to send DM', err?.message);
    return { status: 'error', message: 'Cannot DM this user (DMs may be closed)' };
  }
}

export async function handleSendServerMessage(
  args: { guild_name?: string; channel_name?: string; content: string },
  context: ToolContext
): Promise<{ status: string; message: string }> {
  if (!context.client) return { status: 'error', message: 'Client unavailable' };

  try {
    for (const [, guild] of context.client.guilds.cache) {
      const gSettings = await guildRepo.getSettings(guild.id);
      if (gSettings.allowedChannels.length > 0) {
        const targetChannel = guild.channels.cache.find(
          (ch: any) =>
            gSettings.allowedChannels.includes(ch.id) &&
            (!args.channel_name || ch.name.toLowerCase().includes(args.channel_name.toLowerCase()))
        );
        if (targetChannel && targetChannel.isTextBased()) {
          await targetChannel.send(args.content);
          return { status: 'success', message: `Message relayed to #${targetChannel.name} in ${guild.name}` };
        }
      }
    }
    return { status: 'error', message: 'No matching configured channel found to relay message' };
  } catch (err: any) {
    logger.error('Error sending server message', err);
    return { status: 'error', message: 'Failed to send message to server' };
  }
}

export async function handleAddReaction(
  args: { emoji: string; message_id?: string },
  context: ToolContext
): Promise<{ status: string }> {
  if (!context.client || !context.channelId) return { status: 'error' };
  try {
    const channel = await context.client.channels.fetch(context.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return { status: 'error' };

    const targetMsgId = args.message_id || context.messageId;
    if (!targetMsgId) return { status: 'error' };

    const msg = await channel.messages.fetch(targetMsgId).catch(() => null);
    if (msg) {
      await msg.react(args.emoji);
      return { status: 'success' };
    }
    return { status: 'not_found' };
  } catch (err: any) {
    logger.warn('Failed to add reaction', err?.message);
    return { status: 'error' };
  }
}
