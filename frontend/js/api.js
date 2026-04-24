/**
 * api.js — Shared API client
 *
 * Set API_BASE to your deployed Worker URL, e.g.:
 *   https://dbwebapp-worker.<your-subdomain>.workers.dev
 *
 * Defaults to localhost:8787 for local `wrangler dev` sessions.
 * In production the Worker URL must always use HTTPS.
 */

const API_BASE = (() => {
  if (window.API_BASE) return window.API_BASE;
  // Auto-use HTTPS when the page itself is served over HTTPS
  if (location.protocol === 'https:') {
    return 'https://dbwebapp-worker.your-subdomain.workers.dev';
  }
  return 'http://localhost:8787';
})();

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json();
  if (!res.ok && data.error) throw new Error(data.error);
  return data;
}

/** Execute a raw SQL query (SELECT / INSERT / UPDATE only). */
async function runQuery(sql) {
  return apiFetch('/api/query', {
    method: 'POST',
    body: JSON.stringify({ sql }),
  });
}

/** List all user tables. */
async function listTables() {
  return apiFetch('/api/tables');
}

/** Fetch paginated rows for a table. */
async function fetchRows(tableName, { page = 1, pageSize = 50, search = '', sortBy = '', sortDir = 'asc' } = {}) {
  const params = new URLSearchParams({ page, pageSize, search, sortBy, sortDir });
  return apiFetch(`/api/table/${encodeURIComponent(tableName)}?${params}`);
}

/** Fetch table schema. */
async function fetchSchema(tableName) {
  return apiFetch(`/api/table/${encodeURIComponent(tableName)}/schema`);
}

/** Insert a new row. */
async function insertRow(tableName, rowData) {
  return apiFetch(`/api/table/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    body: JSON.stringify(rowData),
  });
}

/** Update an existing row by primary-key value. */
async function updateRow(tableName, rowId, rowData) {
  return apiFetch(`/api/table/${encodeURIComponent(tableName)}/${encodeURIComponent(rowId)}`, {
    method: 'PUT',
    body: JSON.stringify(rowData),
  });
}

/** Delete a row by primary-key value. */
async function deleteRow(tableName, rowId) {
  return apiFetch(`/api/table/${encodeURIComponent(tableName)}/${encodeURIComponent(rowId)}`, {
    method: 'DELETE',
  });
}

/** Render a results object ({columns, rows}) as an HTML table string. */
function renderTable(columns, rows) {
  if (!rows || rows.length === 0) {
    return '<div class="empty-state">No rows returned.</div>';
  }
  const head = columns
    .map(c => `<th>${escHtml(c)}</th>`)
    .join('');
  const body = rows
    .map(row => {
      const cells = columns
        .map(c => {
          const v = row[c];
          if (v === null || v === undefined) {
            return '<td><span class="null-value">NULL</span></td>';
          }
          return `<td title="${escHtml(String(v))}">${escHtml(String(v))}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
