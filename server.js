import express from "express";
import { nanoid } from "nanoid";
import crypto from "crypto";

const app = express();
app.use(express.json());        // ← wichtig für POST JSON (pairing, jobs etc.)
app.use("/ui", express.static("public"));


// In-memory storage (Demo)
const agents = new Map();               // agentId -> agent
const pairingSessions = new Map();      // pairingCode -> { agentId, expiresAt, usedAt }
const agentDevices = new Map();         // agentId -> [devices]
const jobs = new Map();                 // jobId -> job
const agentJobQueue = new Map();        // agentId -> [jobId]

// Helpers
function nowIso() { return new Date().toISOString(); }
function makePairingCode() {
  // nanoid kann '-' enthalten; fürs Demo ok
  const a = nanoid(4).toUpperCase();
  const b = nanoid(4).toUpperCase();
  return `${a}-${b}`;
}
function ensureQueue(agentId) {
  if (!agentJobQueue.has(agentId)) agentJobQueue.set(agentId, []);
  return agentJobQueue.get(agentId);
}

// Health
app.get("/health", (_req, res) => res.json({ ok: true, time: nowIso() }));

/* -------------------- AGENT API -------------------- */

// Pairing start
app.post("/agent/pairing/start", (req, res) => {
  const { agentVersion, machineInfo } = req.body ?? {};

  const agentId = crypto.randomUUID();
  const pairingCode = makePairingCode();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 Minuten

  agents.set(agentId, {
    agentId,
    tenantId: null,
    displayName: machineInfo?.hostname ?? "unpaired-agent",
    siteId: null,
    paired: false,
    online: false,
    lastSeenAt: null,
    agentVersion: agentVersion ?? "unknown",
    capabilities: {},
    createdAt: nowIso()
  });

  pairingSessions.set(pairingCode, { agentId, expiresAt, usedAt: null });

  res.json({ agentId, pairingCode, expiresAt: new Date(expiresAt).toISOString() });
});

// Heartbeat
app.post("/agent/heartbeat", (req, res) => {
  const { agentId, agentVersion, capabilities } = req.body ?? {};
  if (!agentId || !agents.has(agentId)) return res.status(400).json({ ok: false, error: "UNKNOWN_AGENT" });

  const a = agents.get(agentId);
  a.online = true;
  a.lastSeenAt = nowIso();
  a.agentVersion = agentVersion ?? a.agentVersion;
  a.capabilities = capabilities ?? a.capabilities;
  agents.set(agentId, a);

  res.json({ ok: true, serverTime: nowIso() });
});

// Devices report
app.post("/agent/devices/report", (req, res) => {
  const { agentId, devices } = req.body ?? {};
  if (!agentId || !agents.has(agentId)) return res.status(400).json({ ok: false, error: "UNKNOWN_AGENT" });
  if (!Array.isArray(devices)) return res.status(400).json({ ok: false, error: "MISSING_DEVICES" });

  agentDevices.set(agentId, devices.map(d => ({
    deviceId: d.deviceId ?? crypto.randomUUID(),
    serialNumber: d.serialNumber ?? null,
    model: d.model ?? "unknown",
    fwVersion: d.fwVersion ?? null,
    status: d.status ?? "unknown",
    reportedAt: nowIso()
  })));

  const a = agents.get(agentId);
  a.lastSeenAt = nowIso();
  agents.set(agentId, a);

  res.json({ ok: true, count: agentDevices.get(agentId).length });
});

// Agent pulls next jobs
app.get("/agent/jobs/next", (req, res) => {
  const agentId = req.query.agentId;
  if (!agentId || !agents.has(agentId)) return res.status(400).json({ ok: false, error: "UNKNOWN_AGENT" });

  const queue = ensureQueue(agentId);
  if (queue.length === 0) return res.json({ ok: true, jobs: [] });

  // deliver up to N jobs
  const N = 3;
  const jobIds = queue.splice(0, N);

  const payload = jobIds
    .map(id => jobs.get(id))
    .filter(Boolean)
    .map(j => ({
      jobId: j.jobId,
      type: j.type,
      agentId: j.agentId,
      deviceId: j.deviceId,
      payload: j.payload
    }));

  res.json({ ok: true, jobs: payload });
});

// Agent reports job progress
app.post("/agent/jobs/:jobId/progress", (req, res) => {
  const { jobId } = req.params;
  const { agentId, status, progress, message } = req.body ?? {};

  if (!jobs.has(jobId)) return res.status(404).json({ ok: false, error: "UNKNOWN_JOB" });
  const j = jobs.get(jobId);

  // Basic validation (Demo)
  if (agentId && j.agentId !== agentId) return res.status(403).json({ ok: false, error: "AGENT_MISMATCH" });

  if (status) j.status = status; // queued/running/succeeded/failed
  if (typeof progress === "number") j.progress = Math.max(0, Math.min(100, progress));
  if (message) j.message = message;

  if (j.status === "running" && !j.startedAt) j.startedAt = nowIso();
  if ((j.status === "succeeded" || j.status === "failed") && !j.finishedAt) j.finishedAt = nowIso();

  j.updatedAt = nowIso();
  jobs.set(jobId, j);

  res.json({ ok: true });
});

/* -------------------- PORTAL API (UI) -------------------- */

// Pair (claim agent)
app.post("/portal/agents/pair", (req, res) => {
  const { pairingCode, tenantId, userId, displayName, siteId } = req.body ?? {};
  if (!pairingCode) return res.status(400).json({ ok: false, error: "MISSING_PAIRING_CODE" });

  const session = pairingSessions.get(pairingCode);
  if (!session) return res.status(404).json({ ok: false, error: "INVALID_CODE" });
  if (session.usedAt) return res.status(409).json({ ok: false, error: "CODE_ALREADY_USED" });
  if (Date.now() > session.expiresAt) return res.status(410).json({ ok: false, error: "CODE_EXPIRED" });

  const agent = agents.get(session.agentId);
  agent.tenantId = tenantId ?? "demo-tenant";
  agent.displayName = displayName ?? agent.displayName;
  agent.siteId = siteId ?? null;
  agent.paired = true;
  agent.pairedBy = userId ?? "demo-user";
  agent.pairedAt = nowIso();

  agents.set(agent.agentId, agent);
  session.usedAt = nowIso();
  pairingSessions.set(pairingCode, session);

  res.json({ ok: true, agentId: agent.agentId, status: "paired" });
});

// List agents
app.get("/portal/agents", (req, res) => {
  const { tenantId } = req.query;
  const list = Array.from(agents.values())
    .filter(a => !tenantId || a.tenantId === tenantId)
    .map(a => ({
      agentId: a.agentId,
      displayName: a.displayName,
      siteId: a.siteId,
      tenantId: a.tenantId,
      paired: a.paired,
      online: a.online,
      lastSeenAt: a.lastSeenAt,
      agentVersion: a.agentVersion
    }));
  res.json(list);
});

// Get devices for agent
app.get("/portal/agents/:agentId/devices", (req, res) => {
  const { agentId } = req.params;
  if (!agentId || !agents.has(agentId)) return res.status(404).json({ ok: false, error: "UNKNOWN_AGENT" });
  res.json(agentDevices.get(agentId) ?? []);
});

// Create firmware update job
app.post("/portal/agents/:agentId/jobs/firmware-update", (req, res) => {
  const { agentId } = req.params;
  const { deviceId, artifactId } = req.body ?? {};
  if (!agents.has(agentId)) return res.status(404).json({ ok: false, error: "UNKNOWN_AGENT" });
  if (!deviceId) return res.status(400).json({ ok: false, error: "MISSING_DEVICE_ID" });
  if (!artifactId) return res.status(400).json({ ok: false, error: "MISSING_ARTIFACT_ID" });

  const jobId = crypto.randomUUID();
  const job = {
    jobId,
    type: "firmware-update",
    agentId,
    deviceId,
    payload: { artifactId },
    status: "queued",
    progress: 0,
    message: "queued",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: null,
    finishedAt: null
  };
  jobs.set(jobId, job);
  ensureQueue(agentId).push(jobId);

  res.json({ ok: true, jobId });
});

// Get job status
app.get("/portal/jobs/:jobId", (req, res) => {
  const { jobId } = req.params;
  if (!jobs.has(jobId)) return res.status(404).json({ ok: false, error: "UNKNOWN_JOB" });
  res.json(jobs.get(jobId));
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Cloud server listening on port ${port}`));
