/**
 * Channel Drivers Index
 *
 * Export all channel driver adapters for easy registration.
 */

export { smsChannelDriver, SMSChannelDriver } from './smsChannelDriver';
export { emailChannelDriver, EmailChannelDriver } from './emailChannelDriver';
export { phoneChannelDriver, PhoneChannelDriver } from './phoneChannelDriver';

import { communicationsEngine } from '../engine';
import { smsChannelDriver } from './smsChannelDriver';
import { emailChannelDriver } from './emailChannelDriver';
import { phoneChannelDriver } from './phoneChannelDriver';

/**
 * Register all default channel drivers with the communications engine.
 * Call this function during application startup.
 */
export function registerAllDrivers(): void {
  communicationsEngine.registerDriver(smsChannelDriver);
  communicationsEngine.registerDriver(emailChannelDriver);
  communicationsEngine.registerDriver(phoneChannelDriver);
}
