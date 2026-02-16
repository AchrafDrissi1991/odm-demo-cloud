import express from "express";
import { nanoid } from "nanoid";

const app = express();
app.use(express.json());

// In-memory storage (für Demo). Später: DB.
const agents = new Map(); // agentId -> agent
const pairingSessions = new Map(); // pairingCode -> { agentId, expiresAt, usedAt }

function nowIso() {
  return new Date().toISOString();
}

function makePairingCode() {
  // z.B. "8K7Q-2M9D"
  const a = nanoid(4).toUpperCase();
  const b = nanoid(4).toUpperCase();
  return `${a}-${b}`;
}

// Health
app.get("/health", (_req, res) => {
  res.json({ ok: true, time: nowIso() });
});

/**
 * AGENT API
 * Agent startet Pairing und bekommt pairingCode
 */
app.post("/agent/pairing/start", (req, res) => {
  const { agentVersion, machineInfo } = req.body ?? {};

  const agentId = crypto.randomUUID();
  const pairingCode = makePairingCode();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 Minuten

  agents.set(agentId, {
    agentId,
    tenantId: null, // wird beim Pairing gesetzt
    displayName: machineInfo?.hostname ?? "unpaired-agent",
    siteId: null,
    status: "unpaired",
    lastSeenAt: null,
    agentVersion: agentVersion ?? "unknown",
    capabilities: {},
    createdAt: nowIso()
  });

  pairingSessions.set(pairingCode, {
    agentId,
    expiresAt,
    usedAt: null
  });

  res.json({
    agentId,
    pairingCode,
    expiresAt: new Date(expiresAt).toISOString()
  });
});

/**
 * AGENT API
 * Heartbeat: Agent sagt "ich bin online"
 */
app.post("/agent/heartbeat", (req, res) => {
  const { agentId, status, agentVersion, capabilities } = req.body ?? {};
  if (!agentId || !agents.has(agentId)) {
    return res.status(400).json({ ok: false, error: "UNKNOWN_AGENT" });
  }

  const a = agents.get(agentId);
  a.status = status ?? a.status;
  a.lastSeenAt = nowIso();
  a.agentVersion = agentVersion ?? a.agentVersion;
  a.capabilities = capabilities ?? a.capabilities;

  agents.set(agentId, a);

  res.json({ ok: true, serverTime: nowIso() });
});

/**
 * PORTAL API (User-Action)
 * User "claimt" Agent über pairingCode
 * Für Demo: tenantId/userId kommen einfach aus Body (später aus JWT)
 */
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
  agent.status = "paired";
  agent.pairedBy = userId ?? "demo-user";
  agent.pairedAt = nowIso();

  agents.set(agent.agentId, agent);
  session.usedAt = nowIso();
  pairingSessions.set(pairingCode, session);

  res.json({ ok: true, agentId: agent.agentId, status: "paired" });
});

/**
 * PORTAL API
 * Liste Agents (für Demo: optional nach tenantId filtern)
 */
app.get("/portal/agents", (req, res) => {
  const { tenantId } = req.query;
  const list = Array.from(agents.values())
    .filter(a => !tenantId || a.tenantId === tenantId)
    .map(a => ({
      agentId: a.agentId,
      displayName: a.displayName,
      siteId: a.siteId,
      tenantId: a.tenantId,
      status: a.status,
      lastSeenAt: a.lastSeenAt,
      agentVersion: a.agentVersion
    }));
  res.json(list);
});

// Render setzt PORT automatisch
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Cloud server listening on port ${port}`);
});
