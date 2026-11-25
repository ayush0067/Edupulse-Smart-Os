import hashlib
import json
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "edupulse.db"

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS state_store (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS students (
                roll_id TEXT PRIMARY KEY,
                full_name TEXT NOT NULL,
                program_year TEXT NOT NULL,
                approval_status TEXT NOT NULL,
                face_registered INTEGER DEFAULT 0,
                xp_points INTEGER DEFAULT 0,
                overall_attendance REAL DEFAULT 0.0,
                cgpa REAL DEFAULT 0.0
            );
            CREATE TABLE IF NOT EXISTS attendance_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                audit_date TEXT NOT NULL,
                audit_time TEXT NOT NULL,
                roll_id TEXT NOT NULL,
                student_name TEXT NOT NULL,
                subject TEXT NOT NULL,
                confidence TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_ledger (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                roll_id TEXT NOT NULL,
                action TEXT NOT NULL,
                prev_hash TEXT NOT NULL,
                record_hash TEXT NOT NULL
            );
        """)
        # Seed genesis block if empty
        count = conn.execute("SELECT COUNT(*) FROM audit_ledger").fetchone()[0]
        if count == 0:
            ts = datetime.now().isoformat()
            genesis_hash = hashlib.sha256(f"0|{ts}|SYSTEM|GENESIS_BLOCK|00000000".encode()).hexdigest()
            conn.execute(
                "INSERT INTO audit_ledger (timestamp, roll_id, action, prev_hash, record_hash) VALUES (?, ?, ?, ?, ?)",
                (ts, "SYSTEM", "GENESIS_BLOCK", "0" * 64, genesis_hash),
            )

def append_ledger_block(roll_id: str, action: str):
    init_db()
    with get_connection() as conn:
        last = conn.execute("SELECT seq, record_hash FROM audit_ledger ORDER BY seq DESC LIMIT 1").fetchone()
        next_seq = (last["seq"] + 1) if last else 1
        prev_hash = last["record_hash"] if last else ("0" * 64)
        ts = datetime.now().isoformat()
        raw = f"{next_seq}|{ts}|{roll_id}|{action}|{prev_hash}".encode()
        rec_hash = hashlib.sha256(raw).hexdigest()
        conn.execute(
            "INSERT INTO audit_ledger (timestamp, roll_id, action, prev_hash, record_hash) VALUES (?, ?, ?, ?, ?)",
            (ts, roll_id, action, prev_hash, rec_hash),
        )
        return {"seq": next_seq, "timestamp": ts, "record_hash": rec_hash}

def verify_ledger_chain():
    init_db()
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM audit_ledger ORDER BY seq ASC").fetchall()
        expected_prev = "0" * 64
        for r in rows:
            if r["prev_hash"] != expected_prev:
                return {"valid": False, "corrupted_seq": r["seq"], "total_blocks": len(rows)}
            recomputed = hashlib.sha256(
                f"{r['seq']}|{r['timestamp']}|{r['roll_id']}|{r['action']}|{r['prev_hash']}".encode()
            ).hexdigest()
            if recomputed != r["record_hash"]:
                return {"valid": False, "corrupted_seq": r["seq"], "total_blocks": len(rows)}
            expected_prev = r["record_hash"]
        return {
            "valid": True,
            "total_blocks": len(rows),
            "latest_hash": expected_prev[:16] + "..." + expected_prev[-8:],
        }

def load_saved_state():
    init_db()
    with get_connection() as conn:
        row = conn.execute("SELECT payload FROM state_store WHERE id = 1").fetchone()
        return json.loads(row["payload"]) if row else None

def sync_full_state(state: dict):
    init_db()
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO state_store (id, payload, updated_at)
            VALUES (1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP
        """, (json.dumps(state),))

        conn.execute("DELETE FROM students")
        for m in state.get("members", []):
            subjects = m.get("subjects", [])
            tot_att = sum(s.get("attended", 0) for s in subjects)
            tot_cls = sum(s.get("total", 0) for s in subjects)
            att_pct = round((tot_att / tot_cls) * 100, 2) if tot_cls else 0.0
            avg_score = sum(s.get("internal", 0) + s.get("midterm", 0) + s.get("assignments", 0) for s in subjects) / len(subjects) if subjects else 0.0
            cgpa = round(min(10.0, avg_score / 9.5), 2)
            conn.execute(
                "INSERT INTO students VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (m.get("id", ""), m.get("name", ""), m.get("year", ""), m.get("status", "pending"),
                 1 if m.get("faceRegistered") else 0, m.get("xp", 0), att_pct, cgpa)
            )

        conn.execute("DELETE FROM attendance_audit")
        for log in state.get("liveLogs", []):
            conn.execute(
                "INSERT INTO attendance_audit (audit_date, audit_time, roll_id, student_name, subject, confidence) VALUES (?, ?, ?, ?, ?, ?)",
                (log.get("date", ""), log.get("time", ""), log.get("studentId", ""), log.get("studentName", ""), log.get("subject", ""), log.get("confidence", ""))
            )
