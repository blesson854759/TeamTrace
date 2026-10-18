import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from './database.js'

const jwtSecret = process.env.TEAMTRACE_JWT_SECRET || randomBytes(48).toString('base64url')
const categories = ['Development', 'Testing', 'Documentation', 'Collaboration', 'Planning']
const weights = { Development: 0.35, Testing: 0.25, Documentation: 0.2, Collaboration: 0.1, Planning: 0.1 }
const roleLabels = { faculty: 'Faculty', leader: 'Team Leader', member: 'Team Member' }
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export const app = express()
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }))
app.use(express.json({ limit: '1mb' }))

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const fail = (status, message) => { throw new ApiError(status, message) }
const githubOAuthReady = () => Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
const githubCallbackUrl = () => {
  const callback = new URL(process.env.GITHUB_CALLBACK_URL || 'http://localhost:4000/api/auth/github/callback')
  if ((!['https:'].includes(callback.protocol) && !(callback.protocol === 'http:' && localHosts.has(callback.hostname))) ||
      callback.pathname !== '/api/auth/github/callback' || callback.search || callback.hash || callback.username || callback.password)
    throw new Error('GitHub callback URL must be the secure TeamTrace OAuth callback endpoint.')
  return callback.toString()
}
const clientOrigin = () => process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const idParam = z.coerce.number().int().positive()
const body = (schema, input) => {
  const result = schema.safeParse(input)
  if (!result.success) fail(400, result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  return result.data
}
const userShape = (user) => user && ({
  id: user.id, name: user.name, email: user.email, role: user.role,
  roleLabel: roleLabels[user.role], persona: user.persona, initials: user.initials
})
const audit = (projectId, userId, action, entityType, entityId, details = {}) =>
  db.prepare(`INSERT INTO audit_logs
    (project_id, actor_id, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?)`).run(projectId || null, userId || null, action, entityType, entityId || null, JSON.stringify(details))

function auth(req, _res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return next(new ApiError(401, 'Sign in to continue.'))
  try {
    const payload = jwt.verify(token, jwtSecret)
    req.user = db.prepare('SELECT * FROM users WHERE id = ? AND disabled=0').get(payload.sub)
    if (!req.user) throw new Error('Account no longer exists')
    next()
  } catch {
    next(new ApiError(401, 'Your session is invalid or expired. Please sign in again.'))
  }
}

function projectRow(projectId) {
  const id = idParam.parse(projectId)
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  if (!project) fail(404, 'Project not found.')
  return project
}

function canAccessProject(user, projectId) {
  const project = projectRow(projectId)
  if (user.role === 'faculty' || project.owner_id === user.id) return project
  const member = db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(project.id, user.id)
  if (!member) fail(403, 'You do not have access to this project.')
  return project
}

function parseGithubRepository(input) {
  let url
  try { url = new URL(input) } catch { fail(400, 'Enter a valid GitHub repository URL, such as https://github.com/owner/repository.') }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash)
    fail(400, 'Only HTTPS repository URLs on github.com are supported.')
  const parts = url.pathname.split('/').filter(Boolean)
  const repoName = parts[1]?.replace(/\.git$/, '')
  if (parts.length !== 2 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(parts[0]) ||
      !repoName || repoName === '.' || repoName === '..' || !/^[A-Za-z0-9_.-]+$/.test(repoName))
    fail(400, 'Enter a repository URL in the form https://github.com/owner/repository.')
  return { owner: parts[0], repo: repoName }
}

function cookieValue(header, name) {
  const pair = (header || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`))
  if (!pair) return ''
  try { return decodeURIComponent(pair.slice(name.length + 1)) } catch { return '' }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && timingSafeEqual(a, b)
}

function appSession(user) {
  return jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '8h' })
}

function createGithubState(role, intent, userId = 0) {
  const state = randomBytes(32).toString('hex')
  const payload = `${state}.${role}.${intent}.${userId}`
  const signature = createHmac('sha256', jwtSecret).update(payload).digest('base64url')
  return { state, cookie: `${payload}.${signature}` }
}

function githubAuthorizeUrl(state) {
  const authorize = new URL('https://github.com/login/oauth/authorize')
  authorize.search = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: githubCallbackUrl(),
    scope: 'read:user user:email',
    state
  }).toString()
  return authorize.toString()
}

function githubRedirect(res, values) {
  const origin = new URL(clientOrigin())
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || !['', '/'].includes(origin.pathname))
    fail(500, 'Client origin must be an HTTP or HTTPS origin.')
  const fragment = new URLSearchParams(values)
  res.redirect(303, `${origin.origin}/#${fragment.toString()}`)
}

const requireLeadership = (user) => {
  if (!['faculty', 'leader'].includes(user.role)) fail(403, 'This action is available to faculty and team leaders.')
}
const projectSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).default(''),
  course: z.string().trim().max(120).default(''),
  status: z.enum(['active', 'completed', 'archived']).default('active')
})
const taskSchema = z.object({
  project_id: z.coerce.number().int().positive(),
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().max(2000).default(''),
  status: z.enum(['todo', 'in_progress', 'review', 'done']).default('todo'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  assignee_id: z.coerce.number().int().positive().nullable().optional(),
  due_date: z.string().date().nullable().optional()
})
const evidenceSchema = z.object({
  project_id: z.coerce.number().int().positive(),
  task_id: z.coerce.number().int().positive().nullable().optional(),
  category: z.enum(categories),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(2000).default(''),
  url: z.string().trim().url().nullable().optional().or(z.literal('')),
  points: z.coerce.number().min(0).max(100).default(50)
})
const disputeSchema = z.object({
  project_id: z.coerce.number().int().positive(),
  evidence_id: z.coerce.number().int().positive().nullable().optional(),
  reason: z.string().trim().min(8).max(1200)
})

app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'TeamTrace' }))

app.get('/api/auth/config', (_req, res) => {
  res.json({ githubOAuth: { enabled: githubOAuthReady() } })
})

app.post('/api/auth/login', (req, res, next) => {
  try {
    const input = body(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body)
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND disabled=0').get(input.email)
    if (!user || !user.password_hash || !bcrypt.compareSync(input.password, user.password_hash)) fail(401, 'Email or password is incorrect.')
    const token = appSession(user)
    res.json({ token, user: userShape(user) })
  } catch (error) { next(error) }
})

app.post('/api/auth/register', (req, res, next) => {
  try {
    const input = body(z.object({
      name: z.string().trim().min(2).max(100),
      email: z.string().trim().email().max(254),
      password: z.string().min(10).max(128),
      role: z.enum(['member', 'leader'])
    }), req.body)
    const email = input.email.toLowerCase()
    if (db.prepare('SELECT 1 FROM users WHERE email=? COLLATE NOCASE').get(email))
      fail(409, 'An account with this email already exists.')
    const initials = input.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    const persona = input.role === 'leader' ? 'Team Leader' : 'Team Member'
    const result = db.prepare(`INSERT INTO users (name, email, password_hash, role, persona, initials)
      VALUES (?, ?, ?, ?, ?, ?)`).run(input.name, email, bcrypt.hashSync(input.password, 12), input.role, persona, initials)
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid)
    res.status(201).json({ token: appSession(user), user: userShape(user) })
  } catch (error) { next(error) }
})

app.post('/api/auth/bootstrap-faculty', (req, res, next) => {
  try {
    if (!process.env.FACULTY_BOOTSTRAP_SECRET) fail(404, 'Faculty bootstrap is not enabled.')
    const input = body(z.object({
      name: z.string().trim().min(2).max(100),
      email: z.string().trim().email().max(254),
      password: z.string().min(10).max(128),
      bootstrap_secret: z.string().min(1)
    }), req.body)
    if (!safeEqual(input.bootstrap_secret, process.env.FACULTY_BOOTSTRAP_SECRET)) fail(403, 'Faculty bootstrap secret is invalid.')
    const email = input.email.toLowerCase()
    const initials = input.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    const userId = db.transaction(() => {
      if (db.prepare("SELECT 1 FROM app_settings WHERE key='faculty_bootstrap_completed'").get() ||
          db.prepare("SELECT 1 FROM users WHERE role='faculty' LIMIT 1").get())
        fail(409, 'A faculty account has already been provisioned.')
      if (db.prepare('SELECT 1 FROM users WHERE email=? COLLATE NOCASE').get(email))
        fail(409, 'An account with this email already exists.')
      const result = db.prepare(`INSERT INTO users (name, email, password_hash, role, persona, initials)
        VALUES (?, ?, ?, 'faculty', 'Faculty', ?)`).run(input.name, email, bcrypt.hashSync(input.password, 12), initials)
      db.prepare("INSERT INTO app_settings (key, value) VALUES ('faculty_bootstrap_completed', '1')").run()
      return result.lastInsertRowid
    })()
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId)
    res.status(201).json({ token: appSession(user), user: userShape(user) })
  } catch (error) { next(error) }
})

app.get('/api/auth/github', (req, res, next) => {
  try {
    if (!githubOAuthReady()) fail(503, 'GitHub sign-in is not configured yet.')
    const role = body(z.enum(['member', 'leader']).default('member'), req.query.role)
    const { state, cookie } = createGithubState(role, 'login')
    const secure = githubCallbackUrl().startsWith('https:')
    res.setHeader('Set-Cookie', `teamtrace_oauth_state=${encodeURIComponent(cookie)}; Max-Age=600; Path=/api/auth/github/callback; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`)
    res.redirect(302, githubAuthorizeUrl(state))
  } catch (error) { next(error) }
})

app.post('/api/auth/github/link', auth, (req, res, next) => {
  try {
    if (!githubOAuthReady()) fail(503, 'GitHub sign-in is not configured yet.')
    if (!['member', 'leader', 'faculty'].includes(req.user.role)) fail(403, 'This account cannot connect GitHub.')
    const { state, cookie } = createGithubState(req.user.role, 'link', req.user.id)
    const secure = githubCallbackUrl().startsWith('https:')
    res.setHeader('Set-Cookie', `teamtrace_oauth_state=${encodeURIComponent(cookie)}; Max-Age=600; Path=/api/auth/github/callback; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`)
    res.json({ url: githubAuthorizeUrl(state) })
  } catch (error) { next(error) }
})

app.get('/api/auth/github/callback', async (req, res) => {
  const cookie = cookieValue(req.headers.cookie, 'teamtrace_oauth_state')
  const [expectedState, role, intent, userId, signature] = cookie.split('.')
  res.setHeader('Set-Cookie', 'teamtrace_oauth_state=; Max-Age=0; Path=/api/auth/github/callback; HttpOnly; SameSite=Lax')
  if (!githubOAuthReady()) return githubRedirect(res, { github_error: 'GitHub sign-in is not configured.' })
  const payload = `${expectedState}.${role}.${intent}.${userId}`
  const expectedSignature = createHmac('sha256', jwtSecret).update(payload).digest('base64url')
  if (!req.query.state || !expectedState || !safeEqual(req.query.state, expectedState) ||
      !safeEqual(signature, expectedSignature) || !['member', 'leader', 'faculty'].includes(role) ||
      !['login', 'link'].includes(intent) || (intent === 'link' && !/^[1-9]\d*$/.test(userId)) ||
      (intent === 'login' && userId !== '0'))
    return githubRedirect(res, { github_error: 'GitHub sign-in could not be verified. Please try again.' })
  if (req.query.error) return githubRedirect(res, { github_error: 'GitHub sign-in was cancelled or declined.' })

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: String(req.query.code || ''),
        redirect_uri: githubCallbackUrl(),
        state: String(req.query.state)
      }),
      signal: AbortSignal.timeout(12000)
    })
    const tokenPayload = await tokenResponse.json().catch(() => ({}))
    if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error('GitHub could not complete sign-in.')
    const githubToken = tokenPayload.access_token
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${githubToken}`, 'X-GitHub-Api-Version': '2022-11-28' }
    const [profileResponse, emailsResponse] = await Promise.all([
      fetch('https://api.github.com/user', { headers, signal: AbortSignal.timeout(12000) }),
      fetch('https://api.github.com/user/emails', { headers, signal: AbortSignal.timeout(12000) })
    ])
    if (!profileResponse.ok || !emailsResponse.ok) throw new Error('GitHub could not verify your profile and email.')
    const profile = await profileResponse.json()
    const emails = await emailsResponse.json()
    const verifiedEmail = Array.isArray(emails) && emails.find((entry) => entry.primary && entry.verified)?.email
    if (!verifiedEmail || !profile.id || !profile.login) throw new Error('Add a verified primary email to your GitHub account and try again.')

    let user
    if (intent === 'link') {
      user = db.prepare('SELECT * FROM users WHERE id=? AND disabled=0').get(Number(userId))
      if (!user) throw new Error('The TeamTrace account for this GitHub connection is unavailable.')
      const linkedAccount = db.prepare('SELECT id FROM users WHERE github_id=? AND disabled=0').get(String(profile.id))
      if (linkedAccount && linkedAccount.id !== user.id) throw new Error('This GitHub account is already linked to another TeamTrace account.')
      if (user.github_id && user.github_id !== String(profile.id)) throw new Error('This TeamTrace account is already linked to a different GitHub account.')
    } else {
      user = db.prepare('SELECT * FROM users WHERE github_id=? AND disabled=0').get(String(profile.id))
      if (!user) {
        const emailAccount = db.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE AND disabled=0').get(verifiedEmail)
        if (emailAccount) throw new Error('An account with this email already exists. Sign in with email and password, then connect GitHub from the Evidence view.')
        const name = String(profile.name || profile.login).trim().slice(0, 100)
        const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
        const result = db.prepare(`INSERT INTO users
          (name, email, password_hash, role, persona, initials, github_id, github_access_token)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          name, verifiedEmail.toLowerCase(), bcrypt.hashSync(randomBytes(48).toString('hex'), 12),
          role, role === 'leader' ? 'Team Leader' : 'Team Member', initials, String(profile.id), githubToken
        )
        user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid)
      }
    }
    db.prepare('UPDATE users SET github_id=?, github_access_token=? WHERE id=?')
      .run(String(profile.id), githubToken, user.id)
    user = db.prepare('SELECT * FROM users WHERE id=?').get(user.id)
    return githubRedirect(res, { github_token: appSession(user), github_user: JSON.stringify(userShape(user)) })
  } catch (error) {
    const message = /verified primary email|different GitHub account|already linked|already exists|unavailable/.test(error.message)
      ? error.message
      : 'GitHub sign-in could not be completed. Check the OAuth app configuration and try again.'
    return githubRedirect(res, { github_error: message })
  }
})

app.get('/api/auth/me', auth, (req, res) => res.json({ user: userShape(req.user) }))

app.get('/api/projects', auth, (req, res) => {
  const rows = req.user.role === 'faculty'
    ? db.prepare(`SELECT p.*, u.name AS owner_name,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,
       (SELECT COUNT(*) FROM project_members pm JOIN users active_u ON active_u.id=pm.user_id AND active_u.disabled=0 WHERE pm.project_id=p.id) AS member_count
       FROM projects p JOIN users u ON u.id=p.owner_id ORDER BY p.updated_at DESC`).all()
    : db.prepare(`SELECT p.*, u.name AS owner_name,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,
       (SELECT COUNT(*) FROM project_members pm JOIN users active_u ON active_u.id=pm.user_id AND active_u.disabled=0 WHERE pm.project_id=p.id) AS member_count
       FROM projects p JOIN users u ON u.id=p.owner_id
       WHERE p.owner_id=? OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=?)
       ORDER BY p.updated_at DESC`).all(req.user.id, req.user.id)
  res.json({ projects: rows })
})

app.post('/api/projects', auth, (req, res, next) => {
  try {
    requireLeadership(req.user)
    const input = body(projectSchema, req.body)
    const result = db.prepare(`INSERT INTO projects (name, description, course, status, owner_id)
      VALUES (?, ?, ?, ?, ?)`).run(input.name, input.description, input.course, input.status, req.user.id)
    db.prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)').run(result.lastInsertRowid, req.user.id)
    audit(result.lastInsertRowid, req.user.id, 'created', 'project', result.lastInsertRowid, { name: input.name })
    res.status(201).json({ project: projectRow(result.lastInsertRowid) })
  } catch (error) { next(error) }
})

app.get('/api/projects/:id', auth, (req, res, next) => {
  try {
    const project = canAccessProject(req.user, req.params.id)
    const members = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.persona, u.initials
      FROM project_members pm JOIN users u ON u.id=pm.user_id
      WHERE pm.project_id=? AND u.disabled=0 ORDER BY u.role, u.name`).all(project.id)
    res.json({ project, members })
  } catch (error) { next(error) }
})

app.post('/api/projects/:id/members', auth, (req, res, next) => {
  try {
    const project = canAccessProject(req.user, req.params.id)
    requireLeadership(req.user)
    const input = body(z.object({ user_id: z.coerce.number().int().positive() }), req.body)
    const member = db.prepare('SELECT id, role FROM users WHERE id=? AND disabled=0').get(input.user_id)
    if (!member) fail(404, 'User not found.')
    db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)').run(project.id, member.id)
    audit(project.id, req.user.id, 'added member', 'project', project.id, { user_id: member.id })
    res.status(200).json({ members: db.prepare('SELECT user_id FROM project_members WHERE project_id=?').all(project.id).map((row) => row.user_id) })
  } catch (error) { next(error) }
})

app.delete('/api/projects/:id/members/:userId', auth, (req, res, next) => {
  try {
    const project = canAccessProject(req.user, req.params.id)
    requireLeadership(req.user)
    const memberId = idParam.parse(req.params.userId)
    if (memberId === project.owner_id) fail(400, 'The project owner cannot be removed.')
    if (!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(project.id, memberId))
      fail(404, 'Project member not found.')
    db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project.id, memberId)
    audit(project.id, req.user.id, 'removed member', 'project', project.id, { user_id: memberId })
    res.status(204).end()
  } catch (error) { next(error) }
})

app.put('/api/projects/:id', auth, (req, res, next) => {
  try {
    const project = canAccessProject(req.user, req.params.id)
    requireLeadership(req.user)
    const input = body(projectSchema, req.body)
    db.prepare(`UPDATE projects SET name=?, description=?, course=?, status=?, updated_at=datetime('now') WHERE id=?`)
      .run(input.name, input.description, input.course, input.status, project.id)
    audit(project.id, req.user.id, 'updated', 'project', project.id, { name: input.name })
    res.json({ project: projectRow(project.id) })
  } catch (error) { next(error) }
})

app.delete('/api/projects/:id', auth, (req, res, next) => {
  try {
    const project = canAccessProject(req.user, req.params.id)
    if (req.user.role !== 'faculty' && project.owner_id !== req.user.id) fail(403, 'Only faculty or the project owner can delete a project.')
    audit(project.id, req.user.id, 'deleted', 'project', project.id, { name: project.name })
    db.prepare('DELETE FROM projects WHERE id=?').run(project.id)
    res.status(204).end()
  } catch (error) { next(error) }
})

app.get('/api/users', auth, (req, res) => {
  const rows = db.prepare('SELECT id, name, email, role, persona, initials FROM users WHERE disabled=0 ORDER BY name').all()
  res.json({ users: rows })
})

app.get('/api/tasks', auth, (req, res, next) => {
  try {
    const projectId = req.query.project_id ? idParam.parse(req.query.project_id) : null
    const accessible = req.user.role === 'faculty'
      ? null
      : db.prepare(`SELECT id FROM projects p WHERE p.owner_id=? OR EXISTS
        (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=?)`).all(req.user.id, req.user.id).map((p) => p.id)
    if (projectId) {
      canAccessProject(req.user, projectId)
      return res.json({ tasks: taskList(projectId) })
    }
    const rows = accessible === null
      ? db.prepare('SELECT id FROM projects').all()
      : accessible.map((id) => ({ id }))
    res.json({ tasks: rows.flatMap((project) => taskList(project.id)) })
  } catch (error) { next(error) }
})

function taskList(projectId) {
  return db.prepare(`SELECT t.*, u.name AS assignee_name, u.initials AS assignee_initials,
    (SELECT COUNT(*) FROM evidence e WHERE e.task_id=t.id) AS evidence_count
    FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
    WHERE t.project_id=? ORDER BY CASE t.status WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'review' THEN 3 ELSE 4 END, t.due_date`).all(projectId)
}

app.post('/api/tasks', auth, (req, res, next) => {
  try {
    const input = body(taskSchema, req.body)
    canAccessProject(req.user, input.project_id)
    requireLeadership(req.user)
    if (input.assignee_id && !db.prepare(`SELECT 1 FROM project_members pm JOIN users u ON u.id=pm.user_id
      WHERE pm.project_id=? AND pm.user_id=? AND u.disabled=0`).get(input.project_id, input.assignee_id))
      fail(400, 'The assignee must belong to this project.')
    const result = db.prepare(`INSERT INTO tasks
      (project_id, title, description, status, priority, assignee_id, due_date, created_by)
      VALUES (@project_id, @title, @description, @status, @priority, @assignee_id, @due_date, @created_by)`)
      .run({ ...input, assignee_id: input.assignee_id ?? null, due_date: input.due_date ?? null, created_by: req.user.id })
    audit(input.project_id, req.user.id, 'created', 'task', result.lastInsertRowid, { title: input.title })
    res.status(201).json({ task: taskList(input.project_id).find((task) => task.id === Number(result.lastInsertRowid)) })
  } catch (error) { next(error) }
})

app.put('/api/tasks/:id', auth, (req, res, next) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(idParam.parse(req.params.id))
    if (!task) fail(404, 'Task not found.')
    canAccessProject(req.user, task.project_id)
    const input = body(taskSchema.partial().omit({ project_id: true }), req.body)
    if (req.user.role === 'member') {
      if (task.assignee_id !== req.user.id) fail(403, 'Members can update only tasks assigned to them.')
      const allowed = Object.keys(input).every((key) => key === 'status')
      if (!allowed) fail(403, 'Members can only update task status.')
    } else requireLeadership(req.user)
    const next = { ...task, ...input }
    if (next.assignee_id && !db.prepare(`SELECT 1 FROM project_members pm JOIN users u ON u.id=pm.user_id
      WHERE pm.project_id=? AND pm.user_id=? AND u.disabled=0`).get(task.project_id, next.assignee_id))
      fail(400, 'The assignee must belong to this project.')
    db.prepare(`UPDATE tasks SET title=?, description=?, status=?, priority=?, assignee_id=?, due_date=?, updated_at=datetime('now') WHERE id=?`)
      .run(next.title, next.description, next.status, next.priority, next.assignee_id, next.due_date, task.id)
    audit(task.project_id, req.user.id, 'updated', 'task', task.id, { title: next.title, status: next.status })
    res.json({ task: taskList(task.project_id).find((item) => item.id === task.id) })
  } catch (error) { next(error) }
})

app.delete('/api/tasks/:id', auth, (req, res, next) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(idParam.parse(req.params.id))
    if (!task) fail(404, 'Task not found.')
    canAccessProject(req.user, task.project_id)
    requireLeadership(req.user)
    audit(task.project_id, req.user.id, 'deleted', 'task', task.id, { title: task.title })
    db.prepare('DELETE FROM tasks WHERE id=?').run(task.id)
    res.status(204).end()
  } catch (error) { next(error) }
})

app.get('/api/evidence', auth, (req, res, next) => {
  try {
    const projectId = req.query.project_id ? idParam.parse(req.query.project_id) : null
    if (projectId) canAccessProject(req.user, projectId)
    const rows = projectId
      ? db.prepare(`SELECT e.*, u.name AS contributor_name, u.initials, t.title AS task_title
        FROM evidence e JOIN users u ON u.id=e.user_id LEFT JOIN tasks t ON t.id=e.task_id
        WHERE e.project_id=? ORDER BY e.created_at DESC`).all(projectId)
      : db.prepare(`SELECT e.*, u.name AS contributor_name, u.initials, t.title AS task_title
        FROM evidence e JOIN users u ON u.id=e.user_id LEFT JOIN tasks t ON t.id=e.task_id
        WHERE e.project_id IN (SELECT id FROM projects p WHERE p.owner_id=? OR EXISTS
          (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=?))
        ORDER BY e.created_at DESC`).all(req.user.id, req.user.id)
    res.json({ evidence: rows })
  } catch (error) { next(error) }
})

app.post('/api/evidence', auth, (req, res, next) => {
  try {
    const input = body(evidenceSchema, req.body)
    canAccessProject(req.user, input.project_id)
    if (input.task_id && !db.prepare('SELECT 1 FROM tasks WHERE id=? AND project_id=?').get(input.task_id, input.project_id))
      fail(400, 'Choose a task in this project.')
    if (input.url && !['http:', 'https:'].includes(new URL(input.url).protocol)) fail(400, 'Evidence links must use HTTP or HTTPS.')
    const result = db.prepare(`INSERT INTO evidence
      (project_id, task_id, user_id, category, title, description, url, points)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.project_id, input.task_id ?? null, req.user.id, input.category,
      input.title, input.description, input.url || null, input.points
    )
    audit(input.project_id, req.user.id, 'submitted', 'evidence', result.lastInsertRowid, { title: input.title, category: input.category })
    res.status(201).json({ evidence: db.prepare(`SELECT e.*, u.name AS contributor_name, u.initials, t.title AS task_title
      FROM evidence e JOIN users u ON u.id=e.user_id LEFT JOIN tasks t ON t.id=e.task_id WHERE e.id=?`).get(result.lastInsertRowid) })
  } catch (error) { next(error) }
})

app.put('/api/evidence/:id', auth, (req, res, next) => {
  try {
    const evidence = db.prepare('SELECT * FROM evidence WHERE id=?').get(idParam.parse(req.params.id))
    if (!evidence) fail(404, 'Evidence not found.')
    canAccessProject(req.user, evidence.project_id)
    if (req.user.role === 'member' && evidence.user_id !== req.user.id) fail(403, 'You can edit only evidence you submitted.')
    if (evidence.source !== 'manual') fail(403, 'Repository-synced evidence cannot be edited.')
    const input = body(evidenceSchema.partial().omit({ project_id: true }), req.body)
    const next = { ...evidence, ...input }
    if (next.task_id && !db.prepare('SELECT 1 FROM tasks WHERE id=? AND project_id=?').get(next.task_id, evidence.project_id))
      fail(400, 'Choose a task in this project.')
    if (next.url && !['http:', 'https:'].includes(new URL(next.url).protocol)) fail(400, 'Evidence links must use HTTP or HTTPS.')
    db.prepare(`UPDATE evidence SET task_id=?, category=?, title=?, description=?, url=?, points=? WHERE id=?`)
      .run(next.task_id, next.category, next.title, next.description, next.url || null, next.points, evidence.id)
    audit(evidence.project_id, req.user.id, 'updated', 'evidence', evidence.id, { title: next.title })
    res.json({ evidence: db.prepare(`SELECT e.*, u.name AS contributor_name, u.initials, t.title AS task_title
      FROM evidence e JOIN users u ON u.id=e.user_id LEFT JOIN tasks t ON t.id=e.task_id WHERE e.id=?`).get(evidence.id) })
  } catch (error) { next(error) }
})

app.delete('/api/evidence/:id', auth, (req, res, next) => {
  try {
    const evidence = db.prepare('SELECT * FROM evidence WHERE id=?').get(idParam.parse(req.params.id))
    if (!evidence) fail(404, 'Evidence not found.')
    canAccessProject(req.user, evidence.project_id)
    if (req.user.role === 'member' && evidence.user_id !== req.user.id) fail(403, 'You can remove only evidence you submitted.')
    if (evidence.source !== 'manual') fail(403, 'Repository-synced evidence cannot be removed.')
    audit(evidence.project_id, req.user.id, 'deleted', 'evidence', evidence.id, { title: evidence.title })
    db.prepare('DELETE FROM evidence WHERE id=?').run(evidence.id)
    res.status(204).end()
  } catch (error) { next(error) }
})

function calculateScores(projectId) {
  const people = db.prepare(`SELECT u.id, u.name, u.persona, u.initials
    FROM project_members pm JOIN users u ON u.id=pm.user_id
    WHERE pm.project_id=? AND u.role='member' ORDER BY u.name`).all(projectId)
  const rows = db.prepare(`SELECT user_id, category, AVG(points) AS average, COUNT(*) AS count
    FROM evidence WHERE project_id=? GROUP BY user_id, category`).all(projectId)
  const byPerson = new Map()
  for (const row of rows) {
    if (!byPerson.has(row.user_id)) byPerson.set(row.user_id, {})
    byPerson.get(row.user_id)[row.category] = { average: Math.round(row.average), count: row.count }
  }
  return people.map((person) => {
    const evidence = byPerson.get(person.id) || {}
    const breakdown = Object.fromEntries(categories.map((category) => {
      const average = evidence[category]?.average || 0
      return [category, { average, count: evidence[category]?.count || 0, weight: weights[category], weighted: Math.round(average * weights[category] * 10) / 10 }]
    }))
    const score = Math.round(Object.values(breakdown).reduce((sum, value) => sum + value.weighted, 0))
    return { ...person, score, breakdown, evidence_count: Object.values(breakdown).reduce((n, value) => n + value.count, 0) }
  })
}

app.get('/api/scores', auth, (req, res, next) => {
  try {
    const projectId = idParam.parse(req.query.project_id)
    canAccessProject(req.user, projectId)
    const scores = calculateScores(projectId)
    const evidenceByCategory = categories.map((category) => {
      const entry = db.prepare('SELECT COUNT(*) AS count FROM evidence WHERE project_id=? AND category=?').get(projectId, category)
      return { category, count: entry.count, weight: Math.round(weights[category] * 100) }
    })
    res.json({ scores, categories: evidenceByCategory, weights })
  } catch (error) { next(error) }
})

app.get('/api/dashboard', auth, (req, res, next) => {
  try {
    const projectId = req.query.project_id ? idParam.parse(req.query.project_id) : null
    if (projectId) canAccessProject(req.user, projectId)
    const projectIds = projectId ? [projectId] : req.user.role === 'faculty'
      ? db.prepare('SELECT id FROM projects').all().map((row) => row.id)
      : db.prepare(`SELECT id FROM projects p WHERE p.owner_id=? OR EXISTS
        (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=?)`).all(req.user.id, req.user.id).map((row) => row.id)
    if (!projectIds.length) return res.json({ summary: { projects: 0, tasks: 0, completed: 0, evidence: 0, openDisputes: 0 }, scores: [], activity: [], trend: [] })
    const marks = projectIds.map(() => '?').join(',')
    const summary = {
      projects: projectIds.length,
      tasks: db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE project_id IN (${marks})`).get(...projectIds).n,
      completed: db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE project_id IN (${marks}) AND status='done'`).get(...projectIds).n,
      evidence: db.prepare(`SELECT COUNT(*) AS n FROM evidence WHERE project_id IN (${marks})`).get(...projectIds).n,
      openDisputes: db.prepare(`SELECT COUNT(*) AS n FROM disputes WHERE project_id IN (${marks}) AND status='open'`).get(...projectIds).n
    }
    const scores = projectId ? calculateScores(projectId) : []
    const activity = db.prepare(`SELECT a.*, u.name AS actor_name, u.initials
      FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
      WHERE a.project_id IN (${marks}) ORDER BY a.created_at DESC LIMIT 6`).all(...projectIds)
    const trend = projectId ? db.prepare(`SELECT date(e.created_at) AS day, u.name AS name, SUM(e.points) AS points
      FROM evidence e JOIN users u ON u.id=e.user_id WHERE e.project_id=? AND e.created_at >= date('now','-13 days')
      GROUP BY day, e.user_id ORDER BY day`).all(projectId) : []
    res.json({ summary, scores, activity, trend })
  } catch (error) { next(error) }
})

app.get('/api/github/config', auth, (req, res, next) => {
  try {
    const project = canAccessProject(req.user, req.query.project_id)
    res.json({
      oauthConfigured: githubOAuthReady(),
      githubAccountConnected: Boolean(req.user.github_id && req.user.github_access_token),
      repository: project.github_repo_owner && project.github_repo_name
        ? { owner: project.github_repo_owner, name: project.github_repo_name, url: `https://github.com/${project.github_repo_owner}/${project.github_repo_name}` }
        : null,
      lastSync: db.prepare("SELECT created_at FROM audit_logs WHERE project_id=? AND entity_type='github' ORDER BY id DESC LIMIT 1").get(project.id)?.created_at || null
    })
  } catch (error) { next(error) }
})

app.put('/api/github/repository', auth, (req, res, next) => {
  try {
    const input = body(z.object({
      project_id: z.coerce.number().int().positive(),
      repository_url: z.string().trim().min(1).max(300)
    }), req.body)
    const project = canAccessProject(req.user, input.project_id)
    requireLeadership(req.user)
    const repository = parseGithubRepository(input.repository_url)
    db.prepare(`UPDATE projects SET github_repo_owner=?, github_repo_name=?, updated_at=datetime('now') WHERE id=?`)
      .run(repository.owner, repository.repo, project.id)
    audit(project.id, req.user.id, 'connected', 'github_repository', null, { repository: `${repository.owner}/${repository.repo}` })
    res.json({ repository: { ...repository, url: `https://github.com/${repository.owner}/${repository.repo}` } })
  } catch (error) { next(error) }
})

async function githubApi(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    signal: AbortSignal.timeout(12000)
  })
  if (!response.ok) {
    if (response.status === 404) fail(400, 'GitHub could not access this repository. Check the URL and confirm it is public; private repository access is not included in the default OAuth scope.')
    if (response.status === 401) fail(400, 'Your GitHub connection has expired. Sign in with GitHub again.')
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
      fail(429, 'GitHub API rate limit reached. Wait before syncing again.')
    if (response.status === 403) fail(403, 'GitHub denied repository access. The connected account may not have permission to read this repository.')
    fail(502, `GitHub API request failed (${response.status}).`)
  }
  return response.json()
}

async function githubPages(owner, repo, path, token) {
  const records = []
  for (let page = 1; page <= 3; page += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const batch = await githubApi(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${path}${separator}per_page=100&page=${page}`, token)
    if (!Array.isArray(batch)) fail(502, 'GitHub returned an unexpected repository response.')
    records.push(...batch)
    if (batch.length < 100) break
  }
  return records
}

app.post('/api/github/sync', auth, async (req, res, next) => {
  try {
    const projectId = idParam.parse(req.body.project_id)
    const project = canAccessProject(req.user, projectId)
    requireLeadership(req.user)
    if (!project.github_repo_owner || !project.github_repo_name) fail(400, 'Connect a GitHub repository before syncing.')
    if (!githubOAuthReady()) fail(503, 'GitHub OAuth is not configured on this server yet.')
    if (!req.user.github_access_token) fail(400, 'Sign in with GitHub using the account that will sync this project.')

    let commits
    let pullRequests
    try {
      [commits, pullRequests] = await Promise.all([
        githubPages(project.github_repo_owner, project.github_repo_name, 'commits', req.user.github_access_token),
        githubPages(project.github_repo_owner, project.github_repo_name, 'pulls?state=all', req.user.github_access_token)
      ])
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') fail(504, 'GitHub did not respond in time. Try syncing again.')
      throw error
    }

    let commitAdded = 0
    for (const commit of commits) {
      if (!commit?.sha || !commit?.commit?.message) continue
      const author = commit.author || null
      const member = author?.id ? db.prepare('SELECT id FROM users WHERE github_id=?').get(String(author.id)) : null
      const committedAt = commit.commit.author?.date || commit.commit.committer?.date || new Date().toISOString()
      commitAdded += db.prepare(`INSERT OR IGNORE INTO github_commits
        (project_id, user_id, sha, message, committed_at, author_login, author_name, repository_owner, repository_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        project.id, member?.id || null, commit.sha, commit.commit.message.split('\n')[0].slice(0, 500),
        committedAt, author?.login || null, commit.commit.author?.name || author?.login || 'GitHub contributor',
        project.github_repo_owner, project.github_repo_name
      ).changes
    }

    let pullRequestsAdded = 0
    for (const pullRequest of pullRequests) {
      if (!Number.isInteger(pullRequest?.number) || !pullRequest?.html_url) continue
      const author = pullRequest.user || null
      const member = author?.id ? db.prepare('SELECT id FROM users WHERE github_id=?').get(String(author.id)) : null
      const status = pullRequest.state === 'open' ? 'open' : pullRequest.merged_at ? 'merged' : 'closed'
      pullRequestsAdded += db.prepare(`INSERT OR IGNORE INTO github_pull_requests
        (project_id, user_id, number, title, status, url, created_at, author_login, author_name, repository_owner, repository_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        project.id, member?.id || null, pullRequest.number, String(pullRequest.title || 'Untitled pull request').slice(0, 500),
        status, pullRequest.html_url, pullRequest.created_at || new Date().toISOString(),
        author?.login || null, author?.login || 'GitHub contributor', project.github_repo_owner, project.github_repo_name
      ).changes
    }
    audit(project.id, req.user.id, 'synced', 'github', null, {
      repository: `${project.github_repo_owner}/${project.github_repo_name}`,
      commits: commitAdded,
      pullRequests: pullRequestsAdded
    })
    res.json({
      synced: { commits: commitAdded, pullRequests: pullRequestsAdded },
      message: commitAdded || pullRequestsAdded
        ? `GitHub sync complete · ${commitAdded} commits and ${pullRequestsAdded} pull requests added.`
        : 'GitHub was checked. No new commits or pull requests were found.'
    })
  } catch (error) { next(error) }
})

app.get('/api/github', auth, (req, res, next) => {
  try {
    const projectId = idParam.parse(req.query.project_id)
    canAccessProject(req.user, projectId)
    const commits = db.prepare(`SELECT c.*, COALESCE(u.name, c.author_name, c.author_login, 'GitHub contributor') AS contributor_name, t.title AS task_title FROM github_commits c
      LEFT JOIN users u ON u.id=c.user_id LEFT JOIN tasks t ON t.id=c.task_id
      WHERE c.project_id=? ORDER BY c.committed_at DESC`).all(projectId)
    const pullRequests = db.prepare(`SELECT p.*, COALESCE(u.name, p.author_name, p.author_login, 'GitHub contributor') AS contributor_name, t.title AS task_title FROM github_pull_requests p
      LEFT JOIN users u ON u.id=p.user_id LEFT JOIN tasks t ON t.id=p.task_id
      WHERE p.project_id=? ORDER BY p.created_at DESC`).all(projectId)
    res.json({ commits, pullRequests, lastSync: db.prepare(`SELECT created_at FROM audit_logs WHERE project_id=? AND entity_type='github' ORDER BY id DESC LIMIT 1`).get(projectId)?.created_at || null })
  } catch (error) { next(error) }
})

app.get('/api/disputes', auth, (req, res, next) => {
  try {
    const projectId = idParam.parse(req.query.project_id)
    canAccessProject(req.user, projectId)
    const disputes = db.prepare(`SELECT d.*, u.name AS raised_by_name, r.name AS resolved_by_name,
      e.title AS evidence_title, e.user_id AS evidence_user_id
      FROM disputes d JOIN users u ON u.id=d.raised_by
      LEFT JOIN users r ON r.id=d.resolved_by LEFT JOIN evidence e ON e.id=d.evidence_id
      WHERE d.project_id=? ORDER BY d.created_at DESC`).all(projectId)
    res.json({ disputes })
  } catch (error) { next(error) }
})

app.post('/api/disputes', auth, (req, res, next) => {
  try {
    const input = body(disputeSchema, req.body)
    canAccessProject(req.user, input.project_id)
    if (input.evidence_id) {
      const evidence = db.prepare('SELECT * FROM evidence WHERE id=? AND project_id=?').get(input.evidence_id, input.project_id)
      if (!evidence) fail(400, 'The selected evidence does not belong to this project.')
      if (req.user.role === 'member' && evidence.user_id !== req.user.id) fail(403, 'Members may dispute only their own evidence.')
    }
    const result = db.prepare('INSERT INTO disputes (project_id, evidence_id, raised_by, reason) VALUES (?, ?, ?, ?)')
      .run(input.project_id, input.evidence_id ?? null, req.user.id, input.reason)
    audit(input.project_id, req.user.id, 'opened', 'dispute', result.lastInsertRowid, { reason: input.reason })
    res.status(201).json({ dispute: db.prepare('SELECT * FROM disputes WHERE id=?').get(result.lastInsertRowid) })
  } catch (error) { next(error) }
})

app.patch('/api/disputes/:id', auth, (req, res, next) => {
  try {
    const dispute = db.prepare('SELECT * FROM disputes WHERE id=?').get(idParam.parse(req.params.id))
    if (!dispute) fail(404, 'Dispute not found.')
    canAccessProject(req.user, dispute.project_id)
    requireLeadership(req.user)
    if (dispute.status !== 'open') fail(409, 'This dispute has already been resolved.')
    const input = body(z.object({ status: z.enum(['resolved', 'dismissed']), resolution: z.string().trim().min(4).max(1200) }), req.body)
    db.prepare(`UPDATE disputes SET status=?, resolution=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?`)
      .run(input.status, input.resolution, req.user.id, dispute.id)
    audit(dispute.project_id, req.user.id, input.status, 'dispute', dispute.id, { resolution: input.resolution })
    res.json({ dispute: db.prepare('SELECT * FROM disputes WHERE id=?').get(dispute.id) })
  } catch (error) { next(error) }
})

app.get('/api/audit', auth, (req, res, next) => {
  try {
    const projectId = idParam.parse(req.query.project_id)
    canAccessProject(req.user, projectId)
    const logs = db.prepare(`SELECT a.*, u.name AS actor_name, u.initials
      FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
      WHERE a.project_id=? ORDER BY a.created_at DESC, a.id DESC LIMIT 100`).all(projectId)
    res.json({ logs: logs.map((row) => ({ ...row, details: JSON.parse(row.details) })) })
  } catch (error) { next(error) }
})

const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist')
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false }))
  app.get('*', (req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next()
    res.sendFile(resolve(clientDist, 'index.html'))
  })
}

app.use((_req, _res, next) => next(new ApiError(404, 'That API route does not exist.')))
app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map((issue) => issue.message).join('; ') })
  const status = error.status || 500
  if (status >= 500) console.error(error)
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server.' : error.message })
})

export { calculateScores }
