// Browser-side Local Hermes Agent Prober & Direct Loopback Bridge.
// Enables live discovery of a Hermes Agent running on the user's own machine (127.0.0.1 / localhost)
// both when running locally and when viewing a hosted preview.

export function normalizeLocalLoopbackUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s.includes("://") ? s : `http://${s}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") {
      return null;
    }
    return u.origin;
  } catch {
    return null;
  }
}

async function fetchJsonQuiet(url, timeoutMs = 1200) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      mode: "cors",
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { ok: false, data: null };
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) return { ok: true, data: {} };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : "Unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export function createHermesLocalBridge({ buildHeaders, onStateUpdate }) {
  let browserConnected = false;
  let browserEndpoint = "http://127.0.0.1:8642";
  let browserModel = "hermes-agent";

  async function probeAll(requestedEndpoint) {
    const cleanUrl =
      normalizeLocalLoopbackUrl(requestedEndpoint || browserEndpoint) || "http://127.0.0.1:8642";
    browserEndpoint = cleanUrl;

    // 1. Trigger server-side probe (checks server localhost + ~/.hermes directory)
    let serverData = null;
    try {
      const serverRes = await fetch("/api/hermes/probe", {
        method: "POST",
        headers: buildHeaders({
          "content-type": "application/json",
          "x-meadow-client": "1",
        }),
        body: JSON.stringify({ endpoint: cleanUrl }),
      });
      if (serverRes.ok) {
        serverData = await serverRes.json();
        if (serverData?.hermes) {
          onStateUpdate?.(serverData.hermes);
        }
      }
    } catch {
      // ignore transient server error
    }

    // If server already reached local_http directly, return immediately
    if (serverData?.localProbe?.connected && serverData?.localProbe?.transport === "local_http") {
      browserConnected = false;
      return serverData.hermes;
    }

    // 2. Also probe directly from browser localhost (for remote preview + local laptop Hermes)
    const t0 = performance.now();
    const [health, modelsRes, subRes] = await Promise.all([
      fetchJsonQuiet(`${cleanUrl}/health`),
      fetchJsonQuiet(`${cleanUrl}/v1/models`),
      fetchJsonQuiet(`${cleanUrl}/api/subagents`),
    ]);
    let ok = health.ok || modelsRes.ok || subRes.ok;
    if (!ok) {
      const alt = await fetchJsonQuiet(`${cleanUrl}/api/health`);
      ok = alt.ok;
    }

    const latencyMs = ok ? Math.max(1, Math.round(performance.now() - t0)) : null;
    const models = Array.isArray(modelsRes.data?.data)
      ? modelsRes.data.data.map((m) => String(m?.id || "")).filter(Boolean).slice(0, 12)
      : [];
    const subAgents = Array.isArray(subRes.data?.subagents)
      ? subRes.data.subagents
      : Array.isArray(subRes.data?.agents)
        ? subRes.data.agents
        : [];

    if (ok) {
      browserConnected = true;
      if (models[0]) browserModel = models[0];
      try {
        const syncRes = await fetch("/api/hermes/sync", {
          method: "POST",
          headers: buildHeaders({
            "content-type": "application/json",
            "x-meadow-client": "1",
          }),
          body: JSON.stringify({
            endpoint: cleanUrl,
            connected: true,
            latencyMs,
            models,
            subAgents,
          }),
        });
        if (syncRes.ok) {
          const synced = await syncRes.json();
          if (synced?.hermes) {
            onStateUpdate?.(synced.hermes);
            return synced.hermes;
          }
        }
      } catch {
        // ignore sync failure
      }
    } else {
      browserConnected = false;
    }

    return serverData?.hermes || null;
  }

  async function tryBrowserChatCompletion(prompt) {
    if (!browserConnected) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(`${browserEndpoint}/v1/chat/completions`, {
        method: "POST",
        mode: "cors",
        signal: ctrl.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: browserModel,
          messages: [
            {
              role: "system",
              content: "You are Hermes Agent orchestrating specialized sub-agents. Respond concisely.",
            },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (!text) return null;

      await fetch("/api/hermes/heartbeat", {
        method: "POST",
        headers: buildHeaders({
          "content-type": "application/json",
          "x-meadow-client": "1",
        }),
        body: JSON.stringify({
          endpoint: browserEndpoint,
          model: data.model || browserModel,
          status: "standby",
          task: `Completed: ${prompt.slice(0, 120)}`,
        }),
      }).catch(() => {});

      return { ok: true, summary: text, modelUsed: data.model || browserModel };
    } catch {
      browserConnected = false;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    probeAll,
    tryBrowserChatCompletion,
    isBrowserConnected: () => browserConnected,
    getEndpoint: () => browserEndpoint,
  };
}
