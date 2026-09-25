import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../config/constants.js';
import {
  createDynamicEmbed,
  getDynamicEmbedById,
  getAllDynamicEmbeds,
  updateDynamicEmbedHeader,
  updateDynamicEmbedFields,
  updateDynamicEmbedLocation,
  deleteDynamicEmbed
} from '../database/queries/faqQueries.js';
import { logger } from '../utils/logger.js';

export class FAQService {
  /**
   * Build the Discord embed object formatted as clean continuous Markdown
   * (matching the beautiful rules/announcement style with ### headers and bullet points)
   * @param {object} data 
   * @returns {EmbedBuilder}
   */
  static buildEmbed(data) {
    const colorHex = EMBED_COLORS[data.color] || EMBED_COLORS.PRIMARY;
    const embed = new EmbedBuilder()
      .setTitle(data.title)
      .setColor(colorHex);

    const bodyParts = [];

    // 1. Opening description / intro
    if (data.description) {
      bodyParts.push(data.description.replace(/\\n/g, '\n'));
    }

    // 2. Sections / Rules / Items
    const fields = Array.isArray(data.fields) ? data.fields : (typeof data.fields === 'string' ? JSON.parse(data.fields) : []);

    if (fields.length > 0) {
      for (const f of fields) {
        if (f.name && f.value) {
          const sectionTitle = f.name.startsWith('###') || f.name.startsWith('##') || f.name.startsWith('#')
            ? f.name
            : `### ${f.name}`;
          const sectionBody = f.value.replace(/\\n/g, '\n');
          bodyParts.push(`${sectionTitle}\n${sectionBody}`);
        } else if (f.value) {
          bodyParts.push(f.value.replace(/\\n/g, '\n'));
        }
      }
    }

    const fullDescription = bodyParts.join('\n\n');
    if (fullDescription) {
      embed.setDescription(fullDescription);
    }

    return embed;
  }

  /**
   * Refresh and edit the actual message in Discord channel
   * @param {import('discord.js').Client} client 
   * @param {object} embedRecord 
   */
  static async syncDiscordMessage(client, embedRecord) {
    try {
      const channel = client.channels.cache.get(embedRecord.channel_id)
        || await client.channels.fetch(embedRecord.channel_id).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        throw new Error(`Channel <#${embedRecord.channel_id}> not found or inaccessible.`);
      }

      const message = await channel.messages.fetch(embedRecord.message_id).catch(() => null);
      if (!message) {
        throw new Error(`Message ${embedRecord.message_id} in <#${embedRecord.channel_id}> was deleted or not found.`);
      }

      const embed = this.buildEmbed(embedRecord);
      await message.edit({ embeds: [embed] });
      logger.info(`[FAQService] Synchronized dynamic embed "${embedRecord.id}" in <#${embedRecord.channel_id}>.`);
      return true;
    } catch (err) {
      logger.error(`[FAQService Sync Error] ${err.message}`);
      throw err;
    }
  }

  /**
   * Create and post a new dynamic embed
   */
  static async create({ client, id, channel, title, description, color }) {
    const recordData = {
      id,
      channel_id: channel.id,
      message_id: 'pending',
      title,
      description: description || '',
      color: color || 'PRIMARY',
      fields: []
    };

    const embedObj = this.buildEmbed(recordData);
    const sentMessage = await channel.send({ embeds: [embedObj] });

    const record = await createDynamicEmbed({
      id,
      channelId: channel.id,
      messageId: sentMessage.id,
      title,
      description,
      color,
      fields: []
    });

    return record;
  }

  /**
   * Add a new section / rule / question-answer to an existing embed
   */
  static async addSection({ client, id, title, content }) {
    const record = await getDynamicEmbedById(id);
    if (!record) throw new Error(`Dynamic embed with ID "${id}" was not found.`);

    const fields = Array.isArray(record.fields) ? [...record.fields] : JSON.parse(record.fields || '[]');
    fields.push({ name: title, value: content });

    const updated = await updateDynamicEmbedFields(id, fields);
    await this.syncDiscordMessage(client, updated);
    return updated;
  }

  /**
   * Edit an existing section by 1-based index
   */
  static async editSection({ client, id, index, title, content }) {
    const record = await getDynamicEmbedById(id);
    if (!record) throw new Error(`Dynamic embed with ID "${id}" was not found.`);

    const fields = Array.isArray(record.fields) ? [...record.fields] : JSON.parse(record.fields || '[]');
    const targetIdx = index - 1;

    if (targetIdx < 0 || targetIdx >= fields.length) {
      throw new Error(`Invalid index #${index}. Current sections count: ${fields.length}.`);
    }

    if (title) fields[targetIdx].name = title;
    if (content) fields[targetIdx].value = content;

    const updated = await updateDynamicEmbedFields(id, fields);
    await this.syncDiscordMessage(client, updated);
    return updated;
  }

  /**
   * Remove a section by 1-based index
   */
  static async removeSection({ client, id, index }) {
    const record = await getDynamicEmbedById(id);
    if (!record) throw new Error(`Dynamic embed with ID "${id}" was not found.`);

    const fields = Array.isArray(record.fields) ? [...record.fields] : JSON.parse(record.fields || '[]');
    const targetIdx = index - 1;

    if (targetIdx < 0 || targetIdx >= fields.length) {
      throw new Error(`Invalid index #${index}. Current sections count: ${fields.length}.`);
    }

    const removedItem = fields.splice(targetIdx, 1)[0];
    const updated = await updateDynamicEmbedFields(id, fields);
    await this.syncDiscordMessage(client, updated);
    return { updated, removedItem };
  }

  /**
   * Set raw markdown directly as the body
   */
  static async setMarkdown({ client, id, content }) {
    const record = await getDynamicEmbedById(id);
    if (!record) throw new Error(`Dynamic embed with ID "${id}" was not found.`);

    // Clear fields and put everything in description
    await updateDynamicEmbedFields(id, []);
    const updated = await updateDynamicEmbedHeader(id, { description: content });
    await this.syncDiscordMessage(client, updated);
    return updated;
  }

  /**
   * Append markdown to the end of the existing embed
   */
  static async appendMarkdown({ client, id, content }) {
    const record = await getDynamicEmbedById(id);
    if (!record) throw new Error(`Dynamic embed with ID "${id}" was not found.`);

    const fields = Array.isArray(record.fields) ? [...record.fields] : JSON.parse(record.fields || '[]');
    fields.push({ name: '', value: content });

    const updated = await updateDynamicEmbedFields(id, fields);
    await this.syncDiscordMessage(client, updated);
    return updated;
  }

  /**
   * Update header (title, description, color)
   */
  static async updateHeader({ client, id, title, description, color }) {
    const record = await getDynamicEmbedById(id);
    if (!record) throw new Error(`Dynamic embed with ID "${id}" was not found.`);

    const updated = await updateDynamicEmbedHeader(id, { title, description, color });
    await this.syncDiscordMessage(client, updated);
    return updated;
  }

  /**
   * Move an existing dynamic embed to a new channel.
   * Posts to target channel, updates DB location, and optionally deletes the old message.
   * @param {object} param0
   * @param {import('discord.js').Client} param0.client
   * @param {string} param0.id
   * @param {import('discord.js').TextChannel} param0.targetChannel
   * @param {boolean} [param0.deleteOldMessage=true]
   */
  static async move({ client, id, targetChannel, deleteOldMessage = true }) {
    const record = await getDynamicEmbedById(id);
    if (!record) throw new Error(`Dynamic embed with ID "${id}" was not found.`);

    if (record.channel_id === targetChannel.id) {
      throw new Error(`Embed "${id}" is already in <#${targetChannel.id}>.`);
    }

    // 1. Build and post to new channel
    const embedObj = this.buildEmbed(record);
    const sentMessage = await targetChannel.send({ embeds: [embedObj] });

    // 2. Try to delete old message if requested
    const oldChannelId = record.channel_id;
    const oldMessageId = record.message_id;

    if (deleteOldMessage) {
      try {
        const oldChannel = await client.channels.fetch(oldChannelId).catch(() => null);
        if (oldChannel && oldChannel.isTextBased()) {
          const oldMsg = await oldChannel.messages.fetch(oldMessageId).catch(() => null);
          if (oldMsg && oldMsg.deletable) {
            await oldMsg.delete().catch(() => null);
          }
        }
      } catch (err) {
        logger.warn(`[FAQService] Failed to delete old message ${oldMessageId} in channel ${oldChannelId}: ${err.message}`);
      }
    }

    // 3. Update database record location
    const updated = await updateDynamicEmbedLocation(id, targetChannel.id, sentMessage.id);
    logger.info(`[FAQService] Moved dynamic embed "${id}" from <#${oldChannelId}> to <#${targetChannel.id}>.`);
    return { updated, oldChannelId };
  }

  /**
   * Copy/clone an existing dynamic embed to another channel with a new ID.
   * @param {object} param0
   * @param {import('discord.js').Client} param0.client
   * @param {string} param0.sourceId
   * @param {string} param0.newId
   * @param {import('discord.js').TextChannel} param0.targetChannel
   */
  static async copy({ client, sourceId, newId, targetChannel }) {
    const sourceRecord = await getDynamicEmbedById(sourceId);
    if (!sourceRecord) throw new Error(`Dynamic embed with ID "${sourceId}" was not found.`);

    const existingNew = await getDynamicEmbedById(newId);
    if (existingNew) throw new Error(`An embed with ID "${newId}" already exists. Please choose a different ID.`);

    const fields = Array.isArray(sourceRecord.fields)
      ? sourceRecord.fields
      : (typeof sourceRecord.fields === 'string' ? JSON.parse(sourceRecord.fields || '[]') : []);

    const newRecordData = {
      id: newId,
      channel_id: targetChannel.id,
      message_id: 'pending',
      title: sourceRecord.title,
      description: sourceRecord.description,
      color: sourceRecord.color,
      fields
    };

    const embedObj = this.buildEmbed(newRecordData);
    const sentMessage = await targetChannel.send({ embeds: [embedObj] });

    const created = await createDynamicEmbed({
      id: newId,
      channelId: targetChannel.id,
      messageId: sentMessage.id,
      title: sourceRecord.title,
      description: sourceRecord.description,
      color: sourceRecord.color,
      fields
    });

    logger.info(`[FAQService] Copied dynamic embed "${sourceId}" to "${newId}" in <#${targetChannel.id}>.`);
    return created;
  }

  /**
   * Delete a dynamic embed and optionally delete its Discord message.
   * @param {object} param0
   * @param {import('discord.js').Client} param0.client
   * @param {string} param0.id
   * @param {boolean} [param0.deleteDiscordMessage=true]
   */
  static async delete({ client, id, deleteDiscordMessage = true }) {
    const record = await getDynamicEmbedById(id);
    if (!record) throw new Error(`Dynamic embed with ID "${id}" was not found.`);

    if (deleteDiscordMessage) {
      try {
        const channel = await client.channels.fetch(record.channel_id).catch(() => null);
        if (channel && channel.isTextBased()) {
          const msg = await channel.messages.fetch(record.message_id).catch(() => null);
          if (msg && msg.deletable) {
            await msg.delete().catch(() => null);
          }
        }
      } catch (err) {
        logger.warn(`[FAQService] Failed to delete Discord message for embed ${id}: ${err.message}`);
      }
    }

    await deleteDynamicEmbed(id);
    logger.info(`[FAQService] Deleted dynamic embed "${id}".`);
    return record;
  }
}

