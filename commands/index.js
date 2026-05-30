/**
 * @fileoverview Commands router — aggregates all command/interaction handlers and
 *               exposes a clean interface to root index.js.
 *               No business logic lives here; this is pure routing.
 * @module commands/index
 */

// ─── Birthday ────────────────────────────────────────────────────────────────
import {
  birthdayCommand,
  handleBirthdayCommand,
  handleBirthdayActionButton,
  handleBirthdayMonthSelect,
  handleBirthdayDaySelect,
  handleBirthdayNameSelect,
  handleBirthdayPrefSelect,
  handleBirthdayDeleteSelect,
  handleBirthdayListPrev,
  handleBirthdayListNext,
  handleBirthdayListJump
} from './birthday/BirthdayHandler.js';

import { scheduleBirthdayChecks } from './birthday/BirthdayScheduler.js';

// ─── Reminder ────────────────────────────────────────────────────────────────
import {
  reminderCommand,
  handleReminderCommand,
  handleReminderActionSelect,
  handleReminderTypeSelect,
  handleReminderModal,
  handleReminderLocationSelect,
  handleReminderDeleteSelect,
  handleReminderDeleteButton
} from './reminder/ReminderHandler.js';

import { initializeReminders } from './reminder/ReminderScheduler.js';

// ─── Quote ───────────────────────────────────────────────────────────────────
import {
  quoteCommand,
  handleQuoteCommand,
  handleQuoteActionSelect,
  handleQuoteCategorySelect,
  handleQuoteTimeSelect,
  handleQuoteLocationSelect,
  handleQuoteChannelSelect,
  handleQuoteRemoveSelect
} from './quote/QuoteHandler.js';

import { initializeDailyQuotes } from './quote/QuoteScheduler.js';

// ─── Fun ─────────────────────────────────────────────────────────────────────
import {
  reactionCommand,
  handleReactionCommand,
  handleReactionActionSelect,
  handleReactionRaritySelect,
  checkReaction
} from './fun/RouletteHandler.js';

import {
  anniversaryCommand,
  handleAnniversaryCommand
} from './fun/AnniversaryHandler.js'; // command name is 'details'

import {
  digestCommand,
  handleDigestCommand
} from './fun/DigestHandler.js';

import {
  starterCommand,
  handleStarterCommand
} from './fun/StarterHandler.js';

import {
  complimentCommand,
  handleComplimentCommand
} from './fun/ComplimentHandler.js';

// ─── Game ────────────────────────────────────────────────────────────────────
import {
  gameCommand,
  handleGameCommand,
  handleGameSelect
} from './game/GameRouter.js';

import {
  handleTDS,
  handleTDSChoice,
  handleTDSAgain
} from './game/TruthDareSnap.js';

import { handleNHIENext }  from './game/NeverHaveIEver.js';
import { handleWYRNext }   from './game/WouldYouRather.js';

import {
  handleAkinatorAnswer,
  handleAkinatorResult,
  handleAkinatorAgain,
  handleAkinatorModeSelect
} from './game/Akinator.js';

// ─── Timezone ────────────────────────────────────────────────────────────────
import {
  timezoneCommand,
  handleTimezoneCommand,
  handleTimezoneSelect,
  handleTimezoneNextPage,
  handleTimezonePrevPage,
  handleTimezoneCustomButton,
  handleTimezoneCustomModal
} from './timezone.js';

// ─── Summary ─────────────────────────────────────────────────────────────────
import {
  summaryCommand,
  handleSummaryCommand
} from './summary/SummaryHandler.js';

// ─── Search ──────────────────────────────────────────────────────────────────
import {
  handleSearchCommand
} from './search.js';

// ─── Schedule (chat revival) ──────────────────────────────────────────────────
import {
  reviveCommand,
  handleReviveCommand,
  startReviveLoop
} from './realive.js';

// ============================================================================
// SCHEDULED TASKS — called once on startup from root index.js
// ============================================================================

/**
 * Initialise all background schedulers.
 * @param {import('discord.js').Client} client
 */
export function initializeScheduledTasks(client) {
  scheduleBirthdayChecks(client);
  initializeReminders(client);
  initializeDailyQuotes(client);
  startReviveLoop(client);
}

// ============================================================================
// SLASH COMMAND DISPATCH
// ============================================================================

const COMMAND_HANDLERS = {
  birthday:    handleBirthdayCommand,
  reminder:    handleReminderCommand,
  quote:       handleQuoteCommand,
  reaction:    handleReactionCommand,
  details:     handleAnniversaryCommand,
  digest:      handleDigestCommand,
  starter:     handleStarterCommand,
  compliment:  handleComplimentCommand,
  game:        handleGameCommand,
  timezone:    handleTimezoneCommand,
  summary:     handleSummaryCommand,
  search:      handleSearchCommand,
  schedule:    handleReviveCommand
};

/**
 * Route a slash command interaction to the correct handler.
 * @param {import('discord.js').CommandInteraction} interaction
 */
export async function handleCommandInteraction(interaction) {
  const handler = COMMAND_HANDLERS[interaction.commandName];
  if (handler) await handler(interaction);
}

// ============================================================================
// SELECT MENU DISPATCH
// ============================================================================

/**
 * Prefix-matched lookup table for select menu customIds.
 * Evaluated in order — more-specific prefixes should come first.
 */
const SELECT_MENU_HANDLERS = [
  ['birthday_month',         handleBirthdayMonthSelect],
  ['birthday_day_',          handleBirthdayDaySelect],
  ['birthday_name_',         handleBirthdayNameSelect],
  ['birthday_pref_',         handleBirthdayPrefSelect],
  ['birthday_delete_select', handleBirthdayDeleteSelect],
  ['birthday_list_jump_',    handleBirthdayListJump],
  ['reminder_action',        handleReminderActionSelect],
  ['reminder_type',          handleReminderTypeSelect],
  ['reminder_location_',     handleReminderLocationSelect],
  ['reminder_delete_select', handleReminderDeleteSelect],
  ['quote_action',           handleQuoteActionSelect],
  ['quote_category',         handleQuoteCategorySelect],
  ['quote_time_',            handleQuoteTimeSelect],
  ['quote_location_',        handleQuoteLocationSelect],
  ['quote_channel_',         handleQuoteChannelSelect],
  ['quote_remove_select',    handleQuoteRemoveSelect],
  ['reaction_action',        handleReactionActionSelect],
  ['reaction_rarity',        handleReactionRaritySelect],
  ['game_select',            handleGameSelect],
  ['tds_choice',             handleTDSChoice],
  ['akinator_mode',          handleAkinatorModeSelect],
  ['timezone_region',        handleTimezoneSelect],
  ['timezone_select',        handleTimezoneSelect]
];

/**
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @returns {Promise<boolean>}  True if a handler was found.
 */
export async function handleSelectMenuInteraction(interaction) {
  for (const [prefix, handler] of SELECT_MENU_HANDLERS) {
    if (interaction.customId.startsWith(prefix)) {
      await handler(interaction);
      return true;
    }
  }
  return false;
}

// ============================================================================
// MODAL DISPATCH
// ============================================================================

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @returns {Promise<boolean>}
 */
export async function handleModalSubmission(interaction) {
  if (interaction.customId.startsWith('reminder_modal_')) {
    await handleReminderModal(interaction);
    return true;
  }
  if (interaction.customId === 'timezone_modal') {
    await handleTimezoneCustomModal(interaction);
    return true;
  }
  return false;
}

// ============================================================================
// BUTTON DISPATCH
// ============================================================================

const BUTTON_HANDLERS = [
  ['birthday_action_',     handleBirthdayActionButton],  // action picker: set / remove / list
  ['birthday_list_prev_',  handleBirthdayListPrev],
  ['birthday_list_next_',  handleBirthdayListNext],
  ['akinator_yes_',        handleAkinatorAnswer],
  ['akinator_no_',         handleAkinatorAnswer],
  ['akinator_dk_',         handleAkinatorAnswer],
  ['akinator_prob_',       handleAkinatorAnswer],
  ['akinator_pn_',         handleAkinatorAnswer],
  ['akinator_correct_',    handleAkinatorResult],
  ['akinator_wrong_',      handleAkinatorResult],
  ['akinator_again',       handleAkinatorAgain],
  ['tds_again',            handleTDSAgain],
  ['nhie_next',            handleNHIENext],
  ['wyr_next',             handleWYRNext],
  ['timezone_next_page',   handleTimezoneNextPage],
  ['timezone_prev_page',   handleTimezonePrevPage],
  ['timezone_custom',      handleTimezoneCustomButton],
  ['reminder_action_delete', handleReminderDeleteButton]  // "Delete Reminders" on limit screen
];

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>}
 */
export async function handleButtonInteraction(interaction) {
  for (const [prefix, handler] of BUTTON_HANDLERS) {
    if (interaction.customId.startsWith(prefix)) {
      await handler(interaction);
      return true;
    }
  }
  return false;
}

// ============================================================================
// MESSAGE EVENT HELPERS
// ============================================================================

/**
 * Proxy for the reaction passive message checker.
 * Called from the root messageCreate event handler.
 * @param {import('discord.js').Message} message
 */
export function processMessageRoulette(message) {
  checkReaction(message);
}

// ============================================================================
// RE-EXPORTS — command definitions for slash command registration
// ============================================================================

export {
  birthdayCommand,
  reminderCommand,
  quoteCommand,
  reactionCommand,
  anniversaryCommand,
  digestCommand,
  starterCommand,
  complimentCommand,
  gameCommand,
  timezoneCommand,
  summaryCommand,
  reviveCommand
};
