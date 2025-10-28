// src/components/whiteboard/TextEditor.tsx
// Text editor component for diagram creation using text syntax

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParseError } from '@/lib/parser/ast'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { parseDiagram } from '@/lib/parser/diagram-parser'
import { debounce } from '@/hooks/use-collaboration'

/**
 * Props for TextEditor component
 */
export interface TextEditorProps {
  /**
   * Current text source
   */
  value: string

  /**
   * Callback when text changes (debounced)
   */
  onChange: (value: string) => void

  /**
   * Callback when valid diagram is parsed
   */
  onParsedDiagram?: (ast: any) => void

  /**
   * Whether the editor is read-only
   */
  readOnly?: boolean

  /**
   * Placeholder text
   */
  placeholder?: string

  /**
   * Debounce delay in milliseconds
   */
  debounceMs?: number
}

/**
 * TextEditor component with syntax highlighting and error reporting
 * Provides real-time parsing feedback and debounced updates
 */
export function TextEditor({
  value,
  onChange,
  onParsedDiagram,
  readOnly = false,
  placeholder = 'Enter diagram syntax...',
  debounceMs = 500,
}: TextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [localValue, setLocalValue] = useState(value)
  const [parseErrors, setParseErrors] = useState<Array<ParseError>>([])
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })

  // Update local value when prop changes (external update)
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  // Debounced onChange handler
  const debouncedOnChange = useMemo(
    () => debounce(onChange, debounceMs),
    [onChange, debounceMs],
  )

  // Parse diagram and update errors
  const parseAndValidate = useCallback(
    (text: string) => {
      const result = parseDiagram(text)

      if (result.success && result.ast) {
        setParseErrors([])
        onParsedDiagram?.(result.ast)
      } else {
        setParseErrors(result.errors)
      }
    },
    [onParsedDiagram],
  )

  // Handle text change
  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      setLocalValue(newValue)

      // Parse and validate
      parseAndValidate(newValue)

      // Debounce onChange callback
      debouncedOnChange(newValue)
    },
    [debouncedOnChange, parseAndValidate],
  )

  // Update cursor position
  const handleCursorMove = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart
    const textBeforeCursor = textarea.value.substring(0, cursorPos)
    const lines = textBeforeCursor.split('\n')
    const line = lines.length
    const column = lines[lines.length - 1].length + 1

    setCursorPosition({ line, column })
  }, [])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab key - insert 2 spaces
      if (e.key === 'Tab') {
        e.preventDefault()
        const textarea = textareaRef.current
        if (!textarea) return

        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const newValue =
          localValue.substring(0, start) + '  ' + localValue.substring(end)

        setLocalValue(newValue)
        onChange(newValue)

        // Restore cursor position
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2
        }, 0)
      }
    },
    [localValue, onChange],
  )

  // Calculate line numbers
  const lineNumbers = useMemo(() => {
    const lines = localValue.split('\n')
    return lines.map((_, index) => index + 1)
  }, [localValue])

  // Calculate error line highlights
  const errorLines = useMemo(() => {
    return new Set(parseErrors.map((err) => err.line))
  }, [parseErrors])

  // Generate syntax-highlighted content (simple approach)
  const highlightedLines = useMemo(() => {
    return localValue.split('\n').map((line, index) => {
      const lineNumber = index + 1
      const hasError = errorLines.has(lineNumber)

      return {
        text: line,
        lineNumber,
        hasError,
      }
    })
  }, [localValue, errorLines])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Error Display */}
      {parseErrors.length > 0 && (
        <div className="p-2 border-b max-h-32 overflow-y-auto">
          {parseErrors.map((error, index) => (
            <Alert key={index} variant="destructive" className="mb-2">
              <AlertDescription className="text-sm">
                Line {error.line}, Column {error.column}: {error.message}
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Editor Status Bar */}
      <div className="flex items-center justify-between px-4 py-1 text-xs text-muted-foreground border-b bg-muted/30">
        <div>
          Line {cursorPosition.line}, Column {cursorPosition.column}
        </div>
        <div>
          {parseErrors.length > 0
            ? `${parseErrors.length} error${parseErrors.length > 1 ? 's' : ''}`
            : 'No errors'}
        </div>
      </div>

      {/* Editor Container */}
      <div className="flex-1 relative overflow-hidden">
        {/* Line Numbers */}
        <div className="absolute left-0 top-0 bottom-0 w-12 bg-muted/50 text-right pr-2 py-3 text-xs text-muted-foreground font-mono select-none border-r overflow-y-auto scrollbar-hide">
          {lineNumbers.map((num) => (
            <div
              key={num}
              className={`leading-6 ${errorLines.has(num) ? 'text-destructive font-semibold' : ''}`}
            >
              {num}
            </div>
          ))}
        </div>

        {/* Textarea */}
        <Textarea
          ref={textareaRef}
          value={localValue}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onSelect={handleCursorMove}
          onClick={handleCursorMove}
          onKeyUp={handleCursorMove}
          readOnly={readOnly}
          placeholder={placeholder}
          className="h-full w-full pl-14 py-3 font-mono text-sm resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          style={{
            lineHeight: '1.5rem',
          }}
        />
      </div>

      {/* Help Text */}
      <div className="px-4 py-2 text-xs text-muted-foreground border-t bg-muted/30">
        <div className="space-y-1">
          <div>
            <strong>Syntax:</strong> table TableName &#123; columnName dataType
            [pk] [fk] [unique] [null] &#125;
          </div>
          <div>
            <strong>Relationship:</strong> TableA.columnA -&gt; TableB.columnB
            (one-to-many)
          </div>
          <div>
            <strong>Data types:</strong> int, string, float, boolean, date,
            text, uuid, json
          </div>
        </div>
      </div>
    </div>
  )
}
