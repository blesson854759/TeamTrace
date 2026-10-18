PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('faculty', 'leader', 'member')),
  persona TEXT,
  initials TEXT NOT NULL,
  github_id TEXT,
  github_access_token TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  course TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  github_repo_owner TEXT,
  github_repo_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN ('Development', 'Testing', 'Documentation', 'Collaboration', 'Planning')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT,
  points REAL NOT NULL DEFAULT 1 CHECK (points >= 0 AND points <= 100),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'github_commit', 'github_pr')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS github_commits (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sha TEXT NOT NULL,
  message TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  author_login TEXT,
  author_name TEXT,
  repository_owner TEXT,
  repository_name TEXT,
  UNIQUE (project_id, sha)
);

CREATE TABLE IF NOT EXISTS github_pull_requests (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'merged', 'closed')),
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  author_login TEXT,
  author_name TEXT,
  repository_owner TEXT,
  repository_name TEXT,
  UNIQUE (project_id, number)
);

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  evidence_id INTEGER REFERENCES evidence(id) ON DELETE SET NULL,
  raised_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_evidence_project_created ON evidence(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_project ON disputes(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_logs(project_id, created_at DESC);
