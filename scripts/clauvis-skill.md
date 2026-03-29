---
description: "When the user wants to add, view, complete, or delete todos, or manage projects. Trigger on expressions like 'remember this', 'add to todo', 'show my todos', 'what's left'."
---

# Clauvis - Todo Management Tool

## Available MCP Tools

- `list_todos(project?)` — List todos. Filter by project slug.
- `add_todo(title, project?, priority?, deadline?, memo?)` — Add a todo.
- `complete_todo(target)` — Complete a todo by #number or title keyword.
- `update_todo(target, title?, memo?, priority?, deadline?)` — Update a todo.
- `delete_todo(target)` — Delete a todo by #number or title keyword.
- `list_projects()` — List all projects.
- `add_project(slug, name?, directoryPath?)` — Register a project.
- `delete_project(slug)` — Delete a project.

## When to Use Each Tool

### Adding Todos (`add_todo`)
- "I should do this later", "add to TODO", "remember this", "add todo"
- When bugs/improvements are discovered during work
- When the user explicitly requests to save something
- title is required, project/priority/deadline/memo are optional

### Listing Todos (`list_todos`)
- "what's left?", "show todos", "what do I need to do?"
- The session hook auto-injects todos at startup, so only call manually for additional queries

### Completing Todos (`complete_todo`)
- After work is done, ask the user "Mark as done in Clauvis?"
- When the user says "that's done", "mark it complete", etc.
- **Important**: Never mark as done without user confirmation

### Project Management (`list_projects`, `add_project`)
- "list projects", "register a new project"
- Setting directoryPath with add_project enables auto-filtering by current directory

## Guidelines
- Always ask the user before marking a todo as done
- Only add todos when the user explicitly requests it (don't auto-add from conversation)
- Todos are auto-injected at session start via hook — just summarize them for the user
