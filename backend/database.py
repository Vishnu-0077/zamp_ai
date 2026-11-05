import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat()


def dumps(value):
    return json.dumps(value, default=str, sort_keys=True)


class Store:
    def __init__(self, path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as c:
            c.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY, email_id INTEGER, hash TEXT NOT NULL UNIQUE,
              sender TEXT NOT NULL, filename TEXT NOT NULL, content BLOB NOT NULL,
              status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              pages TEXT, extraction TEXT, findings TEXT NOT NULL DEFAULT '[]',
              checks TEXT NOT NULL DEFAULT '{}', decision TEXT, po_number TEXT,
              vendor_id TEXT, invoice_number TEXT, amount TEXT, currency TEXT,
              invoice_date TEXT, policy_snapshot TEXT, model TEXT);
            CREATE TABLE IF NOT EXISTS submissions (
              id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id),
              email_id INTEGER, sender TEXT NOT NULL, filename TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit (
              id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id),
              at TEXT NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reservations (
              job_id TEXT PRIMARY KEY REFERENCES jobs(id), po_number TEXT NOT NULL, amount TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
            CREATE INDEX IF NOT EXISTS audit_job ON audit(job_id, id);
            CREATE INDEX IF NOT EXISTS jobs_invoice ON jobs(vendor_id, invoice_number);
            ''')

    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        c.execute('PRAGMA busy_timeout=30000')
        try:
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()

    def audit(self, c, job_id, event, payload, actor='system'):
        c.execute('INSERT INTO audit(job_id,at,actor,event,payload) VALUES(?,?,?,?,?)',
                  (job_id, now(), actor, event, dumps(payload)))

    def get(self, job_id):
        with self.connect() as c:
            row = c.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            return self.decode(row) if row else None

    @staticmethod
    def decode(row):
        data = dict(row)
        data.pop('content', None)
        for key in ('pages', 'extraction', 'findings', 'checks', 'decision', 'policy_snapshot'):
            if data.get(key) is not None:
                data[key] = json.loads(data[key])
        return data
