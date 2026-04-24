import { validateSQL } from './query-validator';
import { RateLimiter } from './rate-limiter';

export interface Env {
  DB: D1Database;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_ROWS = 100;

/** 30 requests per minute per IP (per-isolate; see RateLimiter note) */
const rateLimiter = new RateLimiter(30, 60_000);

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

function getClientIP(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function isValidTableName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && name.length <= 64;
}

function isValidColumnName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && name.length <= 64;
}

/** Ensure a SELECT query never returns more than maxRows rows. */
function addRowLimit(sql: string, maxRows: number): string {
  // Remove trailing semicolons and whitespace without using a backtracking regex
  let trimmed = sql.trim();
  while (trimmed.endsWith(';') || trimmed.endsWith(' ') || trimmed.endsWith('\t') || trimmed.endsWith('\n') || trimmed.endsWith('\r')) {
    trimmed = trimmed.slice(0, -1);
  }
  if (/\bLIMIT\b/i.test(trimmed)) {
    // Cap any existing LIMIT value
    return trimmed.replace(/\bLIMIT\s+(\d+)/i, (_m, n) =>
      `LIMIT ${Math.min(parseInt(n, 10), maxRows)}`
    );
  }
  return `${trimmed} LIMIT ${maxRows}`;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleQuery(request: Request, env: Env): Promise<Response> {
  let body: { sql?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body');
  }

  if (!body.sql || typeof body.sql !== 'string') {
    return errorResponse('Missing or invalid "sql" field');
  }

  const validation = validateSQL(body.sql);
  if (!validation.valid) {
    return errorResponse(validation.error ?? 'Invalid SQL query');
  }

  const start = Date.now();

  try {
    if (validation.operation === 'SELECT') {
      const limitedSQL = addRowLimit(body.sql, MAX_ROWS);
      const { results } = await env.DB.prepare(limitedSQL).all();
      const rows = results as Record<string, unknown>[];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return jsonResponse({
        success: true,
        operation: 'SELECT',
        columns,
        rows,
        rowCount: rows.length,
        truncated: rows.length >= MAX_ROWS,
        executionTime: Date.now() - start,
      });
    }

    // INSERT / UPDATE
    const { meta } = await env.DB.prepare(body.sql).run();
    return jsonResponse({
      success: true,
      operation: validation.operation,
      affectedRows: meta.changes ?? 0,
      executionTime: Date.now() - start,
    });
  } catch (err) {
    return errorResponse(
      `SQL Error: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}

async function handleGetTables(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '_cf_%'
     ORDER BY name`
  ).all();
  const tables = (results as { name: string }[]).map(r => r.name);
  return jsonResponse({ success: true, tables });
}

async function handleGetSchema(env: Env, tableName: string): Promise<Response> {
  if (!isValidTableName(tableName)) return errorResponse('Invalid table name');
  const { results } = await env.DB.prepare(
    `PRAGMA table_info("${tableName}")`
  ).all();
  return jsonResponse({ success: true, schema: results });
}

async function handleGetRows(
  env: Env,
  tableName: string,
  url: URL
): Promise<Response> {
  if (!isValidTableName(tableName)) return errorResponse('Invalid table name');

  const page = Math.max(
    1,
    parseInt(url.searchParams.get('page') ?? '1', 10)
  );
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50', 10))
  );
  const search = url.searchParams.get('search') ?? '';
  const sortBy = url.searchParams.get('sortBy') ?? '';
  const sortDir =
    url.searchParams.get('sortDir') === 'desc' ? 'DESC' : 'ASC';
  const offset = (page - 1) * pageSize;

  // Fetch schema so we know column names
  const { results: schemaRows } = await env.DB.prepare(
    `PRAGMA table_info("${tableName}")`
  ).all();
  const schema = schemaRows as {
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }[];
  if (!schema.length) return errorResponse('Table not found', 404);

  const columns = schema.map(r => r.name);

  const searchParams: unknown[] = [];
  let whereClause = '';
  if (search) {
    const conditions = columns
      .map(col => `CAST("${col}" AS TEXT) LIKE ?`)
      .join(' OR ');
    whereClause = ` WHERE ${conditions}`;
    columns.forEach(() => searchParams.push(`%${search}%`));
  }

  // Total count for pagination
  const countSQL = `SELECT COUNT(*) AS total FROM "${tableName}"${whereClause}`;
  const { results: countRows } = await env.DB
    .prepare(countSQL)
    .bind(...searchParams)
    .all();
  const total = (countRows[0] as { total: number }).total;

  let orderClause = '';
  if (sortBy && isValidColumnName(sortBy) && columns.includes(sortBy)) {
    orderClause = ` ORDER BY "${sortBy}" ${sortDir}`;
  }

  const dataSQL = `SELECT * FROM "${tableName}"${whereClause}${orderClause} LIMIT ? OFFSET ?`;
  const { results: rows } = await env.DB
    .prepare(dataSQL)
    .bind(...searchParams, pageSize, offset)
    .all();

  return jsonResponse({
    success: true,
    schema,
    columns,
    rows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}

async function handleInsertRow(
  request: Request,
  env: Env,
  tableName: string
): Promise<Response> {
  if (!isValidTableName(tableName)) return errorResponse('Invalid table name');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body');
  }

  const { results: schemaRows } = await env.DB.prepare(
    `PRAGMA table_info("${tableName}")`
  ).all();
  const validCols = new Set(
    (schemaRows as { name: string }[]).map(r => r.name)
  );

  const entries = Object.entries(body).filter(
    ([col, val]) =>
      isValidColumnName(col) && validCols.has(col) && val !== undefined
  );
  if (!entries.length) return errorResponse('No valid columns provided');

  const cols = entries.map(([col]) => `"${col}"`).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  const values = entries.map(([, v]) => v);

  try {
    const { meta } = await env.DB.prepare(
      `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders})`
    )
      .bind(...values)
      .run();
    return jsonResponse({
      success: true,
      affectedRows: meta.changes ?? 0,
      lastInsertId: meta.last_row_id,
    });
  } catch (err) {
    return errorResponse(
      `SQL Error: ${err instanceof Error ? err.message : 'Insert failed'}`
    );
  }
}

async function handleUpdateRow(
  request: Request,
  env: Env,
  tableName: string,
  rowId: string
): Promise<Response> {
  if (!isValidTableName(tableName)) return errorResponse('Invalid table name');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body');
  }

  const { results: schemaRows } = await env.DB.prepare(
    `PRAGMA table_info("${tableName}")`
  ).all();
  const schema = schemaRows as { name: string; pk: number }[];
  const pkCol = schema.find(r => r.pk === 1)?.name ?? 'id';
  const validCols = new Set(schema.map(r => r.name));

  const entries = Object.entries(body).filter(
    ([col]) => isValidColumnName(col) && validCols.has(col) && col !== pkCol
  );
  if (!entries.length)
    return errorResponse('No valid columns provided for update');

  const setClauses = entries.map(([col]) => `"${col}" = ?`).join(', ');
  const values: unknown[] = [...entries.map(([, v]) => v), rowId];

  try {
    const { meta } = await env.DB.prepare(
      `UPDATE "${tableName}" SET ${setClauses} WHERE "${pkCol}" = ?`
    )
      .bind(...values)
      .run();
    return jsonResponse({ success: true, affectedRows: meta.changes ?? 0 });
  } catch (err) {
    return errorResponse(
      `SQL Error: ${err instanceof Error ? err.message : 'Update failed'}`
    );
  }
}

async function handleDeleteRow(
  env: Env,
  tableName: string,
  rowId: string
): Promise<Response> {
  if (!isValidTableName(tableName)) return errorResponse('Invalid table name');

  const { results: schemaRows } = await env.DB.prepare(
    `PRAGMA table_info("${tableName}")`
  ).all();
  const pkCol =
    (schemaRows as { name: string; pk: number }[]).find(r => r.pk === 1)
      ?.name ?? 'id';

  try {
    const { meta } = await env.DB.prepare(
      `DELETE FROM "${tableName}" WHERE "${pkCol}" = ?`
    )
      .bind(rowId)
      .run();
    return jsonResponse({ success: true, affectedRows: meta.changes ?? 0 });
  } catch (err) {
    return errorResponse(
      `SQL Error: ${err instanceof Error ? err.message : 'Delete failed'}`
    );
  }
}

// ─── Main Router ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS pre-flight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Rate limiting
    const clientIP = getClientIP(request);
    if (!rateLimiter.allow(clientIP)) {
      return errorResponse(
        'Rate limit exceeded. Please wait before making more requests.',
        429
      );
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // POST /api/query
      if (path === '/api/query' && method === 'POST') {
        return await handleQuery(request, env);
      }

      // GET /api/tables
      if (path === '/api/tables' && method === 'GET') {
        return await handleGetTables(env);
      }

      // GET /api/table/:name/schema  — must be checked before /:name/:rowId
      const schemaMatch = path.match(/^\/api\/table\/([^/]+)\/schema$/);
      if (schemaMatch && method === 'GET') {
        return await handleGetSchema(
          env,
          decodeURIComponent(schemaMatch[1])
        );
      }

      // PUT /api/table/:name/:rowId  and  DELETE /api/table/:name/:rowId
      const rowMatch = path.match(/^\/api\/table\/([^/]+)\/([^/]+)$/);
      if (rowMatch) {
        const tableName = decodeURIComponent(rowMatch[1]);
        const rowId = decodeURIComponent(rowMatch[2]);
        if (method === 'PUT')
          return await handleUpdateRow(request, env, tableName, rowId);
        if (method === 'DELETE')
          return await handleDeleteRow(env, tableName, rowId);
      }

      // GET /api/table/:name  and  POST /api/table/:name
      const tableMatch = path.match(/^\/api\/table\/([^/]+)$/);
      if (tableMatch) {
        const tableName = decodeURIComponent(tableMatch[1]);
        if (method === 'GET')
          return await handleGetRows(env, tableName, url);
        if (method === 'POST')
          return await handleInsertRow(request, env, tableName);
      }

      return errorResponse('Not found', 404);
    } catch (err) {
      console.error('Worker error:', err);
      return errorResponse('Internal server error', 500);
    }
  },
};
