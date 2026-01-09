import { Type } from '@google/genai';

export const TOOLS_DECLARATION = [
  {
    functionDeclarations: [
      {
        name: 'set_birthday',
        description: 'Set a birthday reminder for the user or their friend. Extracts month, day, and name.',
        parameters: {
          type: 'OBJECT',
          properties: {
            month: {
              type: 'STRING',
              description: 'Month number (01-12)',
            },
            day: {
              type: 'STRING',
              description: 'Day of the month (01-31)',
            },
            nameType: {
              type: 'STRING',
              description: 'Who is this for? "self" for the user, "other" for someone else.',
              enum: ['self', 'other']
            },
            name: {
              type: 'STRING',
              description: 'Name of the person if nameType is "other". Optional.'
            }
          },
          required: ['month', 'day', 'nameType']
        }
      },
      {
        name: 'set_timezone',
        description: 'Set the user\'s timezone for accurate reminders and scheduling.',
        parameters: {
          type: 'OBJECT',
          properties: {
            timezone: {
              type: 'STRING',
              description: 'IANA Timezone ID (e.g., "America/New_York", "Asia/Tokyo", "UTC").'
            }
          },
          required: ['timezone']
        }
      },
      {
        name: 'add_personal_memory',
        description: 'Save a specific detail, preference, or fact about the user to their long-term personal context.',
        parameters: {
          type: 'OBJECT',
          properties: {
            text: {
              type: 'STRING',
              description: 'The fact or memory to store (e.g., "I love strawberry ice cream", "My dog\'s name is Rex").'
            }
          },
          required: ['text']
        }
      },
      {
        name: 'search_memory',
        description: 'Explicitly search the user\'s conversation history or long-term memory for specific information.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: {
              type: 'STRING',
              description: 'The search query to find relevant memories.'
            }
          },
          required: ['query']
        }
      }
    ]
  }
];
