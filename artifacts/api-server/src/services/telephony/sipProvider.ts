import type { TelephonyProvider } from "./types";

/**
 * Placeholder for a generic SIP webhook bridge. A future contributor can
 * fill these in by subscribing to their SIP recording / CDR source and
 * POSTing into our existing `/api/ingest/webhook` endpoint OR by
 * implementing the parse + TwiML-equivalent here.
 *
 * Status: NOT IMPLEMENTED. Calling any method throws so a misconfiguration
 * surfaces loudly rather than silently dropping calls.
 */
export const sipProvider: TelephonyProvider = {
  id: "sip",
  validateRequest: () => {
    throw new Error("SipProvider is not implemented yet");
  },
  parseIncoming: () => null,
  parseStatus: () => null,
  parseRecording: () => null,
  generateIncomingResponse: () => ({
    contentType: "text/plain",
    body: "SipProvider is not implemented yet",
  }),
  downloadRecording: async () => null,
};
