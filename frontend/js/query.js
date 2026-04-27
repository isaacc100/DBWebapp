/**
 * query.js — SQL Playground page logic
 */

const MAX_HISTORY = 20;

let editor;         // CodeMirror instance
let queryHistory = JSON.parse(localStorage.getItem('queryHistory') || '[]');

// ── DOM refs ──────────────────────────────────────────────────────────────────
const runBtn        = document.getElementById('run-btn');
const clearBtn      = document.getElementById('clear-btn');
const outputPanel   = document.getElementById('output-panel');
const statsRow      = document.getElementById('stats-row');
const historyList   = document.getElementById('history-list');
const exampleList   = document.getElementById('example-list');

// ── Example queries ───────────────────────────────────────────────────────────
const EXAMPLES = [
  { label: 'All users',             sql: 'SELECT * FROM users' },
  { label: 'All products',          sql: 'SELECT * FROM products' },
  { label: 'All orders',            sql: 'SELECT * FROM orders' },
  { label: 'Orders with user names',
    sql: `SELECT o.id, u.name AS customer, p.name AS product,
       o.quantity, o.total_price, o.status
FROM orders o
JOIN users u ON u.id = o.user_id
JOIN products p ON p.id = o.product_id` },
  { label: 'Products under $100',   sql: "SELECT * FROM products WHERE price < 100 ORDER BY price" },
  { label: 'Count by category',     sql: "SELECT category, COUNT(*) AS count FROM products GROUP BY category" },
  { label: 'Update a user name',    sql: "UPDATE users SET name = 'Alice Smith' WHERE id = 1" },
  { label: 'Insert a product',
    sql: `INSERT INTO products (name, description, price, stock, category)
VALUES ('New Item', 'A new product', 9.99, 10, 'Accessories')` },
];

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  editor = CodeMirror.fromTextArea(document.getElementById('sql-input'), {
    mode: 'text/x-sql',
    theme: 'monokai',
    lineNumbers: true,
    matchBrackets: true,
    indentWithTabs: false,
    tabSize: 2,
    extraKeys: {
      'Ctrl-Enter': executeQuery,
      'Cmd-Enter':  executeQuery,
    },
  });

  editor.setValue('SELECT * FROM users');

  renderExamples();
  renderHistory();

  runBtn.addEventListener('click', executeQuery);
  clearBtn.addEventListener('click', clearOutput);
}

// ── Execute query ─────────────────────────────────────────────────────────────
async function executeQuery() {
  const sql = editor.getValue().trim();
  if (!sql) return;

  setLoading(true);
  clearOutput();

  try {
    const data = await runQuery(sql);
    showResult(data, sql);
    addToHistory(sql);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

function showResult(data, sql) {
  if (data.operation === 'SELECT') {
    outputPanel.innerHTML = renderTable(data.columns, data.rows);
    const truncNote = data.truncated
      ? `<p class="truncation-notice">⚠ Results truncated to ${data.rows.length} rows (max 100)</p>`
      : '';
    outputPanel.insertAdjacentHTML('beforeend', truncNote);

    statsRow.innerHTML = `
      <div class="stat-chip">Rows returned: <span>${data.rowCount}</span></div>
      <div class="stat-chip">Time: <span>${data.executionTime}ms</span></div>
      ${data.truncated ? '<div class="stat-chip" style="color:var(--warning)">⚠ truncated</div>' : ''}
    `;
  } else {
    // INSERT / UPDATE
    outputPanel.innerHTML = `
      <div class="alert alert-success">
        ✅ ${data.operation} successful — ${data.affectedRows} row(s) affected.
      </div>`;
    statsRow.innerHTML = `
      <div class="stat-chip">Rows affected: <span>${data.affectedRows}</span></div>
      <div class="stat-chip">Time: <span>${data.executionTime}ms</span></div>
    `;
  }
  statsRow.classList.remove('hidden');
}

function showError(message) {
  outputPanel.innerHTML = `<div class="alert alert-error">❌ ${escHtml(message)}</div>`;
  statsRow.classList.add('hidden');
}

function clearOutput() {
  outputPanel.innerHTML = '<div class="empty-state">Run a query to see results here.</div>';
  statsRow.classList.add('hidden');
}

function setLoading(loading) {
  runBtn.disabled = loading;
  runBtn.innerHTML = loading
    ? '<span class="spinner"></span> Running…'
    : '▶ Run Query';
}

// ── History ───────────────────────────────────────────────────────────────────
function addToHistory(sql) {
  queryHistory = [sql, ...queryHistory.filter(q => q !== sql)].slice(0, MAX_HISTORY);
  localStorage.setItem('queryHistory', JSON.stringify(queryHistory));
  renderHistory();
}

function renderHistory() {
  if (!queryHistory.length) {
    historyList.innerHTML = '<div style="color:var(--text-muted);font-size:.8rem;padding:.5rem .75rem;">No history yet</div>';
    return;
  }
  historyList.innerHTML = queryHistory
    .map((q, i) => `<div class="history-item" data-idx="${i}">${escHtml(q.replace(/\s+/g, ' ').slice(0, 60))}</div>`)
    .join('');

  historyList.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      editor.setValue(queryHistory[parseInt(el.dataset.idx)]);
      editor.focus();
    });
  });
}

// ── Examples ──────────────────────────────────────────────────────────────────
function renderExamples() {
  exampleList.innerHTML = EXAMPLES.map((ex, i) =>
    `<div class="example-item" data-idx="${i}"><strong>${escHtml(ex.label)}</strong></div>`
  ).join('');

  exampleList.querySelectorAll('.example-item').forEach(el => {
    el.addEventListener('click', () => {
      editor.setValue(EXAMPLES[parseInt(el.dataset.idx)].sql);
      editor.focus();
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
