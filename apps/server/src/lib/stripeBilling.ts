import Stripe from 'stripe';
import { env } from '../env.js';
import { settings } from './settings.js';

/**
 * The Stripe client for plans and credit purchases. Test keys always work; a live key works
 * only when the server's environment says BILLING_LIVE=1, so real charges can never be
 * switched on from the browser.
 */
export function stripeClient(): Stripe | null {
  const key = settings().stripeSecretKey;
  if (!key) return null;
  const live = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  if (live && !env.billingLive) {
    throw new Error('This is a live Stripe key. Set BILLING_LIVE=1 on the server to take real payments.');
  }
  return new Stripe(key);
}

/** 'live' when real payments are on, else 'test'. API keys carry this in their prefix. */
export function billingMode(): 'test' | 'live' {
  const key = settings().stripeSecretKey;
  return env.billingLive && (key.startsWith('sk_live_') || key.startsWith('rk_live_')) ? 'live' : 'test';
}
