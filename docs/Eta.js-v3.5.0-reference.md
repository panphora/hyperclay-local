# Eta.js v3.5.0 — Information-Dense Cheat Sheet (3.x.x docs condensed)

## 1) Install + instantiate

```bash
npm install eta
```

Eta is a **class** — instantiate before use:

```js
import { Eta } from "eta"
import path from "node:path"

const eta = new Eta({
  views: path.join(__dirname, "templates") // common
  // other options...
})
```

Common options:

* `views`: templates directory path (most common)
* `debug`: pretty runtime errors (default `false`, adds runtime overhead)
* `cache`: cache templates (default `false`)
* `autoEscape`: escape interpolations (default `true`)

---

## 2) Core rendering API

### Render template files (by name, relative to `views`)

**Sync**

```js
const html = eta.render("templateName", { name: "Ben" })
```

**Async**

```js
const html = await eta.renderAsync("templateName", { name: "Ben" })
```

### Render strings (inline templates)

**Sync**

```js
const html = eta.renderString("Hello <%= it.name %>", { name: "Ben" })
```

**Async**

```js
const html = await eta.renderStringAsync("Hello <%= await it.someFunction() %>", {
  someFunction: () => Promise.resolve("Ben")
})
```

---

## 3) Programmatic templates (no filesystem)

Use `loadTemplate(name, templateString, { async })`.

Key rule: **if it’s not on the filesystem, prefix the name with `@`** so Eta won’t try to resolve it from disk.

```js
const headerPartial = `
  <header>
    <h1><%= it.title %></h1>
  </header>
`

eta.loadTemplate("@header", headerPartial)              // defaults to sync
eta.loadTemplate("@headerAsync", headerPartial, { async: true })
```

### Named templates (no filesystem resolution)

If you render/include a template whose name starts with `@`, Eta looks in internal template storage/cache, not the filesystem.

```js
const html = eta.render("@header", { title: "Hello" })
```

---

## 4) Template syntax (EJS-like)

### Data access model

* Default: data is in **`it`** (configurable via `varName`)
* Typical: `it.name`, `it.users`, etc.

### Tags (default delimiters)

Default tag delimiters: `['<%', '%>']` (configurable via `tags`)

### Evaluate JS (no output)

```eta
<% const x = 3 %>
```

### Output (escaped by default)

```eta
Hi <%= it.name %>
```

### Raw output (no escaping)

```eta
Hi <%~ it.contentContainingHTML %>
```

### Comments (JS multiline comments)

```eta
<% /* this is a comment */ %>
```

---

## 5) Partials + layouts

### Include partial (sync)

```eta
<%~ include("./path-to-partial") %>
<%~ include("./path-to-partial", { option: true }) %>  <% /* merges into `it` */ %>
```

### Include partial (async)

```eta
<%~ await includeAsync("./path-to-partial") %>
```

### Layouts

Set a parent layout (one parent per file; layouts themselves can have parents):

```eta
<% layout("./path-to-layout") %>
```

In the layout, render the child’s content via:

```eta
<%~ it.body %>
```

---

## 6) Name resolution rules (filesystem vs internal)

If running in Node.js or Deno:

* Eta resolves partials/layouts from the filesystem under `views` by default.
* If you want to include a template that **doesn’t exist on disk** (loaded via `loadTemplate`, fetched, etc.), name it with `@` and include it that way:

```eta
<%~ include("@header") %>
```

---

## 7) Whitespace control (tag-level)

You can put `-` or `_` around opening/closing delimiters:

* `_` trims **all whitespace**

  * at **start** of tag: trims all whitespace **before** it
  * at **end** of tag: trims all whitespace **after** it
* `-` trims **one newline**

  * at **start** of tag: trims 1 newline **before** it
  * at **end** of tag: trims 1 newline **after** it

Example from docs:

```eta
Hi
<%- = it.myname %>
<% /* The newline after "Hi" will be stripped */ %>
```

Related config knobs:

* `autoTrim`: automatic whitespace trimming (default `[false, 'nl']`)
* `rmWhitespace`: remove empty lines + whitespace between lines

---

## 8) Configuration (v3.x.x `config` type, condensed)

```ts
type config = {
  autoEscape: boolean                  // default true
  autoFilter: boolean                  // apply filterFunction to interpolations
  autoTrim: trimConfig | [trimConfig, trimConfig] // default [false, 'nl']
  cache: boolean                       // cache templates if name/filename passed
  cacheFilepaths: boolean              // cache resolved filepaths (false disables)
  debug: boolean                       // pretty errors (runtime penalty)
  escapeFunction: (str: unknown) => string
  filterFunction: (val: unknown) => string
  functionHeader: string               // raw JS inserted in template fn
  parse: {
    exec: string                       // prefix for evaluation, default ""
    interpolate: string                // prefix for interpolation, default "="
    raw: string                        // prefix for raw interpolation, default "~"
  }
  plugins: Array<{
    processFnString?: Function
    processAST?: Function
    processTemplate?: Function
  }>
  rmWhitespace: boolean
  tags: [string, string]               // default ['<%', '%>']
  useWith: boolean                     // put data on global instead of varName
  varName: string                      // default "it"
  views?: string
  defaultExtension?: string            // default ".eta"
}
```

Notes straight from docs:

* `parse.exec` default `""`; `parse.interpolate` default `"="`; `parse.raw` default `"~"`
* Those `parse.*` prefixes **do not support** `"-"` or `"_"` (the trim markers)

---

## 9) Common patterns / “how to do X”

### Custom tags (change delimiters)

```js
const eta = new Eta({ tags: ["{{", "}}"] })
```

### Auto-filter every interpolation

```js
const eta = new Eta({
  autoFilter: true,
  filterFunction: (val) => {
    if (typeof val === "string") return val.toUpperCase()
    return val
  }
})
```

### Change the data variable name (`it` → `data`)

```js
const eta = new Eta({ varName: "data" })
// template: "Hi <%= data.name %>"
```

### “Get rid of it” (not recommended)

```js
const eta = new Eta({ useWith: true })
// template: "Hi <%= name %>"
```

Docs caveats: naming collisions + poorer performance.

Better alternative: alias values via `functionHeader`:

```js
const eta = new Eta({
  functionHeader: "const name=it.name, age=it.age"
})
// template: "Hi <%= name %>, our records show you are <%= age %> years old"
```

---

## 10) Express.js integration (v3.x.x)

### Simple: manually render and send

Eta no longer supports Express’s `app.engine()` directly, but you can still use it:

```js
const express = require("express")
const path = require("node:path")
const { Eta } = require("eta")

const app = express()

const eta = new Eta({
  views: path.join(__dirname, "views"),
  cache: true
})

app.get("/", (req, res) => {
  const html = eta.render("index", { title: "Hello", place: "there!" })
  res.status(200).send(html)
})

app.listen(3000)
```

### If you want `res.render(...)`: build a custom engine

Docs note: `app.engine("eta", eta.render)` is **not supported** on v3.x.x.

```js
const express = require("express")
const path = require("node:path")
const { Eta } = require("eta")

const app = express()
const eta = new Eta({ views: path.join(__dirname, "views") })

app.engine("eta", buildEtaEngine())
app.set("view engine", "eta")

app.get("/", (req, res) => {
  res.render("home", { message: "Hello world !" })
})

app.listen(3000)

function buildEtaEngine() {
  return (path, opts, callback) => {
    try {
      const fileContent = eta.readFile(path)
      const html = eta.renderString(fileContent, opts)
      callback(null, html)
    } catch (error) {
      callback(error)
    }
  }
}
```

---

## 11) Custom file handling (advanced)

Extend the class and override:

* `readFile`
* `resolvePath`

```js
class CustomEta extends Eta {
  readFile = function(...) { /* ... */ }
  resolvePath = function(...) { /* ... */ }
}
```

---

## 12) Quick “template patterns” (from docs)

### Conditionals

```eta
<% if (it.someval === "someothervalue") { %>
Display this!
<% } else { %>
They're not equal
<% } %>
```

### Looping over arrays (usually `it.users` unless you’ve aliased/destructured)

```eta
<% it.users.forEach(function(user) { %>
  <%= user.first %> <%= user.last %>
<% }) %>
```

### Looping over objects

```eta
<% Object.keys(it.someObject).forEach(function(prop) { %>
  <%= it.someObject[prop] %>
<% }) %>
```

### Logging

```eta
<% console.log("The value of it.num is: " + it.num) %>
```

### Async partials

```eta
<%~ await includeAsync("./path-to-partial") %>
```
