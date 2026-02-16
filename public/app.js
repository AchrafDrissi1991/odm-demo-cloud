// public/app.js
const $ = (id) => document.getElementById(id);

let selectedAgentId = null;
let jobPollTimer = null;
let allAgents = []; // all agents from /portal/agents/all

function setStatus(msg) {
  $("status").textContent = msg;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  return res.json();
}

// ---------- Tree rendering ----------
function groupByTenant(list) {
  const map = new Map();
  for (const a of list) {
    const key = a.tenantId ? a.tenantId : "UNPAIRED";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(a);
  }
  // sort tenants
  const tenants = Array.from(map.keys()).sort((x, y) => {
    if (x === "UNPAIRED") return 1;
    if (y === "UNPAIRED") return -1;
    return x.localeCompare(y);
  });

  // sort agents within tenant
  for (const t of tenants) {
    map.get(t).sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? ""));
  }

  return { tenants, map };
}

function renderTenantTree(list) {
  const root = $("agents");
  root.innerHTML = "";

  if (list.length === 0) {
    root.innerHTML = `<div style="color:#666; font-size:14px;">No agents found.</div>`;
    return;
  }

  const { tenants, map } = groupByTenant(list);

  for (const tenant of tenants) {
    const agents = map.get(tenant);
    const section = document.createElement("div");
    section.style.marginBottom = "12px";

    const header = document.createElement("div");
    header.className = "agent";
    header.style.cursor = "default";
    header.style.background = "#f9fafc";
    header.innerHTML = `<b>${tenant}</b> <span style="color:#666; font-size:12px;">(${agents.length})</span>`;
    section.appendChild(header);

    for (const a of agents) {
      const div = document.createElement("div");
      div.className = "agent";
      div.style.marginLeft = "14px";
      div.onclick = () => selectAgent(a.agentId);

      const badge = document.createElement("span");
      badge.className = "badge " + (a.online ? "online" : "offline");
      badge.textContent = a.online ? "online" : "offline";

      const pairedBadge = document.createElement("span");
      pairedBadge.className = "badge";
      pairedBadge.textContent = a.paired ? "paired" : "unpaired";

      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
          <b>${a.displayName}</b>
          <div style="display:flex; gap:8px; align-items:center;">
            ${pairedBadge.outerHTML}
            ${badge.outerHTML}
          </div>
        </div>
        <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
          <span class="badge">${a.siteId ?? "no-site"}</span>
          <span style="font-size:12px; color:#555;">lastSeen: ${a.lastSeenAt ?? "-"}</span>
        </div>
        <div style="font-size:12px; color:#666; margin-top:4px;">${a.agentId}</div>
      `;
      section.appendChild(div);
    }

    root.appendChild(section);
  }
}

// ---------- Data refresh ----------
async function refreshAllAgents({ silent = false } = {}) {
  if (!silent) setStatus("loading agents...");
  const list = await api(`/portal/agents/all`);
  allAgents = list;
  renderTenantTree(list);

  // update selected agent online state display/buttons
  if (selectedAgentId) {
    const a = allAgents.find(x => x.agentId === selectedAgentId);
    const online = !!a?.online;
    $("startJob").disabled = !online;
    $("genCode").disabled = false;
    $("unpair").disabled = false;

    $("agentDetails").textContent = `Selected agent: ${selectedAgentId} ${online ? "(online)" : "(offline)"} | tenant: ${a?.tenantId ?? "UNPAIRED"}`;

    if (!online) {
      // keep jobs disabled when offline
      $("startJob").disabled = true;
    }
  }

  if (!silent) setStatus(`agents: ${list.length}`);
  return list;
}

// ---------- Agent selection + devices ----------
async function selectAgent(agentId) {
  selectedAgentId = agentId;

  $("job").textContent = "";
  $("pairInfo").textContent = "";
  $("devices").innerHTML = "";
  $("deviceSelect").innerHTML = "";

  const a = allAgents.find(x => x.agentId === agentId);
  const online = !!a?.online;

  $("agentDetails").textContent = `Selected agent: ${agentId} ${online ? "(online)" : "(offline)"} | tenant: ${a?.tenantId ?? "UNPAIRED"}`;
  $("genCode").disabled = false;
  $("unpair").disabled = false;

  setStatus("loading devices...");
  try {
    const devices = await api(`/portal/agents/${agentId}/devices`);
    renderDevices(devices);

    // firmware only if online and devices exist
    $("startJob").disabled = !(online && devices.length > 0);

    setStatus(`devices: ${devices.length}`);
  } catch (e) {
    setStatus("failed to load devices: " + e.message);
    $("startJob").disabled = true;
  }
}

function renderDevices(devices) {
  const root = $("devices");
  root.innerHTML = "";

  const sel = $("deviceSelect");
  sel.innerHTML = "";

  if (devices.length === 0) {
    root.textContent = "No devices reported yet (agent must report devices).";
    return;
  }

  for (const d of devices) {
    const row = document.createElement("div");
    row.className = "agent";
    row.innerHTML = `
      <div><b>${d.model}</b> <span class="badge">${d.deviceId}</span></div>
      <div style="font-size:12px; color:#666;">
        SN: ${d.serialNumber ?? "-"} | FW: ${d.fwVersion ?? "-"} | status: ${d.status}
      </div>
    `;
    root.appendChild(row);

    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = `${d.deviceId} (${d.model})`;
    sel.appendChild(opt);
  }
}

// ---------- Jobs ----------
async function startFirmwareJob() {
  if (!selectedAgentId) return;

  const a = allAgents.find(x => x.agentId === selectedAgentId);
  if (!a?.online) {
    setStatus("agent offline — cannot start job");
    return;
  }

  const deviceId = $("deviceSelect").value;
  const artifactId = $("artifactId").value.trim();
  if (!deviceId || !artifactId) {
    setStatus("missing deviceId or artifactId");
    return;
  }

  setStatus("starting job...");
  try {
    const res = await api(`/portal/agents/${selectedAgentId}/jobs/firmware-update`, {
      method: "POST",
      body: JSON.stringify({ deviceId, artifactId })
    });

    const jobId = res.jobId;
    setStatus(`job started: ${jobId}`);
    pollJob(jobId);
  } catch (e) {
    setStatus("job start failed: " + e.message);
  }
}

async function pollJob(jobId) {
  if (jobPollTimer) clearInterval(jobPollTimer);

  async function tick() {
    try {
      const j = await api(`/portal/jobs/${jobId}`);
      $("job").textContent = JSON.stringify(j, null, 2);

      if (j.status === "succeeded" || j.status === "failed") {
        clearInterval(jobPollTimer);
        jobPollTimer = null;
        setStatus(`job finished: ${j.status}`);
      }
    } catch (e) {
      setStatus("job poll failed: " + e.message);
      clearInterval(jobPollTimer);
      jobPollTimer = null;
    }
  }

  await tick();
  jobPollTimer = setInterval(tick, 1000);
}

// ---------- Pairing (existing) ----------
async function pairAgentFromUi() {
  const tenantId = $("tenant").value.trim();
  const pairingCode = $("pairingCode").value.trim();
  const displayName = $("pairName").value.trim();
  const siteId = $("pairSite").value.trim();

  if (!pairingCode) {
    setStatus("enter pairing code");
    return;
  }
  if (!tenantId) {
    setStatus("enter tenantId (e.g. hilscher-demo or customer-x)");
    return;
  }

  setStatus("pairing...");
  try {
    await api(`/portal/agents/pair`, {
      method: "POST",
      body: JSON.stringify({
        pairingCode,
        tenantId,
        userId: "achraf",
        displayName,
        siteId
      })
    });

    setStatus("paired ✅");
    $("pairingCode").value = "";
    await refreshAllAgents();
  } catch (e) {
    setStatus("pair failed: " + e.message);
  }
}

// ---------- Unpair + Generate code ----------
async function unpairSelectedAgent() {
  if (!selectedAgentId) return;
  setStatus("unpairing...");
  try {
    await api(`/portal/agents/${selectedAgentId}/unpair`, { method: "POST" });
    $("pairInfo").textContent = "";
    setStatus("unpaired ✅");
    // keep selectedAgentId; user might want to generate code immediately
    await refreshAllAgents();
    // after refresh, selected agent is still present but under UNPAIRED
    const a = allAgents.find(x => x.agentId === selectedAgentId);
    $("agentDetails").textContent = `Selected agent: ${selectedAgentId} | tenant: ${a?.tenantId ?? "UNPAIRED"}`;
  } catch (e) {
    setStatus("unpair failed: " + e.message);
  }
}

async function generatePairingCodeForSelectedAgent() {
  if (!selectedAgentId) return;
  setStatus("generating code...");
  try {
    const res = await api(`/portal/agents/${selectedAgentId}/pairing-code`, { method: "POST" });
    $("pairInfo").textContent = `Pairing Code: ${res.pairingCode}\nExpires: ${res.expiresAt}`;
    setStatus("pairing code generated ✅");
  } catch (e) {
    setStatus("code gen failed: " + e.message);
  }
}

// ---------- Bind UI ----------
$("refresh").onclick = () => refreshAllAgents().catch(e => setStatus(String(e)));
$("startJob").onclick = startFirmwareJob;
$("pairBtn").onclick = pairAgentFromUi;
$("genCode").onclick = generatePairingCodeForSelectedAgent;
$("unpair").onclick = unpairSelectedAgent;

$("pairingCode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") pairAgentFromUi();
});

// initial load
refreshAllAgents().catch(e => setStatus(String(e)));

// auto refresh
setInterval(() => {
  refreshAllAgents({ silent: true }).catch(() => {});
}, 3000);
