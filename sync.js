// Synchronisation de la progression avec Supabase (compte email + mot de passe).
// Sans configuration (sync-config.js vide), tout reste local et le bloc compte est masqué.
(function () {
  const cfg = window.SYNC_CONFIG || {};
  const enabled = !!(cfg.url && cfg.key && window.supabase);

  let client = null, user = null, opts = null, timer = null;
  let status = "idle";          // idle | sync | ok | error
  let panelOpen = false, mode = "login", msg = null, msgKind = "info", busy = false, recovering = false;
  let mountEl = null;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const ERRORS = [
    [/invalid login credentials/i, "Email ou mot de passe incorrect."],
    [/user already registered/i, "Un compte existe déjà avec cet email. Connecte-toi."],
    [/email not confirmed/i, "Confirme d'abord ton email avec le lien reçu (regarde aussi les spams)."],
    [/password should be at least/i, "Le mot de passe doit faire au moins 6 caractères."],
    [/rate limit|too many/i, "Trop de tentatives. Réessaie dans quelques minutes."],
    [/unable to validate email|invalid email/i, "Cette adresse email n'est pas valide."],
    [/failed to fetch|network/i, "Pas de connexion internet. Réessaie plus tard."],
  ];
  const fr = e => { const m = (e && e.message) || String(e); const hit = ERRORS.find(([r]) => r.test(m)); return hit ? hit[1] : m; };

  function init(o) {
    opts = o;
    if (!enabled) return;
    client = window.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.onAuthStateChange((event, session) => {
      const prev = user && user.id;
      user = session ? session.user : null;
      if (event === "PASSWORD_RECOVERY") { recovering = true; panelOpen = true; msg = null; }
      if (user && user.id !== prev) setTimeout(pull, 0);
      if (!user) status = "idle";
      render();
    });
  }

  async function pull() {
    if (!user) return;
    status = "sync"; render();
    const { data, error } = await client.from("progress").select("data").eq("app", opts.app).maybeSingle();
    if (error) { status = "error"; render(); return; }
    const local = opts.getState();
    const merged = data && data.data ? opts.merge(local, data.data) : local;
    opts.setState(merged);
    await upload(merged);
  }

  async function upload(state) {
    if (!user) return;
    status = "sync"; render();
    const { error } = await client.from("progress").upsert({
      user_id: user.id, app: opts.app, data: state, updated_at: new Date().toISOString(),
    });
    status = error ? "error" : "ok";
    render();
  }

  // Appelé à chaque sauvegarde locale : envoi groupé 1,5 s plus tard
  function push() {
    if (!enabled || !user) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; upload(opts.getState()); }, 1500);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && timer) { clearTimeout(timer); timer = null; upload(opts.getState()); }
  });

  // Fusion de deux progressions : pour chaque question, on garde la fiche la plus avancée
  function mergeProgress(a, b) {
    const out = Object.assign({}, a || {});
    Object.entries(b || {}).forEach(([id, rb]) => {
      const ra = out[id];
      if (!ra || (rb.seen || 0) > (ra.seen || 0)) out[id] = rb;
    });
    return out;
  }

  // ---------- Interface ----------
  const CSS = `
  .sync { border-top: 1px solid var(--line); padding-top: 18px; display: flex; flex-direction: column; gap: 12px; }
  .sync-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .sync-txt { font-size: 14px; color: var(--muted); min-width: 0; overflow-wrap: anywhere; }
  .sync-txt b { color: var(--ink); }
  .sync-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--line); vertical-align: middle; }
  .sync-dot.ok { background: var(--good); } .sync-dot.sync { background: var(--accent); } .sync-dot.error { background: var(--bad); }
  .sync form { display: flex; flex-direction: column; gap: 10px; max-width: 420px; }
  .sync label { font-size: 13px; font-weight: 600; color: var(--muted); display: flex; flex-direction: column; gap: 4px; }
  .sync input { font: inherit; font-size: 16px; color: var(--ink); background: var(--surface); border: 1.5px solid var(--line); border-radius: 4px; padding: 10px 12px; }
  .sync input:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--ink); }
  .sync .links { display: flex; gap: 16px; flex-wrap: wrap; }
  .sync .lnk { background: none; border: 0; padding: 0; color: var(--muted); font-size: 13px; text-decoration: underline; cursor: pointer; }
  .sync .msg { font-size: 14px; margin: 0; }
  .sync .msg.error { color: var(--bad); } .sync .msg.info { color: var(--good); }
  .sync .btn-sm { padding: 10px 16px; font-size: 14px; }`;
  if (enabled) { const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); }

  function renderInto(el) { mountEl = el; render(); }

  function statusLabel() {
    return { sync: "Synchronisation…", ok: "Progression synchronisée", error: "Échec de la synchro, nouvel essai à la prochaine réponse", idle: "Connecté" }[status];
  }

  function render() {
    if (!mountEl || !mountEl.isConnected) return;
    if (!enabled) { mountEl.hidden = true; return; }
    mountEl.className = "sync";
    const m = msg ? `<p class="msg ${msgKind}" role="status">${esc(msg)}</p>` : "";

    if (recovering && user) {
      mountEl.innerHTML = `
        <form id="sync-newpw">
          <div class="sync-txt"><b>Choisis un nouveau mot de passe</b></div>
          <label for="sync-pw2">Nouveau mot de passe<input id="sync-pw2" type="password" autocomplete="new-password" minlength="6" required></label>
          ${m}
          <div><button class="btn btn-primary btn-sm" ${busy ? "disabled" : ""}>Enregistrer</button></div>
        </form>`;
      mountEl.querySelector("#sync-newpw").onsubmit = async e => {
        e.preventDefault(); busy = true; msg = null; render();
        const { error } = await client.auth.updateUser({ password: mountEl.querySelector("#sync-pw2").value });
        busy = false;
        if (error) { msg = fr(error); msgKind = "error"; } else { recovering = false; panelOpen = false; msg = "Mot de passe changé."; msgKind = "info"; }
        render();
      };
      return;
    }

    if (user) {
      mountEl.innerHTML = `
        <div class="sync-row">
          <span class="sync-txt"><span class="sync-dot ${status}"></span>${statusLabel()} · <b>${esc(user.email || "")}</b></span>
          <button class="lnk" id="sync-out" type="button">Se déconnecter</button>
        </div>${m}`;
      mountEl.querySelector("#sync-out").onclick = async () => {
        if (timer) { clearTimeout(timer); timer = null; await upload(opts.getState()); }
        await client.auth.signOut(); msg = "Déconnecté. Ta progression reste aussi sur cet appareil."; msgKind = "info"; render();
      };
      return;
    }

    if (!panelOpen) {
      mountEl.innerHTML = `
        <div class="sync-row">
          <span class="sync-txt">Ta progression n'est enregistrée que sur cet appareil.</span>
          <button class="btn btn-ghost btn-sm" id="sync-open" type="button">Se connecter pour la synchroniser</button>
        </div>${m}`;
      mountEl.querySelector("#sync-open").onclick = () => { panelOpen = true; msg = null; render(); mountEl.querySelector("#sync-email")?.focus(); };
      return;
    }

    const signup = mode === "signup", forgot = mode === "forgot";
    mountEl.innerHTML = `
      <form id="sync-form" novalidate>
        <div class="sync-txt"><b>${signup ? "Créer un compte" : forgot ? "Mot de passe oublié" : "Se connecter"}</b> · un seul compte pour Setlist et Bagage culturel</div>
        <label for="sync-email">Email<input id="sync-email" type="email" autocomplete="email" required></label>
        ${forgot ? "" : `<label for="sync-pw">Mot de passe${signup ? " (6 caractères minimum)" : ""}<input id="sync-pw" type="password" autocomplete="${signup ? "new-password" : "current-password"}" required></label>`}
        ${m}
        <div class="sync-row" style="justify-content:flex-start">
          <button class="btn btn-primary btn-sm" ${busy ? "disabled" : ""}>${busy ? "Un instant…" : signup ? "Créer mon compte" : forgot ? "Recevoir un lien" : "Se connecter"}</button>
          <button class="lnk" type="button" id="sync-cancel">Annuler</button>
        </div>
        <div class="links">
          ${signup || forgot ? `<button class="lnk" type="button" data-mode="login">J'ai déjà un compte</button>` : `<button class="lnk" type="button" data-mode="signup">Créer un compte</button>`}
          ${forgot ? "" : `<button class="lnk" type="button" data-mode="forgot">Mot de passe oublié ?</button>`}
        </div>
      </form>`;
    const f = mountEl.querySelector("#sync-form");
    mountEl.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { mode = b.dataset.mode; msg = null; render(); });
    mountEl.querySelector("#sync-cancel").onclick = () => { panelOpen = false; msg = null; render(); };
    f.onsubmit = async e => {
      e.preventDefault();
      const email = f.querySelector("#sync-email").value.trim();
      const pw = f.querySelector("#sync-pw")?.value || "";
      if (!email) { msg = "Indique ton adresse email."; msgKind = "error"; render(); return; }
      if (!forgot && !pw) { msg = "Indique ton mot de passe."; msgKind = "error"; render(); return; }
      busy = true; msg = null; render();
      const back = location.origin + location.pathname;
      let res;
      if (mode === "login") res = await client.auth.signInWithPassword({ email, password: pw });
      else if (signup) res = await client.auth.signUp({ email, password: pw, options: { emailRedirectTo: back } });
      else res = await client.auth.resetPasswordForEmail(email, { redirectTo: back });
      busy = false;
      if (res.error) { msg = fr(res.error); msgKind = "error"; render(); return; }
      if (signup && !(res.data && res.data.session)) { msg = "Compte créé. Clique sur le lien reçu par email pour l'activer (regarde aussi les spams)."; msgKind = "info"; mode = "login"; }
      else if (forgot) { msg = "Si un compte existe avec cet email, tu vas recevoir un lien pour changer ton mot de passe."; msgKind = "info"; mode = "login"; }
      else { panelOpen = false; msg = null; }
      render();
    };
  }

  window.Sync = { enabled, init, push, renderInto, mergeProgress };
})();
