import { Agent } from 'undici';
import { getAllChallenges } from '../database/queries/challengeQueries.js';
import { logger } from '../utils/logger.js';

// Custom dispatcher to handle environments with local SSL certificate inspection
const sslSafeDispatcher = new Agent({
  connect: {
    rejectUnauthorized: false
  }
});

export class NasaValidationService {
  /**
   * Validate a team URL from spaceappschallenge.org
   * 
   * @param {string} url - The team profile URL
   * @returns {Promise<{
   *   valid: boolean,
   *   error?: string,
   *   warning?: string,
   *   inputUrl?: string,
   *   isJember?: boolean,
   *   extractedTitle?: string,
   *   challengeId?: number|null,
   *   challengeTitle?: string|null
   * }>}
   */
  static async validateTeamUrl(url) {
    if (!url || typeof url !== 'string') {
      return { valid: false, inputUrl: url || '', error: 'Tautan URL tidak boleh kosong.' };
    }

    const trimmedUrl = url.trim();

    // 1. Syntactic & Domain Validation
    let parsedUrl;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      return { valid: false, inputUrl: trimmedUrl, error: 'Format URL tidak valid (harus diawali http:// atau https://).' };
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname !== 'spaceappschallenge.org' && !hostname.endsWith('.spaceappschallenge.org')) {
      return {
        valid: false,
        inputUrl: trimmedUrl,
        error: 'Tautan harus mengarah ke situs resmi NASA Space Apps Challenge (**spaceappschallenge.org**).'
      };
    }

    // 2. Fetch HTML from NASA website
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

      const response = await fetch(trimmedUrl, {
        method: 'GET',
        dispatcher: sslSafeDispatcher,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.status === 404) {
        return {
          valid: false,
          inputUrl: trimmedUrl,
          error: 'Halaman tim tidak ditemukan di web NASA Space Apps (Status 404). Pastikan tim sudah dibuat dan link disalin dengan benar.'
        };
      }

      if (!response.ok) {
        return {
          valid: false,
          inputUrl: trimmedUrl,
          error: `Situs web NASA merespons dengan status HTTP ${response.status}. Mohon coba lagi beberapa saat.`
        };
      }

      const html = await response.text();
      const lowerHtml = html.toLowerCase();

      // 3. Location Verification (Jember Check)
      const hasJember = lowerHtml.includes('jember');
      if (!hasJember) {
        return {
          valid: false,
          inputUrl: trimmedUrl,
          error: 'Tautan tim ditemukan di situs NASA, namun tidak terafiliasi dengan lokasi **Jember** (Pastikan tim Anda terdaftar di event lokal Jember).'
        };
      }

      // 4. Extract Page Title / Team Name
      let extractedTitle = null;
      const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
      if (ogTitleMatch && ogTitleMatch[1]) {
        extractedTitle = ogTitleMatch[1].trim();
      } else {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          extractedTitle = titleMatch[1].split('|')[0].trim();
        }
      }

      // 5. Detect Challenge from Database if matching
      let challengeId = null;
      let challengeTitle = null;

      try {
        const dbChallenges = await getAllChallenges();
        if (dbChallenges && dbChallenges.length > 0) {
          for (const ch of dbChallenges) {
            const chTitleLower = ch.title.toLowerCase();
            if (chTitleLower.length > 4 && lowerHtml.includes(chTitleLower)) {
              challengeId = ch.id;
              challengeTitle = ch.title;
              break;
            }
          }
        }
      } catch (dbErr) {
        logger.warn(`[NasaValidation] Could not match challenges from DB: ${dbErr.message}`);
      }

      return {
        valid: true,
        inputUrl: trimmedUrl,
        isJember: true,
        extractedTitle,
        challengeId,
        challengeTitle,
        url: trimmedUrl
      };
    } catch (err) {
      logger.error(`[NasaValidation] Fetch failed: ${err.message}`);
      if (err.name === 'AbortError') {
        return {
          valid: false,
          inputUrl: trimmedUrl,
          error: 'Koneksi ke server web NASA Space Apps mengalami batas waktu (Timeout). Mohon periksa kembali link atau coba lagi sesaat lagi.'
        };
      }

      return {
        valid: false,
        inputUrl: trimmedUrl,
        error: `Gagal melakukan verifikasi ke situs NASA: ${err.message}`
      };
    }
  }
}
