/**
 * SQL Query Validator
 *
 * Allows: SELECT, INSERT, UPDATE
 * Blocks: DROP, ALTER, DELETE, TRUNCATE, CREATE, GRANT, REVOKE, ATTACH,
 *         DETACH, VACUUM, REINDEX, REPLACE, PRAGMA, EXEC/EXECUTE
 * Rejects: multiple statements, queries > 10 000 characters
 */

export type AllowedOperation = 'SELECT' | 'INSERT' | 'UPDATE';

export interface ValidationResult {
  valid: boolean;
  operation?: AllowedOperation;
  error?: string;
}

// Complete-word block list (checked after stripping literals & comments)
const BLOCKED_TOKENS = new Set([
  'DROP',
  'ALTER',
  'DELETE',
  'TRUNCATE',
  'CREATE',
  'GRANT',
  'REVOKE',
  'ATTACH',
  'DETACH',
  'VACUUM',
  'REINDEX',
  'REPLACE',
  'PRAGMA',
  'EXEC',
  'EXECUTE',
]);

/** Remove -- and block comments */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/**
 * Replace string/identifier literals so that keywords inside them
 * don't trigger the block list.
 */
function stripLiterals(sql: string): string {
  return sql
    .replace(/'(?:[^'\\]|\\.)*'/g, "'?'")       // single-quoted strings
    .replace(/"(?:[^"\\]|\\.)*"/g, '"?"');        // double-quoted identifiers
}

export function validateSQL(sql: string): ValidationResult {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { valid: false, error: 'Query cannot be empty' };
  }

  if (trimmed.length > 10_000) {
    return { valid: false, error: 'Query is too long (max 10 000 characters)' };
  }

  // 1. Strip comments, then literals, before any keyword inspection
  const cleaned = stripLiterals(stripComments(trimmed));

  // 2. Reject multiple statements (any non-trailing semicolon)
  const parts = cleaned.split(';').map(p => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    return { valid: false, error: 'Multiple SQL statements are not allowed' };
  }

  // 3. Determine the first keyword (the statement type)
  const firstToken = cleaned.trim().match(/^(\w+)/)?.[1]?.toUpperCase() ?? '';

  const ALLOWED: AllowedOperation[] = ['SELECT', 'INSERT', 'UPDATE'];
  if (!ALLOWED.includes(firstToken as AllowedOperation)) {
    return {
      valid: false,
      error: `Operation "${firstToken || '(unknown)'}" is not allowed. Only SELECT, INSERT, and UPDATE are permitted.`,
    };
  }

  // 4. Scan all word tokens against the block list
  const tokens = cleaned.toUpperCase().match(/\b\w+\b/g) ?? [];
  for (const token of tokens) {
    if (BLOCKED_TOKENS.has(token)) {
      return {
        valid: false,
        error: `Keyword "${token}" is not allowed in queries`,
      };
    }
  }

  return { valid: true, operation: firstToken as AllowedOperation };
}
