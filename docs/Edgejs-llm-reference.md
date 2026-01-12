# Edge.js Template Engine - LLM Reference

## Core Concepts
Edge.js is a server-side template engine for Node.js using familiar JavaScript syntax. No client-side reactivity, purely server-rendered HTML.

## Setup
```javascript
import { Edge } from 'edge.js';
const edge = Edge.create();
edge.mount(new URL('./views', import.meta.url));
const html = await edge.render('template', data);
```

## Syntax

### Interpolation
- `{{ expression }}` - Escaped output
- `{{{ rawHtml }}}` - Unescaped HTML
- `@{{ literal }}` - Escape Edge processing

### Tags
- Block tags: `@tagname ... @end` (e.g., `@if`, `@each`, `@component`)
- Self-closing block: `@!tagname(...)` (auto-closes, no `@end` needed)
- Inline tags: `@tagname(...)` (no body, e.g., `@include`)
- Swallow newline: `@tagname~` (prevents newline after tag)
- Tags must be on their own line (no content around them)

### Comments
`{{-- Comment text --}}`

## Variables & State

### State Layers (priority order)
1. **Inline variables**: `@let(name = value)` / `@assign(name = newValue)`
2. **Rendering data**: `edge.render('template', data)`
3. **Locals**: `edge.createRenderer().share({ key: value })`
4. **Globals**: `edge.global('key', value)`

## Control Flow

### Conditionals
```edge
@if(user.fullName)
  <p> Hello {{ user.fullName }}! </p>
@elseif(user.firstName)
  <p> Hello {{ user.firstName }}! </p>
@else
  <p> Hello Guest! </p>
@end

@unless(account.isActive)  {{-- Inverse of @if --}}
  <p>Please verify your email</p>
@end
```
Ternary: `<input class="{{ hasError ? 'error' : '' }}" />`

### Loops
```edge
@each(item in array)
@each((item, index) in array)
@each((value, key) in object)
@else {{-- Empty fallback --}}
@end
```

## Templates

### Partials
```edge
@include('partials/header')
@includeIf(condition, 'partials/conditional')
@include('diskname::path')  {{-- Named disk --}}
```

### Stacks
```edge
{{-- Define stack --}}
@stack('scripts')

{{-- Push content --}}
@pushTo('scripts') ... @end
@pushOnceTo('scripts') ... @end  {{-- Only once --}}
```

## Components

### Basic Component
```edge
{{-- components/button.edge --}}
<button {{ $props.toAttrs() }}>
  {{ text }}
</button>
```

### Using Components
```edge
@component('components/button', { text: 'Click' })
@!button({ text: 'Click' })  {{-- Component as tag --}}
```

### Props API
- `$props.get('key')`
- `$props.has('key')`
- `$props.only(['key1', 'key2'])`
- `$props.except(['key1'])`
- `$props.merge({ defaultKey: value })`
- `$props.toAttrs()` - Serialize to HTML attributes

### Slots
```edge
{{-- Component with slots --}}
{{{ await $slots.main() }}}     {{-- Default slot --}}
{{{ await $slots.header() }}}   {{-- Named slot --}}

{{-- Using slots --}}
@component('card')
  @slot('header') Title @end
  Main content
@end
```

### Layouts (via components)
```edge
{{-- components/layout/app.edge --}}
<html><head><title>{{ title }}</title></head>
<body>{{{ await $slots.main() }}}</body></html>

{{-- Usage --}}
@layout.app({ title: 'Page' })
  Page content here
@end
```

### Provide/Inject
```edge
{{-- Parent provides --}}
@inject({ sharedData })

{{-- Child accesses --}}
{{ $context.sharedData }}
```

## Helpers

### HTML Helpers
- `html.escape(str)` - Escape HTML
- `html.safe(str)` - Mark as safe HTML
- `html.classNames(['class1', { 'class2': condition }])`
- `html.attrs({ attr: value })` - Object to attributes
- `nl2br(text)` - Newlines to `<br>`

### String Helpers
- `truncate(str, { length: 100, suffix: '...' })`
- `excerpt(html, { length: 100 })` - Strip HTML & truncate
- `camelCase()`, `snakeCase()`, `dashCase()`, `pascalCase()`, `titleCase()`

### Debugging
- `{{ inspect(value) }}` - Pretty print to HTML
- `@debugger` - Insert breakpoint (use `node --inspect`)

## Advanced

### Rendering Methods
- `edge.render(path, data)` - Async render
- `edge.renderSync(path, data)` - Sync render
- `edge.renderRaw(template, data)` - Raw string template
- `edge.registerTemplate(name, { template })` - In-memory template

### Disks (Template Locations)
```javascript
edge.mount('default', './views');
edge.mount('themes', './themes');
// Use: @include('themes::header')
```

### Custom Tags
```typescript
const myTag: TagContract = {
  block: false,      // true = has @end
  seekable: true,    // true = accepts arguments
  tagName: 'myTag',
  compile(parser, buffer, token) {
    const expr = parser.utils.transformAst(
      parser.utils.generateAST(token.properties.jsArg, token.loc, token.filename),
      token.filename, parser
    )
    buffer.outputExpression(parser.utils.stringify(expr), token.filename, token.loc.start.line, false)
  }
}
edge.registerTag(myTag)
```

**Buffer methods:** `outputRaw(str)`, `outputExpression(expr, file, line, escape)`, `writeStatement(code, file, line)`, `writeExpression(code, file, line)`

**Block tag with local variable:**
```typescript
const notification: TagContract = {
  block: true, seekable: true, tagName: 'notification',
  compile(parser, buffer, token) {
    const key = parser.utils.stringify(parser.utils.transformAst(
      parser.utils.generateAST(token.properties.jsArg, token.loc, token.filename),
      token.filename, parser
    ))
    buffer.writeStatement(`if (state.notifications?.[${key}]) {`, token.filename, token.loc.start.line)
    buffer.writeExpression(`let notification = state.notifications[${key}]`, token.filename, token.loc.start.line)
    parser.stack.defineScope()
    parser.stack.defineVariable('notification')
    token.children.forEach((child) => parser.processToken(child, buffer))
    parser.stack.clearScope()
    buffer.writeStatement(`}`, token.filename, token.loc.start.line)
  }
}
```
```edge
@notification('success')
  <div class="alert">{{ notification.message }}</div>
@end
```

### Cache
```javascript
Edge.create({ cache: process.env.NODE_ENV === 'production' })
```

## Migration Notes (v5 → v6)
- ESM only, Node.js >= 18.16.0
- `@set` → `@let` / `@assign`
- Props: `serialize()` → `toAttrs()`
- `serializeExcept()` → `except().toAttrs()`
- `e()` → `html.escape()`
- `stringify()` → `js.stringify()`
- `safe()` → `html.safe()`
- Layouts removed (use components)
- Use `edge.use(migrate)` plugin for compatibility

## Key Differences from Client Frameworks
- No reactivity/state management - server-only execution
- Templates compiled to JS functions, full Node.js API access
- No CSS/JS bundling

## Additional Tags & Variables
- `@eval(expression)` - Execute JS without output (side effects)
- `@eval(await $slots.main())` - Execute slot for side effects without rendering
- `@newError(message, $caller.filename, $caller.line, $caller.col)` - Throw error with location
- `$caller` - In components: `{ filename, line, col }` of where component was called
- `js.stringify(obj)` - JSON serialize for passing to JS (e.g., `x-data="{{ js.stringify(data) }}")`)

## Plugins

### Edge Iconify (SVG Icons)
`npm i edge-iconify @iconify-json/heroicons`
```typescript
import { edgeIconify, addCollection } from 'edge-iconify'
import { icons as heroIcons } from '@iconify-json/heroicons'
addCollection(heroIcons)
edge.use(edgeIconify)
```
Usage: `@svg('heroicons:arrow-left-solid')` or `@svg('heroicons:check', { class: 'icon' })`

### Edge Markdown
`npm i edge-markdown` → `edge.use(edgeMarkdown)`
```edge
@markdown({ file: '/path/to/file.md' })
@markdown({ content: '# Hello **world**' })
```
Features: TOC generation, Shiki highlighting, front-matter, MDC components (`@markdownSlot()`)