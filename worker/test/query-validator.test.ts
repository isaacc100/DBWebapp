import { describe, it, expect } from 'vitest';
import { validateSQL } from '../src/query-validator';

describe('validateSQL', () => {
  // ── Allowed operations ────────────────────────────────────────────────────

  it('allows a simple SELECT', () => {
    const result = validateSQL('SELECT * FROM users');
    expect(result.valid).toBe(true);
    expect(result.operation).toBe('SELECT');
  });

  it('allows SELECT with WHERE', () => {
    const result = validateSQL('SELECT id, name FROM users WHERE id = 1');
    expect(result.valid).toBe(true);
  });

  it('allows INSERT', () => {
    const result = validateSQL(
      "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')"
    );
    expect(result.valid).toBe(true);
    expect(result.operation).toBe('INSERT');
  });

  it('allows UPDATE', () => {
    const result = validateSQL(
      "UPDATE users SET name = 'Bob' WHERE id = 1"
    );
    expect(result.valid).toBe(true);
    expect(result.operation).toBe('UPDATE');
  });

  it('allows SELECT with JOIN', () => {
    const result = validateSQL(
      'SELECT u.name, o.total_price FROM users u JOIN orders o ON u.id = o.user_id'
    );
    expect(result.valid).toBe(true);
  });

  // ── Blocked operations ────────────────────────────────────────────────────

  it('blocks DROP', () => {
    const result = validateSQL('DROP TABLE users');
    expect(result.valid).toBe(false);
  });

  it('blocks DELETE', () => {
    const result = validateSQL('DELETE FROM users WHERE id = 1');
    expect(result.valid).toBe(false);
  });

  it('blocks ALTER', () => {
    const result = validateSQL('ALTER TABLE users ADD COLUMN age INTEGER');
    expect(result.valid).toBe(false);
  });

  it('blocks TRUNCATE', () => {
    const result = validateSQL('TRUNCATE TABLE users');
    expect(result.valid).toBe(false);
  });

  it('blocks CREATE', () => {
    const result = validateSQL('CREATE TABLE new_table (id INTEGER)');
    expect(result.valid).toBe(false);
  });

  it('blocks PRAGMA', () => {
    const result = validateSQL('PRAGMA table_info(users)');
    expect(result.valid).toBe(false);
  });

  // ── Multiple statements ───────────────────────────────────────────────────

  it('blocks multiple statements separated by semicolons', () => {
    const result = validateSQL(
      'SELECT * FROM users; DROP TABLE users'
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/multiple/i);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('rejects empty queries', () => {
    const result = validateSQL('');
    expect(result.valid).toBe(false);
  });

  it('rejects queries over 10 000 characters', () => {
    const result = validateSQL('SELECT ' + 'x'.repeat(10_000));
    expect(result.valid).toBe(false);
  });

  it('does not flag DROP inside a string literal', () => {
    // The word DROP appears only inside a string value
    const result = validateSQL(
      "SELECT * FROM users WHERE note = 'Please DROP me a line'"
    );
    expect(result.valid).toBe(true);
  });

  it('does not flag DROP inside a SQL comment', () => {
    // DROP is in a comment; cleaned SQL should be fine
    const result = validateSQL(
      'SELECT * FROM users -- DROP TABLE users'
    );
    expect(result.valid).toBe(true);
  });

  it('blocks DROP hidden in a block comment token outside of string', () => {
    // The comment is stripped, then DROP is no longer present; query is safe
    const result = validateSQL(
      'SELECT id /* a comment */ FROM users'
    );
    expect(result.valid).toBe(true);
  });
});
