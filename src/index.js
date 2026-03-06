// The Board - Cloudflare Worker
// API + Frontend served from same worker

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Quick dump page for mobile
    if (path === '/dump') {
      return new Response(DUMP_HTML, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // API routes
    if (path.startsWith('/api/')) {
      try {
        const result = await handleAPI(request, env, path);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // Serve frontend
    return new Response(FRONTEND_HTML, {
      headers: { 'Content-Type': 'text/html' },
    });
  },
};

// Get next global ID
async function getNextId(db) {
  const result = await db.prepare('UPDATE global_counter SET next_id = next_id + 1 WHERE id = 1 RETURNING next_id - 1 as id').first();
  return result.id;
}

// API handler
async function handleAPI(request, env, path) {
  const db = env.DB;
  const method = request.method;

  // GET /api/board - Full board state
  if (path === '/api/board' && method === 'GET') {
    const projects = await db.prepare('SELECT * FROM projects ORDER BY sort_order, id').all();
    const cleanTasks = await db.prepare('SELECT * FROM clean_tasks ORDER BY sort_order, id').all();
    const messyTasks = await db.prepare('SELECT * FROM messy_tasks ORDER BY created_at DESC').all();
    const notepads = await db.prepare('SELECT * FROM notepads ORDER BY id').all();
    const notepadItems = await db.prepare('SELECT * FROM notepad_items ORDER BY notepad_id, sort_order, id').all();
    const pinnedNotepads = await db.prepare('SELECT * FROM pinned_notepads ORDER BY position').all();

    // Attach items to notepads
    const notepadsWithItems = notepads.results.map(notepad => ({
      ...notepad,
      items: notepadItems.results.filter(item => item.notepad_id === notepad.id),
    }));

    return {
      projects: projects.results,
      cleanTasks: cleanTasks.results,
      messyTasks: messyTasks.results,
      notepads: notepadsWithItems,
      pinnedNotepads: pinnedNotepads.results.map(p => p.notepad_id),
    };
  }

  // POST /api/projects - Create project
  if (path === '/api/projects' && method === 'POST') {
    const body = await request.json();
    const id = await getNextId(db);
    const maxSort = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM projects').first();
    
    await db.prepare(
      'INSERT INTO projects (id, name, status_notes, active, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, body.name, body.status_notes || '', body.active ? 1 : 0, maxSort.next).run();
    
    return { id, name: body.name, success: true };
  }

  // PATCH /api/projects/:id - Update project
  const projectMatch = path.match(/^\/api\/projects\/(\d+)$/);
  if (projectMatch && method === 'PATCH') {
    const id = parseInt(projectMatch[1]);
    const body = await request.json();
    const updates = [];
    const values = [];

    if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name); }
    if (body.status_notes !== undefined) { updates.push('status_notes = ?'); values.push(body.status_notes); }
    if (body.active !== undefined) { updates.push('active = ?'); values.push(body.active ? 1 : 0); }
    if (body.sort_order !== undefined) { updates.push('sort_order = ?'); values.push(body.sort_order); }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);
      await db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
    }

    return { id, success: true };
  }

  // DELETE /api/projects/:id
  if (projectMatch && method === 'DELETE') {
    const id = parseInt(projectMatch[1]);
    await db.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
    return { id, success: true };
  }

  // POST /api/projects/:id/activate
  const activateMatch = path.match(/^\/api\/projects\/(\d+)\/activate$/);
  if (activateMatch && method === 'POST') {
    const id = parseInt(activateMatch[1]);
    await db.prepare("UPDATE projects SET active = 1, updated_at = datetime('now') WHERE id = ?").bind(id).run();
    return { id, active: true, success: true };
  }

  // POST /api/projects/:id/deactivate
  const deactivateMatch = path.match(/^\/api\/projects\/(\d+)\/deactivate$/);
  if (deactivateMatch && method === 'POST') {
    const id = parseInt(deactivateMatch[1]);
    await db.prepare("UPDATE projects SET active = 0, updated_at = datetime('now') WHERE id = ?").bind(id).run();
    return { id, active: false, success: true };
  }

  // POST /api/tasks/clean - Create clean task
  if (path === '/api/tasks/clean' && method === 'POST') {
    const body = await request.json();
    const id = await getNextId(db);
    const maxSort = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM clean_tasks').first();
    
    await db.prepare('INSERT INTO clean_tasks (id, text, sort_order) VALUES (?, ?, ?)').bind(id, body.text, maxSort.next).run();
    return { id, text: body.text, success: true };
  }

  // POST /api/tasks/messy - Create messy task (brain dump)
  if (path === '/api/tasks/messy' && method === 'POST') {
    const body = await request.json();
    const id = await getNextId(db);
    
    await db.prepare('INSERT INTO messy_tasks (id, text) VALUES (?, ?)').bind(id, body.text).run();
    return { id, text: body.text, success: true };
  }

  // POST /api/tasks/messy/:id/to-clean - Promote messy to clean
  const toCleanMatch = path.match(/^\/api\/tasks\/messy\/(\d+)\/to-clean$/);
  if (toCleanMatch && method === 'POST') {
    const id = parseInt(toCleanMatch[1]);
    const messy = await db.prepare('SELECT * FROM messy_tasks WHERE id = ?').bind(id).first();
    
    if (!messy) return { error: 'Task not found', success: false };

    const maxSort = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM clean_tasks').first();
    await db.prepare('INSERT INTO clean_tasks (id, text, sort_order) VALUES (?, ?, ?)').bind(id, messy.text, maxSort.next).run();
    await db.prepare('DELETE FROM messy_tasks WHERE id = ?').bind(id).run();

    return { id, promoted: true, success: true };
  }

  // POST /api/tasks/messy/:id/to-notepad/:notepadId - Move messy to notepad
  const toNotepadMatch = path.match(/^\/api\/tasks\/messy\/(\d+)\/to-notepad\/(\d+)$/);
  if (toNotepadMatch && method === 'POST') {
    const taskId = parseInt(toNotepadMatch[1]);
    const notepadId = parseInt(toNotepadMatch[2]);
    
    const messy = await db.prepare('SELECT * FROM messy_tasks WHERE id = ?').bind(taskId).first();
    if (!messy) return { error: 'Task not found', success: false };

    const maxSort = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM notepad_items WHERE notepad_id = ?').bind(notepadId).first();
    await db.prepare('INSERT INTO notepad_items (id, notepad_id, text, sort_order) VALUES (?, ?, ?, ?)').bind(taskId, notepadId, messy.text, maxSort.next).run();
    await db.prepare('DELETE FROM messy_tasks WHERE id = ?').bind(taskId).run();

    return { id: taskId, notepadId, success: true };
  }

  // DELETE /api/tasks/clean/:id
  const deleteCleanMatch = path.match(/^\/api\/tasks\/clean\/(\d+)$/);
  if (deleteCleanMatch && method === 'DELETE') {
    const id = parseInt(deleteCleanMatch[1]);
    await db.prepare('DELETE FROM clean_tasks WHERE id = ?').bind(id).run();
    return { id, success: true };
  }

  // DELETE /api/tasks/messy/:id
  const deleteMessyMatch = path.match(/^\/api\/tasks\/messy\/(\d+)$/);
  if (deleteMessyMatch && method === 'DELETE') {
    const id = parseInt(deleteMessyMatch[1]);
    await db.prepare('DELETE FROM messy_tasks WHERE id = ?').bind(id).run();
    return { id, success: true };
  }

  // POST /api/notepads - Create notepad
  if (path === '/api/notepads' && method === 'POST') {
    const body = await request.json();
    const id = await getNextId(db);
    
    await db.prepare('INSERT INTO notepads (id, title, project_id) VALUES (?, ?, ?)').bind(id, body.title, body.project_id || null).run();
    return { id, title: body.title, success: true };
  }

  // PATCH /api/notepads/:id - Update notepad
  const notepadMatch = path.match(/^\/api\/notepads\/(\d+)$/);
  if (notepadMatch && method === 'PATCH') {
    const id = parseInt(notepadMatch[1]);
    const body = await request.json();
    
    if (body.title !== undefined) {
      await db.prepare('UPDATE notepads SET title = ? WHERE id = ?').bind(body.title, id).run();
    }
    if (body.project_id !== undefined) {
      await db.prepare('UPDATE notepads SET project_id = ? WHERE id = ?').bind(body.project_id, id).run();
    }

    return { id, success: true };
  }

  // DELETE /api/notepads/:id
  if (notepadMatch && method === 'DELETE') {
    const id = parseInt(notepadMatch[1]);
    await db.prepare('DELETE FROM notepads WHERE id = ?').bind(id).run();
    return { id, success: true };
  }

  // POST /api/notepads/:id/items - Add item to notepad
  const notepadItemsMatch = path.match(/^\/api\/notepads\/(\d+)\/items$/);
  if (notepadItemsMatch && method === 'POST') {
    const notepadId = parseInt(notepadItemsMatch[1]);
    const body = await request.json();
    const id = await getNextId(db);
    const maxSort = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM notepad_items WHERE notepad_id = ?').bind(notepadId).first();

    await db.prepare('INSERT INTO notepad_items (id, notepad_id, text, sort_order) VALUES (?, ?, ?, ?)').bind(id, notepadId, body.text, maxSort.next).run();
    return { id, notepadId, text: body.text, success: true };
  }

  // PATCH /api/notepads/:id/items/:itemId - Update notepad item
  const notepadItemMatch = path.match(/^\/api\/notepads\/(\d+)\/items\/(\d+)$/);
  if (notepadItemMatch && method === 'PATCH') {
    const notepadId = parseInt(notepadItemMatch[1]);
    const itemId = parseInt(notepadItemMatch[2]);
    const body = await request.json();

    if (body.text !== undefined) {
      await db.prepare('UPDATE notepad_items SET text = ? WHERE id = ? AND notepad_id = ?').bind(body.text, itemId, notepadId).run();
    }
    if (body.done !== undefined) {
      await db.prepare('UPDATE notepad_items SET done = ? WHERE id = ? AND notepad_id = ?').bind(body.done ? 1 : 0, itemId, notepadId).run();
    }

    return { id: itemId, success: true };
  }

  // DELETE /api/notepads/:id/items/:itemId
  if (notepadItemMatch && method === 'DELETE') {
    const itemId = parseInt(notepadItemMatch[2]);
    await db.prepare('DELETE FROM notepad_items WHERE id = ?').bind(itemId).run();
    return { id: itemId, success: true };
  }

  // POST /api/notepads/:id/pin - Pin notepad to board
  const pinMatch = path.match(/^\/api\/notepads\/(\d+)\/pin$/);
  if (pinMatch && method === 'POST') {
    const notepadId = parseInt(pinMatch[1]);
    
    // Check if already pinned
    const existing = await db.prepare('SELECT * FROM pinned_notepads WHERE notepad_id = ?').bind(notepadId).first();
    if (existing) return { notepadId, position: existing.position, alreadyPinned: true, success: true };

    // Find next available position (max 3)
    const pinned = await db.prepare('SELECT position FROM pinned_notepads ORDER BY position').all();
    const usedPositions = new Set(pinned.results.map(p => p.position));
    
    let position = null;
    for (let i = 1; i <= 3; i++) {
      if (!usedPositions.has(i)) { position = i; break; }
    }

    if (position === null) return { error: 'Maximum 3 notepads can be pinned', success: false };

    await db.prepare('INSERT INTO pinned_notepads (notepad_id, position) VALUES (?, ?)').bind(notepadId, position).run();
    return { notepadId, position, success: true };
  }

  // POST /api/notepads/:id/unpin - Unpin notepad from board
  const unpinMatch = path.match(/^\/api\/notepads\/(\d+)\/unpin$/);
  if (unpinMatch && method === 'POST') {
    const notepadId = parseInt(unpinMatch[1]);
    await db.prepare('DELETE FROM pinned_notepads WHERE notepad_id = ?').bind(notepadId).run();
    return { notepadId, success: true };
  }

  // DELETE /api/item/:id - Delete any item by its badge number
  const deleteAnyMatch = path.match(/^\/api\/item\/(\d+)$/);
  if (deleteAnyMatch && method === 'DELETE') {
    const id = parseInt(deleteAnyMatch[1]);
    
    // Try deleting from each table
    let deleted = false;
    const tables = ['projects', 'clean_tasks', 'messy_tasks', 'notepads', 'notepad_items'];
    
    for (const table of tables) {
      const result = await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
      if (result.meta.changes > 0) {
        deleted = true;
        break;
      }
    }

    return { id, deleted, success: deleted };
  }

  return { error: 'Not found', success: false };
}

// Embedded Frontend HTML
const FRONTEND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Board</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&family=Permanent+Marker&family=Architects+Daughter&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #root { width: 100%; height: 100%; overflow: hidden; }
    body { font-family: 'Caveat', cursive; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulse { 0%, 100% { box-shadow: 0 0 20px #22c55e; } 50% { box-shadow: 0 0 30px #22c55e, 0 0 40px #22c55e; } }
    .item-enter { animation: fadeIn 0.3s ease-out; }
    .light-active { animation: pulse 2s ease-in-out infinite; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect, useMemo } = React;

    const API_BASE = '';

    // Number badge component
    const NumberBadge = ({ number, size = 'normal' }) => {
      const sizeClasses = {
        tiny: { width: 22, height: 22, fontSize: 11, border: 2 },
        small: { width: 28, height: 28, fontSize: 14, border: 2 },
        normal: { width: 36, height: 36, fontSize: 18, border: 3 },
        large: { width: 44, height: 44, fontSize: 22, border: 3 }
      };
      const s = sizeClasses[size];
      
      return (
        <div style={{
          width: s.width, height: s.height, backgroundColor: '#FFD60A',
          border: \`\${s.border}px solid #1a1a1a\`, borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Permanent Marker', cursive", fontSize: s.fontSize,
          color: '#1a1a1a', fontWeight: 'bold', flexShrink: 0,
          boxShadow: '2px 2px 0 rgba(0,0,0,0.3)'
        }}>{number}</div>
      );
    };

    // Status light component
    const StatusLight = ({ active, size = 'normal' }) => {
      const s = size === 'small' ? 32 : 48;
      const b = size === 'small' ? 3 : 4;
      return (
        <div className={active ? 'light-active' : ''} style={{
          width: s, height: s, borderRadius: '50%',
          backgroundColor: active ? '#22c55e' : '#ef4444',
          border: \`\${b}px solid #374151\`,
          boxShadow: active 
            ? '0 0 20px #22c55e, inset 0 -8px 16px rgba(0,0,0,0.3), inset 0 4px 8px rgba(255,255,255,0.3)' 
            : '0 0 12px #ef4444, inset 0 -8px 16px rgba(0,0,0,0.3), inset 0 4px 8px rgba(255,255,255,0.2)',
          position: 'relative', flexShrink: 0
        }}>
          <div style={{
            position: 'absolute', top: size === 'small' ? 4 : 6, left: size === 'small' ? 7 : 10,
            width: size === 'small' ? 8 : 12, height: size === 'small' ? 5 : 8,
            borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.4)'
          }} />
        </div>
      );
    };

    // Project card
    const ProjectCard = ({ project, scale }) => {
      const titleSize = scale > 0.7 ? 32 : scale > 0.5 ? 26 : 20;
      const statusSize = scale > 0.7 ? 20 : scale > 0.5 ? 17 : 14;
      const padding = scale > 0.7 ? 24 : scale > 0.5 ? 16 : 12;
      const badgeSize = scale > 0.7 ? 'large' : scale > 0.5 ? 'normal' : 'small';
      const lightSize = scale > 0.5 ? 'normal' : 'small';
      
      return (
        <div className="item-enter" style={{
          backgroundColor: 'rgba(255,255,255,0.85)', border: '3px solid #374151',
          borderRadius: 8, padding, display: 'flex', flexDirection: 'column',
          gap: scale > 0.5 ? 12 : 8, boxShadow: '4px 4px 0 rgba(0,0,0,0.15)',
          flex: 1, minHeight: 0, overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: scale > 0.5 ? 16 : 10 }}>
            <NumberBadge number={project.id} size={badgeSize} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{
                fontFamily: "'Permanent Marker', cursive", fontSize: titleSize,
                color: '#1a1a1a', marginBottom: 2, letterSpacing: 1,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
              }}>{project.name}</h2>
              <div style={{ height: 3, backgroundColor: '#1a1a1a', borderRadius: 2 }} />
            </div>
            <StatusLight active={project.active} size={lightSize} />
          </div>
          <p style={{
            fontFamily: "'Architects Daughter', cursive", fontSize: statusSize,
            color: '#374151', lineHeight: 1.4, paddingLeft: scale > 0.5 ? 52 : 38,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: scale > 0.7 ? 4 : scale > 0.5 ? 3 : 2, WebkitBoxOrient: 'vertical'
          }}>{project.status_notes}</p>
        </div>
      );
    };

    // Clean task
    const CleanTask = ({ task, scale }) => {
      const fontSize = scale > 0.7 ? 18 : scale > 0.5 ? 15 : 13;
      const padding = scale > 0.7 ? '12px 16px' : scale > 0.5 ? '8px 12px' : '6px 10px';
      const badgeSize = scale > 0.7 ? 'small' : 'tiny';
      
      return (
        <div className="item-enter" style={{
          display: 'flex', alignItems: 'center', gap: scale > 0.5 ? 12 : 8,
          padding, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 6,
          border: '2px solid #9ca3af', flex: 1, minHeight: 0
        }}>
          <NumberBadge number={task.id} size={badgeSize} />
          <span style={{
            fontFamily: "'Architects Daughter', cursive", fontSize,
            color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>{task.text}</span>
        </div>
      );
    };

    // Messy task
    const MessyTask = ({ task, index, scale }) => {
      const rotation = useMemo(() => (Math.random() - 0.5) * 12, []);
      const colors = ['#fef08a', '#fde68a', '#fcd34d', '#fbbf24'];
      const bgColor = useMemo(() => colors[index % colors.length], [index]);
      const fontSize = scale > 0.6 ? 16 : scale > 0.4 ? 13 : 11;
      const padding = scale > 0.6 ? '10px 12px' : scale > 0.4 ? '7px 9px' : '5px 7px';
      const badgeSize = scale > 0.6 ? 'small' : 'tiny';
      
      return (
        <div className="item-enter" style={{
          backgroundColor: bgColor, padding, borderRadius: 2,
          boxShadow: '3px 3px 8px rgba(0,0,0,0.25)', transform: \`rotate(\${rotation}deg)\`,
          display: 'flex', flexDirection: 'column', gap: scale > 0.5 ? 6 : 4,
          flex: '1 1 auto', minWidth: scale > 0.6 ? 90 : scale > 0.4 ? 70 : 55,
          maxWidth: scale > 0.6 ? 150 : scale > 0.4 ? 120 : 95
        }}>
          <NumberBadge number={task.id} size={badgeSize} />
          <span style={{
            fontFamily: "'Caveat', cursive", fontSize, color: '#1a1a1a',
            fontWeight: 500, lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: scale > 0.5 ? 3 : 2, WebkitBoxOrient: 'vertical'
          }}>{task.text}</span>
        </div>
      );
    };

    // Notepad
    const Notepad = ({ notepad, style }) => (
      <div style={{
        backgroundColor: '#fef9c3', borderRadius: 4,
        boxShadow: '6px 6px 20px rgba(0,0,0,0.35), 0 0 0 2px #d4a017',
        display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', ...style
      }}>
        <div style={{ position: 'absolute', left: 48, top: 0, bottom: 0, width: 2, backgroundColor: '#f87171' }} />
        <div style={{
          position: 'absolute', top: -8, left: '30%', width: 60, height: 24,
          backgroundColor: 'rgba(200, 180, 150, 0.6)', transform: 'rotate(-2deg)', borderRadius: 2
        }} />
        <div style={{
          position: 'absolute', top: -6, right: '25%', width: 50, height: 22,
          backgroundColor: 'rgba(200, 180, 150, 0.5)', transform: 'rotate(3deg)', borderRadius: 2
        }} />
        <div style={{
          padding: '20px 20px 16px 60px', borderBottom: '2px solid #d4a017',
          display: 'flex', alignItems: 'center', gap: 12
        }}>
          <NumberBadge number={notepad.id} />
          <h3 style={{
            fontFamily: "'Permanent Marker', cursive", fontSize: 26, color: '#1a1a1a',
            textDecoration: 'underline', textUnderlineOffset: 4
          }}>{notepad.title}</h3>
        </div>
        <div style={{ padding: '16px 20px 20px 60px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
          {notepad.items?.map((item, i) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{
                width: 22, height: 22, border: '2px solid #1a1a1a', borderRadius: 3,
                flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2
              }}>
                {item.done ? <span style={{ fontFamily: "'Permanent Marker', cursive", fontSize: 18, color: '#16a34a' }}>✓</span> : null}
              </div>
              <span style={{
                fontFamily: "'Architects Daughter', cursive", fontSize: 19,
                color: item.done ? '#6b7280' : '#1a1a1a',
                textDecoration: item.done ? 'line-through' : 'none', lineHeight: 1.4
              }}>{item.text}</span>
            </div>
          ))}
        </div>
        <div style={{
          position: 'absolute', top: 80, left: 0, right: 0, bottom: 0,
          backgroundImage: 'repeating-linear-gradient(transparent, transparent 31px, #bfdbfe 31px, #bfdbfe 32px)',
          pointerEvents: 'none', opacity: 0.5
        }} />
      </div>
    );

    // Empty state
    const EmptyState = () => (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#9ca3af', fontFamily: "'Architects Daughter', cursive", fontSize: 24
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
        <div>The Board is empty</div>
        <div style={{ fontSize: 18, marginTop: 8 }}>Add projects and tasks to get started</div>
      </div>
    );

    // Main Whiteboard
    const Whiteboard = () => {
      const [data, setData] = useState(null);
      const [error, setError] = useState(null);

      const fetchBoard = async () => {
        try {
          const res = await fetch(API_BASE + '/api/board');
          const json = await res.json();
          setData(json);
          setError(null);
        } catch (e) {
          setError(e.message);
        }
      };

      useEffect(() => {
        fetchBoard();
        const interval = setInterval(fetchBoard, 5000);
        return () => clearInterval(interval);
      }, []);

      if (!data) {
        return (
          <div style={{
            width: '100vw', height: '100vh', backgroundColor: '#f5f5f0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Permanent Marker', cursive", fontSize: 32, color: '#6b7280'
          }}>Loading The Board...</div>
        );
      }

      const pinnedNotepads = data.notepads?.filter(n => data.pinnedNotepads?.includes(n.id)) || [];
      const notepadCount = pinnedNotepads.length;

      const projectScale = Math.max(0.3, 1 - ((data.projects?.length || 1) - 1) * 0.15);
      const cleanTaskScale = Math.max(0.3, 1 - ((data.cleanTasks?.length || 1) - 1) * 0.1);
      const messyTaskScale = Math.max(0.3, 1 - ((data.messyTasks?.length || 1) - 1) * 0.06);

      const isEmpty = !data.projects?.length && !data.cleanTasks?.length && !data.messyTasks?.length;

      return (
        <div style={{
          width: '100vw', height: '100vh', backgroundColor: '#f5f5f0',
          backgroundImage: \`
            radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.05) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(255, 200, 150, 0.08) 0%, transparent 50%),
            url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E")
          \`, display: 'flex', position: 'relative', padding: 20, gap: 20
        }}>
          {isEmpty ? <EmptyState /> : (
            <>
              {/* Projects */}
              <div style={{ flex: '0 0 50%', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
                <div style={{
                  fontFamily: "'Permanent Marker', cursive", fontSize: 28, color: '#6b7280',
                  paddingLeft: 8, opacity: 0.7, flexShrink: 0
                }}>PROJECTS</div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
                  {data.projects?.map(project => (
                    <ProjectCard key={project.id} project={project} scale={projectScale} />
                  ))}
                </div>
              </div>

              {/* Tasks */}
              <div style={{ flex: '0 0 50%', display: 'flex', gap: 16, minHeight: 0 }}>
                {/* Clean */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
                  <div style={{
                    fontFamily: "'Permanent Marker', cursive", fontSize: 24, color: '#6b7280',
                    paddingLeft: 8, opacity: 0.7, flexShrink: 0
                  }}>TASKS</div>
                  <div style={{
                    flex: 1, backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 8,
                    border: '2px dashed #d1d5db', padding: 12, display: 'flex',
                    flexDirection: 'column', gap: 8, minHeight: 0
                  }}>
                    {data.cleanTasks?.map(task => (
                      <CleanTask key={task.id} task={task} scale={cleanTaskScale} />
                    ))}
                  </div>
                </div>

                {/* Messy */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
                  <div style={{
                    fontFamily: "'Permanent Marker', cursive", fontSize: 24, color: '#6b7280',
                    paddingLeft: 8, opacity: 0.7, flexShrink: 0
                  }}>DUMP</div>
                  <div style={{
                    flex: 1, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 8,
                    border: '2px dashed #9ca3af', padding: 12, display: 'flex',
                    flexWrap: 'wrap', gap: 10, alignContent: 'flex-start', minHeight: 0, overflow: 'hidden'
                  }}>
                    {data.messyTasks?.map((task, i) => (
                      <MessyTask key={task.id} task={task} index={i} scale={messyTaskScale} />
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Notepads overlay */}
          {notepadCount > 0 && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 32, padding: 40, zIndex: 100
            }}>
              {pinnedNotepads.map((notepad, index) => (
                <Notepad key={notepad.id} notepad={notepad} style={{
                  width: notepadCount === 1 ? 450 : notepadCount === 2 ? 400 : 350,
                  maxHeight: '80vh',
                  transform: notepadCount === 3 
                    ? \`rotate(\${(index - 1) * 2}deg)\` 
                    : notepadCount === 2 ? \`rotate(\${(index - 0.5) * 3}deg)\` : 'rotate(-1deg)'
                }} />
              ))}
            </div>
          )}
        </div>
      );
    };

    ReactDOM.render(<Whiteboard />, document.getElementById('root'));
  </script>
</body>
</html>`;

// Quick dump page for mobile
const DUMP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Dump">
  <title>Dump</title>
  <link rel="apple-touch-icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect fill='%23FFD60A' width='100' height='100' rx='20'/><text x='50' y='68' text-anchor='middle' font-size='50'>📝</text></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Permanent+Marker&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    h1 {
      font-family: 'Permanent Marker', cursive;
      color: #FFD60A;
      font-size: 32px;
      margin-bottom: 24px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
    }
    .input-container {
      width: 100%;
      max-width: 400px;
    }
    textarea {
      width: 100%;
      height: 120px;
      padding: 16px;
      font-size: 18px;
      border: 3px solid #FFD60A;
      border-radius: 12px;
      background: rgba(255,255,255,0.95);
      resize: none;
      font-family: inherit;
    }
    textarea:focus {
      outline: none;
      border-color: #fff;
      box-shadow: 0 0 20px rgba(255,214,10,0.5);
    }
    button {
      width: 100%;
      margin-top: 16px;
      padding: 16px;
      font-size: 20px;
      font-weight: bold;
      font-family: 'Permanent Marker', cursive;
      background: #FFD60A;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: transform 0.1s, box-shadow 0.1s;
    }
    button:active {
      transform: scale(0.98);
    }
    button:disabled {
      opacity: 0.6;
    }
    .success {
      color: #22c55e;
      font-size: 48px;
      animation: pop 0.3s ease-out;
    }
    @keyframes pop {
      0% { transform: scale(0); }
      50% { transform: scale(1.2); }
      100% { transform: scale(1); }
    }
    .history {
      margin-top: 32px;
      width: 100%;
      max-width: 400px;
    }
    .history-item {
      background: rgba(255,255,255,0.1);
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 8px;
      color: #fff;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .history-item .badge {
      background: #FFD60A;
      color: #1a1a1a;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: bold;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <h1>🗑️ DUMP IT</h1>
  <div class="input-container">
    <textarea id="input" placeholder="What's on your mind?" autofocus></textarea>
    <button id="submit" onclick="dump()">DUMP ➜</button>
  </div>
  <div class="history" id="history"></div>

  <script>
    const input = document.getElementById('input');
    const btn = document.getElementById('submit');
    const history = document.getElementById('history');
    
    // Load history from localStorage
    let items = JSON.parse(localStorage.getItem('dumpHistory') || '[]');
    renderHistory();

    async function dump() {
      const text = input.value.trim();
      if (!text) return;
      
      btn.disabled = true;
      btn.textContent = '...';
      
      try {
        const res = await fetch('/api/tasks/messy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        
        // Success!
        btn.innerHTML = '<span class="success">✓</span>';
        
        // Save to history
        items.unshift({ id: data.id, text, time: new Date().toLocaleTimeString() });
        if (items.length > 5) items.pop();
        localStorage.setItem('dumpHistory', JSON.stringify(items));
        renderHistory();
        
        // Reset
        input.value = '';
        setTimeout(() => {
          btn.textContent = 'DUMP ➜';
          btn.disabled = false;
          input.focus();
        }, 1000);
        
      } catch (e) {
        btn.textContent = 'ERROR';
        setTimeout(() => {
          btn.textContent = 'DUMP ➜';
          btn.disabled = false;
        }, 2000);
      }
    }
    
    function renderHistory() {
      history.innerHTML = items.map(item => 
        '<div class="history-item"><span class="badge">' + item.id + '</span>' + item.text + '</div>'
      ).join('');
    }
    
    // Submit on Enter (but allow Shift+Enter for newlines)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        dump();
      }
    });
  </script>
</body>
</html>`;