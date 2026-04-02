---
description: "When the user wants to add, view, complete, or delete todos/ideas, or manage projects. Trigger on expressions like 'remember this', 'add to todo', 'show my todos', 'what's left', 'idea', 'memo'."
---

# Clauvis - Todo & Idea Management Tool

## Available MCP Tools

### Todos
- `list_todos(project?)` — List todos. Filter by project slug.
- `add_todo(title, project?, priority?, deadline?, memo?)` — Add a todo.
- `complete_todo(target)` — Complete a todo by #number or title keyword.
- `update_todo(target, title?, memo?, priority?, deadline?)` — Update a todo.
- `delete_todo(target)` — Delete a todo by #number or title keyword.

### Ideas
- `list_ideas(project?)` — List saved ideas.
- `add_idea(title, body?, project?, tags?)` — Save an idea or memo.
- `delete_idea(target)` — Delete an idea by #number or keyword.
- `convert_idea_to_todo(target, priority?, deadline?)` — Convert idea to todo.

### Projects
- `list_projects()` — List all projects.
- `add_project(slug, name?, directoryPath?)` — Register a project.
- `delete_project(slug)` — Delete a project.

## Todo vs Idea

- **Todo**: Actionable tasks — "fix bug", "add feature", "deploy"
- **Idea**: Thoughts, inspirations, references — "maybe add dark mode", "look into X"
- When ambiguous, ask the user which one they prefer

## When to Use Each Tool

### Adding Todos (`add_todo`)
- "I should do this later", "add to TODO", "해야 해", "fix this"
- When bugs/improvements are discovered during work
- title is required, project/priority/deadline/memo are optional

### Adding Ideas (`add_idea`)
- "idea", "메모", "나중에 참고", "interesting approach", "maybe we could"
- For inspirations, references, or not-yet-concrete thoughts

### Converting Ideas (`convert_idea_to_todo`)
- When an idea becomes concrete enough to act on
- "let's actually do this idea", "convert idea #3"

### Listing (`list_todos`, `list_ideas`)
- Todos are auto-injected at session start — just summarize them
- Ideas are NOT auto-injected — call `list_ideas` when needed

### Completing Todos (`complete_todo`)
- After work is done, ask the user "Mark as done in Clauvis?"
- **Important**: Never mark as done without user confirmation

## Guidelines
- Always ask the user before marking a todo as done
- Only add todos/ideas when the user explicitly requests it
- Todos are auto-injected at session start via hook — just summarize them for the user
- Ideas are not injected — they stay as a reference the user can query
