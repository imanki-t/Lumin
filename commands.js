import { PermissionFlagsBits, ApplicationCommandOptionType } from 'discord.js';

const commands = [
  {
    name: "settings",
    description: "Configure bot settings and preferences."
  },
  {
    name: "search",
    description: "Search the web or ask AI anything.",
    options: [
      {
        name: "prompt",
        description: "Your search query or question",
        type: ApplicationCommandOptionType.String,
        required: false
      },
      {
        name: "file",
        description: "Attach a file to include in your query",
        type: ApplicationCommandOptionType.Attachment,
        required: false
      }
    ]
  },
  {
    name: "birthday",
    description: "Manage birthday reminders."
  },
  {
    name: "reminder",
    description: "Set personal reminders."
  },
  {
    name: "quote",
    description: "Schedule or receive daily inspirational quotes."
  },
  {
    name: "reaction",
    description: "Toggle random AI reactions to messages in this channel.",
    dm_permission: false,
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString()
  },
  {
    name: "details",
    description: "View server statistics and bot details.",
    dm_permission: false
  },
  {
    name: "digest",
    description: "Get an AI-generated digest of recent server activity.",
    dm_permission: false
  },
  {
    name: "starter",
    description: "Generate a conversation starter."
  },
  {
    name: "compliment",
    description: "Send an anonymous compliment to a server member.",
    dm_permission: false,
    options: [
      {
        name: "user",
        description: "The member to compliment",
        type: ApplicationCommandOptionType.User,
        required: true
      }
    ]
  },
  {
    name: "game",
    description: "Play interactive AI-powered games.",
    dm_permission: false
  },
  {
    name: "timezone",
    description: "Set your timezone for time-based features."
  },
  {
    name: "summary",
    description: "Summarize a conversation, YouTube video, or website.",
    dm_permission: true,
    options: [
      {
        name: "link",
        description: "A Discord message link or YouTube / website URL",
        type: ApplicationCommandOptionType.String,
        required: true
      },
      {
        name: "count",
        description: "Number of messages to summarize (Discord links only)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 1,
        max_value: 100
      }
    ]
  },
  {
    name: "schedule",
    description: "Auto-send revival messages to quiet channels.",
    dm_permission: false,
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      {
        name: "action",
        description: "Action to perform",
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: "Enable",       value: "enable"   },
          { name: "Disable",      value: "disable"  },
          { name: "Set Interval", value: "interval" },
          { name: "Status",       value: "status"   }
        ]
      },
      {
        name: "hours",
        description: "Interval in hours (used with Set Interval)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 1,
        max_value: 168
      }
    ]
  }
];

export { commands };
