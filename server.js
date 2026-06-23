'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const sessions = new Map();

let nextUserId = 4;
let nextTicketId = 4;
let nextNotifId = 3;
let nextUpdateId = 4;

const users = [
  { id: 1, full_name: 'System Administrator', email: 'admin@ltuc.edu.jo', password: 'admin123', role: 'admin', department: 'IT', active: 1, is_it_manager: 1, it_category: JSON.stringify(['ERP System','Academia','Training Module','Moodle','IT Support']) },
  { id: 2, full_name: 'IT Support Member', email: 'it@ltuc.edu.jo', password: 'it123', role: 'it', department: 'IT', active: 1, is_it_manager: 0, it_category: JSON.stringify(['IT Support','Moodle']) },
  { id: 3, full_name: 'Staff Demo User', email: 'staff@ltuc.edu.jo', password: 'staff123', role: 'staff', department: 'Academic', active: 1, is_it_manager: 0, it_category: null }
];

const tickets = [
  { id: 1, ticket_number: 'TCK-2026-0001', title: 'Moodle login issue', category: 'Moodle', priority: 'High', status: 'Submitted', approval_status: null, description: 'User cannot access Moodle after password reset.', submitted_by: 3, submitted_by_name: 'Staff Demo User', assigned_to: 2, assigned_to_name: 'IT Support Member', feedback: null, feedback_comment: '', cc_email1: '', cc_email2: '', unread_count: 1, created_at: '2026-06-21 09:10:00', updated_at: '2026-06-21 09:20:00' },
  { id: 2, ticket_number: 'TCK-2026-0002', title: 'ERP report permission', category: 'ERP System', priority: 'Medium', status: 'In Progress', approval_status: 'Pending', approval_note: 'Needs manager confirmation.', description: 'Finance report access needs to be enabled.', submitted_by: 3, submitted_by_name: 'Staff Demo User', assigned_to: 1, assigned_to_name: 'System Administrator', feedback: null, feedback_comment: '', cc_email1: '', cc_email2: '', unread_count: 0, created_at: '2026-06-20 12:00:00', updated_at: '2026-06-21 10:00:00' },
  { id: 3, ticket_number: 'TCK-2026-0003', title: 'Printer not responding', category: 'IT Support', priority: 'Low', status: 'Resolved', approval_status: null, description: 'Lab printer was not responding.', submitted_by: 3, submitted_by_name: 'Staff Demo User', assigned_to: 2, assigned_to_name: 'IT Support Member', feedback: 'positive', feedback_comment: 'Fast support.', cc_email1: '', cc_email2: '', unread_count: 0, created_at: '2026-06-19 08:00:00', updated_at: '2026-06-20 13:00:00' }
];

const updates = [
  { id: 1, ticket_id: 1, author_name: 'IT Support Member', message: 'Checking account status.', created_at: '2026-06-21 09:20:00', attachments: [] },
  { id: 2, ticket_id: 2, author_name: 'System Administrator', message: 'Approval requested from IT manager.', created_at: '2026-06-21 10:00:00', attachments: [] },
  { id: 3, ticket_id: 3, author_name: 'IT Support Member', message: 'Printer queue restarted and tested.', created_at: '2026-06-20 13:00:00', attachments: [] }
];

const notifications = [
  { id: 1, message: 'New ticket submitted: Moodle login issue', is_read: 0, created_at: '2026-06-21 09:10:00' },
  { id: 2, message: 'Approval pending: ERP report permission', is_read: 0, created_at: '2026-06-21 10:00:00' }
];

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(body);
}
function redirect(res, location, headers = {}) { res.writeHead(302, { Location: location, ...headers }); res.end(); }
function cookie(req, name) {
  const raw = req.headers.cookie || '';
  return raw.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.split('=').slice(1).join('=');
}
function currentUser(req) { const sid = cookie(req, 'sid'); const id = sid && sessions.get(sid); return users.find(u => u.id === id && u.active); }
function publicUser(u) { if (!u) return null; const { password, ...safe } = u; return safe; }
function setSession(res, userId) { const sid = crypto.randomBytes(16).toString('hex'); sessions.set(sid, userId); return { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Lax; Path=/` }; }
function clearSession() { return { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }; }
function readBody(req) { return new Promise(resolve => { const chunks=[]; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); }); }
async function readJson(req) { try { const b = await readBody(req); return b.length ? JSON.parse(b.toString()) : {}; } catch { return {}; } }
async function readFormLike(req) {
  const buf = await readBody(req); const txt = buf.toString('utf8'); const out = {};
  if ((req.headers['content-type']||'').includes('application/json')) return JSON.parse(txt || '{}');
  if ((req.headers['content-type']||'').includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(txt));
  const re = /name="([^"]+)"(?:; filename="([^"]*)")?\r?\n(?:Content-Type:[^\r\n]+\r?\n)?\r?\n([\s\S]*?)(?=\r?\n------|\r?\n--)/g;
  let m; while ((m = re.exec(txt))) if (!m[2]) out[m[1]] = m[3].trim();
  return out;
}
function nowSql() { return new Date().toISOString().slice(0,19).replace('T',' '); }
function withFormatted(t) { return { ...t, created_formatted: new Date(t.created_at.replace(' ','T')).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) }; }
function findTicket(id) { return tickets.find(t => t.id === Number(id)); }
function addUpdate(ticketId, author, message) { updates.push({ id: nextUpdateId++, ticket_id: Number(ticketId), author_name: author?.full_name || 'System', message, created_at: nowSql(), attachments: [] }); }
function addNotification(message) { notifications.unshift({ id: nextNotifId++, message, is_read: 0, created_at: nowSql() }); }
function analyticsData() {
  const statuses = ['Open','Submitted','In Progress','Deferred','Resolved','Closed'];
  const byStatus = Object.fromEntries(statuses.map(s => [s, 0]));
  tickets.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
  const byCategory = {}, byPriority = { Low:0, Medium:0, High:0, Critical:0 };
  tickets.forEach(t => { byCategory[t.category]=(byCategory[t.category]||0)+1; byPriority[t.priority]=(byPriority[t.priority]||0)+1; });
  const feedbackStats = { positive: tickets.filter(t=>t.feedback==='positive').length, negative: tickets.filter(t=>t.feedback==='negative').length, none: tickets.filter(t=>!t.feedback).length };
  return { byStatus, byCategory, byPriority, feedbackStats, avgResolutionDays: 1.4, byMonth: [
    {month:'Jan', count:4},{month:'Feb', count:7},{month:'Mar', count:5},{month:'Apr', count:9},{month:'May', count:6},{month:'Jun', count:tickets.length}
  ] };
}
function mime(file) { return ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'}[path.extname(file).toLowerCase()] || 'application/octet-stream'); }
function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/') p = '/index.html';
  if (p === '/it/dashboard.html' && !fs.existsSync(path.join(ROOT, p))) p = '/it/it/idashboard.html';
  const full = path.normalize(path.join(ROOT, p));
  if (!full.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': mime(full) }); fs.createReadStream(full).pipe(res);
  });
}

async function handleApi(req, res, url) {
  const u = currentUser(req);
  const p = url.pathname;
  if (p === '/api/auth/microsoft') return redirect(res, '/it/dashboard.html', setSession(res, 1));
  if (p === '/api/auth/login' && req.method === 'POST') { const b = await readJson(req); const user = users.find(x => x.email.toLowerCase() === String(b.email||'').toLowerCase() && x.password === b.password && x.active); if (!user) return send(res, 401, { error: 'Invalid email or password.' }); return send(res, 200, { success: true, user: publicUser(user) }, setSession(res, user.id)); }
  if (p === '/api/auth/logout' && req.method === 'POST') return send(res, 200, { success:true }, clearSession());
  if (p === '/api/auth/me') { if (!u) return send(res, 401, { error:'Not authenticated' }); return send(res, 200, { user: publicUser(u) }); }
  if (p === '/api/screen/verify-pin' && req.method === 'POST') { const b = await readJson(req); return b.pin === '1234' ? send(res, 200, { success:true }) : send(res, 403, { error:'Invalid PIN' }); }
  if (p === '/api/screen/data') {
    if (req.headers['x-screen-pin'] !== '1234') return send(res, 403, { error:'Invalid PIN' });
    const stats = { submitted: tickets.filter(t=>t.status==='Submitted').length, inProgress: tickets.filter(t=>t.status==='In Progress').length, deferred: tickets.filter(t=>t.status==='Deferred').length, resolved: tickets.filter(t=>t.status==='Resolved').length, resolvedToday: tickets.filter(t=>t.status==='Resolved' && t.updated_at.startsWith('2026-06-21')).length, avgResolutionDays: 1.4 };
    const active = tickets.filter(t=>['Submitted','In Progress','Deferred'].includes(t.status));
    const byCategory = Object.entries(active.reduce((a,t)=>(a[t.category]=(a[t.category]||0)+1,a),{})).map(([category,count])=>({category,count}));
    const byStatus = Object.entries(tickets.reduce((a,t)=>(a[t.status]=(a[t.status]||0)+1,a),{})).map(([status,count])=>({status,count}));
    return send(res, 200, { stats, byCategory, byStatus, activeTickets: active.map(withFormatted) });
  }
  if (!u) return send(res, 401, { error:'Not authenticated' });
  if (p === '/api/tickets/all') return send(res, 200, { tickets: tickets.map(withFormatted) });
  if (p === '/api/admin/it-members' || p === '/api/admin/it-members-by-category') return send(res, 200, { members: users.filter(x=>['admin','it'].includes(x.role) && x.active).map(publicUser) });
  if (p === '/api/admin/analytics') return send(res, 200, analyticsData());
  if (p === '/api/notifications') return send(res, 200, { notifications });
  if (p === '/api/notifications/mark-read' && req.method === 'POST') { const b=await readJson(req); notifications.forEach(n=>{ if(b.id==='all'||n.id===Number(b.id)) n.is_read=1; }); return send(res, 200, { success:true }); }
  if (p === '/api/admin/users') return send(res, 200, { users: users.map(publicUser) });
  if (p === '/api/admin/users/add' && req.method === 'POST') { const b=await readJson(req); if(!b.email||!b.password||!b.full_name) return send(res,400,{error:'Missing required fields.'}); if(users.some(x=>x.email.toLowerCase()===b.email.toLowerCase())) return send(res,409,{error:'Email already exists.'}); const nu={id:nextUserId++, full_name:b.full_name, email:b.email, password:b.password, role:b.role||'it', department:b.department||'', active:1, is_it_manager:0, it_category:JSON.stringify([])}; users.push(nu); return send(res,200,{user:publicUser(nu)}); }
  if (p.startsWith('/api/admin/logs/')) return send(res, 200, { logs: updates.map(x=>({ id:x.id, message:x.message, actor:x.author_name, created_at:x.created_at })) });
  if (p === '/api/admin/export/tickets') { const csv = ['Number,Title,Category,Priority,Status,Submitted By,Assigned To'].concat(tickets.map(t=>[t.ticket_number,t.title,t.category,t.priority,t.status,t.submitted_by_name,t.assigned_to_name||''].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(','))).join('\n'); return send(res,200,csv,{ 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="tickets.csv"' }); }

  let m;
  if ((m = p.match(/^\/api\/admin\/users\/(\d+)$/)) && req.method === 'DELETE') { const idx=users.findIndex(x=>x.id===Number(m[1])); if(idx<0) return send(res,404,{error:'User not found'}); users.splice(idx,1); return send(res,200,{success:true}); }
  if ((m = p.match(/^\/api\/admin\/users\/(\d+)$/)) && req.method === 'PUT') { const target=users.find(x=>x.id===Number(m[1])); if(!target) return send(res,404,{error:'User not found'}); Object.assign(target, await readJson(req)); return send(res,200,{user:publicUser(target)}); }
  if ((m = p.match(/^\/api\/admin\/users\/(\d+)\/(toggle-status|toggle-manager)$/)) && req.method === 'POST') { const target=users.find(x=>x.id===Number(m[1])); if(!target) return send(res,404,{error:'User not found'}); if(m[2]==='toggle-status') target.active=target.active?0:1; else target.is_it_manager=target.is_it_manager?0:1; return send(res,200,{user:publicUser(target)}); }
  if ((m = p.match(/^\/api\/admin\/users\/(\d+)\/(reset-password|change-role|assign-category)$/)) && req.method === 'POST') { const target=users.find(x=>x.id===Number(m[1])); if(!target) return send(res,404,{error:'User not found'}); const b=await readJson(req); if(m[2]==='reset-password') target.password=b.password||target.password; if(m[2]==='change-role') { target.role=b.role||target.role; target.department=b.department||target.department; } if(m[2]==='assign-category') target.it_category=JSON.stringify(b.categories||b.it_category||[]); return send(res,200,{user:publicUser(target)}); }
  if (p === '/api/tickets/submit' && req.method === 'POST') { const b=await readFormLike(req); const t={ id:nextTicketId++, ticket_number:`TCK-2026-${String(nextTicketId-1).padStart(4,'0')}`, title:b.title||'Untitled ticket', category:b.category||'IT Support', priority:b.priority||'Medium', status:'Submitted', approval_status:null, description:b.description||'', submitted_by:u.id, submitted_by_name:u.full_name, assigned_to:null, assigned_to_name:'', feedback:null, feedback_comment:'', cc_email1:b.cc_email1||'', cc_email2:b.cc_email2||'', unread_count:0, created_at:nowSql(), updated_at:nowSql() }; tickets.unshift(t); addUpdate(t.id,u,'Ticket submitted.'); addNotification(`New ticket submitted: ${t.title}`); return send(res,200,{ticket:t}); }
  if ((m = p.match(/^\/api\/tickets\/(\d+)$/)) && req.method === 'GET') { const t=findTicket(m[1]); return t ? send(res,200,{ticket:withFormatted(t)}) : send(res,404,{error:'Ticket not found'}); }
  if ((m = p.match(/^\/api\/tickets\/(\d+)\/(updates-with-attachments|attachments)$/)) && req.method === 'GET') { if(m[2]==='attachments') return send(res,200,{attachments:[]}); return send(res,200,{updates:updates.filter(x=>x.ticket_id===Number(m[1]))}); }
  if ((m = p.match(/^\/api\/tickets\/(\d+)\/mark-read$/)) && req.method === 'POST') { const t=findTicket(m[1]); if(t) t.unread_count=0; return send(res,200,{success:true}); }
  if ((m = p.match(/^\/api\/tickets\/(\d+)\/assign$/)) && req.method === 'POST') { const t=findTicket(m[1]); if(!t) return send(res,404,{error:'Ticket not found'}); const b=await readJson(req); const assignee=users.find(x=>x.id===Number(b.assigned_to)); t.assigned_to=assignee?assignee.id:null; t.assigned_to_name=assignee?assignee.full_name:''; t.updated_at=nowSql(); addUpdate(t.id,u,`Assigned to ${t.assigned_to_name || 'Unassigned'}.`); return send(res,200,{ticket:t}); }
  if ((m = p.match(/^\/api\/tickets\/(\d+)\/update$/)) && req.method === 'POST') { const t=findTicket(m[1]); if(!t) return send(res,404,{error:'Ticket not found'}); const b=await readFormLike(req); if(b.status) t.status=b.status; if(b.priority) t.priority=b.priority; if(b.category) t.category=b.category; t.updated_at=nowSql(); addUpdate(t.id,u,b.message||'Ticket updated.'); return send(res,200,{ticket:t}); }
  if ((m = p.match(/^\/api\/tickets\/(\d+)\/update-cc$/)) && req.method === 'POST') { const t=findTicket(m[1]); if(!t) return send(res,404,{error:'Ticket not found'}); const b=await readJson(req); t.cc_email1=b.cc_email1||''; t.cc_email2=b.cc_email2||''; addUpdate(t.id,u,'CC list updated.'); return send(res,200,{cc_email1:t.cc_email1,cc_email2:t.cc_email2}); }
  if ((m = p.match(/^\/api\/tickets\/(\d+)\/request-approval$/)) && req.method === 'POST') { const t=findTicket(m[1]); if(!t) return send(res,404,{error:'Ticket not found'}); t.approval_status='Pending'; addNotification(`Approval requested: ${t.title}`); addUpdate(t.id,u,'Approval requested.'); return send(res,200,{ticket:t}); }
  if ((m = p.match(/^\/api\/tickets\/(\d+)\/approve$/)) && req.method === 'POST') { const t=findTicket(m[1]); if(!t) return send(res,404,{error:'Ticket not found'}); const b=await readJson(req); t.approval_status=b.approved===false?'Rejected':'Approved'; t.approval_note=b.note||''; addUpdate(t.id,u,`Approval ${t.approval_status}.`); return send(res,200,{ticket:t}); }
  return send(res, 404, { error: 'API endpoint not found', path: p });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try { if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url); return serveStatic(req, res, url.pathname); }
  catch (e) { console.error(e); return send(res, 500, { error: 'Server error', detail: e.message }); }
}).listen(PORT, () => console.log(`Ticketing system running: http://localhost:${PORT}`));
