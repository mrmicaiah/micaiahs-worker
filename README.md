# Micaiah's Worker

Personal MCP server. Currently includes The Board tools, will expand over time.

## Deploy

```bash
wrangler deploy
```

## Connect to Claude

Add as MCP connector with URL:
```
https://micaiahs-worker.micaiah-tasks.workers.dev/sse
```

## Current Tools

### The Board

| Tool | Description |
|------|-------------|
| `board_status` | Show current board state |
| `board_add_project` | Add a new project |
| `board_update_project` | Update project status notes |
| `board_activate` | Turn project light green |
| `board_deactivate` | Turn project light red |
| `board_add_task` | Add to dump (messy side) |
| `board_add_clean_task` | Add to clean tasks |
| `board_move_to_clean` | Promote dump item to clean |
| `board_move_to_notepad` | Move dump item to notepad |
| `board_delete` | Delete any item by badge # |
| `board_create_notepad` | Create new notepad |
| `board_notepad_add_item` | Add item to notepad |
| `board_notepad_check` | Mark item done |
| `board_show_notepad` | Pin notepad to board |
| `board_hide_notepad` | Unpin from board |
| `board_list_notepads` | List all notepads |

## Adding More Tools

Edit `src/index.js`:
1. Add tool definition to `getToolDefinitions()`
2. Add case to `executeTool()` switch
3. Implement the function

## Endpoints

- `/sse` or `/mcp` - MCP connection
- `/health` - Health check
