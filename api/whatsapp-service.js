/**
 * ==============================================================================
 * WhatsApp Business Cloud API (Meta) & Media Messaging Service
 * ==============================================================================
 * 
 * This service handles sending WhatsApp messages with images, flyers, and templates.
 * 
 * --- 🔑 REQUIRED API KEYS, NAMES & CREDENTIALS ---
 * 
 * 1. WHATSAPP_API_TOKEN (API Secret Key / System User Access Token)
 *    - Name in Meta: "System User Access Token" or "Permanent Access Token"
 *    - Format: Starts with "EAAG..." or "EAA..."
 *    - Where to find:
 *        1. Go to Meta Business Suite (https://business.facebook.com) -> Business Settings.
 *        2. Click Users -> System Users -> Add System User (Admin role).
 *        3. Under "Assigned Assets", assign your WhatsApp Business Account with "Full Control".
 *        4. Click "Generate New Token", select permissions: `whatsapp_business_messaging` and `whatsapp_business_management`.
 *        5. Copy the generated permanent token. This is your API Secret Key.
 * 
 * 2. WHATSAPP_PHONE_NUMBER_ID
 *    - Name in Meta: "Phone number ID"
 *    - Format: ~15-digit number (e.g. 104857291827461)
 *    - Where to find:
 *        Meta Developers Portal (https://developers.facebook.com) -> My Apps -> WhatsApp -> API Setup.
 * 
 * 3. WHATSAPP_WABA_ID (WhatsApp Business Account ID)
 *    - Name in Meta: "WhatsApp Business Account ID"
 *    - Format: ~15-digit number (e.g. 102938475610293)
 *    - Where to find:
 *        Meta Developers Portal -> My Apps -> WhatsApp -> API Setup.
 * 
 * 4. WHATSAPP_APP_SECRET & APP_ID
 *    - Name in Meta: "App ID" & "App Secret"
 *    - Where to find:
 *        Meta Developers Portal -> My Apps -> App Settings -> Basic.
 * 
 * 5. DISPLAY_NAME
 *    - Name in Meta: "Display Name" (e.g. "New Apostolic Church Kumasi Central")
 *    - Where to find:
 *        WhatsApp Manager -> Phone Numbers -> Display Name status (approved by Meta).
 * 
 * ------------------------------------------------------------------------------
 */

const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';

/**
 * Format phone number to WhatsApp international standard without '+'
 * Example: '0241234567' -> '233241234567', '+233241234567' -> '233241234567'
 */
function cleanPhoneNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) {
    return '233' + digits.slice(1);
  }
  return digits;
}

/**
 * Send an image with caption via Meta WhatsApp Business Cloud API
 * 
 * @param {string} to - Recipient phone number (e.g. '0241234567' or '233241234567')
 * @param {string} imageUrl - Direct public HTTPS URL to image (.jpg, .png, .webp)
 * @param {string} caption - Optional text caption accompanying the image
 * @returns {Promise<Object>} Response from WhatsApp Graph API
 */
async function sendWhatsAppImage(to, imageUrl, caption = '') {
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('Missing WHATSAPP_API_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment variables.');
  }

  const recipient = cleanPhoneNumber(to);
  const endpoint = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'image',
    image: {
      link: imageUrl,
      caption: caption
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || 'Failed to send WhatsApp image');
  }

  return result;
}

/**
 * Send text-only message via WhatsApp Cloud API
 */
async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('Missing WHATSAPP_API_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment variables.');
  }

  const recipient = cleanPhoneNumber(to);
  const endpoint = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'text',
    text: {
      preview_url: true, // Enables rich preview if link is inside text
      body: text
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || 'Failed to send WhatsApp message');
  }

  return result;
}

module.exports = {
  cleanPhoneNumber,
  sendWhatsAppImage,
  sendWhatsAppText
};
