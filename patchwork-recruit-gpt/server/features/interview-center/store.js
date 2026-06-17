const { nowIso, parseJson, randomId } = require("./utils");

function createInterviewStore({ getDb }) {
  let initialized = false;

  function ensure() {
    if (initialized) return;
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS interview_feishu_tokens (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS interview_sessions (
        id TEXT PRIMARY KEY,
        feishu_event_id TEXT NOT NULL UNIQUE,
        calendar_id TEXT,
        resume_id TEXT,
        status TEXT NOT NULL,
        start_time INTEGER,
        end_time INTEGER,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_interview_sessions_start ON interview_sessions(start_time);
      CREATE INDEX IF NOT EXISTS idx_interview_sessions_status ON interview_sessions(status, start_time);
      CREATE INDEX IF NOT EXISTS idx_interview_sessions_resume ON interview_sessions(resume_id);

      CREATE TABLE IF NOT EXISTS interview_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_interview_logs_session ON interview_logs(session_id, created_at DESC);
    `);
    initialized = true;
  }

  function getToken() {
    ensure();
    const row = getDb().prepare("SELECT payload FROM interview_feishu_tokens WHERE id = 'default'").get();
    return row ? parseJson(row.payload, null) : null;
  }

  function saveToken(token) {
    ensure();
    const timestamp = nowIso();
    getDb()
      .prepare(
        `INSERT INTO interview_feishu_tokens (id, payload, updated_at)
         VALUES ('default', ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(token || {}), timestamp);
  }

  function clearToken() {
    ensure();
    getDb().prepare("DELETE FROM interview_feishu_tokens WHERE id = 'default'").run();
  }

  function publicSession(row) {
    if (!row) return null;
    const payload = parseJson(row.payload, {});
    return {
      ...payload,
      id: row.id,
      feishuEventId: row.feishu_event_id,
      calendarId: row.calendar_id || payload.calendarId || "",
      resumeId: row.resume_id || payload.resumeId || "",
      status: row.status || payload.status || "synced",
      startTime: row.start_time || payload.startTime || 0,
      endTime: row.end_time || payload.endTime || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function getSession(id) {
    ensure();
    const row = getDb().prepare("SELECT * FROM interview_sessions WHERE id = ?").get(id);
    return publicSession(row);
  }

  function getSessionByEventId(eventId) {
    ensure();
    const row = getDb().prepare("SELECT * FROM interview_sessions WHERE feishu_event_id = ?").get(eventId);
    return publicSession(row);
  }

  function listSessions({ startTime = 0, endTime = 0, status = "" } = {}) {
    ensure();
    const clauses = [];
    const args = [];
    if (startTime) {
      clauses.push("start_time >= ?");
      args.push(Number(startTime));
    }
    if (endTime) {
      clauses.push("start_time <= ?");
      args.push(Number(endTime));
    }
    if (status) {
      clauses.push("status = ?");
      args.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return getDb()
      .prepare(`SELECT * FROM interview_sessions ${where} ORDER BY start_time ASC, updated_at DESC`)
      .all(...args)
      .map(publicSession);
  }

  function upsertSessionFromEvent(event) {
    ensure();
    const timestamp = nowIso();
    const existing = getSessionByEventId(event.feishuEventId);
    const payload = {
      ...(existing || {}),
      ...event,
      status: existing?.status && existing.status !== "synced" ? existing.status : event.status || "synced",
      updatedAt: timestamp,
    };
    const id = existing?.id || randomId("interview");
    getDb()
      .prepare(
        `INSERT INTO interview_sessions
           (id, feishu_event_id, calendar_id, resume_id, status, start_time, end_time, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(feishu_event_id) DO UPDATE SET
           calendar_id = excluded.calendar_id,
           resume_id = excluded.resume_id,
           status = excluded.status,
           start_time = excluded.start_time,
           end_time = excluded.end_time,
           payload = excluded.payload,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        event.feishuEventId,
        event.calendarId || "",
        payload.resumeId || "",
        payload.status,
        Number(event.startTime || 0),
        Number(event.endTime || 0),
        JSON.stringify(payload),
        existing?.createdAt || timestamp,
        timestamp
      );
    return getSession(id);
  }

  function saveSession(session) {
    ensure();
    const existing = session.id ? getSession(session.id) : getSessionByEventId(session.feishuEventId);
    if (!existing) throw new Error("面试日程不存在");
    const timestamp = nowIso();
    const payload = {
      ...existing,
      ...session,
      updatedAt: timestamp,
    };
    getDb()
      .prepare(
        `UPDATE interview_sessions
         SET calendar_id = ?, resume_id = ?, status = ?, start_time = ?, end_time = ?, payload = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        payload.calendarId || "",
        payload.resumeId || "",
        payload.status || "synced",
        Number(payload.startTime || 0),
        Number(payload.endTime || 0),
        JSON.stringify(payload),
        timestamp,
        existing.id
      );
    return getSession(existing.id);
  }

  function appendLog(sessionId, level, message, payload = {}) {
    ensure();
    const createdAt = nowIso();
    getDb()
      .prepare(
        `INSERT INTO interview_logs (id, session_id, level, message, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(randomId("ilog"), sessionId || "", level || "info", String(message || ""), JSON.stringify(payload || {}), createdAt);
  }

  function listLogs(sessionId = "", limit = 80) {
    ensure();
    if (sessionId) {
      return getDb()
        .prepare("SELECT * FROM interview_logs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(sessionId, Number(limit || 80))
        .map((row) => ({
          id: row.id,
          sessionId: row.session_id || "",
          level: row.level,
          message: row.message,
          payload: parseJson(row.payload, {}),
          createdAt: row.created_at,
        }));
    }
    return getDb()
      .prepare("SELECT * FROM interview_logs ORDER BY created_at DESC LIMIT ?")
      .all(Number(limit || 80))
      .map((row) => ({
        id: row.id,
        sessionId: row.session_id || "",
        level: row.level,
        message: row.message,
        payload: parseJson(row.payload, {}),
        createdAt: row.created_at,
      }));
  }

  return {
    ensure,
    getToken,
    saveToken,
    clearToken,
    getSession,
    getSessionByEventId,
    listSessions,
    upsertSessionFromEvent,
    saveSession,
    appendLog,
    listLogs,
  };
}

module.exports = {
  createInterviewStore,
};
