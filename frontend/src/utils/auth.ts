/**
 * Lightweight demo authentication (frontend session only).
 * NOTE: this is a presentation login gate, not production security — add backend auth (JWT/OAuth) before real use.
 */
const KEY = 'aerospectra.session';

export const DEMO_USERS: Record<string, { password: string; name: string; role: string }> = {
  'engineer@aerospectra.ai': { password: 'inspect123', name: 'Lead Engineer', role: 'Engineer' },
  'admin@aerospectra.ai': { password: 'admin123', name: 'Administrator', role: 'Admin' },
};

export interface Session { email: string; name: string; role: string; at: string }

export function getSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function login(email: string, password: string, remember: boolean): Session | null {
  const u = DEMO_USERS[email.trim().toLowerCase()];
  if (!u || u.password !== password) return null;
  const s: Session = { email: email.trim().toLowerCase(), name: u.name, role: u.role, at: new Date().toISOString() };
  (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(s));
  if (!remember) localStorage.setItem(KEY, JSON.stringify(s)); // keep guard simple across tabs
  return s;
}

export function logout() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
}
