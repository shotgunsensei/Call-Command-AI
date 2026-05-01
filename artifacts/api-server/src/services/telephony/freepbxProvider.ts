import type { TelephonyProvider } from "./types";

/**
 * Placeholder for a FreePBX integration. The most pragmatic wiring is:
 *   - FreePBX's CDR module posts to a webhook (or a cron exports CDR rows)
 *   - Recording files are accessible via shared HTTP / object storage
 *   - We translate the incoming CDR payload to NormalizedRecording and run
 *     the existing analysis + flow pipeline against it.
 *
 * Status: NOT IMPLEMENTED. See sipProvider.ts.
 */
export const freepbxProvider: TelephonyProvider = {
  id: "freepbx",
  validateRequest: () => {
    throw new Error("FreepbxProvider is not implemented yet");
  },
  parseIncoming: () => null,
  parseStatus: () => null,
  parseRecording: () => null,
  generateIncomingResponse: () => ({
    contentType: "text/plain",
    body: "FreepbxProvider is not implemented yet",
  }),
  downloadRecording: async () => null,
};
