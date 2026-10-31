import faqCmd from './faq.js';

/**
 * /embed command
 * Alias and modern companion to /faq, sharing identical live dynamic embed capabilities.
 */
const embedData = {
  ...faqCmd.data.toJSON(),
  name: 'embed',
  description: '[Staff] Kelola Live Dynamic Embed / FAQ / Rules dengan sinkronisasi langsung',
  toJSON() {
    return this;
  }
};

export default {
  data: embedData,
  execute: faqCmd.execute
};
