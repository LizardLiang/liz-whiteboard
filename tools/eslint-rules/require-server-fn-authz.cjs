// tools/eslint-rules/require-server-fn-authz.js
// SEC-RBAC-04: ESLint rule ensuring every createServerFn export carries a
// @requires JSDoc tag and (unless using an escape-hatch tag) actually calls
// requireServerFnRole in its handler body.
//
// AD-2: Lives as a separate file imported by eslint.config.js inline plugin.
// Uses CommonJS exports for ESLint 9 flat-config compatibility.

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ALLOWED_REQUIRES_VALUES = new Set([
  'authenticated',
  'unauthenticated',
  'viewer',
  'editor',
  'admin',
  'owner',
])

// Escape-hatch tags — when present, no requireServerFnRole call is required
const ESCAPE_HATCH_TAGS = new Set(['authenticated', 'unauthenticated'])

// Allowed wrapper HOF names — only these are trusted to delegate to requireServerFnRole
const ALLOWED_WRAPPERS = new Set(['requireAuth'])

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract @requires tag value from a JSDoc comment string.
 * Returns the tag value or null if absent.
 */
function getRequiresTag(jsDocComment) {
  if (!jsDocComment) return null
  const match = jsDocComment.match(/@requires\s+(\S+)/)
  return match ? match[1].toLowerCase() : null
}

/**
 * Collect all call expression callee names in a body node (recursive).
 * Returns a Set of all function names called anywhere in the body.
 *
 * HIGH-1 fix: replaced the old `bodyCallsRequireServerFnRole` single-boolean
 * check with a Set collector so we can require BOTH `findEffectiveRole` AND
 * `hasMinimumRole` when the legacy pattern is used. Previously, a discarded
 * `findEffectiveRole(...)` call (result not used) would pass the rule — the
 * paired assertion now closes that bypass. (Cassandra HIGH-1)
 */
function collectCalleeNames(node, names) {
  if (!node) return
  if (node.type === 'CallExpression') {
    const callee = node.callee
    const calleeName =
      callee.type === 'Identifier'
        ? callee.name
        : callee.type === 'MemberExpression'
          ? callee.property.name
          : null
    if (calleeName) names.add(calleeName)
    node.arguments.forEach((arg) => collectCalleeNames(arg, names))
    return
  }
  if (node.type === 'AwaitExpression') {
    collectCalleeNames(node.argument, names)
    return
  }
  if (node.type === 'BlockStatement') {
    node.body.forEach((s) => collectCalleeNames(s, names))
    return
  }
  if (node.type === 'ExpressionStatement') {
    collectCalleeNames(node.expression, names)
    return
  }
  if (node.type === 'ReturnStatement') {
    collectCalleeNames(node.argument, names)
    return
  }
  if (node.type === 'TryStatement') {
    collectCalleeNames(node.block, names)
    collectCalleeNames(node.handler?.body, names)
    return
  }
  if (node.type === 'IfStatement') {
    // Traverse the condition (test), consequent, and alternate
    // e.g. if (!hasMinimumRole(...)) — hasMinimumRole is in node.test
    collectCalleeNames(node.test, names)
    collectCalleeNames(node.consequent, names)
    collectCalleeNames(node.alternate, names)
    return
  }
  if (node.type === 'UnaryExpression' || node.type === 'LogicalExpression') {
    // Handle !hasMinimumRole(...) (UnaryExpression) and a && b (LogicalExpression)
    collectCalleeNames(node.argument ?? node.left, names)
    if (node.right) collectCalleeNames(node.right, names)
    return
  }
  if (node.type === 'VariableDeclaration') {
    node.declarations.forEach((d) => collectCalleeNames(d.init, names))
    return
  }
  if (
    node.type === 'ForOfStatement' ||
    node.type === 'ForInStatement' ||
    node.type === 'ForStatement'
  ) {
    collectCalleeNames(node.body, names)
  }
}

/**
 * Return true if the body satisfies RBAC requirements:
 *   (a) calls `requireServerFnRole` (preferred pattern), OR
 *   (b) calls BOTH `findEffectiveRole` AND `hasMinimumRole` (legacy pattern, paired assertion), OR
 *   (c) calls `requireMinimumRole` (shared-helper pattern — a thin wrapper
 *       that itself calls findEffectiveRole+hasMinimumRole internally; see
 *       src/routes/api/invites.ts. Trusted the same way requireServerFnRole
 *       is trusted — both are named, singular, project-defined RBAC gates).
 *
 * A single `findEffectiveRole` call with a discarded result does NOT pass.
 */
function bodyCallsRequireServerFnRole(node) {
  if (!node) return false
  const names = new Set()
  collectCalleeNames(node, names)
  if (names.has('requireServerFnRole')) return true
  if (names.has('requireMinimumRole')) return true
  // Legacy pattern: both halves must be present
  if (names.has('findEffectiveRole') && names.has('hasMinimumRole')) return true
  return false
}

/**
 * Find a module-level function-like declaration matching `name` directly in
 * `programBody` (no cross-file resolution). Supports:
 *   function name(...) { ... }
 *   export function name(...) { ... }
 *   const/let name = (...) => { ... }
 *   export const/let name = (...) => { ... }
 * Returns the function's body node, or null if not found.
 */
function findLocalFunctionBody(programBody, name) {
  if (!programBody) return null
  const isFunctionLike = (n) =>
    n &&
    (n.type === 'ArrowFunctionExpression' ||
      n.type === 'FunctionExpression' ||
      n.type === 'FunctionDeclaration')

  for (const stmt of programBody) {
    const decl =
      stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt
    if (!decl) continue

    if (decl.type === 'FunctionDeclaration' && decl.id?.name === name) {
      return decl.body
    }
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (
          d.id?.type === 'Identifier' &&
          d.id.name === name &&
          isFunctionLike(d.init)
        ) {
          return d.init.body
        }
      }
    }
  }
  return null
}

/**
 * Find the ImportDeclaration source (module specifier) that brings `name`
 * into scope as a named import, e.g. `import { name } from '@/lib/x'` ->
 * '@/lib/x'. Returns null if `name` isn't imported (or is a default/
 * namespace import — not supported, project convention is named exports).
 */
function findImportSource(programBody, name) {
  for (const stmt of programBody) {
    if (stmt.type !== 'ImportDeclaration') continue
    for (const spec of stmt.specifiers) {
      if (
        spec.type === 'ImportSpecifier' &&
        spec.local.type === 'Identifier' &&
        spec.local.name === name
      ) {
        return stmt.source.value
      }
    }
  }
  return null
}

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const SRC_ROOT = path.join(PROJECT_ROOT, 'src')
const RESOLVED_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

/** Resolve a module specifier (relative or '@/'-aliased) to an absolute file path on disk. Returns null if unresolvable (e.g. a node_modules package — never trusted silently). */
function resolveSpecifierToFile(fromFile, source) {
  let base
  if (source.startsWith('@/')) {
    base = path.join(SRC_ROOT, source.slice(2))
  } else if (source.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), source)
  } else {
    return null // bare package specifier — not a project-local file, don't trust
  }

  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base
  for (const ext of RESOLVED_EXTENSIONS) {
    const candidate = base + ext
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

// Cache parsed ASTs per file for the lifetime of this lint run (a single
// target module, e.g. src/lib/invite/handlers.ts, is commonly imported by
// several createServerFn wrappers in the same file).
const parsedFileCache = new Map()

/** Parse a project TS/TSX file into its Program body (AST). Returns null on read/parse failure. */
function parseFileBody(filePath) {
  if (parsedFileCache.has(filePath)) return parsedFileCache.get(filePath)

  let body = null
  try {
    const tsParser = require('@typescript-eslint/parser')
    const sourceText = fs.readFileSync(filePath, 'utf8')
    const ast = tsParser.parse(sourceText, {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: filePath.endsWith('.tsx') },
    })
    body = ast.body
  } catch {
    body = null
  }

  parsedFileCache.set(filePath, body)
  return body
}

/**
 * Resolve an Identifier to a function-like declaration's body, checking the
 * current file first and, if not found there, following a named import to
 * another project-local (@/... or relative) file — so
 * `.handler(requireAuth(namedHandlerFn))` is checked correctly whether
 * `namedHandlerFn` is declared in the same module (extracted for direct
 * unit-testing) or in a dedicated server-only handlers module (kept out of
 * the same file specifically so client-imported sibling exports, e.g. the
 * createServerFn consts themselves, don't drag that file's data-layer
 * imports into the client bundle — see src/lib/invite/handlers.ts).
 * Bounded to a few hops to avoid pathological re-export chains.
 */
function resolveModuleLevelFunctionBody(
  programBody,
  name,
  currentFile,
  hopsRemaining = 3,
) {
  const local = findLocalFunctionBody(programBody, name)
  if (local) return local

  if (hopsRemaining <= 0 || !currentFile) return null

  const source = findImportSource(programBody, name)
  if (!source) return null

  const resolvedFile = resolveSpecifierToFile(currentFile, source)
  if (!resolvedFile) return null

  const importedBody = parseFileBody(resolvedFile)
  if (!importedBody) return null

  return resolveModuleLevelFunctionBody(
    importedBody,
    name,
    resolvedFile,
    hopsRemaining - 1,
  )
}

/**
 * Find the inner arrow function body from a .handler(requireAuth(async ...)) chain.
 * Returns the inner function's body or null.
 */
function resolveHandlerBody(handlerArg, programBody, currentFile) {
  if (!handlerArg) return null

  // Direct arrow/function: .handler(async (ctx, data) => { ... })
  if (
    handlerArg.type === 'ArrowFunctionExpression' ||
    handlerArg.type === 'FunctionExpression'
  ) {
    return handlerArg.body
  }

  // Direct named-function reference: .handler(namedHandlerFn)
  if (handlerArg.type === 'Identifier') {
    return resolveModuleLevelFunctionBody(
      programBody,
      handlerArg.name,
      currentFile,
    )
  }

  // Wrapped: .handler(requireAuth(async (ctx, data) => { ... }))
  //      or: .handler(requireAuth(namedHandlerFn))
  if (handlerArg.type === 'CallExpression') {
    const callee = handlerArg.callee
    const wrapperName =
      callee.type === 'Identifier'
        ? callee.name
        : callee.type === 'MemberExpression'
          ? callee.property.name
          : null

    if (!ALLOWED_WRAPPERS.has(wrapperName)) {
      return { __notAllowed: true, wrapperName }
    }

    // Recurse into the wrapper's first argument
    const innerFn = handlerArg.arguments[0]
    if (
      innerFn &&
      (innerFn.type === 'ArrowFunctionExpression' ||
        innerFn.type === 'FunctionExpression')
    ) {
      return innerFn.body
    }
    if (innerFn && innerFn.type === 'Identifier') {
      return resolveModuleLevelFunctionBody(
        programBody,
        innerFn.name,
        currentFile,
      )
    }
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule definition
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Every createServerFn export must have a @requires JSDoc tag and call requireServerFnRole (unless @requires authenticated/unauthenticated)',
      recommended: false,
    },
    schema: [],
    messages: {
      missingJsDoc:
        'createServerFn export must have a JSDoc block with @requires {authenticated,unauthenticated,viewer,editor,admin,owner}',
      invalidRequiresValue:
        'createServerFn @requires value "{{value}}" is not one of: authenticated, unauthenticated, viewer, editor, admin, owner',
      missingRequiresCall:
        'createServerFn handler must call requireServerFnRole() or carry @requires authenticated/@requires unauthenticated escape hatch',
      notAllowedWrapper:
        'createServerFn handler is wrapped in "{{wrapper}}" which is not in the allowed wrapper list [requireAuth]. Use requireAuth or call requireServerFnRole directly.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        // Detect: createServerFn({ method: ... })
        const callee = node.callee
        if (callee.type !== 'Identifier' || callee.name !== 'createServerFn') {
          return
        }

        // Walk up to find the chained .handler() call
        // Pattern: createServerFn(...).inputValidator(...).handler(...)
        // or:      createServerFn(...).handler(...)
        let parent = node.parent
        let handlerNode = null

        // Traverse member-expression chains until we find .handler(...)
        let current = node
        while (current.parent) {
          const p = current.parent
          if (
            p.type === 'MemberExpression' &&
            p.property.type === 'Identifier' &&
            p.property.name === 'handler' &&
            p.parent?.type === 'CallExpression'
          ) {
            handlerNode = p.parent
            break
          }
          current = p
        }

        if (!handlerNode) return // no .handler() chain found

        // ── 1. Check JSDoc @requires tag ──────────────────────────────────
        // Find the JSDoc comment on the export declaration that contains this createServerFn
        let exportDecl = handlerNode
        while (exportDecl && exportDecl.type !== 'ExportNamedDeclaration') {
          exportDecl = exportDecl.parent
        }

        let jsDocValue = null
        if (exportDecl) {
          const comments = context.getSourceCode().getCommentsBefore(exportDecl)
          const jsDoc = comments
            .filter((c) => c.type === 'Block' && c.value.startsWith('*'))
            .map((c) => c.value)
            .join('\n')
          jsDocValue = getRequiresTag(jsDoc)

          if (!jsDocValue) {
            context.report({
              node: exportDecl,
              messageId: 'missingJsDoc',
            })
            return
          }

          if (!ALLOWED_REQUIRES_VALUES.has(jsDocValue)) {
            context.report({
              node: exportDecl,
              messageId: 'invalidRequiresValue',
              data: { value: jsDocValue },
            })
            return
          }
        }

        // ── 2. Escape-hatch: @requires authenticated / unauthenticated ────
        if (jsDocValue && ESCAPE_HATCH_TAGS.has(jsDocValue)) {
          return // No requireServerFnRole call required
        }

        // ── 3. Check handler body calls requireServerFnRole ───────────────
        const handlerArg = handlerNode.arguments[0]
        const programBody = context.getSourceCode().ast.body
        const bodyOrFlag = resolveHandlerBody(
          handlerArg,
          programBody,
          context.getFilename(),
        )

        if (bodyOrFlag && bodyOrFlag.__notAllowed) {
          context.report({
            node: handlerNode,
            messageId: 'notAllowedWrapper',
            data: { wrapper: bodyOrFlag.wrapperName },
          })
          return
        }

        const body = bodyOrFlag
        if (!body || !bodyCallsRequireServerFnRole(body)) {
          if (exportDecl) {
            context.report({
              node: exportDecl,
              messageId: 'missingRequiresCall',
            })
          }
        }
      },
    }
  },
}

module.exports = rule
