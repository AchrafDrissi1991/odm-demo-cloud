const $ = (id) => document.getElementById(id);

let selectedAgentId = null;
let jobPollTimer = null;

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

function renderAgents(list) {
  const root = $("agents");
  root.innerHTML = "";
  for (const a of list) {
    const div = document.createElement("div");
    div.className = "agent";
    div.onclick = () => selectAgent(a.agentId);

    const badge = document.createElement("span");
    badge.className = "badge " + (a.online ? "online" : "offline");
    badge.textContent = a.online ? "online" : "offline";

    div.innerHTML = `
      <div><b>${a.displayName}</b></div>
      <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
        ${badge.outerHTML}
        <span class="badge">${a.siteId ?? "no-site"}</span>
        <span style="font-size:12px; color:#555;">lastSeen: ${a.lastSeenAt ?? "-"}</span>
      </div>
      <div style="font-size:12px; color:#666; margin-top:4px;">${a.agentId}</div>
    `;
    root.appendChild(div);
  }
}

async function refreshAgents() {
  const tenant = $("tenant").value.trim();
  setStatus("loading agents...");
  const list = await api(`/portal/agents?tenantId=${encodeURIComponent(tenant)}`);
  renderAgents(list);
  setStatus(`agents: ${list.length}`);
}

async function selectAgent(agentId) {
  selectedAgentId = agentId;
  $("startJob").disabled = false;
  $("job").textContent = "";

  $("agentDetails").textContent = `Selected agent: ${agentId}`;
  setStatus("loading devices...");

  const devices = await api(`/portal/agents/${agentId}/devices`);
  renderDevices(devices);
  setStatus(`devices: ${devices.length}`);
}

function renderDevices(devices) {
  const root = $("devices");
  root.innerHTML = "";

  const sel = $("deviceSelect");
  sel.innerHTML = "";

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

  if (devices.length === 0) {
    root.textContent = "No devices reported yet (agent must report devices).";
    $("startJob").disabled = true;
  }
}

async function startFirmwareJob() {
  if (!selectedAgentId) return;

  const deviceId = $("deviceSelect").value;
  const artifactId = $("artifactId").value.trim();
  if (!deviceId || !artifactId) return;

  setStatus("starting job...");
  const res = await api(`/portal/agents/${selectedAgentId}/jobs/firmware-update`, {
    method: "POST",
    body: JSON.stringify({ deviceId, artifactId })
  });

  const jobId = res.jobId;
  setStatus(`job started: ${jobId}`);
  pollJob(jobId);
}

async function pollJob(jobId) {
  if (jobPollTimer) clearInterval(jobPollTimer);

  async function tick() {
    const j = await api(`/portal/jobs/${jobId}`);
    $("job").textContent = JSON.stringify(j, null, 2);
    if (j.status === "succeeded" || j.status === "failed") {
      clearInterval(jobPollTimer);
      jobPollTimer = null;
      setStatus(`job finished: ${j.status}`);
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
        userId: "achraf", // später aus Login/JWT
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

$("refresh").onclick = refreshAgents;
$("startJob").onclick = startFirmwareJob;

refreshAgents().catch(e => setStatus(String(e)));
