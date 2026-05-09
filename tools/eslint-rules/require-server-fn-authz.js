// tools/eslint-rules/require-server-fn-authz.js
// SEC-RBAC-04: ESLint rule ensuring every createServerFn export carries a
// @requires JSDoc tag and (unless using an escape-hatch tag) actually calls
// requireServerFnRole in its handler body.
//
// AD-2: Lives as a separate file imported by eslint.config.js inline plugin.
// Uses CommonJS exports for ESLint 9 flat-config compatibility.

'use strict'

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
 * Walk a function body (BlockStatement or expression) and check whether
 * it (or a nested call) contains a call to `requireServerFnRole` OR the
 * legacy `findEffectiveRole` + `hasMinimumRole` pattern (spec §3.9 resilience).
 */
function bodyCallsRequireServerFnRole(node) {
  if (!node) return false
  if (node.type === 'CallExpression') {
    const callee = node.callee
    const calleeName =
      callee.type === 'Identifier' ? callee.name :
      callee.type === 'MemberExpression' ? callee.property.name :
      null

    if (
      calleeName === 'requireServerFnRole' ||
      // Legacy pattern (AD-5: already-correct files use findEffectiveRole + hasMinimumRole)
      calleeName === 'findEffectiveRole' ||
      calleeName === 'hasMinimumRole'
    ) {
      return true
    }
    // Recurse into arguments
    return node.arguments.some(bodyCallsRequireServerFnRole)
  }
  if (node.type === 'AwaitExpression') {
    return bodyCallsRequireServerFnRole(node.argument)
  }
  if (node.type === 'BlockStatement') {
    return node.body.some(bodyCallsRequireServerFnRole)
  }
  if (node.type === 'ExpressionStatement') {
    return bodyCallsRequireServerFnRole(node.expression)
  }
  if (node.type === 'ReturnStatement') {
    return bodyCallsRequireServerFnRole(node.argument)
  }
  if (node.type === 'TryStatement') {
    return (
      bodyCallsRequireServerFnRole(node.block) ||
      bodyCallsRequireServerFnRole(node.handler?.body)
    )
  }
  if (node.type === 'IfStatement') {
    return (
      bodyCallsRequireServerFnRole(node.consequent) ||
      bodyCallsRequireServerFnRole(node.alternate)
    )
  }
  if (node.type === 'VariableDeclaration') {
    return node.declarations.some((d) => bodyCallsRequireServerFnRole(d.init))
  }
  if (node.type === 'ForOfStatement' || node.type === 'ForInStatement' || node.type === 'ForStatement') {
    return bodyCallsRequireServerFnRole(node.body)
  }
  return false
}

/**
 * Find the inner arrow function body from a .handler(requireAuth(async ...)) chain.
 * Returns the inner function's body or null.
 */
function resolveHandlerBody(handlerArg) {
  if (!handlerArg) return null

  // Direct arrow/function: .handler(async (ctx, data) => { ... })
  if (handlerArg.type === 'ArrowFunctionExpression' || handlerArg.type === 'FunctionExpression') {
    return handlerArg.body
  }

  // Wrapped: .handler(requireAuth(async (ctx, data) => { ... }))
  if (handlerArg.type === 'CallExpression') {
    const callee = handlerArg.callee
    const wrapperName =
      callee.type === 'Identifier' ? callee.name :
      callee.type === 'MemberExpression' ? callee.property.name :
      null

    if (!ALLOWED_WRAPPERS.has(wrapperName)) {
      return { __notAllowed: true, wrapperName }
    }

    // Recurse into the wrapper's first argument
    const innerFn = handlerArg.arguments[0]
    if (innerFn && (innerFn.type === 'ArrowFunctionExpression' || innerFn.type === 'FunctionExpression')) {
      return innerFn.body
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
        if (
          callee.type !== 'Identifier' ||
          callee.name !== 'createServerFn'
        ) {
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
        const bodyOrFlag = resolveHandlerBody(handlerArg)

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
