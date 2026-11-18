// Terra Hex — online room client. The server checks every move; this only sends and listens.
const CREDS_KEY = 'terrahex.rooms';

function loadCreds() { try { return JSON.parse(localStorage.getItem(CREDS_KEY) || '{}'); } catch { return {}; } }
function saveCreds(all) { try { localStorage.setItem(CREDS_KEY, JSON.stringify(all)); } catch { /* storage blocked */ } }

export async function serverAvailable() {
  try { const r = await fetch('api/health', { cache: 'no-store' }); return r.ok; } catch { return false; }
}

export class OnlineClient {
  constructor({ onUpdate, onStatus }) {
    this.onUpdate = onUpdate;
    this.onStatus = onStatus || (() => {});
    this.code = null; this.uid = null; this.token = null;
    this.es = null;
    this.seq = 0;
  }
  async _post(path, body) {
    const auth = OnlineClient.authToken ? { Authorization: `Bearer ${OnlineClient.authToken}` } : {};
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
    return data;
  }
  _remember() {
    const all = loadCreds();
    all[this.code] = { uid: this.uid, token: this.token, at: Date.now() };
    saveCreds(all);
    try { localStorage.setItem('terrahex.lastRoom', this.code); } catch { /* ignore */ }
  }
  static savedRoom() {
    try {
      const code = localStorage.getItem('terrahex.lastRoom');
      return code && loadCreds()[code] ? code : null;
    } catch { return null; }
  }
  static forget(code) { const all = loadCreds(); delete all[code]; saveCreds(all); }

  async create(name, color) {
    const r = await this._post('api/rooms', { name, color });
    Object.assign(this, { code: r.code, uid: r.uid, token: r.token });
    this._remember();
    this.connect();
    return r.code;
  }
  async join(code, name, color) {
    code = String(code || '').trim().toUpperCase();
    const saved = loadCreds()[code];
    const r = await this._post(`api/rooms/${code}/join`, { name, color, ...(saved || {}) });
    Object.assign(this, { code: r.code, uid: r.uid, token: r.token });
    this._remember();
    this.connect();
    return r;
  }
  chat(text) { return this._post(`api/rooms/${this.code}/chat`, { uid: this.uid, token: this.token, text }); }
  lobby(op, extra = {}) { return this._post(`api/rooms/${this.code}/lobby`, { uid: this.uid, token: this.token, op, ...extra }); }
  action(action, version) {
    const actionId = `${this.uid}-${Date.now().toString(36)}-${(this.seq++).toString(36)}`;
    return this._post(`api/rooms/${this.code}/action`, { uid: this.uid, token: this.token, action, version, actionId });
  }
  connect() {
    if (this.es) this.es.close();
    const url = `api/rooms/${this.code}/events?uid=${encodeURIComponent(this.uid)}&token=${encodeURIComponent(this.token)}`;
    this.es = new EventSource(url);
    this.es.onopen = () => this.onStatus('online');
    this.es.onerror = () => this.onStatus('reconnecting'); // EventSource retries by itself
    this.es.onmessage = (ev) => {
      try { this.onUpdate(JSON.parse(ev.data)); } catch (err) { console.warn('Bad update', err); }
    };
  }
  leave() {
    if (this.es) this.es.close();
    this.es = null;
  }
}

/** Account, friends and leaderboard calls (need the Terra Hex server). */
export async function accountCall(path, body, token, method = 'POST') {
  const res = await fetch(`api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
