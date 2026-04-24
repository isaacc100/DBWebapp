/**
 * edit.js — Structured CRUD editor
 * All mutations use the parameterised /api/table/:name endpoints — no raw SQL.
 */

let currentTable  = '';
let currentSchema = [];
let currentRows   = [];
let currentPage   = 1;
let totalPages    = 1;
let pkCol         = 'id';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const tableSelect  = document.getElementById('table-select');
const tableContent = document.getElementById('table-content');
const paginationEl = document.getElementById('pagination');
const paginationInfo = document.getElementById('pagination-info');
const addRowBtn    = document.getElementById('add-row-btn');
const modal        = document.getElementById('row-modal');
const modalTitle   = document.getElementById('modal-title');
const modalForm    = document.getElementById('modal-form');
const modalSave    = document.getElementById('modal-save');
const modalCancel  = document.getElementById('modal-cancel');
const statusMsg    = document.getElementById('status-msg');

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
    showStatus(`Failed to load tables: ${err.message}`, 'error');
  }
}

tableSelect.addEventListener('change', () => {
  currentTable = tableSelect.value;
  currentPage  = 1;
  if (currentTable) loadTable();
  else {
    tableContent.innerHTML = '<div class="empty-state">Select a table to start editing.</div>';
    addRowBtn.disabled = true;
  }
});

addRowBtn.addEventListener('click', () => openModal(null));
modalCancel.addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
modalSave.addEventListener('click', saveRow);

// ── Load table ────────────────────────────────────────────────────────────────
async function loadTable() {
  tableContent.innerHTML = '<div class="empty-state"><span class="spinner"></span> Loading…</div>';
  addRowBtn.disabled = true;

  try {
    const data = await fetchRows(currentTable, { page: currentPage, pageSize: 50 });
    currentSchema = data.schema;
    currentRows   = data.rows;
    pkCol = (currentSchema.find(c => c.pk === 1) || { name: 'id' }).name;

    renderTable(data.columns, data.rows);
    renderPagination(data.pagination);
    addRowBtn.disabled = false;
  } catch (err) {
    tableContent.innerHTML = `<div class="alert alert-error">${escHtml(err.message)}</div>`;
  }
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable(columns, rows) {
  if (!rows || rows.length === 0) {
    tableContent.innerHTML = '<div class="empty-state">No rows found.</div>';
    return;
  }

  const head = [...columns, 'Actions'].map(c => `<th>${escHtml(c)}</th>`).join('');

  const body = rows.map(row => {
    const cells = columns.map(col => {
      const v = row[col];
      if (v === null || v === undefined) return '<td><span class="null-value">NULL</span></td>';
      return `<td title="${escHtml(String(v))}">${escHtml(String(v))}</td>`;
    }).join('');
    const rowId = row[pkCol];
    return `<tr>
      ${cells}
      <td style="white-space:nowrap;">
        <button class="btn btn-ghost btn-sm edit-btn" data-id="${escHtml(String(rowId))}">✏ Edit</button>
        <button class="btn btn-danger btn-sm del-btn" data-id="${escHtml(String(rowId))}">🗑 Delete</button>
      </td>
    </tr>`;
  }).join('');

  tableContent.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;

  tableContent.querySelectorAll('.edit-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const row = currentRows.find(r => String(r[pkCol]) === btn.dataset.id);
      if (row) openModal(row);
    })
  );

  tableContent.querySelectorAll('.del-btn').forEach(btn =>
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id))
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────
function renderPagination(p) {
  totalPages = p.totalPages;
  paginationInfo.textContent =
    `Showing ${Math.min((p.page-1)*p.pageSize+1, p.total)}–${Math.min(p.page*p.pageSize, p.total)} of ${p.total} rows`;

  paginationEl.innerHTML = '';
  const prev = btn('‹ Prev', p.page <= 1, () => { currentPage--; loadTable(); });
  paginationEl.appendChild(prev);

  const start = Math.max(1, p.page - 2);
  const end   = Math.min(p.totalPages, start + 4);
  for (let n = start; n <= end; n++) {
    const b = btn(String(n), false, () => { currentPage = n; loadTable(); });
    if (n === p.page) b.classList.replace('btn-ghost', 'btn-primary');
    paginationEl.appendChild(b);
  }

  const next = btn('Next ›', p.page >= p.totalPages, () => { currentPage++; loadTable(); });
  paginationEl.appendChild(next);
}

function btn(label, disabled, onClick) {
  const b = document.createElement('button');
  b.className = 'btn btn-ghost btn-sm';
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(row) {
  const isEdit = row !== null;
  modalTitle.textContent = isEdit ? `Edit Row (${pkCol} = ${row[pkCol]})` : 'Add New Row';
  modalSave.dataset.mode  = isEdit ? 'edit' : 'add';
  modalSave.dataset.rowId = isEdit ? String(row[pkCol]) : '';

  // Build form fields for each column except auto-increment pk
  const editableCols = currentSchema.filter(c => {
    if (c.pk === 1 && !isEdit) return false; // hide pk on add (auto-increment)
    return true;
  });

  modalForm.innerHTML = editableCols.map(col => {
    const val = row ? (row[col.name] ?? '') : '';
    const readonly = col.pk === 1; // pk shown but read-only when editing
    return `
      <div class="form-group">
        <label for="field-${escHtml(col.name)}">
          ${escHtml(col.name)}
          ${col.pk ? '<span class="badge badge-purple">PK</span>' : ''}
          ${col.notnull && !col.pk ? '<span style="color:var(--error)">*</span>' : ''}
        </label>
        <input
          id="field-${escHtml(col.name)}"
          class="input"
          data-col="${escHtml(col.name)}"
          value="${escHtml(String(val))}"
          placeholder="${escHtml(col.type || 'TEXT')}"
          ${readonly ? 'readonly style="opacity:.6"' : ''}
        />
      </div>`;
  }).join('');

  modal.classList.remove('hidden');
}

function closeModal() {
  modal.classList.add('hidden');
  modalForm.innerHTML = '';
}

async function saveRow() {
  const mode  = modalSave.dataset.mode;
  const rowId = modalSave.dataset.rowId;

  const rowData = {};
  modalForm.querySelectorAll('input[data-col]:not([readonly])').forEach(input => {
    rowData[input.dataset.col] = input.value;
  });

  modalSave.disabled = true;
  modalSave.textContent = 'Saving…';

  try {
    if (mode === 'add') {
      await insertRow(currentTable, rowData);
      showStatus('Row inserted successfully.', 'success');
    } else {
      await updateRow(currentTable, rowId, rowData);
      showStatus('Row updated successfully.', 'success');
    }
    closeModal();
    loadTable();
  } catch (err) {
    showStatus(err.message, 'error');
  } finally {
    modalSave.disabled = false;
    modalSave.textContent = 'Save';
  }
}

async function confirmDelete(rowId) {
  if (!confirm(`Delete row where ${pkCol} = ${rowId}? This cannot be undone.`)) return;
  try {
    await deleteRow(currentTable, rowId);
    showStatus('Row deleted.', 'success');
    loadTable();
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

// ── Status message ─────────────────────────────────────────────────────────────
function showStatus(msg, type = 'info') {
  statusMsg.innerHTML = `<div class="alert alert-${type}">${escHtml(msg)}</div>`;
  setTimeout(() => { statusMsg.innerHTML = ''; }, 4000);
}

document.addEventListener('DOMContentLoaded', init);
