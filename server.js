const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'david-myalik-secret-key-2026';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'public/uploads/' });

function authMiddleware(req, res, next) {
    const token = req.cookies.auth_token;
    if (!token) { req.user = null; return next(); }
    try {
        req.user = jwt.verify(token, JWT_SECRET);
    } catch { req.user = null; }
    next();
}

function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'owner')) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
}

app.use(authMiddleware);

async function log(level, message, metadata = {}) {
    try {
        await pool.query(
            'INSERT INTO system_logs (level, message, metadata) VALUES ($1, $2, $3)',
            [level, message, JSON.stringify(metadata)]
        );
    } catch {}
}

app.post('/api/auth/signup', async (req, res) => {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    try {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) return res.status(400).json({ error: 'Email already in use' });

        const countRes = await pool.query('SELECT COUNT(*) FROM users');
        const isFirst = parseInt(countRes.rows[0].count) === 0;
        const role = isFirst ? 'owner' : 'customer';

        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, first_name, last_name, role',
            [email, hash, firstName || '', lastName || '', role]
        );
        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('auth_token', token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000, sameSite: 'lax' });
        await log('info', 'User signed up', { email, role });
        res.json({ user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid email or password' });
        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(400).json({ error: 'Invalid email or password' });
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('auth_token', token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000, sameSite: 'lax' });
        await log('info', 'User logged in', { email });
        res.json({ user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    pool.query('SELECT id, email, first_name, last_name, role FROM users WHERE id = $1', [req.user.id])
        .then(r => {
            if (!r.rows.length) return res.json({ user: null });
            const u = r.rows[0];
            res.json({ user: { id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name, role: u.role } });
        })
        .catch(() => res.json({ user: null }));
});

app.post('/api/auth/forgot-password', async (req, res) => {
    res.json({ ok: true, message: 'If that email exists, a reset link was sent.' });
});

app.post('/api/auth/reset-password', async (req, res) => {
    res.status(400).json({ error: 'Password reset via email is not configured in this environment.' });
});

app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products WHERE is_active = true ORDER BY created_at DESC');
        res.json(result.rows);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/settings/shipping', async (req, res) => {
    try {
        const r = await pool.query("SELECT value FROM settings WHERE key = 'shipping_cost'");
        res.json({ shippingCost: parseFloat(r.rows[0]?.value || '8.99') });
    } catch {
        res.json({ shippingCost: 8.99 });
    }
});

app.get('/api/settings/socials', async (req, res) => {
    try {
        const r = await pool.query("SELECT value FROM settings WHERE key = 'socials'");
        res.json(JSON.parse(r.rows[0]?.value || '[]'));
    } catch {
        res.json([]);
    }
});

app.get('/api/settings/grind', async (req, res) => {
    try {
        const r = await pool.query("SELECT key, value FROM settings WHERE key LIKE 'grind_%'");
        const data = {};
        r.rows.forEach(row => { data[row.key.replace('grind_', '')] = row.value; });
        res.json({
            title: data.title || 'THE GRIND|NEVER STOPS',
            text: data.text || 'Every stitch, every thread — crafted for those who push limits.',
            quote: data.quote || 'If you are not sideways, you are not trying hard enough.',
            image: data.image || 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=600',
            linkUrl: data.link_url || '#shop',
            linkText: data.link_text || 'SHOP THE COLLECTION'
        });
    } catch {
        res.json({ title: 'THE GRIND|NEVER STOPS', text: '', quote: '', image: '', linkUrl: '#shop', linkText: 'SHOP' });
    }
});

app.get('/api/settings/all', async (req, res) => {
    try {
        const r = await pool.query('SELECT key, value FROM settings');
        const data = {};
        r.rows.forEach(row => { data[row.key] = row.value; });
        res.json(data);
    } catch {
        res.json({});
    }
});

app.get('/api/orders', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
        res.json(result.rows);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/orders/:id', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/user/addresses', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC', [req.user.id]);
        res.json(result.rows);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/user/addresses', requireAuth, async (req, res) => {
    const { label, firstName, lastName, address, city, state, zip, country, isDefault } = req.body;
    try {
        if (isDefault) {
            await pool.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [req.user.id]);
        }
        const result = await pool.query(
            'INSERT INTO user_addresses (user_id, label, first_name, last_name, address, city, state, zip, country, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
            [req.user.id, label || 'Home', firstName, lastName, address, city, state, zip, country || 'US', !!isDefault]
        );
        res.json(result.rows[0]);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/user/profile', requireAuth, async (req, res) => {
    const { firstName, lastName, email } = req.body;
    try {
        const result = await pool.query(
            'UPDATE users SET first_name = $1, last_name = $2, email = $3 WHERE id = $4 RETURNING id, email, first_name, last_name, role',
            [firstName, lastName, email, req.user.id]
        );
        res.json({ user: result.rows[0] });
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/user/password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
        const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
        const match = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
        if (!match) return res.status(400).json({ error: 'Current password is incorrect' });
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/checkout', requireAuth, async (req, res) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
        return res.status(503).json({ error: 'Stripe is not configured. Add STRIPE_SECRET_KEY to environment variables.' });
    }
    try {
        const stripe = require('stripe')(stripeKey);
        const { cart, shipping } = req.body;
        const host = req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const baseUrl = `${protocol}://${host}`;

        const lineItems = cart.map(item => ({
            price_data: {
                currency: 'usd',
                product_data: { name: item.name },
                unit_amount: Math.round(item.price * 100),
            },
            quantity: item.qty,
        }));

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `${baseUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/?checkout=cancelled`,
            metadata: { user_id: String(req.user.id), shipping: JSON.stringify(shipping) }
        });

        res.json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/checkout/complete', requireAuth, async (req, res) => {
    const { sessionId, cart } = req.body;
    try {
        const orderNum = 'DM-' + Date.now().toString(36).toUpperCase();
        const items = cart || [];
        const total = items.reduce((acc, i) => acc + (i.price * i.qty), 0);
        const result = await pool.query(
            'INSERT INTO orders (order_number, user_id, status, total, shipping_cost, items, stripe_session_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [orderNum, req.user.id, 'paid', total, 8.99, JSON.stringify(items), sessionId || '']
        );
        await log('info', 'Order placed', { orderNumber: orderNum, userId: req.user.id });
        res.json({ order: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Could not create order' });
    }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const [userCount, orderCount, productCount, revenue] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM users'),
            pool.query('SELECT COUNT(*) FROM orders'),
            pool.query('SELECT COUNT(*) FROM products WHERE is_active = true'),
            pool.query("SELECT COALESCE(SUM(total), 0) FROM orders WHERE status = 'paid'")
        ]);
        res.json({
            totalUsers: parseInt(userCount.rows[0].count),
            totalOrders: parseInt(orderCount.rows[0].count),
            totalProducts: parseInt(productCount.rows[0].count),
            totalRevenue: parseFloat(revenue.rows[0].coalesce)
        });
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/categories', requireAdmin, async (req, res) => {
    try {
        const r = await pool.query('SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category');
        res.json(r.rows.map(r => r.category));
    } catch {
        res.json([]);
    }
});

app.get('/api/admin/products', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
        res.json(result.rows);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
    const { name, description, price, image_url, category, stock, is_active } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO products (name, description, price, image_url, category, stock, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [name, description, price, image_url, category, stock || 0, is_active !== false]
        );
        await log('info', 'Product created', { name });
        res.json(result.rows[0]);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
    const { name, description, price, image_url, category, stock, is_active } = req.body;
    try {
        const result = await pool.query(
            'UPDATE products SET name=$1, description=$2, price=$3, image_url=$4, category=$5, stock=$6, is_active=$7 WHERE id=$8 RETURNING *',
            [name, description, price, image_url, category, stock, is_active, req.params.id]
        );
        res.json(result.rows[0]);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        await log('info', 'Product deleted', { id: req.params.id });
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.*, u.email as user_email, u.first_name, u.last_name 
            FROM orders o LEFT JOIN users u ON o.user_id = u.id 
            ORDER BY o.created_at DESC
        `);
        res.json(result.rows);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.patch('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body;
    try {
        const result = await pool.query(
            'UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
            [status, req.params.id]
        );
        await log('info', 'Order status updated', { id: req.params.id, status });
        res.json(result.rows[0]);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, email, first_name, last_name, role, created_at FROM users ORDER BY created_at DESC');
        res.json(result.rows);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const userRes = await pool.query('SELECT id, email, first_name, last_name, role, created_at FROM users WHERE id = $1', [req.params.id]);
        if (!userRes.rows.length) return res.status(404).json({ error: 'Not found' });
        const ordersRes = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [req.params.id]);
        res.json({ ...userRes.rows[0], orders: ordersRes.rows });
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/settings/bulk', requireAdmin, async (req, res) => {
    const settings = req.body;
    try {
        for (const [key, value] of Object.entries(settings)) {
            await pool.query(
                'INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
                [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]
            );
        }
        await log('info', 'Settings updated', { keys: Object.keys(settings) });
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/logs', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 200');
        res.json(result.rows);
    } catch {
        res.json([]);
    }
});

app.post('/api/admin/upload', requireAdmin, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
});

app.get('*', (req, res) => {
    const urlPath = req.path;
    const htmlMap = {
        '/login': 'login.html',
        '/signup': 'signup.html',
        '/dashboard': 'dashboard.html',
        '/admin': 'admin.html',
        '/help-center': 'help-center.html',
        '/shipping-info': 'shipping-info.html',
        '/returns': 'returns.html',
        '/404': '404.html',
        '/500': '500.html'
    };
    const file = htmlMap[urlPath];
    if (file) {
        return res.sendFile(path.join(__dirname, 'public', file));
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
