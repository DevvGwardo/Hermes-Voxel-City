// Hermes Agent & Sub-Agent Swarm Command Workspace Controller.

import { createHermesLocalBridge } from "./hermes_bridge.js";

function formatClock(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "--:--:--";
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

export function createHermesWorkspaceController({
  buildHeaders,
  onFocusAgent,
  onFollowAgent,
  onApplyEngineState,
  onToast,
  isOgCapture = false,
}) {
  const bar = document.getElementById("hermes-bar");
  const toggleBtn = document.getElementById("hermes-toggle-btn");
  const openBtn = document.getElementById("hermes-open-btn");
  const quickSpawnBtn = document.getElementById("hermes-quick-spawn-btn");
  const statusDot = document.getElementById("hermes-status-dot");
  const barMeta = document.getElementById("hermes-bar-meta");

  const followBar = document.getElementById("hermes-follow-bar");
  const followNameEl = document.getElementById("hermes-follow-name");
  const followMetaEl = document.getElementById("hermes-follow-meta");
  const followNextBtn = document.getElementById("hermes-follow-next-btn");
  const followStopBtn = document.getElementById("hermes-follow-stop-btn");

  const drawer = document.getElementById("hermes-drawer");
  const closeBtn = document.getElementById("hermes-close-btn");
  const drawerSubtitle = document.getElementById("hermes-drawer-subtitle");
  const tabButtons = Array.from(document.querySelectorAll("[data-hermes-tab]"));
  const panels = {
    swarm: document.getElementById("hermes-panel-swarm"),
    dispatch: document.getElementById("hermes-panel-dispatch"),
    local: document.getElementById("hermes-panel-local"),
  };

  const leadRow = document.getElementById("hermes-lead-row");
  const spawnForm = document.getElementById("hermes-spawn-form");
  const spawnNameInput = document.getElementById("hermes-spawn-name");
  const spawnRoleSelect = document.getElementById("hermes-spawn-role");
  const spawnParentSelect = document.getElementById("hermes-spawn-parent");
  const spawnTaskInput = document.getElementById("hermes-spawn-task");
  const spawnSubmitBtn = document.getElementById("hermes-spawn-submit");
  const subAgentList = document.getElementById("hermes-subagent-list");

  const dispatchForm = document.getElementById("hermes-dispatch-form");
  const dispatchInput = document.getElementById("hermes-dispatch-input");
  const dispatchBtn = document.getElementById("hermes-dispatch-btn");
  const dispatchModeNote = document.getElementById("hermes-dispatch-mode-note");
  const dispatchReply = document.getElementById("hermes-dispatch-reply");
  const logList = document.getElementById("hermes-log-list");

  const probeForm = document.getElementById("hermes-probe-form");
  const endpointInput = document.getElementById("hermes-endpoint-input");
  const probeBtn = document.getElementById("hermes-probe-btn");
  const presetBtns = Array.from(document.querySelectorAll("[data-endpoint]"));
  const localDiag = document.getElementById("hermes-local-diag");
  const hookCode = document.getElementById("hermes-hook-code");
  const copyHookBtn = document.getElementById("hermes-copy-hook-btn");

  let currentSnapshot = null;
  let activeTab = "swarm";
  let selectedAgentId = null;
  let followingAgentId = null;

  const localBridge = createHermesLocalBridge({
    buildHeaders,
    onStateUpdate: (snap) => applySnapshot(snap),
  });

  function buildHookSnippet() {
    const origin = window.location.origin;
    return [
      `# 1. Stream a working Hermes Agent + Sub-Agents helping it`,
      `curl -sX POST ${origin}/api/hermes/agent \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"id":"agent-refactor","name":"Refactor-Lead","role":"architect","status":"delegating","tool":"plan_edit","task":"Migrating API handlers","progress":55,"helpers":[{"id":"helper-tests","name":"Test-Helper","role":"coder","status":"executing","tool":"pytest","task":"Running auth suite","progress":70},{"id":"helper-docs","name":"Docs-Helper","role":"researcher","status":"thinking","tool":"rg","task":"Scanning changelog refs","progress":40}]}'`,
      ``,
      `# 2. Or stream a single helper linked to a working agent`,
      `curl -sX POST ${origin}/api/hermes/subagent \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"id":"sub-1","parentId":"agent-refactor","name":"Critic-01","role":"critic","status":"executing","tool":"lint","task":"Checking types","progress":80}'`,
    ].join("\n");
  }

  if (hookCode) {
    hookCode.textContent = buildHookSnippet();
  }

  function setActiveTab(nextTab) {
    if (!panels[nextTab]) return;
    activeTab = nextTab;
    for (const btn of tabButtons) {
      const isMatch = btn.getAttribute("data-hermes-tab") === nextTab;
      btn.classList.toggle("is-active", isMatch);
      btn.setAttribute("aria-selected", isMatch ? "true" : "false");
    }
    for (const [key, panel] of Object.entries(panels)) {
      if (panel) panel.hidden = key !== nextTab;
    }
  }

  function openDrawer(tab = activeTab, focusTarget = null) {
    if (!drawer || isOgCapture) return;
    drawer.hidden = false;
    setActiveTab(tab);
    if (focusTarget) {
      requestAnimationFrame(() => focusTarget.focus?.({ preventScroll: true }));
    }
  }

  function closeDrawer() {
    if (drawer) drawer.hidden = true;
  }

  function toggleDrawer() {
    if (!drawer) return;
    if (drawer.hidden) openDrawer(activeTab);
    else closeDrawer();
  }

  function updateFollowBar() {
    if (!followBar || isOgCapture) return;
    if (!followingAgentId || !currentSnapshot) {
      followBar.hidden = true;
      return;
    }
    const lead = currentSnapshot.leadAgent;
    const subs = Array.isArray(currentSnapshot.subAgents) ? currentSnapshot.subAgents : [];
    const target =
      followingAgentId === "hermes-prime"
        ? lead
        : subs.find((s) => s.id === followingAgentId) || null;
    if (!target) {
      followingAgentId = null;
      followBar.hidden = true;
      onFollowAgent?.(null);
      return;
    }
    if (followNameEl) {
      followNameEl.textContent = target.name || "Hermes Agent";
    }
    if (followMetaEl) {
      if (target.id === "hermes-prime") {
        followMetaEl.textContent = `${target.status} · ${target.currentTask || "Orchestrating"}`;
      } else {
        const parent =
          target.parentId && target.parentId !== "hermes-prime"
            ? subs.find((s) => s.id === target.parentId)?.name
            : null;
        const pct =
          target.status === "executing" || target.status === "thinking"
            ? ` ${Math.round(target.progress || 0)}%`
            : "";
        followMetaEl.textContent = `${target.role.replace(/_/g, " ")}${parent ? ` · helping ${parent}` : ""} · ${target.status}${pct}`;
      }
    }
    followBar.hidden = false;
  }

  function getOrderedFollowIds() {
    if (!currentSnapshot) return ["hermes-prime"];
    const subs = Array.isArray(currentSnapshot.subAgents) ? currentSnapshot.subAgents : [];
    const byId = new Map(subs.map((s) => [s.id, s]));
    const helpersByParent = new Map();
    const topLevel = [];
    for (const sub of subs) {
      const pid = sub.parentId;
      if (pid && pid !== "hermes-prime" && pid !== sub.id && byId.has(pid)) {
        if (!helpersByParent.has(pid)) helpersByParent.set(pid, []);
        helpersByParent.get(pid).push(sub);
      } else {
        topLevel.push(sub);
      }
    }
    const rank = (s) => {
      const hasHelpers = (helpersByParent.get(s.id)?.length || 0) > 0;
      if (s.status === "executing" || s.status === "thinking" || s.status === "delegating") return 0;
      if (hasHelpers) return 1;
      if (s.ephemeral) return 2;
      return 3;
    };
    topLevel.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    const ids = ["hermes-prime"];
    for (const parent of topLevel) {
      ids.push(parent.id);
      const helpers = [...(helpersByParent.get(parent.id) || [])].sort(
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
      );
      for (const h of helpers) {
        ids.push(h.id);
      }
    }
    return ids;
  }

  function requestToggleFollow(agentId) {
    if (!agentId) return;
    if (followingAgentId === agentId) {
      followingAgentId = null;
      onFollowAgent?.(null);
    } else {
      selectedAgentId = agentId;
      followingAgentId = agentId;
      onFollowAgent?.(agentId);
    }
    updateFollowBar();
    if (currentSnapshot) {
      renderLeadAgent(currentSnapshot.leadAgent, currentSnapshot.localProbe);
      renderSubAgents(currentSnapshot.subAgents || []);
    }
  }

  function renderLeadAgent(lead, probe) {
    if (!leadRow || !lead) return;
    leadRow.replaceChildren();

    const copy = el("div");
    copy.appendChild(el("div", "hermes-lead-name", lead.name || "Hermes Prime"));
    const transportLabel =
      probe?.transport === "local_http"
        ? "Local HTTP"
        : probe?.transport === "browser_bridge"
          ? "Browser Bridge"
          : probe?.transport === "local_files"
            ? "~/.hermes Local"
            : "Hybrid Swarm";
    copy.appendChild(
      el(
        "div",
        "hermes-lead-meta",
        `${lead.status.toUpperCase()} · ${transportLabel} · ${lead.model} · ${lead.tasksCompleted} done`,
      ),
    );
    copy.appendChild(el("div", "hermes-lead-task", lead.currentTask || "Standby at Hermes Central Plaza"));

    const actions = el("div", "hermes-action-group");
    const isFollowing = followingAgentId === "hermes-prime";
    const followLeadBtn = el(
      "button",
      `hermes-btn hermes-btn-sm${isFollowing ? " is-following" : ""}`,
      isFollowing ? "Following" : "Follow",
    );
    followLeadBtn.type = "button";
    followLeadBtn.setAttribute("aria-pressed", isFollowing ? "true" : "false");
    followLeadBtn.addEventListener("click", () => requestToggleFollow("hermes-prime"));
    actions.appendChild(followLeadBtn);

    const focusLeadBtn = el("button", "hermes-btn hermes-btn-sm", "Focus");
    focusLeadBtn.type = "button";
    focusLeadBtn.addEventListener("click", () => {
      selectedAgentId = "hermes-prime";
      onFocusAgent?.("hermes-prime");
    });
    actions.appendChild(focusLeadBtn);

    leadRow.append(copy, actions);
  }

  function syncSpawnParentOptions(subs) {
    if (!spawnParentSelect) return;
    const prev = spawnParentSelect.value || "hermes-prime";
    spawnParentSelect.replaceChildren();

    const primeOpt = document.createElement("option");
    primeOpt.value = "hermes-prime";
    primeOpt.textContent = "Hermes Prime (Top-level agent)";
    spawnParentSelect.appendChild(primeOpt);

    for (const sub of subs) {
      if (!sub || !sub.id) continue;
      // Only offer top-level / Hermes-Prime-owned agents as parent targets cleanly
      if (sub.parentId && sub.parentId !== "hermes-prime") continue;
      const opt = document.createElement("option");
      opt.value = sub.id;
      opt.textContent = `Help ${sub.name} (${sub.role.replace(/_/g, " ")})`;
      spawnParentSelect.appendChild(opt);
    }

    const stillExists = Array.from(spawnParentSelect.options).some((o) => o.value === prev);
    spawnParentSelect.value = stillExists ? prev : "hermes-prime";
  }

  function renderAgentCard(sub, { isHelper = false, parentName = "", helperCount = 0 } = {}) {
    const row = el("div", `hermes-agent-row${isHelper ? " hermes-agent-helper" : ""}`);
    if (selectedAgentId === sub.id) {
      row.style.background = "rgba(44, 122, 75, 0.05)";
    }

    const top = el("div", "hermes-agent-top");
    const left = el("div");
    left.appendChild(el("span", "hermes-agent-title", sub.name));
    const roleTag = sub.role.replace(/_/g, " ");
    const locationPart = isHelper && parentName
      ? `helping ${parentName}`
      : helperCount > 0
        ? `${helperCount} helping`
        : sub.stationLabel || "Island";
    left.appendChild(el("span", "hermes-agent-role", ` · ${roleTag} · ${locationPart}`));

    const statusText =
      sub.status === "executing" || sub.status === "thinking"
        ? `${sub.status} ${Math.round(sub.progress || 0)}%`
        : sub.status;
    const statusEl = el(
      "span",
      `hermes-agent-status${sub.status === "error" ? " is-error" : ""}`,
      statusText,
    );
    top.append(left, statusEl);
    row.appendChild(top);

    row.appendChild(el("div", "hermes-agent-task", `${sub.task}${sub.tool ? ` [${sub.tool}]` : ""}`));

    if (sub.output) {
      row.appendChild(el("div", "hermes-agent-output", sub.output));
    }

    const bottom = el("div", "hermes-agent-actions");
    bottom.appendChild(
      el(
        "span",
        "hermes-agent-role",
        sub.source === "local_daemon"
          ? "Local daemon"
          : sub.source === "browser_bridge"
            ? "Local bridge"
            : sub.source === "hook"
              ? "CLI hook"
              : "Swarm worker",
      ),
    );

    const btns = el("div", "hermes-action-group");
    const isFollowing = followingAgentId === sub.id;
    const followBtn = el(
      "button",
      `hermes-btn hermes-btn-sm${isFollowing ? " is-following" : ""}`,
      isFollowing ? "Following" : "Follow",
    );
    followBtn.type = "button";
    followBtn.setAttribute("aria-pressed", isFollowing ? "true" : "false");
    followBtn.addEventListener("click", () => requestToggleFollow(sub.id));
    btns.appendChild(followBtn);

    const focusBtn = el("button", "hermes-btn hermes-btn-sm", "Focus");
    focusBtn.type = "button";
    focusBtn.addEventListener("click", () => {
      selectedAgentId = sub.id;
      onFocusAgent?.(sub.id);
    });
    btns.appendChild(focusBtn);

    if (!isHelper) {
      const addHelperBtn = el("button", "hermes-btn hermes-btn-sm", "+ Helper");
      addHelperBtn.type = "button";
      addHelperBtn.addEventListener("click", () => {
        if (spawnParentSelect) {
          spawnParentSelect.value = sub.id;
        }
        openDrawer("swarm", spawnTaskInput);
      });
      btns.appendChild(addHelperBtn);
    }

    if (sub.status !== "standby" || sub.ephemeral) {
      const stopBtn = el("button", "hermes-btn hermes-btn-sm", sub.ephemeral ? "Dismiss" : "Stop");
      stopBtn.type = "button";
      stopBtn.addEventListener("click", async () => {
        stopBtn.disabled = true;
        try {
          const res = await fetch("/api/hermes/subagent/stop", {
            method: "POST",
            headers: buildHeaders({
              "content-type": "application/json",
              "x-meadow-client": "1",
            }),
            body: JSON.stringify({ id: sub.id }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.hermes) applySnapshot(data.hermes);
          }
        } finally {
          stopBtn.disabled = false;
        }
      });
      btns.appendChild(stopBtn);
    }

    bottom.appendChild(btns);
    row.appendChild(bottom);
    return row;
  }

  function renderSubAgents(subs) {
    if (!subAgentList) return;
    subAgentList.replaceChildren();

    if (!Array.isArray(subs) || subs.length === 0) {
      subAgentList.appendChild(el("div", "hermes-muted-note", "No agents or sub-agents active."));
      return;
    }

    const byId = new Map(subs.map((s) => [s.id, s]));
    const helpersByParent = new Map();
    const topLevel = [];

    for (const sub of subs) {
      const pid = sub.parentId;
      if (pid && pid !== "hermes-prime" && pid !== sub.id && byId.has(pid)) {
        if (!helpersByParent.has(pid)) helpersByParent.set(pid, []);
        helpersByParent.get(pid).push(sub);
      } else {
        topLevel.push(sub);
      }
    }

    const rank = (s) => {
      const hasHelpers = (helpersByParent.get(s.id)?.length || 0) > 0;
      if (s.status === "executing" || s.status === "thinking" || s.status === "delegating") return 0;
      if (hasHelpers) return 1;
      if (s.ephemeral) return 2;
      return 3;
    };

    topLevel.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    for (const parent of topLevel) {
      const helpers = helpersByParent.get(parent.id) || [];
      subAgentList.appendChild(
        renderAgentCard(parent, { isHelper: false, helperCount: helpers.length }),
      );
      helpers.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      for (const helper of helpers) {
        subAgentList.appendChild(
          renderAgentCard(helper, { isHelper: true, parentName: parent.name }),
        );
      }
    }
  }

  function renderLogs(logs) {
    if (!logList) return;
    logList.replaceChildren();
    if (!Array.isArray(logs) || logs.length === 0) {
      logList.appendChild(el("div", "hermes-muted-note", "No events recorded yet."));
      return;
    }
    for (const item of logs.slice(0, 24)) {
      const row = el("div", "hermes-log-item");
      const meta = el("div", "hermes-log-meta", `${formatClock(item.ts)} · ${item.agentName} · ${item.kind}`);
      row.appendChild(meta);
      row.appendChild(el("div", "hermes-log-msg", item.message));
      logList.appendChild(row);
    }
  }

  function renderLocalDiagnostics(probe) {
    if (!localDiag || !probe) return;
    localDiag.replaceChildren();
    const rows = [
      ["Endpoint", probe.endpoint || "http://127.0.0.1:8642"],
      [
        "Transport",
        probe.transport === "local_http"
          ? "Local HTTP daemon"
          : probe.transport === "browser_bridge"
            ? "Browser localhost bridge"
            : probe.transport === "local_files"
              ? "~/.hermes workspace files"
              : "Standby (hybrid swarm ready)",
      ],
      ["Latency", probe.latencyMs ? `${probe.latencyMs} ms` : "Not listening"],
      [
        "~/.hermes",
        probe.hermesHomeFound
          ? `${probe.skillCount} skills · ${probe.sessionCount} sessions · ${probe.memoryCount} memories`
          : "Not found on server host",
      ],
      ["Models", Array.isArray(probe.models) && probe.models.length > 0 ? probe.models.join(", ") : "None advertised"],
    ];
    if (probe.error) {
      rows.push(["Last probe", probe.error]);
    }
    for (const [k, v] of rows) {
      localDiag.appendChild(el("dt", null, k));
      localDiag.appendChild(el("dd", null, v));
    }

    if (endpointInput && document.activeElement !== endpointInput && probe.endpoint) {
      endpointInput.value = probe.endpoint;
    }
  }

  function applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    currentSnapshot = snapshot;
    onApplyEngineState?.(snapshot);

    const lead = snapshot.leadAgent;
    const probe = snapshot.localProbe;
    const subs = Array.isArray(snapshot.subAgents) ? snapshot.subAgents : [];
    const activeCount = subs.filter(
      (s) => s.status === "thinking" || s.status === "executing" || s.status === "delegating",
    ).length;

    if (statusDot) {
      statusDot.classList.remove("is-connected", "is-active", "is-error");
      if (lead?.status === "error") statusDot.classList.add("is-error");
      else if (activeCount > 0 || (lead && lead.status !== "standby")) statusDot.classList.add("is-active");
      else if (probe?.connected) statusDot.classList.add("is-connected");
    }

    if (barMeta) {
      const linkText =
        probe?.transport === "local_http" || probe?.transport === "browser_bridge"
          ? "Local Live"
          : probe?.hermesHomeFound
            ? "~/.hermes Linked"
            : "Hybrid Ready";
      barMeta.textContent = `${linkText} · ${activeCount}/${subs.length} active`;
    }

    if (drawerSubtitle) {
      drawerSubtitle.textContent = `${subs.length} sub-agents · ${activeCount} working · ${lead?.tasksCompleted ?? 0} completed`;
    }

    if (dispatchModeNote) {
      dispatchModeNote.textContent =
        probe?.transport === "local_http" || probe?.transport === "browser_bridge"
          ? `Connected to ${probe.endpoint}`
          : "Hybrid swarm + local Hermes endpoint";
    }

    renderLeadAgent(lead, probe);
    syncSpawnParentOptions(subs);
    renderSubAgents(subs);
    renderLogs(snapshot.logs || []);
    renderLocalDiagnostics(probe);
    updateFollowBar();
  }

  toggleBtn?.addEventListener("click", toggleDrawer);
  openBtn?.addEventListener("click", () => openDrawer("dispatch", dispatchInput));
  quickSpawnBtn?.addEventListener("click", () => openDrawer("swarm", spawnTaskInput));
  closeBtn?.addEventListener("click", closeDrawer);

  followStopBtn?.addEventListener("click", () => {
    followingAgentId = null;
    onFollowAgent?.(null);
    updateFollowBar();
    if (currentSnapshot) {
      renderLeadAgent(currentSnapshot.leadAgent, currentSnapshot.localProbe);
      renderSubAgents(currentSnapshot.subAgents || []);
    }
  });

  followNextBtn?.addEventListener("click", () => {
    const ids = getOrderedFollowIds();
    if (ids.length === 0) return;
    const curIdx = followingAgentId ? ids.indexOf(followingAgentId) : -1;
    const nextId = ids[(curIdx + 1) % ids.length];
    selectedAgentId = nextId;
    followingAgentId = nextId;
    onFollowAgent?.(nextId);
    updateFollowBar();
    if (currentSnapshot) {
      renderLeadAgent(currentSnapshot.leadAgent, currentSnapshot.localProbe);
      renderSubAgents(currentSnapshot.subAgents || []);
    }
  });

  for (const btn of tabButtons) {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-hermes-tab");
      if (t) setActiveTab(t);
    });
  }

  spawnForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const task = spawnTaskInput?.value.trim() || "";
    if (!task) {
      spawnTaskInput?.focus();
      return;
    }
    const name = spawnNameInput?.value.trim() || undefined;
    const role = spawnRoleSelect?.value || "researcher";
    const parentId = spawnParentSelect?.value || "hermes-prime";
    if (spawnSubmitBtn) spawnSubmitBtn.disabled = true;
    try {
      const res = await fetch("/api/hermes/spawn", {
        method: "POST",
        headers: buildHeaders({
          "content-type": "application/json",
          "x-meadow-client": "1",
        }),
        body: JSON.stringify({ name, role, task, parentId }),
      });
      const data = await res.json();
      if (res.ok && data?.hermes) {
        applySnapshot(data.hermes);
        if (spawnNameInput) spawnNameInput.value = "";
        if (spawnTaskInput) spawnTaskInput.value = "";
        if (data.subAgent?.id) {
          onFocusAgent?.(data.subAgent.id);
        }
      } else {
        onToast?.(data?.error || "Could not spawn Hermes sub-agent.");
      }
    } catch {
      onToast?.("Network error while spawning sub-agent.");
    } finally {
      if (spawnSubmitBtn) spawnSubmitBtn.disabled = false;
    }
  });

  dispatchForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const prompt = dispatchInput?.value.trim() || "";
    if (!prompt) {
      dispatchInput?.focus();
      return;
    }
    if (dispatchBtn) dispatchBtn.disabled = true;
    if (dispatchReply) {
      dispatchReply.hidden = false;
      dispatchReply.textContent = "Hermes Prime is delegating across sub-agents…";
    }
    try {
      // 1. If browser has direct localhost bridge connected, try direct local inference first
      if (localBridge.isBrowserConnected()) {
        const direct = await localBridge.tryBrowserChatCompletion(prompt);
        if (direct?.ok) {
          if (dispatchReply) dispatchReply.textContent = direct.summary;
          if (dispatchInput) dispatchInput.value = "";
          if (dispatchBtn) dispatchBtn.disabled = false;
          return;
        }
      }

      // 2. Otherwise dispatch via server HermesRuntimeHub (local HTTP daemon or gateway hybrid swarm)
      const res = await fetch("/api/hermes/dispatch", {
        method: "POST",
        headers: buildHeaders({
          "content-type": "application/json",
          "x-meadow-client": "1",
        }),
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data?.hermes) applySnapshot(data.hermes);
      if (res.ok && data?.ok) {
        if (dispatchReply) {
          dispatchReply.hidden = false;
          dispatchReply.textContent = data.summary || "Completed.";
        }
        if (dispatchInput) dispatchInput.value = "";
      } else if (dispatchReply) {
        dispatchReply.hidden = false;
        dispatchReply.textContent = data?.error || "Dispatch failed.";
      }
    } catch {
      if (dispatchReply) {
        dispatchReply.hidden = false;
        dispatchReply.textContent = "Network error while dispatching task.";
      }
    } finally {
      if (dispatchBtn) dispatchBtn.disabled = false;
    }
  });

  probeForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const endpoint = endpointInput?.value.trim() || "http://127.0.0.1:8642";
    if (probeBtn) probeBtn.disabled = true;
    try {
      const snap = await localBridge.probeAll(endpoint);
      if (snap?.localProbe?.connected) {
        onToast?.(`Connected to local Hermes (${snap.localProbe.transport})`);
      } else {
        onToast?.("No local daemon listening on that port — hybrid swarm ready.");
      }
    } finally {
      if (probeBtn) probeBtn.disabled = false;
    }
  });

  for (const btn of presetBtns) {
    btn.addEventListener("click", async () => {
      const ep = btn.getAttribute("data-endpoint");
      if (!ep || !endpointInput) return;
      endpointInput.value = ep;
      if (probeBtn) probeBtn.disabled = true;
      try {
        await localBridge.probeAll(ep);
      } finally {
        if (probeBtn) probeBtn.disabled = false;
      }
    });
  }

  copyHookBtn?.addEventListener("click", async () => {
    const txt = buildHookSnippet();
    try {
      await navigator.clipboard.writeText(txt);
      onToast?.("Copied local Hermes curl hook snippet.");
    } catch {
      onToast?.("Select and copy the curl hook block.");
    }
  });

  async function init() {
    if (isOgCapture && bar) {
      bar.hidden = true;
      return;
    }
    try {
      const res = await fetch("/api/hermes/state", { headers: buildHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data?.hermes) applySnapshot(data.hermes);
      }
    } catch {
      // ignore initial fetch hiccup
    }
  }

  return {
    init,
    applySnapshot,
    setFollowingAgentId(agentId) {
      const next = agentId || null;
      if (followingAgentId === next) return;
      followingAgentId = next;
      updateFollowBar();
      if (currentSnapshot) {
        renderLeadAgent(currentSnapshot.leadAgent, currentSnapshot.localProbe);
        renderSubAgents(currentSnapshot.subAgents || []);
      }
    },
    openForAgent(agent) {
      if (!agent) return;
      selectedAgentId = agent.id;
      openDrawer("swarm");
      if (currentSnapshot) renderSubAgents(currentSnapshot.subAgents || []);
    },
    closeDrawer,
    isDrawerOpen: () => Boolean(drawer && !drawer.hidden),
  };
}
