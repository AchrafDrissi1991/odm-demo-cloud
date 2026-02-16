// public/app.js
const $ = (id) => document.getElementById(id);

let selectedAgentId = null;
let jobPollTimer = null;
let lastAgents = []; // cache of last agent list

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

  // some endpoints return json always
  return res.json();
}

function renderAgents(list) {
  const root = $("agents");
  root.innerHTML = "";

  if (list.length === 0) {
    root.innerHTML = `<div style="color:#666; font-size:14px;">No agents found for this tenant.</div>`;
    return;
  }

  for (const a of list) {
    const div = document.createElement("div");
    div.className = "agent";
    div.onclick = () => selectAgent(a.agentId);

    const badge = document.createElement("span");
    badge.className = "badge " + (a.online ? "online" : "offline");
    badge.textContent = a.online ? "online" : "offline";

    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
        <b>${a.displayName}</b>
        ${badge.outerHTML}
      </div>
      <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
        <span class="badge">${a.siteId ?? "no-site"}</span>
        <span style="font-size:12px; color:#555;">lastSeen: ${a.lastSeenAt ?? "-"}</span>
      </div>
      <div style="font-size:12px; color:#666; margin-top:4px;">${a.agentId}</div>
    `;

    root.appendChild(div);
  }
}

async function refreshAgents({ silent = false } = {}) {
  const tenant = $("tenant").value.trim();

  if (!silent) setStatus("loading agents...");
  const list = await api(`/portal/agents?tenantId=${encodeURIComponent(tenant)}`);

  lastAgents = list;
  renderAgents(list);

  // if an agent is currently selected, update UI enable/disable based on online state
  if (selectedAgentId) {
    const selected = lastAgents.find(x => x.agentId === selectedAgentId);
    const online = !!selected?.online;
    $("startJob").disabled = !online;

    if (!online) {
      // show a hint, but don't spam too much
      if (silent) {
        $("agentDetails").textContent = `Selected agent: ${selectedAgentId} (offline)`;
      }
    } else {
      if (silent) {
        $("agentDetails").textContent = `Selected agent: ${selectedAgentId} (online)`;
      }
    }
  }

  if (!silent) setStatus(`agents: ${list.length}`);
  return list;
}

async function selectAgent(agentId) {
  selectedAgentId = agentId;

  $("job").textContent = "";
  $("devices").innerHTML = "";
  $("deviceSelect").innerHTML = "";
  $("startJob").disabled = true; // set after we know online state

  const selected = lastAgents.find(x => x.agentId === agentId);
  const online = !!selected?.online;

  $("agentDetails").textContent = `Selected agent: ${agentId}${online ? " (online)" : " (offline)"}`;
  setStatus("loading devices...");

  try {
    const devices = await api(`/portal/agents/${agentId}/devices`);
    renderDevices(devices);

    // enable job only if online and have devices
    $("startJob").disabled = !(online && devices.length > 0);

    setStatus(`devices: ${devices.length}`);
  } catch (e) {
    setStatus("failed to load devices: " + e.message);
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

async function startFirmwareJob() {
  if (!selectedAgentId) return;

  // block if offline
  const selected = lastAgents.find(x => x.agentId === selectedAgentId);
  if (!selected?.online) {
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

async function pairAgentFromUi() {
  const tenantId = $("tenant").value.trim();
  const pairingCode = $("pairingCode").value.trim();
  const displayName = $("pairName").value.trim();
  const siteId = $("pairSite").value.trim();

  if (!pairingCode) {
    setStatus("enter pairing code");
    return;
  }

  setStatus("pairing...");
  try {
    await api(`/portal/agents/pair`, {
      method: "POST",
      body: JSON.stringify({
        pairingCode,
        tenantId,
        userId: "achraf", // later from login/jwt
        displayName,
        siteId
      })
    });

    setStatus("paired ✅");
    $("pairingCode").value = "";
    await refreshAgents();
  } catch (e) {
    setStatus("pair failed: " + e.message);
  }
}

// Bind UI
$("refresh").onclick = () => refreshAgents().catch(e => setStatus(String(e)));
$("startJob").onclick = startFirmwareJob;
$("pairBtn").onclick = pairAgentFromUi;

// Enter key in pairing code input
$("pairingCode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") pairAgentFromUi();
});

// Initial load
refreshAgents().catch(e => setStatus(String(e)));

// Auto refresh (live-ish)
setInterval(() => {
  refreshAgents({ silent: true }).catch(() => {});
}, 3000);
