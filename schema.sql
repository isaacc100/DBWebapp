-- DBWebapp Sample Schema
-- Run with: wrangler d1 execute dbwebapp --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  total_price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sample data
INSERT INTO users (name, email, role) VALUES
  ('Alice Johnson', 'alice@example.com', 'admin'),
  ('Bob Smith', 'bob@example.com', 'user'),
  ('Carol Davis', 'carol@example.com', 'user'),
  ('David Lee', 'david@example.com', 'moderator'),
  ('Eve Wilson', 'eve@example.com', 'user');

INSERT INTO products (name, description, price, stock, category) VALUES
  ('Laptop Pro 15', 'High-performance laptop with 16GB RAM', 1299.99, 50, 'Electronics'),
  ('Wireless Mouse', 'Ergonomic wireless mouse, 2.4GHz', 29.99, 200, 'Accessories'),
  ('USB-C Hub', '7-in-1 USB-C hub with HDMI and PD', 49.99, 150, 'Accessories'),
  ('Mechanical Keyboard', 'RGB backlit mechanical keyboard', 89.99, 75, 'Accessories'),
  ('4K Monitor', '27-inch 4K IPS display, 144Hz', 599.99, 30, 'Electronics'),
  ('Webcam HD', '1080p webcam with built-in mic', 79.99, 100, 'Electronics');

INSERT INTO orders (user_id, product_id, quantity, total_price, status) VALUES
  (1, 1, 1, 1299.99, 'completed'),
  (2, 2, 2, 59.98, 'completed'),
  (3, 4, 1, 89.99, 'pending'),
  (1, 3, 1, 49.99, 'completed'),
  (4, 5, 1, 599.99, 'shipped'),
  (2, 6, 1, 79.99, 'pending'),
  (5, 2, 3, 89.97, 'processing');
