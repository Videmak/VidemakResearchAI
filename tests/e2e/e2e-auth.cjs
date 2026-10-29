// A signed-in test user: a fresh account when sign-up allows it, otherwise an existing test
// account (sign-up is limited to 10 an hour per address, and test runs share one address).
//   const { signIn } = require('./e2e-auth.cjs'); const auth = await signIn(BASE, 'smoke');
const PASSWORD = 'correct-horse-9';

async function signIn(base, name = 'e2e', fullName = 'Ada Lovelace') {
  const registered = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${name}-${Date.now()}@example.test`, password: PASSWORD, full_name: fullName }),
  });
  if (registered.status !== 429) return registered.json();
  const email = process.env.E2E_EMAIL;
  if (!email) throw new Error('Sign-up is rate limited here; set E2E_EMAIL to an existing test account.');
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: process.env.E2E_PASSWORD || PASSWORD }),
  });
  if (!login.ok) throw new Error(`Test account sign-in failed (${login.status}).`);
  return login.json();
}

module.exports = { signIn };
