import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

process.env.TEAMTRACE_DB_PATH = ':memory:'
process.env.TEAMTRACE_JWT_SECRET = 'test-only-secret'
process.env.FACULTY_BOOTSTRAP_SECRET = 'one-time-test-secret'

const { app } = await import('../app.js')
const { db, closeDatabase, migrate } = await import('../database.js')

assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 0)

let leaderToken
let memberToken
let facultyToken
let leaderId
let memberId
let projectId

async function register(name, email, role = 'member') {
  return request(app).post('/api/auth/register').send({ name, email, role, password: 'safe-password-123' })
}

before(async () => {
  const leader = await register('Taylor Leader', 'taylor@example.test', 'leader')
  assert.equal(leader.status, 201)
  leaderToken = leader.body.token
  leaderId = leader.body.user.id
  const member = await register('Morgan Member', 'morgan@example.test')
  assert.equal(member.status, 201)
  memberToken = member.body.token
  memberId = member.body.user.id
  const faculty = await request(app).post('/api/auth/bootstrap-faculty').send({
    name: 'Casey Faculty', email: 'casey@example.test', password: 'faculty-password-123', bootstrap_secret: process.env.FACULTY_BOOTSTRAP_SECRET
  })
  assert.equal(faculty.status, 201)
  facultyToken = faculty.body.token
  const created = await request(app).post('/api/projects').set('Authorization', `Bearer ${leaderToken}`)
    .send({ name: 'Research notebook', description: 'A user-created team workspace.', course: 'DES 204' })
  assert.equal(created.status, 201)
  projectId = created.body.project.id
  assert.equal((await request(app).post(`/api/projects/${projectId}/members`)
    .set('Authorization', `Bearer ${leaderToken}`).send({ user_id: memberId })).status, 200)
})

after(() => closeDatabase())

test('fresh database is empty and signup allows only member and leader roles', async () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@teamtrace.demo'").get().n, 0)
  assert.equal((await register('Another Leader', 'another@example.test', 'leader')).body.user.role, 'leader')
  assert.equal((await register('Another Member', 'another-member@example.test')).body.user.role, 'member')
  assert.equal((await register('Not Faculty', 'faculty-escalation@example.test', 'faculty')).status, 400)
  assert.equal((await register('Invalid Role', 'invalid-role@example.test', 'admin')).status, 400)
  assert.equal((await register('Duplicate Email', 'TAYLOR@example.test', 'member')).status, 409)
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'taylor@example.test', password: 'safe-password-123' })).status, 200)
})

test('legacy cleanup removes only known seed identities and the seeded workspace', async () => {
  const identities = [
    ['Dr. Jordan Lee', 'faculty@teamtrace.demo', 'faculty'],
    ['Riley Brooks', 'riley@teamtrace.demo', 'leader'],
    ['Maya Chen', 'maya@teamtrace.demo', 'member'],
    ['Leo Martinez', 'leo@teamtrace.demo', 'member'],
    ['Aisha Patel', 'aisha@teamtrace.demo', 'member'],
    ['Noah Kim', 'noah@teamtrace.demo', 'member']
  ]
  const ids = identities.map(([name, email, role], index) => db.prepare(`INSERT INTO users
    (name, email, password_hash, role, persona, initials) VALUES (?, ?, 'legacy', ?, ?, ?)`)
    .run(name, email, role, role === 'member' ? 'Legacy persona' : null, `L${index}`).lastInsertRowid)
  const legacyProject = db.prepare(`INSERT INTO projects (name, description, course, owner_id)
    VALUES ('Fieldwork Atlas', 'Legacy sample', 'DES 204', ?)`).run(ids[1]).lastInsertRowid
  for (const id of ids) db.prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)').run(legacyProject, id)
  const legacyTask = db.prepare(`INSERT INTO tasks (project_id, title, created_by)
    VALUES (?, 'Legacy sample task', ?)`).run(legacyProject, ids[1]).lastInsertRowid
  db.prepare(`INSERT INTO evidence (project_id, task_id, user_id, category, title)
    VALUES (?, ?, ?, 'Development', 'Legacy sample evidence')`).run(legacyProject, legacyTask, ids[2])

  migrate()

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects WHERE id=?').get(legacyProject).n, 0)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@teamtrace.demo'").get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects WHERE id=?').get(projectId).n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE project_id=?').get(legacyProject).n, 0)
})

test('faculty bootstrap is secret-gated and one-time', async () => {
  assert.equal((await request(app).post('/api/auth/bootstrap-faculty').send({
    name: 'Intruder', email: 'intruder@example.test', password: 'safe-password-123', bootstrap_secret: 'wrong'
  })).status, 403)
  assert.equal((await request(app).post('/api/auth/bootstrap-faculty').send({
    name: 'Second Faculty', email: 'second-faculty@example.test', password: 'safe-password-123', bootstrap_secret: process.env.FACULTY_BOOTSTRAP_SECRET
  })).status, 409)
})

test('health, authenticated profile, and project authorization are available', async () => {
  const health = await request(app).get('/api/health')
  assert.equal(health.status, 200)
  assert.equal(health.body.status, 'ok')
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${memberToken}`)
  assert.equal(me.status, 200)
  assert.equal(me.body.user.role, 'member')
  assert.equal((await request(app).get('/api/projects')).status, 401)
  assert.equal((await request(app).get(`/api/projects/${projectId}`).set('Authorization', `Bearer ${memberToken}`)).status, 200)
  assert.equal((await request(app).post('/api/tasks').set('Authorization', `Bearer ${memberToken}`)
    .send({ project_id: projectId, title: 'Unauthorized task' })).status, 403)
})

test('faculty project list aggregates task progress and keeps the global view faculty-only', async () => {
  const outsideOwner = await register('Other Project Owner', 'other-owner@example.test', 'leader')
  assert.equal(outsideOwner.status, 201)
  const ownerId = outsideOwner.body.user.id
  const cases = [
    { name: 'Empty project', statuses: [], expected: { task_count: 0, todo_count: 0, in_progress_count: 0, review_count: 0, completed_count: 0, completion_percent: 0, stage: 'Planning' } },
    { name: 'Planning project', statuses: ['todo', 'todo'], expected: { task_count: 2, todo_count: 2, in_progress_count: 0, review_count: 0, completed_count: 0, completion_percent: 0, stage: 'Planning' } },
    { name: 'In progress project', statuses: ['in_progress', 'done', 'todo'], expected: { task_count: 3, todo_count: 1, in_progress_count: 1, review_count: 0, completed_count: 1, completion_percent: 33, stage: 'In progress' } },
    { name: 'Review project', statuses: ['review', 'todo'], expected: { task_count: 2, todo_count: 1, in_progress_count: 0, review_count: 1, completed_count: 0, completion_percent: 0, stage: 'Review' } },
    { name: 'Complete project', statuses: ['done', 'done'], expected: { task_count: 2, todo_count: 0, in_progress_count: 0, review_count: 0, completed_count: 2, completion_percent: 100, stage: 'Complete' } }
  ]
  for (const item of cases) {
    const project = db.prepare(`INSERT INTO projects (name, course, owner_id) VALUES (?, 'TEST 200', ?)`)
      .run(item.name, ownerId)
    for (const status of item.statuses) {
      db.prepare(`INSERT INTO tasks (project_id, title, status, created_by) VALUES (?, ?, ?, ?)`)
        .run(project.lastInsertRowid, `${item.name} ${status}`, status, leaderId)
    }
  }

  const facultyProjects = await request(app).get('/api/projects').set('Authorization', ['Bearer', facultyToken].join(' '))
  assert.equal(facultyProjects.status, 200)
  for (const item of cases) {
    const project = facultyProjects.body.projects.find((entry) => entry.name === item.name)
    assert.ok(project, `Faculty should see ${item.name}`)
    assert.equal(project.owner_name, 'Other Project Owner')
    assert.equal(project.course, 'TEST 200')
    assert.equal(project.member_count, 0)
    for (const [key, value] of Object.entries(item.expected)) assert.equal(project[key], value, `${item.name}: ${key}`)
  }

  for (const token of [memberToken, leaderToken]) {
    const scopedProjects = await request(app).get('/api/projects').set('Authorization', ['Bearer', token].join(' '))
    assert.equal(scopedProjects.status, 200)
    assert.deepEqual(scopedProjects.body.projects.map((project) => project.id), [projectId])
    assert.equal(Object.hasOwn(scopedProjects.body.projects[0], 'completion_percent'), false)
    assert.equal(Object.hasOwn(scopedProjects.body.projects[0], 'stage'), false)
  }
})

test('project leadership manages projects, memberships, and tasks', async () => {
  const created = await request(app).post('/api/projects').set('Authorization', `Bearer ${leaderToken}`)
    .send({ name: 'Temporary workspace', description: 'A short-lived project for API coverage.', course: 'TEST 101' })
  assert.equal(created.status, 201)
  const id = created.body.project.id
  assert.equal((await request(app).post(`/api/projects/${id}/members`).set('Authorization', `Bearer ${leaderToken}`).send({ user_id: memberId })).status, 200)
  const taskResponse = await request(app).post('/api/tasks').set('Authorization', `Bearer ${leaderToken}`)
    .send({ project_id: id, title: 'Prepare initial review', assignee_id: memberId })
  assert.equal(taskResponse.status, 201)
  const taskId = taskResponse.body.task.id
  const statusUpdate = await request(app).put(`/api/tasks/${taskId}`).set('Authorization', `Bearer ${memberToken}`).send({ status: 'in_progress' })
  assert.equal(statusUpdate.status, 200)
  assert.equal(statusUpdate.body.task.status, 'in_progress')
  assert.equal((await request(app).put(`/api/tasks/${taskId}`).set('Authorization', `Bearer ${memberToken}`).send({ title: 'Escalation' })).status, 403)
  const updated = await request(app).put(`/api/projects/${id}`).set('Authorization', `Bearer ${leaderToken}`)
    .send({ name: 'Temporary workspace edited', description: 'Updated project context.', course: 'TEST 102' })
  assert.equal(updated.body.project.name, 'Temporary workspace edited')
  assert.equal((await request(app).delete(`/api/projects/${id}`).set('Authorization', `Bearer ${leaderToken}`)).status, 204)
})

test('evidence is persisted, scored, and auditable', async () => {
  const submission = await request(app).post('/api/evidence').set('Authorization', `Bearer ${memberToken}`).send({
    project_id: projectId, category: 'Testing', title: 'Accessibility pass',
    description: 'Checked focus order and keyboard access.', points: 92
  })
  assert.equal(submission.status, 201)
  const scores = await request(app).get(`/api/scores?project_id=${projectId}`).set('Authorization', `Bearer ${leaderToken}`)
  assert.equal(scores.status, 200)
  const member = scores.body.scores.find((person) => person.id === memberId)
  assert.equal(member.breakdown.Testing.count, 1)
  assert.equal(member.breakdown.Testing.average, 92)
  assert.equal(member.breakdown.Testing.weight, 0.25)
  const audit = await request(app).get(`/api/audit?project_id=${projectId}`).set('Authorization', `Bearer ${leaderToken}`)
  assert.ok(audit.body.logs.some((entry) => entry.action === 'submitted'))
})

test('GitHub configuration is explicit and only GitHub owner/repository URLs are accepted', async () => {
  const previousId = process.env.GITHUB_CLIENT_ID
  const previousSecret = process.env.GITHUB_CLIENT_SECRET
  delete process.env.GITHUB_CLIENT_ID
  delete process.env.GITHUB_CLIENT_SECRET
  const config = await request(app).get('/api/auth/config')
  assert.equal(config.body.githubOAuth.enabled, false)
  assert.equal((await request(app).get(`/api/github/config?project_id=${projectId}`).set('Authorization', `Bearer ${leaderToken}`)).body.oauthConfigured, false)
  assert.equal((await request(app).post('/api/github/sync').set('Authorization', `Bearer ${leaderToken}`).send({ project_id: projectId })).status, 400)
  for (const repository_url of ['file:///etc/passwd', 'https://github.com.evil.test/org/repo', 'https://github.com/org/repo/../../other']) {
    assert.equal((await request(app).put('/api/github/repository').set('Authorization', `Bearer ${leaderToken}`).send({ project_id: projectId, repository_url })).status, 400)
  }
  assert.equal((await request(app).put('/api/github/repository').set('Authorization', `Bearer ${memberToken}`)
    .send({ project_id: projectId, repository_url: 'https://github.com/org/repo' })).status, 403)
  const saved = await request(app).put('/api/github/repository').set('Authorization', `Bearer ${leaderToken}`)
    .send({ project_id: projectId, repository_url: 'https://github.com/field-notes/study-map.git' })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.repository.url, 'https://github.com/field-notes/study-map')
  if (previousId === undefined) delete process.env.GITHUB_CLIENT_ID
  else process.env.GITHUB_CLIENT_ID = previousId
  if (previousSecret === undefined) delete process.env.GITHUB_CLIENT_SECRET
  else process.env.GITHUB_CLIENT_SECRET = previousSecret
})

test('GitHub sync imports only API records and deduplicates commits and pull requests', async () => {
  process.env.GITHUB_CLIENT_ID = 'test-oauth-client'
  process.env.GITHUB_CLIENT_SECRET = 'test-oauth-secret'
  db.prepare('UPDATE users SET github_id=?, github_access_token=? WHERE id=?').run('1001', 'test-access-token', leaderId)
  const originalFetch = globalThis.fetch
  const requested = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requested.push(url)
    if (url.includes('/commits?')) return {
      ok: true, json: async () => [{
        sha: 'a'.repeat(40), commit: { message: 'Add map filters\n\nDetails', author: { date: '2026-10-10T10:00:00Z', name: 'External Contributor' } },
        author: { id: 2020, login: 'map-maker' }
      }]
    }
    if (url.includes('/pulls?')) return {
      ok: true, json: async () => [{
        number: 17, title: 'Add accessible map controls', state: 'closed', merged_at: '2026-10-11T10:00:00Z',
        html_url: 'https://github.com/field-notes/study-map/pull/17', created_at: '2026-10-09T10:00:00Z',
        user: { id: 2020, login: 'map-maker' }
      }]
    }
    throw new Error(`Unexpected GitHub API URL ${url}`)
  }
  try {
    const first = await request(app).post('/api/github/sync').set('Authorization', `Bearer ${leaderToken}`).send({ project_id: projectId })
    assert.equal(first.status, 200)
    assert.deepEqual(first.body.synced, { commits: 1, pullRequests: 1 })
    assert.equal(requested.length, 2)
    assert.ok(requested.every((url) => url.startsWith('https://api.github.com/repos/field-notes/study-map/')))
    const records = await request(app).get(`/api/github?project_id=${projectId}`).set('Authorization', `Bearer ${leaderToken}`)
    assert.equal(records.body.commits[0].message, 'Add map filters')
    assert.equal(records.body.commits[0].contributor_name, 'External Contributor')
    assert.equal(records.body.pullRequests[0].status, 'merged')
    assert.equal(records.body.pullRequests[0].contributor_name, 'map-maker')
    const again = await request(app).post('/api/github/sync').set('Authorization', `Bearer ${leaderToken}`).send({ project_id: projectId })
    assert.deepEqual(again.body.synced, { commits: 0, pullRequests: 0 })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM evidence WHERE project_id=? AND source LIKE \'github_%\'').get(projectId).n, 0)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET
  }
})

test('GitHub OAuth state is short-lived and rejects a callback with mismatched state', async () => {
  process.env.GITHUB_CLIENT_ID = 'test-oauth-client'
  process.env.GITHUB_CLIENT_SECRET = 'test-oauth-secret'
  const started = await request(app).get('/api/auth/github?role=leader')
  assert.equal(started.status, 302)
  const location = new URL(started.headers.location)
  assert.equal(location.origin, 'https://github.com')
  assert.equal(location.searchParams.get('scope'), 'read:user user:email')
  assert.equal(location.searchParams.get('redirect_uri'), 'http://localhost:4000/api/auth/github/callback')
  const cookie = started.headers['set-cookie'][0].split(';')[0]
  const callback = await request(app).get('/api/auth/github/callback?state=wrong&code=unused').set('Cookie', cookie)
  assert.equal(callback.status, 303)
  assert.match(callback.headers.location, /github_error/)
  assert.match(callback.headers['set-cookie'][0], /Max-Age=0/)
  delete process.env.GITHUB_CLIENT_ID
  delete process.env.GITHUB_CLIENT_SECRET
})

test('GitHub OAuth creates a self-registered leader from a verified identity without exposing its token', async () => {
  process.env.GITHUB_CLIENT_ID = 'test-oauth-client'
  process.env.GITHUB_CLIENT_SECRET = 'test-oauth-secret'
  const originalFetch = globalThis.fetch
  const requested = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requested.push(url)
    if (url === 'https://github.com/login/oauth/access_token') return { ok: true, json: async () => ({ access_token: 'oauth-secret-token' }) }
    if (url === 'https://api.github.com/user') return { ok: true, json: async () => ({ id: 88008, login: 'octo-student', name: 'Octo Student' }) }
    if (url === 'https://api.github.com/user/emails') return { ok: true, json: async () => [
      { email: 'octo-student@example.test', primary: true, verified: true }
    ] }
    throw new Error(`Unexpected OAuth URL ${url}`)
  }
  try {
    const started = await request(app).get('/api/auth/github?role=leader')
    const state = new URL(started.headers.location).searchParams.get('state')
    const cookie = started.headers['set-cookie'][0].split(';')[0]
    const callback = await request(app).get(`/api/auth/github/callback?state=${state}&code=mock-code`).set('Cookie', cookie)
    assert.equal(callback.status, 303)
    const fragment = new URLSearchParams(new URL(callback.headers.location).hash.slice(1))
    assert.equal(fragment.get('github_error'), null)
    const session = JSON.parse(fragment.get('github_user'))
    assert.equal(session.role, 'leader')
    assert.equal(session.email, 'octo-student@example.test')
    assert.equal(callback.headers.location.includes('oauth-secret-token'), false)
    assert.ok(requested.every((url) => url.startsWith('https://')))
    const stored = db.prepare('SELECT github_access_token FROM users WHERE github_id=?').get('88008')
    assert.equal(stored.github_access_token, 'oauth-secret-token')
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${fragment.get('github_token')}`)
    assert.equal(me.body.user.role, 'leader')
    assert.equal(JSON.stringify(me.body).includes('oauth-secret-token'), false)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET
  }
})

test('GitHub OAuth refuses unverified account linking and supports authenticated linking', async () => {
  process.env.GITHUB_CLIENT_ID = 'test-oauth-client'
  process.env.GITHUB_CLIENT_SECRET = 'test-oauth-secret'
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url === 'https://github.com/login/oauth/access_token') return { ok: true, json: async () => ({ access_token: 'verified-link-token' }) }
    if (url === 'https://api.github.com/user') return { ok: true, json: async () => ({ id: 99009, login: 'morgan-github', name: 'Morgan Member' }) }
    if (url === 'https://api.github.com/user/emails') return { ok: true, json: async () => [
      { email: 'morgan@example.test', primary: true, verified: true }
    ] }
    throw new Error(`Unexpected OAuth URL ${url}`)
  }
  const callbackWith = async (url, cookie) => {
    const state = new URL(url).searchParams.get('state')
    return request(app).get(`/api/auth/github/callback?state=${state}&code=mock-code`).set('Cookie', cookie)
  }
  try {
    const unauthenticatedStart = await request(app).get('/api/auth/github?role=leader')
    const emailCollision = await callbackWith(
      unauthenticatedStart.headers.location, unauthenticatedStart.headers['set-cookie'][0].split(';')[0]
    )
    const errorFragment = new URLSearchParams(new URL(emailCollision.headers.location).hash.slice(1))
    assert.match(errorFragment.get('github_error'), /already exists/)
    assert.equal(db.prepare('SELECT github_id FROM users WHERE id=?').get(memberId).github_id, null)

    const link = await request(app).post('/api/auth/github/link').set('Authorization', `Bearer ${memberToken}`).send({})
    assert.equal(link.status, 200)
    const callback = await callbackWith(link.body.url, link.headers['set-cookie'][0].split(';')[0])
    const fragment = new URLSearchParams(new URL(callback.headers.location).hash.slice(1))
    assert.equal(fragment.get('github_error'), null)
    assert.equal(JSON.parse(fragment.get('github_user')).id, memberId)
    assert.equal(db.prepare('SELECT github_access_token FROM users WHERE id=?').get(memberId).github_access_token, 'verified-link-token')
    assert.equal((await request(app).post('/api/auth/github/link').set('Authorization', `Bearer ${memberToken}`).send({})).status, 200)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET
  }
})

test('faculty can resolve disputes once', async () => {
  const created = await request(app).post('/api/disputes').set('Authorization', `Bearer ${memberToken}`)
    .send({ project_id: projectId, reason: 'Please review the contribution context.' })
  assert.equal(created.status, 201)
  const disputeId = created.body.dispute.id
  const resolved = await request(app).patch(`/api/disputes/${disputeId}`).set('Authorization', `Bearer ${facultyToken}`)
    .send({ status: 'resolved', resolution: 'Reviewed with the project team and clarified next steps.' })
  assert.equal(resolved.status, 200)
  assert.equal(resolved.body.dispute.status, 'resolved')
  assert.equal((await request(app).patch(`/api/disputes/${disputeId}`).set('Authorization', `Bearer ${facultyToken}`)
    .send({ status: 'dismissed', resolution: 'Already handled.' })).status, 409)
})

test('faculty bootstrap stays consumed even if the provisioned account is later removed', async () => {
  const id = db.prepare("SELECT id FROM users WHERE role='faculty'").get().id
  db.prepare('UPDATE disputes SET resolved_by=NULL WHERE resolved_by=?').run(id)
  db.prepare('DELETE FROM users WHERE id=?').run(id)
  const secondAttempt = await request(app).post('/api/auth/bootstrap-faculty').send({
    name: 'Replacement Faculty', email: 'replacement@example.test', password: 'safe-password-123',
    bootstrap_secret: process.env.FACULTY_BOOTSTRAP_SECRET
  })
  assert.equal(secondAttempt.status, 409)
})
