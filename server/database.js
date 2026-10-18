import initSqlJs from 'sql.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const databasePath = process.env.TEAMTRACE_DB_PATH || resolve(root, 'data', 'teamtrace.sqlite')
if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })

const entry = fileURLToPath(import.meta.resolve('sql.js'))
const SQL = await initSqlJs({ locateFile: (file) => resolve(dirname(entry), file) })
const loaded = databasePath !== ':memory:' && existsSync(databasePath)
const native = loaded ? new SQL.Database(readFileSync(databasePath)) : new SQL.Database()
native.run('PRAGMA foreign_keys = ON')

let open = true
let transactionDepth = 0
let dirty = false

function persist() {
  if (databasePath === ':memory:' || !dirty || transactionDepth > 0) return
  writeFileSync(databasePath, Buffer.from(native.export()))
  dirty = false
}

function bindArgs(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0]
  if (args.length === 1 && args[0] && typeof args[0] === 'object') {
    return Object.fromEntries(Object.entries(args[0]).map(([key, value]) => [
      /^[\s]*[:@$]/.test(key) ? key : `@${key}`,
      value
    ]))
  }
  return args
}

export const db = {
  get open() { return open },
  prepare(sql) {
    return {
      all(...args) {
        const statement = native.prepare(sql)
        try {
          statement.bind(bindArgs(args))
          const rows = []
          while (statement.step()) rows.push(statement.getAsObject())
          return rows
        } finally { statement.free() }
      },
      get(...args) {
        const statement = native.prepare(sql)
        try {
          statement.bind(bindArgs(args))
          return statement.step() ? statement.getAsObject() : undefined
        } finally { statement.free() }
      },
      run(...args) {
        const statement = native.prepare(sql)
        let changes
        try {
          statement.bind(bindArgs(args))
          while (statement.step()) {}
          changes = native.getRowsModified()
        } finally { statement.free() }
        const lastInsertRowid = native.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] || 0
        if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql)) {
          dirty = true
          persist()
        }
        return { changes, lastInsertRowid }
      }
    }
  },
  exec(sql) {
    native.exec(sql)
    dirty = true
    persist()
  },
  transaction(callback) {
    return (...args) => {
      native.run('BEGIN')
      transactionDepth += 1
      try {
        const result = callback(...args)
        native.run('COMMIT')
        transactionDepth -= 1
        dirty = true
        persist()
        return result
      } catch (error) {
        native.run('ROLLBACK')
        transactionDepth -= 1
        throw error
      }
    }
  },
  close() {
    if (open) {
      persist()
      native.close()
      open = false
    }
  }
}

export function migrate() {
  const sql = readFileSync(resolve(root, 'migrations', '001_initial.sql'), 'utf8')
  db.exec(sql)
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
  const addColumn = (table, name, definition) => {
    if (!columns(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
  }

  addColumn('users', 'github_id', 'TEXT')
  addColumn('users', 'github_access_token', 'TEXT')
  addColumn('users', 'disabled', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('projects', 'github_repo_owner', 'TEXT')
  addColumn('projects', 'github_repo_name', 'TEXT')

  const githubColumns = columns('github_commits')
  const existingColumn = (available, name) => available.includes(name) ? name : 'NULL'
  if (['author_login', 'author_name', 'repository_owner', 'repository_name'].some((name) => !githubColumns.includes(name))) {
    db.exec(`
      CREATE TABLE github_commits_next (
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
      INSERT OR IGNORE INTO github_commits_next
        (id, project_id, task_id, user_id, sha, message, committed_at, author_login, author_name, repository_owner, repository_name)
        SELECT id, project_id, task_id, user_id, sha, message, committed_at,
          ${existingColumn(githubColumns, 'author_login')}, ${existingColumn(githubColumns, 'author_name')},
          ${existingColumn(githubColumns, 'repository_owner')}, ${existingColumn(githubColumns, 'repository_name')}
        FROM github_commits;
      DROP TABLE github_commits;
      ALTER TABLE github_commits_next RENAME TO github_commits;
    `)
  }

  const prColumns = columns('github_pull_requests')
  if (['author_login', 'author_name', 'repository_owner', 'repository_name'].some((name) => !prColumns.includes(name))) {
    db.exec(`
      CREATE TABLE github_pull_requests_next (
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
      INSERT OR IGNORE INTO github_pull_requests_next
        (id, project_id, task_id, user_id, number, title, status, url, created_at, author_login, author_name, repository_owner, repository_name)
        SELECT id, project_id, task_id, user_id, number, title, status, url, created_at,
          ${existingColumn(prColumns, 'author_login')}, ${existingColumn(prColumns, 'author_name')},
          ${existingColumn(prColumns, 'repository_owner')}, ${existingColumn(prColumns, 'repository_name')}
        FROM github_pull_requests;
      DROP TABLE github_pull_requests;
      ALTER TABLE github_pull_requests_next RENAME TO github_pull_requests;
    `)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_github_commits_project ON github_commits(project_id, committed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_github_pr_project ON github_pull_requests(project_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id) WHERE github_id IS NOT NULL;
  `)

  const cleanupDemoData = db.transaction(() => {
    const demoLeader = db.prepare("SELECT id FROM users WHERE email='riley@teamtrace.demo' COLLATE NOCASE").get()
    if (demoLeader) {
      const demoProject = db.prepare("SELECT id FROM projects WHERE owner_id=? AND name='Fieldwork Atlas'").get(demoLeader.id)
      if (demoProject) {
        db.prepare('DELETE FROM audit_logs WHERE project_id=?').run(demoProject.id)
        db.prepare('DELETE FROM disputes WHERE project_id=?').run(demoProject.id)
        db.prepare('DELETE FROM projects WHERE id=?').run(demoProject.id)
      }
    }
    db.prepare("DELETE FROM evidence WHERE description LIKE 'Mock-synced commit %' OR description LIKE 'Mock PR #% was merged%'").run()
    db.prepare(`DELETE FROM audit_logs WHERE action='synced' AND entity_type='github'
      AND project_id IN (
        SELECT project_id FROM github_commits WHERE sha LIKE 'tt-%'
        UNION SELECT project_id FROM github_pull_requests WHERE url LIKE 'https://github.com/teamtrace-demo/%'
      )`).run()
    db.prepare("DELETE FROM github_commits WHERE sha LIKE 'tt-%'").run()
    db.prepare("DELETE FROM github_pull_requests WHERE url LIKE 'https://github.com/teamtrace-demo/%'").run()
    const legacyUsers = db.prepare(`SELECT id FROM users WHERE lower(email) IN (
      'faculty@teamtrace.demo', 'riley@teamtrace.demo', 'maya@teamtrace.demo',
      'leo@teamtrace.demo', 'aisha@teamtrace.demo', 'noah@teamtrace.demo'
    )`).all()
    for (const { id } of legacyUsers) {
      const protectedReferences = db.prepare(`SELECT
        (SELECT COUNT(*) FROM projects WHERE owner_id=?) +
        (SELECT COUNT(*) FROM tasks WHERE created_by=?) +
        (SELECT COUNT(*) FROM evidence WHERE user_id=?) +
        (SELECT COUNT(*) FROM disputes WHERE raised_by=?) +
        (SELECT COUNT(*) FROM disputes WHERE resolved_by=?) AS total`).get(id, id, id, id, id).total
      if (protectedReferences) {
        db.prepare(`UPDATE users SET name='Former user', email=?, password_hash='!', role='member',
          persona=NULL, initials='TT', github_id=NULL, github_access_token=NULL, disabled=1 WHERE id=?`)
          .run(`disabled-demo-${id}@invalid.local`, id)
      } else {
        db.prepare('DELETE FROM users WHERE id=?').run(id)
      }
    }
  })
  cleanupDemoData()
  if (db.prepare("SELECT 1 FROM users WHERE role='faculty' LIMIT 1").get())
    db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('faculty_bootstrap_completed', '1')").run()
}

export function closeDatabase() {
  if (db.open) db.close()
}

migrate()
