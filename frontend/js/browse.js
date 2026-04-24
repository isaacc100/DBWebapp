/**
 * browse.js — Read-Only Table Browser
 */

let currentTable  = '';
let currentPage   = 1;
let totalPages    = 1;
let currentSort   = { by: '', dir: 'asc' };
let currentSearch = '';
let debounceTimer = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const tableSelect   = document.getElementById('table-select');
const searchInput   = document.getElementById('search-input');
const tableContent  = document.getElementById('table-content');
const paginationEl  = document.getElementById('pagination');
const paginationInfo= document.getElementById('pagination-info');
const schemaPanel   = document.getElementById('schema-panel');
const schemaList    = document.getElementById('schema-list');
const toggleSchema  = document.getElementById('toggle-schema');

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const data = await listTables();
    if (!data.tables || data.tables.length === 0) {
      tableSelect.innerHTML = '<option value="">No tables found</option>';
      return;
    }
    tableSelect.innerHTML =
      '<option value="">— select a table —</option>' +
      data.tables.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
  } catch (err) {
    showMessage(`Failed to load tables: ${err.message}`, 'error');
  }
}

tableSelect.addEventListener('change', () => {
  currentTable  = tableSelect.value;
  currentPage   = 1;
  currentSort   = { by: '', dir: 'asc' };
  currentSearch = '';
  searchInput.value = '';
  if (currentTable) loadTable();
  else tableContent.innerHTML = '<div class="empty-state">Select a table above to start browsing.</div>';
});

searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    currentSearch = searchInput.value.trim();
    currentPage   = 1;
    if (currentTable) loadTable();
  }, 350);
});

toggleSchema.addEventListener('click', () => {
  schemaPanel.classList.toggle('hidden');
  toggleSchema.textContent = schemaPanel.classList.contains('hidden') ? 'Show Schema' : 'Hide Schema';
});

// ── Load table ────────────────────────────────────────────────────────────────
async function loadTable() {
  tableContent.innerHTML = '<div class="empty-state"><span class="spinner"></span> Loading…</div>';

  try {
    const data = await fetchRows(currentTable, {
      page:     currentPage,
      pageSize: 50,
      search:   currentSearch,
      sortBy:   currentSort.by,
      sortDir:  currentSort.dir,
    });

    renderSchema(data.schema);
    renderRows(data.columns, data.rows, data.schema);
    renderPagination(data.pagination);
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

// ── Render rows ───────────────────────────────────────────────────────────────
function renderRows(columns, rows, schema) {
  if (!rows || rows.length === 0) {
    tableContent.innerHTML = '<div class="empty-state">No rows found' +
      (currentSearch ? ` matching "${escHtml(currentSearch)}"` : '') + '.</div>';
    return;
  }

  const pkCol = schema.find(c => c.pk === 1)?.name;

  const head = columns.map(col => {
    const isActive = currentSort.by === col;
    const dir      = isActive ? (currentSort.dir === 'asc' ? '↑' : '↓') : '↕';
    return `<th class="sortable" data-col="${escHtml(col)}">${escHtml(col)} <small style="opacity:.5">${dir}</small></th>`;
  }).join('');

  const body = rows.map(row => {
    const cells = columns.map(col => {
      const v = row[col];
      if (v === null || v === undefined) return '<td><span class="null-value">NULL</span></td>';
      return `<td title="${escHtml(String(v))}">${escHtml(String(v))}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  tableContent.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;

  // Column sort listeners
  tableContent.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (currentSort.by === col) {
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = { by: col, dir: 'asc' };
      }
      currentPage = 1;
      loadTable();
    });
  });
}

// ── Render schema ──────────────────────────────────────────────────────────────
function renderSchema(schema) {
  if (!schema || !schema.length) { schemaList.innerHTML = ''; return; }
  schemaList.innerHTML = schema.map(col => `
    <tr>
      <td><strong>${escHtml(col.name)}</strong>${col.pk ? ' <span class="badge badge-purple">PK</span>' : ''}</td>
      <td style="color:var(--text-muted)">${escHtml(col.type || 'ANY')}</td>
      <td style="color:var(--text-muted)">${col.notnull ? 'NOT NULL' : ''}</td>
      <td style="color:var(--text-muted)">${col.dflt_value != null ? escHtml(String(col.dflt_value)) : ''}</td>
    </tr>`).join('');
}

// ── Pagination ────────────────────────────────────────────────────────────────
function renderPagination(p) {
  totalPages = p.totalPages;

  paginationInfo.textContent =
    `Showing ${((p.page - 1) * p.pageSize) + 1}–${Math.min(p.page * p.pageSize, p.total)} of ${p.total} rows`;

  paginationEl.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-ghost btn-sm';
  prevBtn.textContent = '‹ Prev';
  prevBtn.disabled = p.page <= 1;
  prevBtn.addEventListener('click', () => { currentPage--; loadTable(); });
  paginationEl.appendChild(prevBtn);

  // Page number chips (show up to 5)
  const start = Math.max(1, p.page - 2);
  const end   = Math.min(p.totalPages, start + 4);
  for (let n = start; n <= end; n++) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm ' + (n === p.page ? 'btn-primary' : 'btn-ghost');
    btn.textContent = n;
    btn.addEventListener('click', () => { currentPage = n; loadTable(); });
    paginationEl.appendChild(btn);
  }

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-ghost btn-sm';
  nextBtn.textContent = 'Next ›';
  nextBtn.disabled = p.page >= p.totalPages;
  nextBtn.addEventListener('click', () => { currentPage++; loadTable(); });
  paginationEl.appendChild(nextBtn);
}

function showMessage(msg, type = 'info') {
  tableContent.innerHTML = `<div class="alert alert-${type}">${escHtml(msg)}</div>`;
}

document.addEventListener('DOMContentLoaded', init);
