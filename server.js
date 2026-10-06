 const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ----------------------------------------------------
// 1. READ: Get all books
// ----------------------------------------------------
app.get('/api/books', async (req, res) => {
  try {
    const [books] = await db.query('SELECT * FROM books');
    res.json(books);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 2. CREATE: Add a new book
// ----------------------------------------------------
app.post('/api/books', async (req, res) => {
  const { title, author, category, quantity } = req.body;
  if (!title || !author || !category || quantity === undefined) {
    return res.status(400).json({ error: 'Title, author, category, and quantity are required' });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO books (title, author, category, quantity) VALUES (?, ?, ?, ?)',
      [title, author, category, quantity]
    );
    res.json({ id: result.insertId, title, author, category, quantity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 3. DELETE: Remove a book by ID
// ----------------------------------------------------
app.delete('/api/books/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM books WHERE book_id = ?', [req.params.id]);
    res.json({ message: 'Book deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 4. READ: Get all users
// ----------------------------------------------------
app.get('/api/users', async (req, res) => {
  try {
    const [users] = await db.query('SELECT * FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 5. CREATE: Add a new user
// ----------------------------------------------------
app.post('/api/users', async (req, res) => {
  const { name, role } = req.body;

  if (!name || !role) {
    return res.status(400).json({ error: 'Name and role are required' });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO users (name, role) VALUES (?, ?)',
      [name, role]
    );
    res.json({ user_id: result.insertId, name, role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 6. TRANSACTION: Issue a book to a user
// ----------------------------------------------------
app.post('/api/issue', async (req, res) => {
  const { book_id, user_id } = req.body;

  if (!book_id || !user_id) {
    return res.status(400).json({ error: 'book_id and user_id are required' });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Verify user exists
    const [user] = await connection.query('SELECT user_id FROM users WHERE user_id = ?', [user_id]);
    if (user.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'User does not exist' });
    }

    // Check if book exists and has available inventory
    const [book] = await connection.query('SELECT quantity FROM books WHERE book_id = ? FOR UPDATE', [book_id]);
    if (book.length === 0 || book[0].quantity < 1) {
      await connection.rollback();
      return res.status(400).json({ error: 'Book is out of stock or does not exist' });
    }

    // Record issue transaction
    await connection.query(
      'INSERT INTO issue_records (book_id, user_id, issue_date, status) VALUES (?, ?, CURDATE(), "ISSUED")',
      [book_id, user_id]
    );

    // Reduce inventory count by 1
    await connection.query('UPDATE books SET quantity = quantity - 1 WHERE book_id = ?', [book_id]);

    await connection.commit();
    res.json({ message: 'Book issued successfully' });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// ----------------------------------------------------
// 7. JOIN QUERY: Get transaction logs with user & book details
// ----------------------------------------------------
app.get('/api/transactions', async (req, res) => {
  try {
    const query = `
      SELECT 
        ir.issue_id, 
        ir.book_id, 
        b.title, 
        u.name AS user_name, 
        u.role, 
        ir.issue_date, 
        ir.status 
      FROM issue_records ir
      JOIN books b ON ir.book_id = b.book_id
      JOIN users u ON ir.user_id = u.user_id
    `;
    const [transactions] = await db.query(query);
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 8. TRANSACTION: Return an issued book
// ----------------------------------------------------
app.post('/api/return', async (req, res) => {
  const { issue_id, book_id } = req.body;

  if (!issue_id || !book_id) {
    return res.status(400).json({ error: 'issue_id and book_id are required' });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Update status in issue_records to 'RETURNED'
    const [updateResult] = await connection.query(
      "UPDATE issue_records SET status = 'RETURNED' WHERE issue_id = ? AND status = 'ISSUED'",
      [issue_id]
    );

    if (updateResult.affectedRows === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Transaction not found or book already returned' });
    }

    // Increment book quantity back by 1
    await connection.query(
      'UPDATE books SET quantity = quantity + 1 WHERE book_id = ?',
      [book_id]
    );

    await connection.commit();
    res.json({ message: 'Book returned successfully!' });
  } catch (error) {
    await connection.rollback();
    console.error('Return book error:', error);
    res.status(500).json({ error: 'Database transaction failed' });
  } finally {
    connection.release();
  }
});

// Start the server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});