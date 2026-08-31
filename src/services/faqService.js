import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../config/constants.js';
import {
  createDynamicEmbed,
  getDynamicEmbedById,
  getAllDynamicEmbeds,
  updateDynamicEmbedHeader,
  updateDynamicEmbedFields,
  deleteDynamicEmbed
} from '../database/queries/faqQueries.js';
import { logger } from '../utils/logger.js';

export class FAQService {
  /**
   * Build the Discord embed object from DB record
   * @param {object} data 
   * @returns {EmbedBuilder}
   */
  static buildEmbed(data) {
    const colorHex = EMBED_COLORS[data.color] || EMBED_COLORS.PRIMARY;
    const embed = new EmbedBuilder()
      .setTitle(data.title)
      .setColor(colorHex)
      .setFooter({ text: `ID: ${data.id} • Last Updated` })
      .setTimestamp(new Date(data.updated_at || Date.now()));

    if (data.description) {
      embed.setDescription(data.description.replace(/\\n/g, '\n'));
    }

    const fields = Array.isArray(data.fields) ? data.fields : (typeof data.fields === 'string' ? JSON.parse(data.fields) : []);

    if (fields.length > 0) {
      for (const f of fields) {
        embed.addFields({
          name: f.name,
          value: f.value.replace(/\\n/g, '\n'),
          inline: f.inline || false
        });
      }
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
      const channel = await client.channels.fetch(embedRecord.channel_id).catch(() => null);
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
    const embedObj = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description ? description.replace(/\\n/g, '\n') : null)
      .setColor(EMBED_COLORS[color] || EMBED_COLORS.PRIMARY)
      .setFooter({ text: `ID: ${id} • Created` })
      .setTimestamp();

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
   * Add a new item / question-answer to an existing embed
   */
  static async addItem({ client, id, name, value, inline = false }) {
    const record = await getDynamicEmbedById(id);
    if (!record) throw new Error(`Dynamic embed with ID "${id}" was not found.`);

    const fields = Array.isArray(record.fields) ? [...record.fields] : JSON.parse(record.fields || '[]');
    fields.push({ name, value, inline });

    const updated = await updateDynamicEmbedFields(id, fields);
    await this.syncDiscordMessage(client, updated);
    return updated;
  }

  /**
   * Edit an existing item / question-answer by 1-based index
   */
  static async editItem({ client, id, index, name, value, inline }) {
    const record = await getDynamicEmbedById(id);
    if (!record) throw new Error(`Dynamic embed with ID "${id}" was not found.`);

    const fields = Array.isArray(record.fields) ? [...record.fields] : JSON.parse(record.fields || '[]');
    const targetIdx = index - 1; // 1-based to 0-based

    if (targetIdx < 0 || targetIdx >= fields.length) {
      throw new Error(`Invalid index #${index}. Current items count: ${fields.length}.`);
    }

    if (name) fields[targetIdx].name = name;
    if (value) fields[targetIdx].value = value;
    if (inline !== undefined && inline !== null) fields[targetIdx].inline = inline;

    const updated = await updateDynamicEmbedFields(id, fields);
    await this.syncDiscordMessage(client, updated);
    return updated;
  }

  /**
   * Remove an item by 1-based index
   */
  static async removeItem({ client, id, index }) {
    const record = await getDynamicEmbedById(id);
    if (!record) throw new Error(`Dynamic embed with ID "${id}" was not found.`);

    const fields = Array.isArray(record.fields) ? [...record.fields] : JSON.parse(record.fields || '[]');
    const targetIdx = index - 1;

    if (targetIdx < 0 || targetIdx >= fields.length) {
      throw new Error(`Invalid index #${index}. Current items count: ${fields.length}.`);
    }

    const removedItem = fields.splice(targetIdx, 1)[0];
    const updated = await updateDynamicEmbedFields(id, fields);
    await this.syncDiscordMessage(client, updated);
    return { updated, removedItem };
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
}
