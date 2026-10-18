import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, BookOpenCheck,
  CalendarDays, Check, CheckCheck, ChevronDown, CircleHelp, ClipboardList, Clock3,
  Code2, FileText, Filter, Github, LayoutDashboard, Link2, LoaderCircle, LogOut,
  Menu, MessageSquareWarning, MoreHorizontal, Plus, RefreshCw, Search, Settings2,
  ShieldCheck, Sparkles, Users, X
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis
} from 'recharts'

const API = '/api'
const navItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'tasks', label: 'Tasks', icon: ClipboardList },
  { id: 'evidence', label: 'Evidence', icon: BookOpenCheck },
  { id: 'reports', label: 'Contribution report', icon: BarChart3 },
  { id: 'disputes', label: 'Disputes', icon: MessageSquareWarning },
  { id: 'activity', label: 'Audit history', icon: Activity }
]
const categories = ['Development', 'Testing', 'Documentation', 'Collaboration', 'Planning']
const statusLabels = { todo: 'To do', in_progress: 'In progress', review: 'In review', done: 'Completed' }
const statusOrder = ['todo', 'in_progress', 'review', 'done']
const roleLabel = { faculty: 'Faculty', leader: 'Team leader', member: 'Team member' }
const dateLabel = (value, options = { month: 'short', day: 'numeric' }) => value
  ? new Intl.DateTimeFormat('en', options).format(new Date(value))
  : 'No date'
const since = (value) => {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) localStorage.removeItem('teamtrace-token')
    throw new Error(payload.error || `Request failed (${response.status})`)
  }
  return payload
}

function IconButton({ label, children, onClick, className = '', disabled = false }) {
  return <button className={`icon-button ${className}`} type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>
}

function Pill({ children, tone = 'neutral' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

function Avatar({ initials, tone = '' }) {
  return <span className={`avatar ${tone}`}>{initials || 'TT'}</span>
}

function Metric({ label, value, foot, icon: Icon, accent = 'indigo' }) {
  return <article className={`metric metric-${accent}`}>
    <div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={16} /></span></div>
    <strong>{value}</strong>
    <small>{foot}</small>
  </article>
}

function EmptyState({ icon: Icon = CircleHelp, title, copy, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={22} /></span><h3>{title}</h3><p>{copy}</p>{action}</div>
}

function Modal({ title, eyebrow, onClose, children, wide = false }) {
  useEffect(() => {
    const close = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return <div className="modal-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-head"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id="modal-title">{title}</h2></div><IconButton label="Close dialog" onClick={onClose}><X size={18} /></IconButton></div>
      {children}
    </section>
  </div>
}

function Login({ onLogin, onRegister, oauthError = '' }) {
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(oauthError)
  const [oauthEnabled, setOauthEnabled] = useState(false)
  const [oauthChecked, setOauthChecked] = useState(false)
  useEffect(() => {
    request('/auth/config').then((config) => setOauthEnabled(config.githubOAuth.enabled))
      .catch(() => setOauthEnabled(false)).finally(() => setOauthChecked(true))
  }, [])
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') await onLogin(email, password)
      else await onRegister({ name, email, password, role })
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <main className="login-shell">
    <section className="login-visual">
      <div className="login-brand"><span className="brand-glyph"><Activity size={20} /></span> teamtrace</div>
      <div className="login-copy">
        <span className="eyebrow light">A clearer picture of team work</span>
        <h1>Good work<br /><i>leaves a trace.</i></h1>
        <p>Bring project activity, contribution, and context into one honest view.</p>
      </div>
      <div className="login-note"><span className="mini-bars"><i /><i /><i /><i /><i /></span><span>Progress is a team story.<br /><b>Make it visible.</b></span></div>
      <div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" />
    </section>
    <section className="login-form-wrap">
      <div className="login-form-inner">
        <div className="mobile-brand"><span className="brand-glyph"><Activity size={18} /></span> teamtrace</div>
        <div className="auth-switch" role="tablist" aria-label="Account access">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'selected' : ''} onClick={() => { setMode('login'); setError('') }}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'selected' : ''} onClick={() => { setMode('register'); setError('') }}>Create account</button>
        </div>
        <span className="eyebrow">{mode === 'login' ? 'Welcome back' : 'A good place to begin'}</span>
        <h2>{mode === 'login' ? <>Sign in to your<br />workspace.</> : <>Create your<br />TeamTrace account.</>}</h2>
        <p className="form-intro">{mode === 'login' ? 'Your team’s work is waiting right where you left it.' : 'Join a team or start a workspace of your own.'}</p>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <form onSubmit={submit} className="login-fields">
          {mode === 'register' && <label>Your name<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required minLength="2" maxLength="100" /></label>}
          <label>Email address<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 10 : undefined} maxLength="128" />
            {mode === 'register' && <small className="password-hint">Use at least 10 characters.</small>}</label>
          {mode === 'register' && <fieldset className="role-picker"><legend>I’m joining as</legend>
            <label><input type="radio" name="role" value="member" checked={role === 'member'} onChange={() => setRole('member')} /><span><b>Team Member</b><small>Contribute to project work</small></span></label>
            <label><input type="radio" name="role" value="leader" checked={role === 'leader'} onChange={() => setRole('leader')} /><span><b>Team Leader</b><small>Create and coordinate projects</small></span></label>
          </fieldset>}
          <button className="button button-primary login-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={16} /></button>
        </form>
        <div className="auth-divider"><span>or</span></div>
        <button className="button button-outline github-auth-button" type="button" disabled={!oauthEnabled || !oauthChecked || busy} onClick={() => { window.location.href = `/api/auth/github?role=${role}` }}>
          <Github size={17} /> Continue with GitHub
        </button>
        {!oauthEnabled && oauthChecked && <p className="oauth-unavailable" role="status">GitHub sign-in is unavailable until the server is configured. You can still use email and password.</p>}
        <div className="login-foot">Transparent by design <span>·</span> Private to your team</div>
      </div>
    </section>
  </main>
}

function consumeGithubCallback() {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const token = params.get('github_token') || ''
  let user = null
  try { user = JSON.parse(params.get('github_user') || 'null') } catch {}
  const error = params.get('github_error') || ''
  if (token) localStorage.setItem('teamtrace-token', token)
  if (token || error) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  return { token, user, error }
}

function App() {
  const [oauthCallback] = useState(() => consumeGithubCallback())
  const [token, setToken] = useState(() => oauthCallback.token || localStorage.getItem('teamtrace-token') || '')
  const [user, setUser] = useState(() => oauthCallback.user)
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [users, setUsers] = useState([])
  const [projectMembers, setProjectMembers] = useState([])
  const [page, setPage] = useState('overview')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [bootError, setBootError] = useState('')
  const [notice, setNotice] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [data, setData] = useState({ dashboard: null, tasks: [], evidence: [], scores: [], disputes: [], logs: [], github: { commits: [], pullRequests: [] } })
  const [modal, setModal] = useState(null)
  const [busyAction, setBusyAction] = useState(false)
  const searchRef = useRef(null)

  const currentProject = projects.find((item) => String(item.id) === String(projectId))
  const activePage = navItems.find((item) => item.id === page)
  const canLead = user && ['faculty', 'leader'].includes(user.role)

  async function login(email, password) {
    const result = await request('/auth/login', { method: 'POST', body: { email, password } })
    localStorage.setItem('teamtrace-token', result.token)
    setToken(result.token)
    setUser(result.user)
    setPage('overview')
    setBootError('')
  }

  async function register(values) {
    const result = await request('/auth/register', { method: 'POST', body: values })
    localStorage.setItem('teamtrace-token', result.token)
    setToken(result.token)
    setUser(result.user)
    setPage('overview')
    setBootError('')
    setNotice('Your account is ready.')
  }

  const logout = useCallback(() => {
    localStorage.removeItem('teamtrace-token')
    setToken('')
    setUser(null)
    setProjects([])
    setProjectId('')
    setData({ dashboard: null, tasks: [], evidence: [], scores: [], disputes: [], logs: [], github: { commits: [], pullRequests: [] } })
  }, [])

  const refresh = useCallback(async (activeToken = token, activeProjectId = projectId) => {
    if (!activeToken || !activeProjectId) return
    setLoading(true)
    setBootError('')
    try {
      const q = `?project_id=${activeProjectId}`
      const [dashboard, tasks, evidence, scores, disputes, logs, github] = await Promise.all([
        request(`/dashboard${q}`, { token: activeToken }),
        request(`/tasks${q}`, { token: activeToken }),
        request(`/evidence${q}`, { token: activeToken }),
        request(`/scores${q}`, { token: activeToken }),
        request(`/disputes${q}`, { token: activeToken }),
        request(`/audit${q}`, { token: activeToken }),
        request(`/github${q}`, { token: activeToken })
      ])
      setData({ dashboard, tasks: tasks.tasks, evidence: evidence.evidence, scores: scores.scores, disputes: disputes.disputes, logs: logs.logs, github })
    } catch (e) {
      if (/session|sign in|expired|invalid/i.test(e.message)) logout()
      setBootError(e.message)
    } finally { setLoading(false) }
  }, [logout, projectId, token])

  useEffect(() => {
    if (!token) return
    let active = true
    Promise.all([request('/auth/me', { token }), request('/projects', { token }), request('/users', { token })])
      .then(([authResult, projectResult, usersResult]) => {
        if (!active) return
        setUser(authResult.user)
        setProjects(projectResult.projects)
        setUsers(usersResult.users)
        setProjectId((selected) => selected && projectResult.projects.some((p) => String(p.id) === String(selected))
          ? selected : String(projectResult.projects[0]?.id || ''))
        setBootError('')
      })
      .catch((error) => {
        if (active) {
          if (/session|sign in|expired|invalid/i.test(error.message)) logout()
          else setBootError(error.message)
        }
      })
    return () => { active = false }
  }, [logout, token])

  useEffect(() => { if (token && projectId) refresh(token, projectId) }, [token, projectId, refresh])
  useEffect(() => {
    if (!token || !projectId) return
    request(`/projects/${projectId}`, { token }).then((result) => setProjectMembers(result.members)).catch(() => setProjectMembers([]))
  }, [token, projectId])

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 4200)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const onShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [])

  const doAction = async (action, message) => {
    setBusyAction(true)
    try {
      const outcome = await action()
      const projectResult = await request('/projects', { token })
      const nextProjects = projectResult.projects
      setProjects(nextProjects)
      let selectionChanged = false
      if (!nextProjects.some((item) => String(item.id) === String(projectId))) {
        setProjectId(String(nextProjects[0]?.id || ''))
        selectionChanged = true
      } else if (nextProjects.length > projects.length) {
        const created = nextProjects.find((item) => !projects.some((existing) => existing.id === item.id))
        if (created) {
          setProjectId(String(created.id))
          selectionChanged = true
        }
      }
      if (!selectionChanged) await refresh()
      setNotice(typeof outcome === 'string' ? outcome : message || 'Changes saved.')
      setModal(null)
    } catch (error) { setNotice(`Could not save: ${error.message}`) } finally { setBusyAction(false) }
  }
  const syncGithub = () => doAction(async () => {
    const result = await request('/github/sync', { token, method: 'POST', body: { project_id: Number(projectId) } })
    return result.message
  }, 'GitHub sync complete.')

  const changePage = (id) => { setPage(id); setMobileNav(false) }
  if (token && !user) return <main className="restoring"><LoaderCircle size={23} className="spin" /><span>Opening your workspace…</span></main>
  if (!token || !user) return <Login onLogin={login} onRegister={register} oauthError={oauthCallback.error} />

  if (bootError && !currentProject) return <main className="fatal-state"><span className="brand-glyph"><Activity size={18} /></span><h2>We couldn’t open your workspace.</h2><p>{bootError}</p><button className="button button-primary" onClick={() => window.location.reload()}>Try again</button><button className="button button-subtle" onClick={logout}>Sign out</button></main>

  const headerActions = <div className="header-actions">
    <label className="search-box"><Search size={16} /><input ref={searchRef} aria-label="Search tasks and evidence" placeholder="Search your workspace" value={search} onChange={(e) => setSearch(e.target.value)} /><kbd>⌘ K</kbd></label>
    <span className="header-divider" />
    <button className="profile-trigger" onClick={logout} title="Sign out">
      <Avatar initials={user.initials} /><span className="profile-meta"><b>{user.name}</b><small>{roleLabel[user.role]}</small></span><LogOut size={15} />
    </button>
  </div>

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand-row"><span className="brand-glyph"><Activity size={19} /></span><span>teamtrace</span><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button></div>
      <div className="workspace-label">WORKSPACE</div>
      <label className="project-select-wrap">
        <span className="project-mark">{currentProject?.name?.slice(0, 1) || 'P'}</span>
        <select aria-label="Select project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {!projects.length && <option value="" disabled>No projects yet</option>}
          {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
        </select><ChevronDown size={15} />
      </label>
      <div className="project-course">{currentProject?.course || 'Choose a project'}</div>
      <nav className="main-nav" aria-label="Main navigation">
        <span className="nav-caption">YOUR SPACE</span>
        {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => changePage(id)}>
          <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
          {id === 'disputes' && data.dashboard?.summary?.openDisputes > 0 && <i className="nav-count">{data.dashboard.summary.openDisputes}</i>}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="team-card"><div className="team-card-head"><span>YOUR TEAM</span><Users size={15} /></div>
          <div className="team-avatars">{projectMembers.filter((item) => item.role === 'member').slice(0, 4).map((item, index) => <Avatar key={item.id} initials={item.initials} tone={`avatar-tone-${index}`} />)}</div>
          <p>{projectMembers.filter((item) => item.role === 'member').length} student contributors<br /><span>working together</span></p>
        </div>
        <button className="help-link" onClick={() => setNotice('TeamTrace keeps contribution evidence visible and reviewable by your project team.')}><CircleHelp size={16} /> Help & guide <ArrowRight size={14} /></button>
        <div className="sidebar-account"><Avatar initials={user.initials} /><span><b>{user.name}</b><small>{roleLabel[user.role]}</small></span><button aria-label="Sign out" onClick={logout}><LogOut size={15} /></button></div>
      </div>
    </aside>
    {mobileNav && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileNav(false)} />}
    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumb"><button className="hamburger" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={19} /></button><span>Projects</span><span className="crumb-slash">/</span><b>{currentProject?.name || (projects.length ? 'Loading project' : 'No projects yet')}</b></div>
        {headerActions}
      </header>
      <div className="page-body">
        <div className="page-heading">
          <div><span className="eyebrow">{page === 'overview' ? dateLabel(new Date(), { weekday: 'long', month: 'long', day: 'numeric' }) : `${currentProject?.name || ''} · ${currentProject?.course || 'PROJECT WORKSPACE'}`}</span>
            <h1>{page === 'overview' ? 'The work, in focus.' : activePage?.label}</h1>
            <p>{page === 'overview' ? 'A shared view of what your team is moving forward.' : pageDescription(page)}</p>
          </div>
          <div className="heading-actions">
            {canLead && page === 'evidence' && <button className="button button-outline" onClick={syncGithub} disabled={busyAction}><Github size={16} /> Sync repository</button>}
            {canLead && page === 'tasks' && <button className="button button-primary" onClick={() => setModal({ type: 'task' })}><Plus size={16} /> Add task</button>}
            {page === 'evidence' && <button className="button button-primary" onClick={() => setModal({ type: 'evidence' })}><Plus size={16} /> Add evidence</button>}
            {page === 'disputes' && <button className="button button-primary" onClick={() => setModal({ type: 'dispute' })}><Plus size={16} /> Raise a dispute</button>}
            {canLead && page === 'overview' && <>
              {currentProject && <button className="button button-outline" onClick={() => setModal({ type: 'project-edit' })}><Settings2 size={15} /> Edit project</button>}
              {currentProject && (currentProject.owner_id === user.id || user.role === 'faculty') && <button className="button button-subtle delete-project" onClick={() => {
                if (window.confirm(`Delete “${currentProject.name}” and its project data? This cannot be undone.`))
                  doAction(() => request(`/projects/${currentProject.id}`, { token, method: 'DELETE' }), 'Project deleted.')
              }}><X size={15} /> Delete</button>}
              <button className="button button-primary" onClick={() => setModal({ type: 'project' })}><Plus size={16} /> New project</button>
            </>}
          </div>
        </div>
        {notice && <div className={`toast ${notice.startsWith('Could not') ? 'toast-error' : ''}`} role="status"><span>{notice.startsWith('Could not') ? <X size={15} /> : <Check size={15} />}</span>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}
        {bootError && <div className="error-banner page-error" role="alert">{bootError}<button onClick={() => refresh()} className="button button-subtle">Retry</button></div>}
        {!currentProject && !bootError && <EmptyState icon={LayoutDashboard} title={canLead ? 'Start with a new project' : 'No projects in this workspace'} copy={canLead ? 'Create a workspace for your team and bring your project activity together.' : 'Ask a team leader to add you to a project.'} action={canLead && <button className="button button-primary" onClick={() => setModal({ type: 'project' })}><Plus size={15} /> Create a project</button>} />}
        {currentProject && <>
          {page === 'overview' && <Overview data={data} project={currentProject} tasks={data.tasks} scores={data.scores} loading={loading} onNavigate={changePage} onCreate={() => setModal({ type: 'task' })} canLead={canLead} />}
          {page === 'tasks' && <Tasks tasks={data.tasks} search={search} user={user} canLead={canLead} onStatus={(task, status) => doAction(() => request(`/tasks/${task.id}`, { token, method: 'PUT', body: { status } }), 'Task status updated.')} onCreate={() => setModal({ type: 'task' })} onEdit={(task) => setModal({ type: 'task-edit', task })} onDelete={(task) => {
            if (window.confirm(`Delete “${task.title}”?`)) doAction(() => request(`/tasks/${task.id}`, { token, method: 'DELETE' }), 'Task removed.')
          }} />}
          {page === 'evidence' && <Evidence evidence={data.evidence} github={data.github} search={search} currentUser={user} canManage={canLead} projectId={projectId} token={token} onCreate={() => setModal({ type: 'evidence' })} onEdit={(entry) => setModal({ type: 'evidence-edit', evidence: entry })} onSync={syncGithub} onDispute={(entry) => setModal({ type: 'dispute', evidence: entry })} onDelete={(entry) => {
            if (window.confirm(`Remove “${entry.title}” from project evidence?`)) doAction(() => request(`/evidence/${entry.id}`, { token, method: 'DELETE' }), 'Evidence removed.')
          }} />}
          {page === 'reports' && <Reports scores={data.scores} evidence={data.evidence} />}
          {page === 'disputes' && <Disputes disputes={data.disputes} user={user} onRaise={() => setModal({ type: 'dispute' })} onResolve={(dispute) => setModal({ type: 'resolve', dispute })} />}
          {page === 'activity' && <Audit logs={data.logs} />}
        </>}
        <footer className="page-footer"><span><ShieldCheck size={14} /> Contribution is a conversation, not a verdict.</span><span>TeamTrace <i>·</i> Private team workspace</span></footer>
      </div>
    </main>
    {modal && <AppModal modal={modal} close={() => setModal(null)} busy={busyAction} token={token} project={currentProject} users={users} projectMembers={projectMembers} currentUser={user} tasks={data.tasks} evidence={data.evidence} doAction={doAction} />}
  </div>
}

function pageDescription(page) {
  return {
    tasks: 'A clear view of ownership, momentum, and what comes next.',
    evidence: 'Work is more than a number. Keep the context close.',
    reports: 'Contribution signals, grounded in work your team can review.',
    disputes: 'Make room for questions. Resolve them with context and care.',
    activity: 'A transparent, append-only record of project changes.'
  }[page]
}

function Overview({ data, project, tasks, scores, loading, onNavigate, onCreate, canLead }) {
  const summary = data.dashboard?.summary || {}
  const openTasks = tasks.filter((task) => task.status !== 'done').length
  const nextUp = tasks.filter((task) => task.status !== 'done').slice(0, 4)
  const trendData = useMemo(() => {
    const recent = data.dashboard?.trend || []
    const buckets = new Map()
    for (const item of recent) {
      const label = dateLabel(item.day, { month: 'short', day: 'numeric' })
      const bucket = buckets.get(label) || { day: label, points: 0 }
      bucket.points += Number(item.points)
      buckets.set(label, bucket)
    }
    return [...buckets.values()].slice(-8)
  }, [data.dashboard?.trend])
  const palette = ['#5557d8', '#19a68c', '#eb896f', '#d7a849', '#5e83b2']
  return <>
    <div className="welcome-strip">
      <div className="welcome-mark"><Sparkles size={18} /></div>
      <div><b>{project.course}</b><span>{project.description}</span></div>
      <div className="welcome-status"><i className={project.status === 'active' ? '' : 'status-paused'} /> Project {project.status}</div>
    </div>
    <section className="metric-grid" aria-label="Project summary">
      <Metric label="Open tasks" value={loading ? '—' : openTasks} foot={`${summary.completed || 0} completed so far`} icon={ClipboardList} />
      <Metric label="Evidence captured" value={loading ? '—' : summary.evidence ?? 0} foot="Across 5 contribution areas" icon={BookOpenCheck} accent="teal" />
      <Metric label="Active contributors" value={scores.length || '—'} foot="Every role, one shared view" icon={Users} accent="coral" />
      <Metric label="Open conversations" value={summary.openDisputes ?? 0} foot={summary.openDisputes ? 'Ready for a thoughtful review' : 'No open disputes'} icon={MessageSquareWarning} accent="gold" />
    </section>
    <section className="dashboard-grid">
      <article className="panel contribution-panel">
        <div className="panel-heading"><div><span className="eyebrow">CONTRIBUTION SIGNALS</span><h2>Progress, together</h2></div><button className="text-link" onClick={() => onNavigate('reports')}>Full report <ArrowRight size={15} /></button></div>
        {scores.length ? <div className="contribution-list">
          {scores.map((person, index) => <div className="contributor-row" key={person.id}>
            <Avatar initials={person.initials} tone={`avatar-tone-${index}`} />
            <div className="contributor-name"><b>{person.name}</b><small>{person.persona || 'Team member'} <span>·</span> {person.evidence_count} signals</small></div>
            <div className="score-track"><span style={{ width: `${person.score}%`, background: palette[index % palette.length] }} /></div>
            <b className="score-value">{person.score}</b>
          </div>)}
        </div> : <EmptyState title="No contribution signals yet" copy="Submitted evidence will make the team report more useful." />}
        <div className="score-disclaimer"><ShieldCheck size={14} /> Weighted signals help start a conversation—they don’t define a person.</div>
      </article>
      <article className="panel tasks-panel">
        <div className="panel-heading"><div><span className="eyebrow">WHAT’S MOVING</span><h2>Next up</h2></div><button className="text-link" onClick={() => onNavigate('tasks')}>All tasks <ArrowRight size={15} /></button></div>
        {nextUp.length ? <div className="next-task-list">{nextUp.map((task) => <div className="next-task" key={task.id}>
          <span className={`priority-marker priority-${task.priority}`} />
          <div className="next-task-copy"><b>{task.title}</b><small>{task.assignee_name || 'Unassigned'} <span>·</span> due {dateLabel(task.due_date)}</small></div>
          <Pill tone={task.status === 'in_progress' ? 'indigo' : task.status === 'review' ? 'gold' : 'neutral'}>{statusLabels[task.status]}</Pill>
        </div>)}</div> : <EmptyState title="All caught up" copy="Every task is marked complete." />}
        <button className="quiet-add" onClick={onCreate} disabled={!canLead}><Plus size={15} /> {canLead ? 'Add a task' : 'Tasks owned by your team lead'}</button>
      </article>
    </section>
    <section className="dashboard-grid lower-grid">
      <article className="panel trend-panel">
        <div className="panel-heading"><div><span className="eyebrow">LAST 14 DAYS</span><h2>Evidence over time</h2></div><span className="chart-legend"><i /> points added</span></div>
        {data.dashboard?.trend?.length ? <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={trendData} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
            <defs><linearGradient id="teamArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5557d8" stopOpacity={0.18} /><stop offset="100%" stopColor="#5557d8" stopOpacity={0.01} /></linearGradient></defs>
            <CartesianGrid stroke="#eae9e3" vertical={false} />
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#87878b', fontSize: 11 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#87878b', fontSize: 11 }} />
            <Tooltip contentStyle={{ border: '1px solid #e6e5df', borderRadius: 9, fontSize: 12 }} />
            <Area type="monotone" dataKey="points" stroke="#5557d8" strokeWidth={2.5} fill="url(#teamArea)" connectNulls />
          </AreaChart></ResponsiveContainer>
        </div> : <EmptyState icon={Activity} title="The timeline starts with evidence" copy="Add a work signal to see your team’s activity over time." action={<button className="button button-outline" onClick={() => onNavigate('evidence')}>Explore evidence</button>} />}
      </article>
      <article className="panel snapshot-panel">
        <div className="panel-heading"><div><span className="eyebrow">PROJECT SNAPSHOT</span><h2>A steady rhythm</h2></div><span className="snapshot-icon"><Activity size={17} /></span></div>
        <div className="completion-number">{summary.tasks ? Math.round((summary.completed / summary.tasks) * 100) : 0}<small>%</small></div>
        <p className="completion-copy">of project tasks are complete</p>
        <div className="completion-track"><span style={{ width: `${summary.tasks ? (summary.completed / summary.tasks) * 100 : 0}%` }} /></div>
        <div className="snapshot-footer"><span><CheckCheck size={15} /> {summary.completed || 0} finished</span><span>{openTasks} still moving</span></div>
        <div className="snapshot-note"><span>↗</span> Work becomes fairer when the context is visible.</div>
      </article>
    </section>
  </>
}

function Tasks({ tasks, search, user, canLead, onStatus, onCreate, onEdit, onDelete }) {
  const filtered = tasks.filter((task) => `${task.title} ${task.description} ${task.assignee_name || ''}`.toLowerCase().includes(search.toLowerCase()))
  const [view, setView] = useState('board')
  const [statusFilter, setStatusFilter] = useState('all')
  const taskCount = filtered.filter((task) => statusFilter === 'all' || task.status === statusFilter)
  return <section className="panel task-board-panel">
    <div className="table-toolbar"><div className="view-switch"><button onClick={() => setView('board')} className={view === 'board' ? 'selected' : ''}>Board</button><button onClick={() => setView('list')} className={view === 'list' ? 'selected' : ''}>List</button></div>
      <div className="toolbar-right"><label className="filter-control"><Filter size={14} /><select aria-label="Filter tasks by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All statuses</option>{statusOrder.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}</select><ChevronDown size={14} /></label><span className="toolbar-count">{taskCount.length} tasks</span></div>
    </div>
    {view === 'board' ? <div className="kanban">{statusOrder.map((status) => {
      const columnTasks = taskCount.filter((task) => task.status === status)
      return <section className={`kanban-column column-${status}`} key={status}>
        <div className="column-head"><span className={`column-dot dot-${status}`} /><b>{statusLabels[status]}</b><small>{columnTasks.length}</small></div>
        {columnTasks.map((task) => <TaskCard key={task.id} task={task} user={user} canLead={canLead} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} />)}
        {!columnTasks.length && <div className="column-empty">Nothing here yet</div>}
        {canLead && status === 'todo' && <button className="column-add" onClick={onCreate}><Plus size={14} /> Add task</button>}
      </section>
    })}</div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Task</th><th>Owner</th><th>Priority</th><th>Due date</th><th>Status</th></tr></thead>
      <tbody>{taskCount.map((task) => <tr key={task.id}><td><b>{task.title}</b><small>{task.description}</small></td><td>{task.assignee_name || 'Unassigned'}</td><td><span className={`priority-text priority-text-${task.priority}`}>{task.priority}</span></td><td>{dateLabel(task.due_date)}</td><td><StatusSelect task={task} user={user} onStatus={onStatus} /></td></tr>)}</tbody>
    </table></div>}
    {!tasks.length && <EmptyState icon={ClipboardList} title="No tasks on the board" copy={canLead ? 'Add the first task and give the work a clear owner.' : 'Your team lead will add tasks to this project.'} action={canLead && <button className="button button-primary" onClick={onCreate}><Plus size={15} /> Create first task</button>} />}
  </section>
}

function TaskCard({ task, user, canLead, onStatus, onEdit, onDelete }) {
  return <article className="task-card">
    <div className="task-card-top"><span className={`priority-text priority-text-${task.priority}`}>{task.priority} priority</span><span className="task-card-tools">{canLead && <button className="card-menu" title="Edit task" onClick={() => onEdit(task)}><Settings2 size={14} /></button>}{canLead && <button className="card-menu" title="Delete task" onClick={() => onDelete(task)}><X size={14} /></button>}</span></div>
    <h3>{task.title}</h3>{task.description && <p>{task.description}</p>}
    <div className="task-card-bottom"><span className="task-assignee"><Avatar initials={task.assignee_initials} /><span>{task.assignee_name || 'Unassigned'}</span></span><span className="task-due"><CalendarDays size={13} />{dateLabel(task.due_date)}</span></div>
    <div className="task-card-foot"><span><Link2 size={13} />{task.evidence_count} evidence</span><StatusSelect task={task} user={user} onStatus={onStatus} compact /></div>
  </article>
}

function StatusSelect({ task, user, onStatus, compact = false }) {
  const canChange = ['faculty', 'leader'].includes(user.role) || task.assignee_id === user.id
  return <label className={`status-select status-${task.status} ${compact ? 'status-compact' : ''}`}>
    {compact && <span className={`column-dot dot-${task.status}`} />}
    <select aria-label={`Change status for ${task.title}`} value={task.status} disabled={!canChange} onChange={(event) => onStatus(task, event.target.value)}>
      {statusOrder.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}
    </select><ChevronDown size={13} />
  </label>
}

function GithubRepository({ projectId, token, canManage, onSync }) {
  const [config, setConfig] = useState(null)
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [linking, setLinking] = useState(false)
  useEffect(() => {
    let active = true
    request(`/github/config?project_id=${projectId}`, { token }).then((result) => {
      if (!active) return
      setConfig(result)
      setRepositoryUrl(result.repository?.url || '')
    }).catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [projectId, token])

  async function saveRepository(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const result = await request('/github/repository', {
        token, method: 'PUT', body: { project_id: Number(projectId), repository_url: repositoryUrl }
      })
      setConfig((current) => ({ ...current, repository: result.repository }))
      setRepositoryUrl(result.repository.url)
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }

  async function linkGithub() {
    setLinking(true)
    setError('')
    try {
      const result = await request('/auth/github/link', { token, method: 'POST', body: {} })
      window.location.href = result.url
    } catch (requestError) { setError(requestError.message); setLinking(false) }
  }

  return <section className="github-connect-panel" aria-labelledby="repository-heading">
    <div className="github-connect-copy">
      <span className="github-connect-mark"><Github size={18} /></span>
      <div><span className="eyebrow">REPOSITORY ACTIVITY</span><h2 id="repository-heading">Connect real GitHub work</h2>
        <p>{config?.repository ? <a href={config.repository.url} target="_blank" rel="noreferrer">{config.repository.owner}/{config.repository.name} <ArrowUpRight size={13} /></a> : 'Choose the repository this project should follow. Activity is fetched directly from GitHub.'}</p>
      </div>
    </div>
    <div className="github-connect-status" role="status">
      {!config ? 'Checking GitHub connection…' : !config.oauthConfigured
        ? 'GitHub OAuth is not configured on this server.'
        : config.githubAccountConnected
          ? `GitHub account connected${config.lastSync ? ` · Last sync ${since(config.lastSync)}` : ''}`
          : 'Sign in with GitHub to authorize repository sync.'}
    </div>
    {canManage && <form className="repository-form" onSubmit={saveRepository}>
      <label htmlFor="repository-url">GitHub repository URL</label>
      <div className="repository-input-row"><input id="repository-url" type="url" inputMode="url" autoComplete="url" placeholder="https://github.com/owner/repository" value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} required />
        <button className="button button-outline" disabled={saving || !config}>{saving ? <LoaderCircle size={15} className="spin" /> : null}Save repository</button>
      </div>
    </form>}
    {error && <p className="repository-error" role="alert">{error}</p>}
    {config && !config.githubAccountConnected && <p className="repository-hint">{config.oauthConfigured
      ? <>Connect your GitHub identity to authorize reads. <button type="button" disabled={linking} onClick={linkGithub}>{linking ? 'Connecting…' : 'Connect GitHub'} <ArrowRight size={13} /></button></>
      : 'Email sign-in remains available. Repository activity sync will turn on when the server operator configures a GitHub OAuth App.'}</p>}
    <div className="repository-footnote"><ShieldCheck size={14} /> Public repositories only by default. Private repository access requires a broader OAuth scope and is not enabled.</div>
    <div className="repository-actions">
      <span>{config?.repository ? `Source: ${config.repository.url}` : 'No repository connected'}</span>
      {canManage && <button className="button button-primary" type="button" disabled={!config?.repository || !config.oauthConfigured || !config.githubAccountConnected} onClick={onSync}><RefreshCw size={15} /> Sync activity</button>}
    </div>
  </section>
}

function Evidence({ evidence, github, search, currentUser, canManage, projectId, token, onCreate, onEdit, onSync, onDispute, onDelete }) {
  const [category, setCategory] = useState('all')
  const [source, setSource] = useState('all')
  const filtered = evidence.filter((entry) => {
    const textMatch = `${entry.title} ${entry.description} ${entry.contributor_name} ${entry.task_title || ''}`.toLowerCase().includes(search.toLowerCase())
    return textMatch && (category === 'all' || entry.category === category) && (source === 'all' || entry.source === source)
  })
  return <>
    <div className="evidence-overview">
      <div className="evidence-lead"><span className="eyebrow">BEYOND THE NUMBER</span><h2>Evidence has a story.</h2><p>Each signal connects a contribution to the task, the person, and the context behind the work.</p></div>
      <div className="evidence-mini-stats"><span><b>{evidence.length}</b><small>signals shared</small></span><span><b>{new Set(evidence.map((entry) => entry.category)).size}<i>/5</i></b><small>areas represented</small></span><span><b>{github.commits.length + github.pullRequests.length}</b><small>GitHub records</small></span></div>
    </div>
    <section className="panel evidence-panel">
      <div className="panel-heading"><div><span className="eyebrow">TEAM EVIDENCE</span><h2>Recent work signals</h2></div>
        <div className="toolbar-right"><label className="filter-control"><Filter size={14} /><select aria-label="Filter evidence by category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></label>
          <label className="filter-control"><select aria-label="Filter evidence source" value={source} onChange={(e) => setSource(e.target.value)}><option value="all">All sources</option><option value="manual">Submitted</option><option value="github_commit">GitHub commits</option><option value="github_pr">GitHub PRs</option></select><ChevronDown size={14} /></label></div>
      </div>
      {filtered.length ? <div className="evidence-list">{filtered.map((entry, index) => <article className="evidence-entry" key={entry.id}>
        <div className={`evidence-icon evidence-icon-${categories.indexOf(entry.category)}`}><EvidenceIcon category={entry.category} /></div>
        <div className="evidence-content"><div className="evidence-entry-head"><h3>{entry.title}</h3><Pill tone={index % 3 === 0 ? 'teal' : 'neutral'}>{entry.category}</Pill></div>
          <p>{entry.description || 'No additional context provided.'}</p>
          <div className="evidence-meta"><span><Avatar initials={entry.initials} /> {entry.contributor_name}</span>{entry.task_title && <span><Link2 size={13} /> {entry.task_title}</span>}<span><Clock3 size={13} /> {since(entry.created_at)}</span>{entry.source !== 'manual' && <span className="source-label"><Github size={12} /> {entry.source === 'github_pr' ? 'Pull request' : 'Commit'}</span>}</div>
        </div>
        <div className="evidence-points"><b>{Math.round(entry.points)}</b><small>signal</small></div>
        <div className="evidence-actions">{entry.url && <a href={entry.url} target="_blank" rel="noreferrer" aria-label="Open evidence link"><ArrowUpRight size={16} /></a>}
          {entry.user_id === currentUser.id && <button onClick={() => onDispute(entry)} title="Raise a question"><MessageSquareWarning size={15} /></button>}
          {entry.source === 'manual' && (entry.user_id === currentUser.id || canManage) && <button onClick={() => onEdit(entry)} title="Edit evidence"><Settings2 size={15} /></button>}
          {entry.source === 'manual' && (entry.user_id === currentUser.id || canManage) && <button onClick={() => onDelete(entry)} title="Remove evidence"><X size={15} /></button>}
        </div>
      </article>)}</div> : <EmptyState icon={BookOpenCheck} title={search || category !== 'all' || source !== 'all' ? 'No matching evidence' : 'Your first signal starts here'} copy={search || category !== 'all' || source !== 'all' ? 'Try another search or clear a filter.' : 'Add a small piece of context from the work your team is doing.'} action={<button className="button button-primary" onClick={onCreate}><Plus size={15} /> Add evidence</button>} />}
      <div className="evidence-bottom"><span><ShieldCheck size={14} /> Signals are visible to project members.</span><span><Github size={14} /> GitHub records are imported from the connected repository.</span></div>
    </section>
    <GithubRepository projectId={projectId} token={token} canManage={canManage} onSync={onSync} />
    {(github.commits.length > 0 || github.pullRequests.length > 0) && <section className="github-records">
      <div className="panel-heading"><div><span className="eyebrow">GITHUB REPOSITORY</span><h2>Linked GitHub activity</h2></div><span className="connected-chip"><i /> Live API data</span></div>
      <div className="github-record-grid">{github.commits.slice(0, 3).map((commit) => <article className="github-record" key={commit.id}><Github size={15} /><div><b>{commit.message}</b><small>{commit.repository_owner ? `${commit.repository_owner}/${commit.repository_name}` : 'Earlier repository'} · {commit.sha.slice(0, 7)} · {commit.contributor_name}</small></div><Pill tone="teal">Commit</Pill></article>)}{github.pullRequests.slice(0, 2).map((pr) => <article className="github-record" key={`pr${pr.id}`}><Github size={15} /><div><b>#{pr.number} {pr.title}</b><small>{pr.repository_owner ? `${pr.repository_owner}/${pr.repository_name}` : 'Earlier repository'} · {pr.status} · {pr.contributor_name}</small></div><Pill tone="indigo">PR</Pill></article>)}</div>
    </section>}
  </>
}

function EvidenceIcon({ category }) {
  const icons = { Development: Code2, Testing: CheckCheck, Documentation: FileText, Collaboration: Users, Planning: CalendarDays }
  const Icon = icons[category] || Activity
  return <Icon size={17} />
}

function Reports({ scores, evidence }) {
  const [selected, setSelected] = useState(scores[0]?.id || '')
  useEffect(() => { if (!scores.some((score) => String(score.id) === String(selected))) setSelected(scores[0]?.id || '') }, [scores, selected])
  const person = scores.find((score) => String(score.id) === String(selected))
  const chartData = scores.map((item) => ({ name: item.name.split(' ')[0], score: item.score }))
  const categoryValues = categories.map((category) => {
    const matching = evidence.filter((entry) => entry.category === category)
    return { category, value: matching.length ? Math.round(matching.reduce((sum, item) => sum + item.points, 0) / matching.length) : 0, count: matching.length }
  })
  return <>
    <div className="report-note"><ShieldCheck size={17} /><p><b>Scores are discussion prompts, not a final judgment.</b><span>Each category is weighted and calculated from evidence saved in this project. Click any category to see the contributions behind it.</span></p><Pill tone="indigo">Transparent model</Pill></div>
    <section className="report-grid">
      <article className="panel report-score-panel"><div className="panel-heading"><div><span className="eyebrow">CONTRIBUTION OVERVIEW</span><h2>Team signals</h2></div><span className="report-period">Live from evidence</span></div>
        {scores.length ? <><div className="report-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 20, right: 14, bottom: 8, left: -18 }}>
          <CartesianGrid stroke="#e9e8e2" vertical={false} />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#777780', fontSize: 12 }} />
          <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#777780', fontSize: 11 }} />
          <Tooltip contentStyle={{ border: '1px solid #e3e2dc', borderRadius: 8, fontSize: 12 }} />
          <Line type="monotone" dataKey="score" stroke="#5557d8" strokeWidth={3} dot={{ r: 5, fill: '#5557d8', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 7 }} />
        </LineChart></ResponsiveContainer></div>
        <div className="report-rank-list">{scores.map((item, index) => <button className={`report-person ${String(item.id) === String(selected) ? 'is-selected' : ''}`} key={item.id} onClick={() => setSelected(String(item.id))}><span className="rank-number">0{index + 1}</span><Avatar initials={item.initials} tone={`avatar-tone-${index}`} /><span className="report-person-name"><b>{item.name}</b><small>{item.persona}</small></span><span className="report-person-count">{item.evidence_count} signals</span><strong>{item.score}<small> / 100</small></strong></button>)}</div></> : <EmptyState icon={BarChart3} title="No report to show yet" copy="Team members and their contributions will appear here." />}
      </article>
      <aside className="report-side">
        <article className="panel breakdown-panel"><div className="panel-heading"><div><span className="eyebrow">WEIGHTED BREAKDOWN</span><h2>{person?.name || 'No member selected'}</h2></div><select className="report-person-select" aria-label="Select team member" value={selected} onChange={(e) => setSelected(e.target.value)}>{scores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          {person ? <div className="breakdown-list">{categories.map((category) => {
            const item = person.breakdown[category]
            return <div className="breakdown-row" key={category}><div className="breakdown-label"><span>{category}</span><small>{Math.round(item.weight * 100)}% weight · {item.count} signals</small></div><div className="breakdown-bar"><span style={{ width: `${item.average}%` }} /></div><b>{item.average}</b></div>
          })}<div className="breakdown-total"><span>Weighted contribution score</span><b>{person.score}<small> / 100</small></b></div></div> : <EmptyState title="Select a member" copy="Choose a person to review their breakdown." />}
        </article>
        <article className="panel category-panel"><div className="panel-heading"><div><span className="eyebrow">TEAM COVERAGE</span><h2>Evidence areas</h2></div></div>
          {categoryValues.map((item, index) => <div className="coverage-row" key={item.category}><span className={`coverage-index coverage-${index}`}>{String(index + 1).padStart(2, '0')}</span><span>{item.category}</span><b>{item.count}</b></div>)}
        </article>
      </aside>
    </section>
  </>
}

function Disputes({ disputes, user, onRaise, onResolve }) {
  const open = disputes.filter((item) => item.status === 'open')
  const resolved = disputes.filter((item) => item.status !== 'open')
  return <>
    <div className="dispute-intro"><div className="dispute-symbol"><MessageSquareWarning size={19} /></div><div><b>Questions are part of fair contribution.</b><p>Disputes let teammates add context, ask for a review, and resolve disagreements with a written record.</p></div>{open.length > 0 && <span className="open-dispute-count">{open.length} awaiting review</span>}</div>
    <section className="panel dispute-panel"><div className="panel-heading"><div><span className="eyebrow">NEEDS ATTENTION</span><h2>Open conversations</h2></div><span className="toolbar-count">{open.length} open</span></div>
      {open.length ? <div className="dispute-list">{open.map((dispute) => <DisputeCard dispute={dispute} key={dispute.id} user={user} onResolve={onResolve} />)}</div> : <EmptyState icon={CheckCheck} title="No open disputes" copy="A quiet queue means your team has no unresolved questions right now." action={<button className="button button-outline" onClick={onRaise}><Plus size={15} /> Raise a question</button>} />}
    </section>
    <section className="panel resolved-panel"><div className="panel-heading"><div><span className="eyebrow">THE RECORD</span><h2>Resolved conversations</h2></div><span className="toolbar-count">{resolved.length} resolved</span></div>
      {resolved.length ? <div className="resolved-list">{resolved.map((dispute) => <DisputeCard dispute={dispute} key={dispute.id} user={user} resolved />)}</div> : <p className="quiet-empty">Resolved disputes will remain here as part of the project record.</p>}
    </section>
  </>
}

function DisputeCard({ dispute, user, onResolve, resolved = false }) {
  return <article className={`dispute-card ${resolved ? 'dispute-card-resolved' : ''}`}>
    <div className="dispute-status-mark">{resolved ? <Check size={16} /> : <MessageSquareWarning size={16} />}</div>
    <div className="dispute-content"><div className="dispute-card-head"><div><b>{dispute.evidence_title || 'Project contribution review'}</b><span>Raised by {dispute.raised_by_name} · {dateLabel(dispute.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div><Pill tone={resolved ? 'teal' : 'gold'}>{resolved ? dispute.status : 'Needs review'}</Pill></div>
      <p className="dispute-reason">{dispute.reason}</p>
      {resolved && <div className="resolution-note"><Check size={14} /><span><b>Resolution · {dispute.resolved_by_name || 'Team lead'}</b>{dispute.resolution}</span></div>}
    </div>
    {!resolved && ['faculty', 'leader'].includes(user.role) && <button className="button button-outline resolve-button" onClick={() => onResolve(dispute)}>Review & resolve <ArrowRight size={14} /></button>}
  </article>
}

function Audit({ logs }) {
  const label = (log) => {
    const action = log.action === 'submitted' ? 'added evidence' : log.action === 'synced' ? 'synced repository activity' : `${log.action} ${log.entity_type}`
    return action
  }
  return <section className="panel audit-panel"><div className="panel-heading"><div><span className="eyebrow">APPEND-ONLY PROJECT RECORD</span><h2>What changed, and when</h2></div><span className="audit-lock"><ShieldCheck size={14} /> Immutable history</span></div>
    {logs.length ? <div className="audit-timeline">{logs.map((log, index) => <article className="audit-item" key={log.id}><div className={`audit-node audit-node-${index % 4}`}><AuditIcon action={log.action} /></div><div className="audit-copy"><div><b>{log.actor_name || 'System'}</b> {label(log)}{log.details?.title && <> · <strong>{log.details.title}</strong></>}{log.details?.name && <> · <strong>{log.details.name}</strong></>}</div><small>{dateLabel(log.created_at, { month: 'long', day: 'numeric', year: 'numeric' })} at {new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(log.created_at))}</small>
      {log.details?.resolution && <p>{log.details.resolution}</p>}</div><span className="audit-type">{log.entity_type}</span></article>)}</div> : <EmptyState icon={Activity} title="No activity yet" copy="Changes to tasks, evidence, and disputes will appear here." />}
  </section>
}

function AuditIcon({ action }) {
  if (action === 'created') return <Plus size={14} />
  if (action === 'synced') return <Github size={14} />
  if (action.includes('resolved')) return <Check size={14} />
  return <Activity size={14} />
}

function AppModal({ modal, close, busy, token, project, users, projectMembers, currentUser, tasks, evidence, doAction }) {
  const allMembers = users.filter((item) => item.role === 'member')
  const members = projectMembers.filter((item) => item.role === 'member')
  const currentMembers = projectMembers.filter((item) => item.role === 'member')
  const selectableEvidence = currentUser.role === 'member'
    ? evidence.filter((entry) => entry.user_id === currentUser.id) : evidence
  const [selectedMembers, setSelectedMembers] = useState(() => modal.type === 'project-edit'
    ? currentMembers.map((member) => member.id) : allMembers.map((member) => member.id))
  const [form, setForm] = useState(() => ({
    name: modal.type === 'project-edit' ? project?.name || '' : '',
    description: modal.task ? modal.task.description : modal.evidence ? modal.evidence.description : modal.type === 'project-edit' ? project?.description || '' : '',
    course: modal.type === 'project-edit' ? project?.course || '' : '',
    title: modal.task?.title || modal.evidence?.title || '',
    project_id: project?.id,
    task_id: modal.task?.id || modal.evidence?.task_id || '',
    assignee_id: modal.task?.assignee_id || '',
    due_date: modal.task?.due_date || '',
    priority: modal.task?.priority || 'medium',
    category: modal.evidence?.category || 'Development',
    points: modal.evidence?.points ?? 60,
    url: modal.evidence?.url || '',
    evidence_id: modal.evidence?.id || '',
    reason: '', resolution: '', status: 'resolved'
  }))
  const update = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }))
  const submit = (event, endpoint, method = 'POST', payload = form, message = 'Changes saved.') => {
    event.preventDefault()
    doAction(() => request(endpoint, { token, method, body: payload }), message)
  }
  const createProject = (event) => {
    event.preventDefault()
    doAction(async () => {
      const created = await request('/projects', {
        token, method: 'POST',
        body: { name: form.name, description: form.description, course: form.course }
      })
      for (const userId of selectedMembers) {
        await request(`/projects/${created.project.id}/members`, { token, method: 'POST', body: { user_id: userId } })
      }
    }, 'Project created.')
  }
  const saveProject = (event) => {
    event.preventDefault()
    doAction(async () => {
      await request(`/projects/${project.id}`, {
        token, method: 'PUT',
        body: { name: form.name, description: form.description, course: form.course, status: project.status }
      })
      const selected = new Set(selectedMembers)
      const existing = new Set(currentMembers.map((member) => member.id))
      for (const userId of selectedMembers) {
        if (!existing.has(userId)) await request(`/projects/${project.id}/members`, { token, method: 'POST', body: { user_id: userId } })
      }
      for (const member of currentMembers) {
        if (!selected.has(member.id)) await request(`/projects/${project.id}/members/${member.id}`, { token, method: 'DELETE' })
      }
    }, 'Project and team updated.')
  }
  if (modal.type === 'project') return <Modal title="Create a project" eyebrow="NEW WORKSPACE" onClose={close}>
    <form className="modal-form" onSubmit={createProject}>
      <label>Project name<input autoFocus value={form.name} onChange={update('name')} placeholder="e.g. Community garden study" required minLength="2" /></label>
      <label>Course or group<input value={form.course} onChange={update('course')} placeholder="e.g. DES 204 · Collaborative Systems" /></label>
      <label>Project description<textarea rows="3" value={form.description} onChange={update('description')} placeholder="What is your team working toward?" /></label>
      <fieldset className="member-picker"><legend>Add teammates</legend>{allMembers.map((member) => <label key={member.id}><input type="checkbox" checked={selectedMembers.includes(member.id)} onChange={(event) => setSelectedMembers((selected) => event.target.checked ? [...selected, member.id] : selected.filter((id) => id !== member.id))} /><span><b>{member.name}</b><small>{member.persona}</small></span></label>)}</fieldset>
      <div className="modal-actions"><button type="button" className="button button-subtle" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}>Create project <ArrowRight size={15} /></button></div>
    </form>
  </Modal>
  if (modal.type === 'project-edit') return <Modal title="Edit project details" eyebrow="WORKSPACE SETTINGS" onClose={close}>
    <form className="modal-form" onSubmit={saveProject}>
      <label>Project name<input autoFocus value={form.name} onChange={update('name')} required minLength="2" /></label>
      <label>Course or group<input value={form.course} onChange={update('course')} /></label>
      <label>Project description<textarea rows="3" value={form.description} onChange={update('description')} /></label>
      <fieldset className="member-picker"><legend>Project members</legend>{members.map((member) => <label key={member.id}><input type="checkbox" checked={selectedMembers.includes(member.id)} onChange={(event) => setSelectedMembers((selected) => event.target.checked ? [...selected, member.id] : selected.filter((id) => id !== member.id))} /><span><b>{member.name}</b><small>{member.persona}</small></span></label>)}</fieldset>
      <div className="modal-actions"><button type="button" className="button button-subtle" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}>Save changes <Check size={15} /></button></div>
    </form>
  </Modal>
  if (modal.type === 'task' || modal.type === 'task-edit') {
    const editing = modal.type === 'task-edit'
    return <Modal title={editing ? 'Edit task' : 'Add a task'} eyebrow="PROJECT WORK" onClose={close}>
    <form className="modal-form" onSubmit={(e) => submit(e, editing ? `/tasks/${modal.task.id}` : '/tasks', editing ? 'PUT' : 'POST', {
      project_id: Number(project.id), title: form.title, description: form.description,
      status: editing ? modal.task.status : 'todo', priority: form.priority, assignee_id: form.assignee_id ? Number(form.assignee_id) : null, due_date: form.due_date || null
    }, editing ? 'Task updated.' : 'Task added to the board.')}>
      <label>Task title<input autoFocus value={form.title} onChange={update('title')} placeholder="What needs to get done?" required minLength="2" /></label>
      <label>Brief context<textarea rows="3" value={form.description} onChange={update('description')} placeholder="A little context helps everyone see the why." /></label>
      <div className="form-row"><label>Owner<select value={form.assignee_id} onChange={update('assignee_id')}><option value="">Unassigned</option>{members.map((member) => <option value={member.id} key={member.id}>{member.name} · {member.persona}</option>)}</select></label>
        <label>Priority<select value={form.priority} onChange={update('priority')}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div>
      <label>Due date<input type="date" value={form.due_date} onChange={update('due_date')} /></label>
      <div className="modal-actions"><button type="button" className="button button-subtle" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}>{editing ? 'Save task' : 'Add task'} <ArrowRight size={15} /></button></div>
    </form>
  </Modal>
  }
  if (modal.type === 'evidence' || modal.type === 'evidence-edit') {
    const editing = modal.type === 'evidence-edit'
    return <Modal title={editing ? 'Edit work signal' : 'Add a work signal'} eyebrow="CONTRIBUTION EVIDENCE" onClose={close} wide>
    <form className="modal-form" onSubmit={(e) => submit(e, editing ? `/evidence/${modal.evidence.id}` : '/evidence', editing ? 'PUT' : 'POST', {
      project_id: Number(project.id), task_id: form.task_id ? Number(form.task_id) : null,
      category: form.category, title: form.title, description: form.description, url: form.url || null, points: Number(form.points)
    }, editing ? 'Evidence updated.' : 'Evidence added to the project.')}>
      {!editing && <div className="modal-callout"><Sparkles size={16} /><span><b>Focus on the work and its context.</b> A clear note matters more than a perfect number.</span></div>}
      <label>Signal title<input autoFocus value={form.title} onChange={update('title')} placeholder="e.g. Keyboard navigation walkthrough" required minLength="3" /></label>
      <div className="form-row"><label>Contribution area<select value={form.category} onChange={update('category')}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>Related task<select value={form.task_id} onChange={update('task_id')}><option value="">Not linked to a task</option>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select></label></div>
      <label>What happened?<textarea rows="3" value={form.description} onChange={update('description')} placeholder="Add a sentence or two so the team can understand the contribution." /></label>
      <div className="form-row"><label>Link (optional)<input type="url" value={form.url} onChange={update('url')} placeholder="https://…" /></label>
        <label>Signal strength <span className="input-range-value">{form.points} / 100</span><input type="range" min="0" max="100" value={form.points} onChange={update('points')} /></label></div>
      <div className="modal-actions"><button type="button" className="button button-subtle" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}>{editing ? 'Save changes' : 'Save evidence'} <ArrowRight size={15} /></button></div>
    </form>
  </Modal>
  }
  if (modal.type === 'dispute') return <Modal title="Raise a question" eyebrow="A THOUGHTFUL REVIEW" onClose={close}>
    <div className="modal-callout"><MessageSquareWarning size={16} /><span><b>Be specific and constructive.</b> Disputes are visible to project members and stay in the audit record.</span></div>
    <form className="modal-form" onSubmit={(e) => submit(e, '/disputes', 'POST', {
      project_id: Number(project.id), evidence_id: form.evidence_id ? Number(form.evidence_id) : null, reason: form.reason
    }, 'Your question was shared with the project team.')}>
      <label>Related evidence<select value={form.evidence_id} onChange={update('evidence_id')}><option value="">General project question</option>{selectableEvidence.map((entry) => <option value={entry.id} key={entry.id}>{entry.title} · {entry.contributor_name}</option>)}</select></label>
      <label>What would you like reviewed?<textarea autoFocus rows="5" value={form.reason} onChange={update('reason')} placeholder="Share the context, what feels unclear, and what kind of follow-up would help." required minLength="8" /></label>
      <div className="modal-actions"><button type="button" className="button button-subtle" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}>Share question <ArrowRight size={15} /></button></div>
    </form>
  </Modal>
  if (modal.type === 'resolve') return <Modal title="Review this conversation" eyebrow="DISPUTE RESOLUTION" onClose={close}>
    <div className="dispute-modal-context"><span>{modal.dispute.evidence_title || 'Project contribution'}</span><p>{modal.dispute.reason}</p></div>
    <form className="modal-form" onSubmit={(e) => submit(e, `/disputes/${modal.dispute.id}`, 'PATCH', { status: form.status, resolution: form.resolution }, 'Dispute resolution recorded.')}>
      <label>Outcome<select value={form.status} onChange={update('status')}><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label>
      <label>Resolution note<textarea autoFocus rows="4" value={form.resolution} onChange={update('resolution')} placeholder="Summarize what was reviewed and the follow-up agreed on." required minLength="4" /></label>
      <div className="modal-actions"><button type="button" className="button button-subtle" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}><Check size={15} /> Record resolution</button></div>
    </form>
  </Modal>
}

export default App
