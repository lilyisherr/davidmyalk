const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.SESSION_SECRET || 'fallback-secret';

// Support Vercel/Neon environment variable names alongside standard DATABASE_URL
const dbUrl = process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL
    || process.env.POSTGRES_URL_NON_POOLING;
if (!dbUrl) { console.error('ERROR: No database URL found. Set DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL.'); /* don't exit here so serverless can still start for static assets */ }
const pool = dbUrl ? new Pool({ connectionString: dbUrl }) : null;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Security headers for production
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Use /tmp on serverless platforms (Vercel) to avoid write errors
        const useTmp = !!process.env.VERCEL;
        const dir = useTmp ? path.join(__dirname, 'tmp', 'uploads') : path.join(__dirname, 'public', 'uploads');
        try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) { console.error('Upload dir create error:', e.message); }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads are allowed'));
    cb(null, true);
} });

// DB init wrapper
async function initDb() {
    if (!pool) { console.warn('DB not configured; skipping DB init'); return; }
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
            sale_price DECIMAL(10,2) DEFAULT NULL,
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

        CREATE TABLE IF NOT EXISTS discount_codes (
            id SERIAL PRIMARY KEY,
            code VARCHAR(50) UNIQUE NOT NULL,
            type VARCHAR(20) NOT NULL DEFAULT 'percentage',
            value DECIMAL(10,2) NOT NULL,
            min_order_amount DECIMAL(10,2) DEFAULT 0,
            usage_limit INTEGER DEFAULT NULL,
            usage_count INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT true,
            expires_at TIMESTAMP DEFAULT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS newsletter_subscribers (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            subscribed_at TIMESTAMP DEFAULT NOW(),
            is_active BOOLEAN DEFAULT true
        );
        CREATE TABLE IF NOT EXISTS contact_submissions (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            subject VARCHAR(500) DEFAULT '',
            message TEXT NOT NULL,
            order_number VARCHAR(100) DEFAULT '',
            status VARCHAR(50) DEFAULT 'new',
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS product_reviews (
            id SERIAL PRIMARY KEY,
            reviewer_name VARCHAR(255) NOT NULL,
            reviewer_location VARCHAR(255) DEFAULT '',
            rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
            review_text TEXT NOT NULL,
            is_approved BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // Basic migrations left out for brevity in this serverless-friendly copy
}

// ─── AUTH MIDDLEWARE ───────────────────────────────────────────────────────
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

// minimal admin log helper for serverless safety
async function adminLog(req, action, details) {
    try {
        if (!pool) return;
        const name = req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email : 'System';
        await pool.query('INSERT INTO admin_logs (user_id, user_name, action, details) VALUES ($1, $2, $3, $4)', [req.user?.id || null, name, action, details]);
    } catch (e) { console.error('adminLog error', e.message); }
}

// email helper (unchanged)
async function getSmtpSettings() {
    if (!pool) return {};
    const r = await pool.query("SELECT key, value FROM settings WHERE key LIKE 'smtp_%'");
    const s = {};
    r.rows.forEach(row => { s[row.key] = row.value; });
    return s;
}
function buildTransporter(s) {
    if (!s.smtp_host || !s.smtp_user || !s.smtp_pass) return null;
    return nodemailer.createTransport({
        host: s.smtp_host,
        port: parseInt(s.smtp_port) || 587,
        secure: s.smtp_secure === 'true',
        auth: { user: s.smtp_user, pass: s.smtp_pass }
    });
}
async function sendEmail({ to, subject, text, html }) {
    try {
        const s = await getSmtpSettings();
        const transporter = buildTransporter(s);
        if (!transporter) return false;
        await transporter.sendMail({
            from: `"${s.smtp_from_name || 'David Myalik Store'}" <${s.smtp_from_email || s.smtp_user}>`,
            to, subject, text, html: html || `<pre style="font-family:sans-serif;white-space:pre-wrap;">${text}</pre>`
        });
        return true;
    } catch (e) { console.error('Email send error:', e && e.message); return false; }
}

// ─── SIMPLE ROUTES USED BY FRONTEND ──────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, env: process.env.NODE_ENV || 'development' }));

// Upload endpoint — serverless-friendly (writes to /tmp on Vercel)
app.post('/api/admin/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    // Build a reachable URL. On Vercel use VERCEL_URL env if available.
    const filePath = `/uploads/${req.file.filename}`;
    const base = process.env.APP_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `${req.protocol}://${req.get('host')}`);
    const fullUrl = base + filePath;
    // If file was written to tmp, consider returning a temporary URL and warn that uploads are ephemeral on Vercel
    if (process.env.VERCEL) {
        return res.json({ url: fullUrl, ephemeral: true, message: 'On Vercel uploads are stored temporarily and may not persist. Use external storage for production.' });
    }
    res.json({ url: fullUrl });
});

// Simple static file fallback for uploaded assets when running locally
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Provide a lightweight /api/checkout-status to let frontend poll
app.get('/api/checkout-status', async (req, res) => {
    try {
        const sessionId = req.query.session_id;
        if (!sessionId) return res.json({ status: 'unknown' });
        if (!pool) return res.json({ status: 'unknown' });
        const r = await pool.query('SELECT * FROM orders WHERE stripe_session_id = $1', [sessionId]);
        if (!r.rows.length) return res.json({ status: 'not_found' });
        const order = r.rows[0];
        return res.json({ status: order.status });
    } catch (e) { console.error('checkout-status error', e.message); res.status(500).json({ error: 'server error' }); }
});

// Add a cancel endpoint so frontend can mark a pre-created order as abandoned
app.post('/api/checkout/cancel', async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) return res.status(400).json({ error: 'No sessionId provided' });
        if (!pool) return res.status(200).json({ ok: true, message: 'DB not configured' });
        await pool.query("UPDATE orders SET status = 'abandoned', updated_at = NOW() WHERE stripe_session_id = $1 AND status = 'pending_payment'", [sessionId]);
        res.json({ ok: true });
    } catch (e) { console.error('checkout cancel error', e.message); res.status(500).json({ error: 'server error' }); }
});

// Basic products endpoint for storefront
app.get('/api/products', async (req, res) => {
    try {
        if (!pool) return res.json([]);
        const r = await pool.query('SELECT * FROM products WHERE is_active = true ORDER BY created_at DESC');
        res.json(r.rows);
    } catch (err) { console.error(err.message); res.status(500).json({ error: 'Server error' }); }
});

// Fallback to serve public HTML pages
const htmlRoutes = {
    '/login': 'login.html',
    '/signup': 'signup.html',
    '/dashboard': 'dashboard.html',
    '/admin': 'admin.html',
    '/help-center': 'help-center.html',
    '/shipping-info': 'shipping-info.html',
    '/returns': 'returns.html',
    '/forgot-password': 'forgot-password.html',
    '/contact': 'contact.html',
    '/tracking': 'tracking.html',
    '/404': '404.html',
    '/500': '500.html',
};
app.get('*', (req, res) => {
    const file = htmlRoutes[req.path];
    if (file) return res.sendFile(path.join(__dirname, 'public', file));
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Startup / export handling: when required (e.g. by serverless wrapper) export app; when run directly, init DB and listen
if (require.main === module) {
    initDb().then(() => {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT}`);
        });
    }).catch(err => {
        console.error('DB init failed:', err && err.message);
        process.exit(1);
    });
} else {
    // allow serverless platforms to import the express app
    initDb().catch(err => console.error('DB init (import) error:', err && err.message));
    module.exports = app;
}
