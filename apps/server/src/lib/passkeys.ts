import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { sql } from '../db.js';
import type { AuthUser } from '../auth.js';
import { settings } from './settings.js';
import { createFlow, takeFlow } from './signin.js';
import { activeUser } from './users.js';

/**
 * Passkeys (WebAuthn): discoverable credentials with user verification, for the site at
 * PUBLIC_URL. Challenges are one-time flows; the browser never sends a user name first.
 */

function relyingParty() {
  const url = new URL(settings().publicUrl);
  return { rpID: url.hostname, origin: url.origin, rpName: 'Videmak' };
}

type StoredPasskey = { id: string; user_id: string; credential_id: string; public_key: Buffer; counter: string | number; transports: string[] };

export async function registrationOptions(user: AuthUser) {
  const { rpID, rpName } = relyingParty();
  const existing = await sql<{ credential_id: string; transports: string[] }[]>`select credential_id, transports from user_passkeys where user_id = ${user.id}`;
  const options = await generateRegistrationOptions({
    rpName, rpID, userName: user.email, userDisplayName: user.full_name || user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((item) => ({ id: item.credential_id, transports: item.transports as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const flow = await createFlow('passkey_register', { challenge: options.challenge }, { userId: user.id, ttlSeconds: 300 });
  return { flow, options };
}

/** A friendly default name from where the passkey lives. */
function passkeyName(transports: string[] | undefined, backedUp: boolean) {
  if (transports?.includes('hybrid')) return 'Phone passkey';
  if (transports?.includes('usb') || transports?.includes('nfc')) return 'Security key';
  return backedUp ? 'Synced passkey' : 'This device';
}

export async function finishRegistration(user: AuthUser, flowId: string, response: RegistrationResponseJSON) {
  const flow = await takeFlow(flowId, 'passkey_register');
  if (!flow || flow.user_id !== user.id) throw new Error('This passkey request expired. Try again.');
  const { rpID, origin } = relyingParty();
  const result = await verifyRegistrationResponse({
    response, expectedChallenge: flow.data.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
  });
  if (!result.verified) throw new Error('The passkey could not be checked. Try again.');
  const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
  const transports = credential.transports ?? response.response.transports ?? [];
  const [saved] = await sql<{ id: string; name: string }[]>`
    insert into user_passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
    values (${user.id}, ${credential.id}, ${Buffer.from(credential.publicKey)}, ${credential.counter}, ${transports as string[]},
            ${credentialDeviceType}, ${credentialBackedUp}, ${passkeyName(transports, credentialBackedUp)})
    on conflict (credential_id) do nothing
    returning id, name`;
  if (!saved) throw new Error('This passkey is already saved.');
  return saved;
}

export async function authenticationOptions() {
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  const flow = await createFlow('passkey_login', { challenge: options.challenge }, { ttlSeconds: 300 });
  return { flow, options };
}

/** The person whose passkey answered the challenge. */
export async function finishAuthentication(flowId: string, response: AuthenticationResponseJSON): Promise<AuthUser> {
  const flow = await takeFlow(flowId, 'passkey_login');
  if (!flow) throw new Error('This passkey request expired. Try again.');
  const [stored] = await sql<StoredPasskey[]>`
    select id, user_id, credential_id, public_key, counter, transports from user_passkeys where credential_id = ${response.id}`;
  if (!stored) throw new Error('This passkey is not saved on any Videmak account. Sign in another way, then add it on your Account page.');
  const { rpID, origin } = relyingParty();
  const result = await verifyAuthenticationResponse({
    response, expectedChallenge: flow.data.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    credential: {
      id: stored.credential_id, publicKey: new Uint8Array(stored.public_key), counter: Number(stored.counter),
      transports: stored.transports as AuthenticatorTransportFuture[],
    },
  });
  if (!result.verified) throw new Error('The passkey could not be checked. Try again.');
  await sql`update user_passkeys set counter = ${result.authenticationInfo.newCounter}, last_used_at = now() where id = ${stored.id}`;
  const user = await activeUser(stored.user_id);
  if (!user) throw new Error('This account is turned off.');
  return user;
}
