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
const JWT_SECRET = process.env.SESSION_SECRET || 'fallback-secret';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── DB SETUP ────────────────────────────────────────────────────────────────
async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            first_name VARCHAR(100) DEFAULT '',
            last_name VARCHAR(100) DEFAULT '',
            phone VARCHAR(50) DEFAULT '',
            role VARCHAR(20) DEFAULT 'customer',
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT DEFAULT '',
            price DECIMAL(10,2) NOT NULL,
            image_url VARCHAR(500) DEFAULT '',
            category VARCHAR(100) DEFAULT '',
            stock INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            order_number VARCHAR(50) UNIQUE NOT NULL,
            user_id INTEGER REFERENCES users(id),
            status VARCHAR(50) DEFAULT 'pending',
            subtotal DECIMAL(10,2) DEFAULT 0,
            shipping_cost DECIMAL(10,2) DEFAULT 0,
            total DECIMAL(10,2) DEFAULT 0,
            shipping_first_name VARCHAR(100) DEFAULT '',
            shipping_last_name VARCHAR(100) DEFAULT '',
            shipping_address VARCHAR(255) DEFAULT '',
            shipping_city VARCHAR(100) DEFAULT '',
            shipping_state VARCHAR(100) DEFAULT '',
            shipping_zip VARCHAR(20) DEFAULT '',
            shipping_country VARCHAR(100) DEFAULT '',
            tracking_number VARCHAR(255) DEFAULT '',
            items JSONB DEFAULT '[]',
            stripe_session_id VARCHAR(255) DEFAULT '',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(100) PRIMARY KEY,
            value TEXT DEFAULT '',
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS user_addresses (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            first_name VARCHAR(100) DEFAULT '',
            last_name VARCHAR(100) DEFAULT '',
            address_line1 VARCHAR(255) DEFAULT '',
            address_line2 VARCHAR(255) DEFAULT '',
            city VARCHAR(100) DEFAULT '',
            state VARCHAR(100) DEFAULT '',
            zip VARCHAR(20) DEFAULT '',
            country VARCHAR(100) DEFAULT 'US',
            is_default BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS admin_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            user_name VARCHAR(200) DEFAULT '',
            action VARCHAR(100) DEFAULT '',
            details TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            token VARCHAR(100) UNIQUE NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // Add phone column if missing (migration)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT ''`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(255) DEFAULT ''`);

    // Seed default settings
    const defaults = [
        ['shipping_cost', '8.99'],
        ['free_shipping_threshold', '100'],
        ['low_stock_threshold', '10'],
        ['hero_title', 'SIDEWAYS ALWAYS'],
        ['hero_subtitle', 'Drift culture apparel for those who live life sideways. Born from the smoke, built for the streets.'],
        ['hero_cta_text', 'SHOP NOW'],
        ['contact_email', 'contact@davidmyalik.com'],
        ['grind_title', 'THE GRIND|NEVER STOPS'],
        ['grind_text', 'Every stitch, every thread — crafted for those who push limits and live for the drift.'],
        ['grind_quote', 'If you are not sideways, you are not trying hard enough.'],
        ['grind_image', 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=600'],
        ['grind_link_url', '#shop'],
        ['grind_link_text', 'SHOP THE COLLECTION'],
        ['socials', JSON.stringify([
            { name: 'Instagram', icon: 'instagram', url: '', enabled: false },
            { name: 'YouTube', icon: 'youtube', url: '', enabled: false },
            { name: 'Twitter', icon: 'twitter', url: '', enabled: false },
            { name: 'TikTok', icon: 'tiktok', url: '', enabled: false },
            { name: 'Discord', icon: 'discord', url: '', enabled: false },
            { name: 'Facebook', icon: 'facebook', url: '', enabled: false }
        ])],
        ['store_name', 'David Myalik'],
        ['store_tagline', 'Sideways Always'],
        ['currency', 'USD'],
        ['order_prefix', 'DM'],
        ['tax_rate', '0'],
        ['tax_enabled', 'false'],
        ['guest_checkout_enabled', 'false'],
        ['maintenance_mode', 'false'],
        ['maintenance_message', ''],
        ['checkout_terms_enabled', 'false'],
        ['checkout_terms_text', ''],
        ['min_order_amount', '0'],
    ];
    for (const [key, value] of defaults) {
        await pool.query(
            'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
            [key, value]
        );
    }

    // Seed sample products if none exist
    const prodCount = await pool.query('SELECT COUNT(*) FROM products');
    if (parseInt(prodCount.rows[0].count) === 0) {
        await pool.query(`
            INSERT INTO products (name, description, price, image_url, category, stock) VALUES
            ('Sideways Always Tee', 'Premium cotton tee for drift culture enthusiasts.', 34.99, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600', 'Apparel', 50),
            ('DM Logo Hoodie', 'Heavyweight pullover hoodie with embroidered logo.', 74.99, 'https://images.unsplash.com/photo-1556821840-3a63f15732ce?w=600', 'Apparel', 25),
            ('Smoke & Tire Cap', 'Structured snapback with embroidered drift logo.', 34.99, 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=600', 'Accessories', 40),
            ('S13 Blueprint Poster', 'High-quality print of the iconic drift machine.', 24.99, 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=600', 'Art', 100),
            ('Drift Culture Sticker Pack', '5-piece vinyl sticker set for your ride or gear.', 9.99, 'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=600', 'Accessories', 200),
            ('Sideways Always Long Sleeve', 'Long sleeve tee with full back print.', 44.99, 'https://images.unsplash.com/photo-1618517048710-4e3dab9a7b97?w=600', 'Apparel', 3)
        `);
    }
    console.log('DB ready');
}

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const token = req.cookies.auth_token;
    if (!token) { req.user = null; return next(); }
    try { req.user = jwt.verify(token, JWT_SECRET); }
    catch { req.user = null; }
    next();
}
function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    next();
}
function requireAdmin(req, res, next) {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'owner'))
        return res.status(403).json({ error: 'Forbidden' });
    next();
}
app.use(authMiddleware);

// ─── ADMIN LOG HELPER ────────────────────────────────────────────────────────
async function adminLog(req, action, details) {
    try {
        const name = req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email : 'System';
        await pool.query(
            'INSERT INTO admin_logs (user_id, user_name, action, details) VALUES ($1, $2, $3, $4)',
            [req.user?.id || null, name, action, details]
        );
    } catch {}
}

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    try {
        const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
        if (existing.rows.length) return res.status(400).json({ error: 'An account with this email already exists' });

        const countRes = await pool.query('SELECT COUNT(*) FROM users');
        const role = parseInt(countRes.rows[0].count) === 0 ? 'owner' : 'customer';

        const hash = await bcrypt.hash(password, 10);
        const r = await pool.query(
            'INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, first_name, last_name, role',
            [email.toLowerCase(), hash, firstName || '', lastName || '', role]
        );
        const user = r.rows[0];
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role, first_name: user.first_name, last_name: user.last_name }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('auth_token', token, { httpOnly: true, maxAge: 7 * 24 * 3600000, sameSite: 'lax' });
        res.json({ user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role } });
    } catch (err) {
        console.error('Signup error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    try {
        const r = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
        if (!r.rows.length) return res.status(400).json({ error: 'Invalid email or password' });
        const user = r.rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(400).json({ error: 'Invalid email or password' });
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role, first_name: user.first_name, last_name: user.last_name }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('auth_token', token, { httpOnly: true, maxAge: 7 * 24 * 3600000, sameSite: 'lax' });
        res.json({ user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role } });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
    if (!req.user) return res.json({ user: null });
    try {
        const r = await pool.query('SELECT id, email, first_name, last_name, role, phone FROM users WHERE id = $1', [req.user.id]);
        if (!r.rows.length) return res.json({ user: null });
        res.json({ user: r.rows[0] });
    } catch {
        res.json({ user: null });
    }
});

app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const r = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
        if (!r.rows.length) {
            // Still show token section but with dummy token so we don't leak email existence
            return res.json({ token: null });
        }
        const userId = r.rows[0].id;
        // Generate 6-char token for demo display
        const token = Math.random().toString(36).slice(2, 8).toUpperCase();
        const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 min
        await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
        await pool.query(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [userId, token, expires]
        );
        res.json({ token }); // In production this would be emailed
    } catch (err) {
        console.error('Forgot password error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    try {
        const r = await pool.query(
            'SELECT * FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW()',
            [token.toUpperCase()]
        );
        if (!r.rows.length) return res.status(400).json({ error: 'Invalid or expired reset token' });
        const { user_id } = r.rows[0];
        const hash = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user_id]);
        await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user_id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Reset password error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── PRODUCTS ────────────────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM products WHERE is_active = true ORDER BY created_at DESC');
        res.json(r.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(r.rows[0]);
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── SETTINGS ────────────────────────────────────────────────────────────────
app.get('/api/settings/shipping', async (req, res) => {
    try {
        const r = await pool.query("SELECT value FROM settings WHERE key = 'shipping_cost'");
        res.json({ shippingCost: parseFloat(r.rows[0]?.value || '8.99') });
    } catch { res.json({ shippingCost: 8.99 }); }
});

app.get('/api/settings/socials', async (req, res) => {
    try {
        const r = await pool.query("SELECT value FROM settings WHERE key = 'socials'");
        res.json(JSON.parse(r.rows[0]?.value || '[]'));
    } catch { res.json([]); }
});

app.get('/api/settings/grind', async (req, res) => {
    try {
        const r = await pool.query("SELECT key, value FROM settings WHERE key LIKE 'grind_%'");
        const d = {};
        r.rows.forEach(row => { d[row.key] = row.value; });
        res.json({
            title: d['grind_title'] || 'THE GRIND|NEVER STOPS',
            text: d['grind_text'] || '',
            quote: d['grind_quote'] || '',
            image: d['grind_image'] || '',
            linkUrl: d['grind_link_url'] || '#shop',
            linkText: d['grind_link_text'] || 'SHOP THE COLLECTION'
        });
    } catch { res.json({ title: 'THE GRIND|NEVER STOPS', text: '', quote: '', image: '', linkUrl: '#shop', linkText: 'SHOP' }); }
});

app.get('/api/settings/all', async (req, res) => {
    try {
        const r = await pool.query('SELECT key, value FROM settings');
        const d = {};
        r.rows.forEach(row => { d[row.key] = row.value; });
        res.json(d);
    } catch { res.json({}); }
});

// ─── ORDERS (user) ───────────────────────────────────────────────────────────
app.get('/api/orders', requireAuth, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
        res.json(r.rows);
    } catch { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/orders/:id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(r.rows[0]);
    } catch { res.status(500).json({ error: 'Server error' }); }
});

// ─── USER PROFILE ────────────────────────────────────────────────────────────
app.get('/api/user/addresses', requireAuth, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC', [req.user.id]);
        res.json(r.rows);
    } catch { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/user/addresses', requireAuth, async (req, res) => {
    const { firstName, lastName, addressLine1, addressLine2, city, state, zip, country, isDefault } = req.body;
    try {
        if (isDefault) {
            await pool.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [req.user.id]);
        }
        const r = await pool.query(
            'INSERT INTO user_addresses (user_id, first_name, last_name, address_line1, address_line2, city, state, zip, country, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
            [req.user.id, firstName || '', lastName || '', addressLine1 || '', addressLine2 || '', city || '', state || '', zip || '', country || 'US', !!isDefault]
        );
        res.json(r.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/user/profile', requireAuth, async (req, res) => {
    const { firstName, lastName, phone } = req.body;
    try {
        await pool.query(
            'UPDATE users SET first_name = $1, last_name = $2, phone = $3 WHERE id = $4',
            [firstName || '', lastName || '', phone || '', req.user.id]
        );
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/user/password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
        const r = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
        const match = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
        if (!match) return res.status(400).json({ error: 'Current password is incorrect' });
        if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

// ─── CHECKOUT ────────────────────────────────────────────────────────────────
app.post('/api/checkout', requireAuth, async (req, res) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(503).json({ error: 'Stripe is not configured' });
    try {
        const stripe = require('stripe')(stripeKey);
        const { cart, shipping } = req.body;
        if (!cart || !cart.length) return res.status(400).json({ error: 'Cart is empty' });

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const baseUrl = `${protocol}://${host}`;

        const lineItems = cart.map(item => ({
            price_data: {
                currency: 'usd',
                product_data: { name: item.name, images: item.image_url ? [item.image_url] : [] },
                unit_amount: Math.round(parseFloat(item.price) * 100),
            },
            quantity: item.qty,
        }));

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `${baseUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/?checkout=cancelled`,
            metadata: {
                user_id: String(req.user.id),
                cart: JSON.stringify(cart),
                shipping: JSON.stringify(shipping || {})
            }
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error('Checkout error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/checkout/complete', requireAuth, async (req, res) => {
    const { sessionId } = req.body;
    try {
        // Check if order already exists for this session
        if (sessionId) {
            const existing = await pool.query('SELECT * FROM orders WHERE stripe_session_id = $1', [sessionId]);
            if (existing.rows.length) return res.json({ order: existing.rows[0] });
        }

        let cart = [];
        let shipping = {};

        if (sessionId && process.env.STRIPE_SECRET_KEY) {
            try {
                const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                const session = await stripe.checkout.sessions.retrieve(sessionId);
                cart = JSON.parse(session.metadata?.cart || '[]');
                shipping = JSON.parse(session.metadata?.shipping || '{}');
            } catch {}
        }

        const prefix = (await pool.query("SELECT value FROM settings WHERE key = 'order_prefix'")).rows[0]?.value || 'DM';
        const orderNum = `${prefix}-${Date.now().toString(36).toUpperCase()}`;
        const shippingCostRow = await pool.query("SELECT value FROM settings WHERE key = 'shipping_cost'");
        const shippingCost = parseFloat(shippingCostRow.rows[0]?.value || '8.99');
        const subtotal = cart.reduce((acc, i) => acc + (parseFloat(i.price) * i.qty), 0);
        const total = subtotal + shippingCost;

        // Build items array matching the expected shape
        const items = cart.map(i => ({
            id: i.id,
            product_name: i.name,
            product_image: i.image_url || '',
            price_at_purchase: i.price,
            quantity: i.qty
        }));

        const r = await pool.query(
            `INSERT INTO orders (order_number, user_id, status, subtotal, shipping_cost, total,
                shipping_first_name, shipping_last_name, shipping_address, shipping_city,
                shipping_state, shipping_zip, shipping_country, items, stripe_session_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
            [orderNum, req.user.id, 'pending', subtotal, shippingCost, total,
                shipping.firstName || '', shipping.lastName || '', shipping.address || '',
                shipping.city || '', shipping.state || '', shipping.zip || '', shipping.country || 'US',
                JSON.stringify(items), sessionId || '']
        );
        res.json({ order: r.rows[0] });
    } catch (err) {
        console.error('Checkout complete error:', err.message);
        res.status(500).json({ error: 'Could not create order' });
    }
});

// ─── ADMIN: STATS ─────────────────────────────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const lowThreshold = parseInt((await pool.query("SELECT value FROM settings WHERE key='low_stock_threshold'")).rows[0]?.value || '10');
        const [users, orders, products, revenue, monthlyRev, pending, newUsers, lowStock] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM users'),
            pool.query('SELECT COUNT(*) FROM orders'),
            pool.query('SELECT COUNT(*) FROM products WHERE is_active = true'),
            pool.query("SELECT COALESCE(SUM(total),0) FROM orders WHERE status != 'cancelled'"),
            pool.query("SELECT COALESCE(SUM(total),0) FROM orders WHERE status != 'cancelled' AND created_at >= date_trunc('month', NOW())"),
            pool.query("SELECT COUNT(*) FROM orders WHERE status = 'pending'"),
            pool.query("SELECT COUNT(*) FROM users WHERE created_at >= date_trunc('month', NOW())"),
            pool.query('SELECT COUNT(*) FROM products WHERE is_active = true AND stock <= $1', [lowThreshold]),
        ]);
        res.json({
            totalUsers: parseInt(users.rows[0].count),
            totalOrders: parseInt(orders.rows[0].count),
            totalProducts: parseInt(products.rows[0].count),
            totalRevenue: parseFloat(revenue.rows[0].coalesce),
            monthlyRevenue: parseFloat(monthlyRev.rows[0].coalesce),
            pendingOrders: parseInt(pending.rows[0].count),
            newUsersThisMonth: parseInt(newUsers.rows[0].count),
            lowStockCount: parseInt(lowStock.rows[0].count),
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── ADMIN: CATEGORIES ───────────────────────────────────────────────────────
app.get('/api/admin/categories', requireAdmin, async (req, res) => {
    try {
        const r = await pool.query("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != '' ORDER BY category");
        res.json(r.rows.map(r => r.category));
    } catch { res.json([]); }
});

// ─── ADMIN: PRODUCTS ─────────────────────────────────────────────────────────
app.get('/api/admin/products', requireAdmin, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
        res.json(r.rows);
    } catch { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
    const { name, description, price, stock, category, isActive, imageUrl } = req.body;
    if (!name || price === undefined) return res.status(400).json({ error: 'Name and price are required' });
    try {
        const r = await pool.query(
            'INSERT INTO products (name, description, price, image_url, category, stock, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [name, description || '', parseFloat(price), imageUrl || '', category || '', parseInt(stock) || 0, isActive !== false]
        );
        await adminLog(req, 'create_product', `Created product: ${name}`);
        res.json(r.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
    const { name, description, price, stock, category, isActive, imageUrl } = req.body;
    try {
        const r = await pool.query(
            'UPDATE products SET name=$1, description=$2, price=$3, image_url=$4, category=$5, stock=$6, is_active=$7 WHERE id=$8 RETURNING *',
            [name, description || '', parseFloat(price), imageUrl || '', category || '', parseInt(stock) || 0, isActive !== false, req.params.id]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        await adminLog(req, 'update_product', `Updated product: ${name}`);
        res.json(r.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Deactivate (soft delete)
app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
    try {
        const r = await pool.query('UPDATE products SET is_active = false WHERE id = $1 RETURNING name', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        await adminLog(req, 'deactivate_product', `Deactivated product: ${r.rows[0].name}`);
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

// Permanent delete
app.delete('/api/admin/products/:id/permanent', requireAdmin, async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM products WHERE id = $1 RETURNING name', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        await adminLog(req, 'delete_product', `Permanently deleted product: ${r.rows[0].name}`);
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

// Reactivate
app.patch('/api/admin/products/:id/reactivate', requireAdmin, async (req, res) => {
    try {
        const r = await pool.query('UPDATE products SET is_active = true WHERE id = $1 RETURNING name', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        await adminLog(req, 'reactivate_product', `Reactivated product: ${r.rows[0].name}`);
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

// Duplicate
app.post('/api/admin/products/:id/duplicate', requireAdmin, async (req, res) => {
    try {
        const orig = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
        if (!orig.rows.length) return res.status(404).json({ error: 'Not found' });
        const p = orig.rows[0];
        const r = await pool.query(
            'INSERT INTO products (name, description, price, image_url, category, stock, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [`${p.name} (Copy)`, p.description, p.price, p.image_url, p.category, 0, false]
        );
        await adminLog(req, 'duplicate_product', `Duplicated product: ${p.name}`);
        res.json(r.rows[0]);
    } catch { res.status(500).json({ error: 'Server error' }); }
});

// Quick stock update
app.patch('/api/admin/products/:id/stock', requireAdmin, async (req, res) => {
    const { stock } = req.body;
    try {
        const r = await pool.query('UPDATE products SET stock = $1 WHERE id = $2 RETURNING *', [parseInt(stock), req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        await adminLog(req, 'update_stock', `Updated stock for ${r.rows[0].name} to ${stock}`);
        res.json(r.rows[0]);
    } catch { res.status(500).json({ error: 'Server error' }); }
});

// ─── ADMIN: ORDERS ────────────────────────────────────────────────────────────
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT o.*, u.email as user_email, u.first_name as user_first_name, u.last_name as user_last_name
            FROM orders o LEFT JOIN users u ON o.user_id = u.id
            ORDER BY o.created_at DESC
        `);
        res.json(r.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
    const { status, trackingNumber } = req.body;
    try {
        const r = await pool.query(
            'UPDATE orders SET status=$1, tracking_number=$2, updated_at=NOW() WHERE id=$3 RETURNING *',
            [status, trackingNumber || '', req.params.id]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        await adminLog(req, 'update_order', `Updated order ${r.rows[0].order_number} status to ${status}`);
        res.json(r.rows[0]);
    } catch { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/admin/orders/:id', requireAdmin, async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING order_number', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        await adminLog(req, 'delete_order', `Deleted order ${r.rows[0].order_number}`);
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

// ─── ADMIN: USERS ─────────────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.created_at,
                   COUNT(o.id)::int as order_count
            FROM users u LEFT JOIN orders o ON o.user_id = u.id
            GROUP BY u.id ORDER BY u.created_at DESC
        `);
        res.json(r.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
        if (!userRes.rows.length) return res.status(404).json({ error: 'Not found' });
        const addrRes = await pool.query('SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC', [req.params.id]);
        const ordersRes = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [req.params.id]);
        res.json({ user: userRes.rows[0], addresses: addrRes.rows, orders: ordersRes.rows });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
    const { firstName, lastName, email, role, newPassword } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
        if (!userRes.rows.length) return res.status(404).json({ error: 'Not found' });
        const target = userRes.rows[0];

        // Only owner can change roles; can't demote owner
        let newRole = target.role;
        if (role && req.user.role === 'owner' && target.role !== 'owner') newRole = role;

        let passwordHash = target.password_hash;
        if (newPassword && newPassword.length >= 6) {
            passwordHash = await bcrypt.hash(newPassword, 10);
        }

        const r = await pool.query(
            'UPDATE users SET first_name=$1, last_name=$2, email=$3, role=$4, password_hash=$5 WHERE id=$6 RETURNING id, email, first_name, last_name, role',
            [firstName || target.first_name, lastName || target.last_name, email || target.email, newRole, passwordHash, req.params.id]
        );
        await adminLog(req, 'edit_user', `Edited user: ${email || target.email}`);
        res.json({ user: r.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const userRes = await pool.query('SELECT role, email FROM users WHERE id = $1', [req.params.id]);
        if (!userRes.rows.length) return res.status(404).json({ error: 'Not found' });
        if (userRes.rows[0].role === 'owner') return res.status(400).json({ error: 'Cannot delete the owner account' });
        if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        await adminLog(req, 'delete_user', `Deleted user: ${userRes.rows[0].email}`);
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

// ─── ADMIN: SETTINGS ─────────────────────────────────────────────────────────
app.put('/api/admin/settings/bulk', requireAdmin, async (req, res) => {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'Invalid settings' });
    try {
        for (const [key, value] of Object.entries(settings)) {
            await pool.query(
                'INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
                [key, String(value)]
            );
        }
        await adminLog(req, 'update_settings', `Updated settings: ${Object.keys(settings).join(', ')}`);
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/settings/socials', requireAdmin, async (req, res) => {
    const { socials } = req.body;
    try {
        await pool.query(
            'INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
            ['socials', JSON.stringify(socials)]
        );
        await adminLog(req, 'update_socials', 'Updated social links');
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/settings/grind', requireAdmin, async (req, res) => {
    const { title, text, quote, image, linkUrl, linkText } = req.body;
    try {
        const pairs = [['grind_title', title], ['grind_text', text], ['grind_quote', quote], ['grind_image', image], ['grind_link_url', linkUrl], ['grind_link_text', linkText]];
        for (const [key, value] of pairs) {
            await pool.query(
                'INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
                [key, value || '']
            );
        }
        await adminLog(req, 'update_grind', 'Updated Grind section');
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/settings/shipping', requireAdmin, async (req, res) => {
    const { shippingCost } = req.body;
    try {
        await pool.query(
            'INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
            ['shipping_cost', String(parseFloat(shippingCost))]
        );
        await adminLog(req, 'update_shipping', `Updated shipping cost to $${shippingCost}`);
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

// ─── ADMIN: LOGS ─────────────────────────────────────────────────────────────
app.get('/api/admin/logs', requireAdmin, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 500');
        res.json(r.rows);
    } catch { res.json([]); }
});

// ─── ADMIN: FILE UPLOAD ───────────────────────────────────────────────────────
app.post('/api/admin/upload', requireAdmin, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

// ─── HTML ROUTING ─────────────────────────────────────────────────────────────
const htmlRoutes = {
    '/login': 'login.html',
    '/signup': 'signup.html',
    '/dashboard': 'dashboard.html',
    '/admin': 'admin.html',
    '/help-center': 'help-center.html',
    '/shipping-info': 'shipping-info.html',
    '/returns': 'returns.html',
    '/forgot-password': 'forgot-password.html',
    '/404': '404.html',
    '/500': '500.html',
};

app.get('*', (req, res) => {
    const file = htmlRoutes[req.path];
    if (file) return res.sendFile(path.join(__dirname, 'public', file));
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────
initDb().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
    });
}).catch(err => {
    console.error('DB init failed:', err.message);
    process.exit(1);
});
