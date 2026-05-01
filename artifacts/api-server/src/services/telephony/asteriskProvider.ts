import type { TelephonyProvider } from "./types";

/**
 * Placeholder for an Asterisk ARI integration. Expected wiring:
 *   1. Asterisk dialplan posts a CDR (and recording URL) to a webhook.
 *   2. We map Asterisk CDR fields → NormalizedIncoming/Status/Recording.
 *   3. Recording fetch goes via Asterisk's HTTP (or shared file store).
 *
 * Status: NOT IMPLEMENTED. See sipProvider.ts for the same caveat.
 */
export const asteriskProvider: TelephonyProvider = {
  id: "asterisk",
  validateRequest: () => {
    throw new Error("AsteriskProvider is not implemented yet");
  },
  parseIncoming: () => null,
  parseStatus: () => null,
  parseRecording: () => null,
  generateIncomingResponse: () => ({
    contentType: "text/plain",
    body: "AsteriskProvider is not implemented yet",
  }),
  downloadRecording: async () => null,
};
