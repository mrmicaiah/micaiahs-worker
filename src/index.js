// Micaiah's Worker - MCP Server for The Board + Manus AI

const BOARD_API = 'https://the-board.micaiah-tasks.workers.dev';
const MANUS_API = 'https://api.manus.ai/v1';
let globalEnv = null;

export default {
  async fetch(request, env) {
    globalEnv = env;
    const url = new URL(request.url);
    
    if (url.pathname === '/sse' || url.pathname === '/mcp') {
      return handleMCP(request, env);
    }
    
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'micaiahs-worker' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Micaiah\'s Worker - MCP Server\n\nEndpoints:\n  /sse - MCP connection\n  /health - Health check', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

async function handleMCP(request, env) {
  const url = new URL(request.url);
  
  if (request.method === 'GET') {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    
    const sessionId = crypto.randomUUID();
    const messageEndpoint = `${url.origin}/mcp?session=${sessionId}`;
    
    writer.write(encoder.encode(`event: endpoint\ndata: ${messageEndpoint}\n\n`));
    
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  
  if (request.method === 'POST') {
    const message = await request.json();
    const response = await handleMCPMessage(message, env);
    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }
  
  return new Response('Method not allowed', { status: 405 });
}

async function handleMCPMessage(message, env) {
  const { method, params, id } = message;
  
  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'micaiahs-worker',
            version: '1.2.0'
          }
        }
      };
    
    case 'notifications/initialized':
      return { jsonrpc: '2.0', id, result: {} };
    
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: getToolDefinitions()
        }
      };
    
    case 'tools/call':
      const result = await executeTool(params.name, params.arguments || {}, env);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: result }]
        }
      };
    
    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown method: ${method}` }
      };
  }
}

function getToolDefinitions() {
  return [
    // ===== MANUS AI TOOLS =====
    {
      name: 'manus_research',
      description: 'Send a research task to Manus AI. Manus will autonomously research the topic and return comprehensive results. Good for competitor analysis, market research, technical deep-dives, or any complex research task.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The research task or question for Manus to investigate' },
          wait: { type: 'boolean', description: 'If true, wait for completion (may take minutes). If false, returns task ID for later polling. Default: false' }
        },
        required: ['prompt']
      }
    },
    {
      name: 'manus_status',
      description: 'Check the status of a Manus task by its ID',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The Manus task ID to check' }
        },
        required: ['task_id']
      }
    },
    {
      name: 'manus_result',
      description: 'Get the result of a completed Manus task',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The Manus task ID to get results for' }
        },
        required: ['task_id']
      }
    },
    // ===== BOARD TOOLS =====
    {
      name: 'board_status',
      description: 'Show the current state of The Board - all projects, tasks, and notepads',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'board_log',
      description: 'Log a progress update to The Board\'s Progress column',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Short recap, ~280 chars, casual tone' },
          details: { type: 'string', description: 'Optional longer notes' },
          project_id: { type: 'number', description: 'Optional project badge number to link to' }
        },
        required: ['summary']
      }
    },
    {
      name: 'board_add_project',
      description: 'Add a new project to The Board',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project name' },
          status_notes: { type: 'string', description: 'Initial status notes (optional)' }
        },
        required: ['name']
      }
    },
    {
      name: 'board_update_project',
      description: 'Update a project\'s status notes',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Project badge number' },
          status_notes: { type: 'string', description: 'New status notes' }
        },
        required: ['id', 'status_notes']
      }
    },
    {
      name: 'board_activate',
      description: 'Activate a project (turn light green) - means you\'re working on it',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Project badge number' }
        },
        required: ['id']
      }
    },
    {
      name: 'board_deactivate',
      description: 'Deactivate a project (turn light red) - not currently working on it',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Project badge number' }
        },
        required: ['id']
      }
    },
    {
      name: 'board_add_task',
      description: 'Add a task to the dump (messy side) - brain dump style',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Task text' }
        },
        required: ['text']
      }
    },
    {
      name: 'board_add_clean_task',
      description: 'Add a task directly to the clean tasks list',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Task text' }
        },
        required: ['text']
      }
    },
    {
      name: 'board_move_to_clean',
      description: 'Move a task from the dump to the clean tasks list',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Task badge number' }
        },
        required: ['id']
      }
    },
    {
      name: 'board_move_to_notepad',
      description: 'Move a task from the dump to a notepad as a checklist item',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'number', description: 'Task badge number' },
          notepad_id: { type: 'number', description: 'Notepad badge number' }
        },
        required: ['task_id', 'notepad_id']
      }
    },
    {
      name: 'board_delete',
      description: 'Delete any item from the board by its badge number',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Badge number to delete' }
        },
        required: ['id']
      }
    },
    {
      name: 'board_create_notepad',
      description: 'Create a new notepad (legal pad style checklist)',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Notepad title' },
          project_id: { type: 'number', description: 'Attach to project (optional)' }
        },
        required: ['title']
      }
    },
    {
      name: 'board_notepad_add_item',
      description: 'Add a checklist item to a notepad',
      inputSchema: {
        type: 'object',
        properties: {
          notepad_id: { type: 'number', description: 'Notepad badge number' },
          text: { type: 'string', description: 'Item text' }
        },
        required: ['notepad_id', 'text']
      }
    },
    {
      name: 'board_notepad_check',
      description: 'Mark a notepad item as done',
      inputSchema: {
        type: 'object',
        properties: {
          notepad_id: { type: 'number', description: 'Notepad badge number' },
          item_id: { type: 'number', description: 'Item badge number' }
        },
        required: ['notepad_id', 'item_id']
      }
    },
    {
      name: 'board_show_notepad',
      description: 'Pin a notepad to the board (overlay, max 3)',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Notepad badge number' }
        },
        required: ['id']
      }
    },
    {
      name: 'board_hide_notepad',
      description: 'Unpin a notepad from the board',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Notepad badge number' }
        },
        required: ['id']
      }
    },
    {
      name: 'board_list_notepads',
      description: 'List all notepads with their items',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'board_search',
      description: 'Search notepads, projects, and tasks by keyword',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term (searches titles, text, and notes)' }
        },
        required: ['query']
      }
    }
  ];
}

async function executeTool(name, args, env) {
  try {
    switch (name) {
      // Manus tools
      case 'manus_research':
        return await manusResearch(args.prompt, args.wait, env);
      case 'manus_status':
        return await manusStatus(args.task_id, env);
      case 'manus_result':
        return await manusResult(args.task_id, env);
      // Board tools
      case 'board_status':
        return await getBoardStatus();
      case 'board_log':
        return await logCheckin(args.summary, args.details, args.project_id);
      case 'board_add_project':
        return await addProject(args.name, args.status_notes);
      case 'board_update_project':
        return await updateProject(args.id, args.status_notes);
      case 'board_activate':
        return await activateProject(args.id);
      case 'board_deactivate':
        return await deactivateProject(args.id);
      case 'board_add_task':
        return await addMessyTask(args.text);
      case 'board_add_clean_task':
        return await addCleanTask(args.text);
      case 'board_move_to_clean':
        return await moveToClean(args.id);
      case 'board_move_to_notepad':
        return await moveToNotepad(args.task_id, args.notepad_id);
      case 'board_delete':
        return await deleteItem(args.id);
      case 'board_create_notepad':
        return await createNotepad(args.title, args.project_id);
      case 'board_notepad_add_item':
        return await addNotepadItem(args.notepad_id, args.text);
      case 'board_notepad_check':
        return await checkNotepadItem(args.notepad_id, args.item_id);
      case 'board_show_notepad':
        return await pinNotepad(args.id);
      case 'board_hide_notepad':
        return await unpinNotepad(args.id);
      case 'board_list_notepads':
        return await listNotepads();
      case 'board_search':
        return await searchBoard(args.query);
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

// ===== MANUS RESPONSE FORMATTER =====

function formatManusResponse(data) {
  // If it's already a string, return it
  if (typeof data === 'string') {
    return data;
  }
  
  // If it's null or undefined
  if (data == null) {
    return 'No content';
  }
  
  // If it's an array, format each item
  if (Array.isArray(data)) {
    return data.map((item, index) => {
      if (typeof item === 'string') {
        return item;
      }
      // Handle common Manus response structures
      if (item.type === 'text' && item.text) {
        return item.text;
      }
      if (item.content) {
        return formatManusResponse(item.content);
      }
      if (item.message) {
        return item.message;
      }
      // Fallback: pretty print the object
      return JSON.stringify(item, null, 2);
    }).join('\n\n');
  }
  
  // If it's an object with common fields
  if (typeof data === 'object') {
    // Check for text content
    if (data.text) return data.text;
    if (data.content) return formatManusResponse(data.content);
    if (data.message) return data.message;
    if (data.output) return formatManusResponse(data.output);
    if (data.result) return formatManusResponse(data.result);
    
    // Fallback: pretty print
    return JSON.stringify(data, null, 2);
  }
  
  // Fallback for primitives
  return String(data);
}

// ===== MANUS AI FUNCTIONS =====

async function manusResearch(prompt, wait = false, env) {
  const apiKey = env?.MANUS_API_KEY;
  if (!apiKey) {
    return '❌ MANUS_API_KEY not configured. Add it to your Cloudflare Worker environment variables.';
  }

  try {
    // Create the task
    const createRes = await fetch(`${MANUS_API}/tasks`, {
      method: 'POST',
      headers: {
        'API_KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt })
    });

    if (!createRes.ok) {
      const errorText = await createRes.text();
      return `❌ Manus API error (${createRes.status}): ${errorText}`;
    }

    const task = await createRes.json();
    const taskId = task.id || task.task_id;

    if (!taskId) {
      return `❌ Manus returned unexpected response: ${JSON.stringify(task)}`;
    }

    if (!wait) {
      return `🚀 **Manus task started**\n\nTask ID: \`${taskId}\`\n\nManus is working on this in the background. Use \`manus_status\` or \`manus_result\` to check progress.\n\nPrompt: ${prompt}`;
    }

    // If wait=true, poll for completion (with timeout)
    const maxWaitMs = 5 * 60 * 1000; // 5 minutes max
    const pollIntervalMs = 5000; // 5 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      const statusRes = await fetch(`${MANUS_API}/tasks/${taskId}`, {
        headers: { 'API_KEY': apiKey }
      });

      if (!statusRes.ok) continue;

      const statusData = await statusRes.json();
      const status = statusData.status?.toLowerCase();

      if (status === 'completed' || status === 'done' || status === 'finished') {
        const resultContent = statusData.result || statusData.output || statusData.response || statusData;
        const formatted = formatManusResponse(resultContent);
        return `✅ **Manus research complete**\n\nTask ID: \`${taskId}\`\n\n---\n\n${formatted}`;
      }

      if (status === 'failed' || status === 'error') {
        return `❌ Manus task failed: ${statusData.error || 'Unknown error'}`;
      }
    }

    return `⏱️ **Manus task still running**\n\nTask ID: \`${taskId}\`\n\nThe task is taking longer than 5 minutes. Use \`manus_result\` to check later.`;

  } catch (error) {
    return `❌ Manus error: ${error.message}`;
  }
}

async function manusStatus(taskId, env) {
  const apiKey = env?.MANUS_API_KEY;
  if (!apiKey) {
    return '❌ MANUS_API_KEY not configured.';
  }

  try {
    const res = await fetch(`${MANUS_API}/tasks/${taskId}`, {
      headers: { 'API_KEY': apiKey }
    });

    if (!res.ok) {
      return `❌ Manus API error (${res.status}): ${await res.text()}`;
    }

    const data = await res.json();
    const status = data.status || 'unknown';
    const progress = data.progress ? ` (${data.progress}%)` : '';

    return `📊 **Manus Task Status**\n\nTask ID: \`${taskId}\`\nStatus: **${status}**${progress}\n\n${data.status_message || ''}`;

  } catch (error) {
    return `❌ Error checking status: ${error.message}`;
  }
}

async function manusResult(taskId, env) {
  const apiKey = env?.MANUS_API_KEY;
  if (!apiKey) {
    return '❌ MANUS_API_KEY not configured.';
  }

  try {
    const res = await fetch(`${MANUS_API}/tasks/${taskId}`, {
      headers: { 'API_KEY': apiKey }
    });

    if (!res.ok) {
      return `❌ Manus API error (${res.status}): ${await res.text()}`;
    }

    const data = await res.json();
    const status = data.status?.toLowerCase();

    if (status !== 'completed' && status !== 'done' && status !== 'finished') {
      return `⏳ Task not yet complete.\n\nStatus: **${data.status}**\n\nUse \`manus_status\` to check progress.`;
    }

    // Try multiple possible result fields and format properly
    const resultContent = data.result || data.output || data.response || data.data || data;
    const formatted = formatManusResponse(resultContent);
    
    return `✅ **Manus Result**\n\nTask ID: \`${taskId}\`\n\n---\n\n${formatted}`;

  } catch (error) {
    return `❌ Error getting result: ${error.message}`;
  }
}

// ===== BOARD API HELPERS =====

async function apiGet(path) {
  if (globalEnv?.BOARD) {
    const res = await globalEnv.BOARD.fetch(`https://the-board${path}`);
    return res.json();
  }
  const res = await fetch(`${BOARD_API}${path}`);
  return res.json();
}

async function apiPost(path, body = {}) {
  if (globalEnv?.BOARD) {
    const res = await globalEnv.BOARD.fetch(`https://the-board${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  }
  const res = await fetch(`${BOARD_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function apiPatch(path, body) {
  if (globalEnv?.BOARD) {
    const res = await globalEnv.BOARD.fetch(`https://the-board${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  }
  const res = await fetch(`${BOARD_API}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function apiDelete(path) {
  if (globalEnv?.BOARD) {
    const res = await globalEnv.BOARD.fetch(`https://the-board${path}`, { method: 'DELETE' });
    return res.json();
  }
  const res = await fetch(`${BOARD_API}${path}`, { method: 'DELETE' });
  return res.json();
}

// ===== BOARD TOOL IMPLEMENTATIONS =====

async function getBoardStatus() {
  const data = await apiGet('/api/board');
  
  let output = '📋 **THE BOARD**\n\n';
  
  if (data.projects?.length) {
    output += '**PROJECTS**\n';
    for (const p of data.projects) {
      const light = p.active ? '🟢' : '🔴';
      output += `  [${p.id}] ${light} **${p.name}**\n`;
      if (p.status_notes) output += `      ${p.status_notes}\n`;
    }
    output += '\n';
  }
  
  if (data.cleanTasks?.length) {
    output += '**TASKS**\n';
    for (const t of data.cleanTasks) {
      output += `  [${t.id}] ${t.text}\n`;
    }
    output += '\n';
  }
  
  if (data.messyTasks?.length) {
    output += '**DUMP**\n';
    for (const t of data.messyTasks) {
      output += `  [${t.id}] ${t.text}\n`;
    }
    output += '\n';
  }
  
  const pinned = data.notepads?.filter(n => data.pinnedNotepads?.includes(n.id));
  if (pinned?.length) {
    output += '**PINNED NOTEPADS**\n';
    for (const n of pinned) {
      output += `  [${n.id}] ${n.title}\n`;
      for (const item of (n.items || [])) {
        const check = item.done ? '☑' : '☐';
        output += `      ${check} [${item.id}] ${item.text}\n`;
      }
    }
  }
  
  if (!data.projects?.length && !data.cleanTasks?.length && !data.messyTasks?.length) {
    output += '_Board is empty. Add some projects and tasks!_';
  }
  
  return output;
}

async function logCheckin(summary, details, project_id) {
  const result = await apiPost('/api/checkins', { summary, details, project_id });
  if (result.success) {
    return `✅ Logged [${result.id}]: ${summary}`;
  }
  return `❌ Failed to log checkin: ${result.error || 'Unknown error'}`;
}

async function addProject(name, status_notes) {
  const result = await apiPost('/api/projects', { name, status_notes: status_notes || '' });
  return `✅ Added project [${result.id}] **${name}**`;
}

async function updateProject(id, status_notes) {
  await apiPatch(`/api/projects/${id}`, { status_notes });
  return `✅ Updated project [${id}] status notes`;
}

async function activateProject(id) {
  await apiPost(`/api/projects/${id}/activate`);
  return `🟢 Project [${id}] is now active`;
}

async function deactivateProject(id) {
  await apiPost(`/api/projects/${id}/deactivate`);
  return `🔴 Project [${id}] is now inactive`;
}

async function addMessyTask(text) {
  const result = await apiPost('/api/tasks/messy', { text });
  return `✅ Added to dump [${result.id}] ${text}`;
}

async function addCleanTask(text) {
  const result = await apiPost('/api/tasks/clean', { text });
  return `✅ Added to tasks [${result.id}] ${text}`;
}

async function moveToClean(id) {
  const result = await apiPost(`/api/tasks/messy/${id}/to-clean`);
  if (result.error) return `❌ ${result.error}`;
  return `✅ Moved [${id}] to clean tasks`;
}

async function moveToNotepad(taskId, notepadId) {
  const result = await apiPost(`/api/tasks/messy/${taskId}/to-notepad/${notepadId}`);
  if (result.error) return `❌ ${result.error}`;
  return `✅ Moved [${taskId}] to notepad [${notepadId}]`;
}

async function deleteItem(id) {
  const result = await apiDelete(`/api/item/${id}`);
  if (result.deleted) return `✅ Deleted [${id}]`;
  return `❌ Item [${id}] not found`;
}

async function createNotepad(title, projectId) {
  const result = await apiPost('/api/notepads', { title, project_id: projectId });
  return `✅ Created notepad [${result.id}] **${title}**`;
}

async function addNotepadItem(notepadId, text) {
  const result = await apiPost(`/api/notepads/${notepadId}/items`, { text });
  return `✅ Added [${result.id}] to notepad [${notepadId}]: ${text}`;
}

async function checkNotepadItem(notepadId, itemId) {
  await apiPatch(`/api/notepads/${notepadId}/items/${itemId}`, { done: true });
  return `☑ Checked off [${itemId}]`;
}

async function pinNotepad(id) {
  const result = await apiPost(`/api/notepads/${id}/pin`);
  if (result.error) return `❌ ${result.error}`;
  if (result.alreadyPinned) return `📌 Notepad [${id}] is already pinned`;
  return `📌 Pinned notepad [${id}] to the board`;
}

async function unpinNotepad(id) {
  await apiPost(`/api/notepads/${id}/unpin`);
  return `📌 Unpinned notepad [${id}] from the board`;
}

async function listNotepads() {
  const data = await apiGet('/api/board');
  
  if (!data.notepads?.length) {
    return '_No notepads yet. Create one with board_create_notepad._';
  }
  
  let output = '📝 **NOTEPADS**\n\n';
  
  for (const n of data.notepads) {
    const pinned = data.pinnedNotepads?.includes(n.id) ? ' 📌' : '';
    const project = n.project_id ? ` (Project [${n.project_id}])` : '';
    output += `[${n.id}] **${n.title}**${pinned}${project}\n`;
    
    for (const item of (n.items || [])) {
      const check = item.done ? '☑' : '☐';
      output += `    ${check} [${item.id}] ${item.text}\n`;
    }
    output += '\n';
  }
  
  return output;
}

async function searchBoard(query) {
  const data = await apiGet('/api/board');
  const q = query.toLowerCase();
  
  let output = `🔍 **Search: "${query}"**\n\n`;
  let found = false;
  
  // Search projects
  const matchingProjects = data.projects?.filter(p => 
    p.name.toLowerCase().includes(q) || 
    p.status_notes?.toLowerCase().includes(q)
  );
  if (matchingProjects?.length) {
    found = true;
    output += '**Projects:**\n';
    for (const p of matchingProjects) {
      const light = p.active ? '🟢' : '🔴';
      output += `  [${p.id}] ${light} **${p.name}**\n`;
      if (p.status_notes) output += `      ${p.status_notes}\n`;
    }
    output += '\n';
  }
  
  // Search clean tasks
  const matchingClean = data.cleanTasks?.filter(t => 
    t.text.toLowerCase().includes(q)
  );
  if (matchingClean?.length) {
    found = true;
    output += '**Tasks:**\n';
    for (const t of matchingClean) {
      output += `  [${t.id}] ${t.text}\n`;
    }
    output += '\n';
  }
  
  // Search messy tasks
  const matchingMessy = data.messyTasks?.filter(t => 
    t.text.toLowerCase().includes(q)
  );
  if (matchingMessy?.length) {
    found = true;
    output += '**Dump:**\n';
    for (const t of matchingMessy) {
      output += `  [${t.id}] ${t.text}\n`;
    }
    output += '\n';
  }
  
  // Search notepads
  const matchingNotepads = data.notepads?.filter(n => 
    n.title.toLowerCase().includes(q) ||
    n.items?.some(item => item.text.toLowerCase().includes(q))
  );
  if (matchingNotepads?.length) {
    found = true;
    output += '**Notepads:**\n';
    for (const n of matchingNotepads) {
      const pinned = data.pinnedNotepads?.includes(n.id) ? ' 📌' : '';
      output += `  [${n.id}] **${n.title}**${pinned}\n`;
      for (const item of (n.items || [])) {
        if (item.text.toLowerCase().includes(q)) {
          const check = item.done ? '☑' : '☐';
          output += `      ${check} [${item.id}] ${item.text}\n`;
        }
      }
    }
    output += '\n';
  }
  
  if (!found) {
    output += '_No matches found._';
  }
  
  return output;
}
