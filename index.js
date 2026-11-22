// -----------------------------------------------------------------------------
// Entry point of the Yi Home Cameras integration for Gladys Assistant.
//
// Holds no camera logic: it instantiates the SDK, hands it to src/app.js
// (which registers every handler BEFORE connect(), as the SDK requires), and
// connects.
//
// Environment variables provided by the Gladys supervisor to the container,
// read by the SDK itself:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = createApp({ gladys });

// The SDK disconnects cleanly and exits with code 0 when the supervisor stops
// the container (SIGTERM/SIGINT); the timers and the MQTT client stop first.
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await app.stop();
});

logger.info('Starting the Yi Home Cameras integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
