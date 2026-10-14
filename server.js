const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const Stripe = require('stripe');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.SESSION_SECRET;
const ADMIN_ROLES = new Set(['admin', 'owner']);
const PUBLIC_SETTING_KEYS = [
    'contact_email', 'free_shipping_threshold', 'low_stock_threshold',
    'hero_title', 'hero_subtitle', 'hero_cta_text',
    'newsletter_enabled', 'newsletter_title', 'newsletter_subtitle',
    'policy_returns', 'policy_shipping', 'policy_privacy', 'policy_terms',
    'banner_enabled', 'banner_text', 'banner_link', 'banner_color'
];
const ADMIN_SETTING_KEYS = [
    'contact_email', 'shipping_cost', 'free_shipping_threshold', 'tax_enabled', 'tax_rate',
    'min_order_amount', 'order_prefix', 'order_processing_days', 'order_shipping_days',
    'low_stock_threshold', 'auto_reduce_stock', 'auto_deactivate_on_zero_stock',
    'allow_backorders', 'show_low_stock_to_customers', 'show_out_of_stock_products',
    'guest_checkout_enabled', 'checkout_terms_enabled', 'checkout_terms_text',
    'admin_notification_email', 'order_notification_enabled', 'low_stock_alert_enabled',
    'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from_name',
    'smtp_from_email', 'contact_form_email',
    'email_order_confirmation_enabled', 'email_order_confirmation_subject', 'email_order_confirmation_body',
    'email_order_shipped_enabled', 'email_order_shipped_subject', 'email_order_shipped_body',
    'email_contact_auto_reply_enabled', 'email_contact_auto_reply_subject', 'email_contact_auto_reply_body',
    'policy_returns', 'policy_shipping', 'policy_privacy', 'policy_terms'
];
const DEFAULT_PRODUCT_CATEGORIES = ['Apparel', 'Hats', 'Stickers', 'Accessories', 'Decals', 'Home & Garage'];
let dbInitialization = null;

// Support Vercel/Neon environment variable names alongside standard DATABASE_URL
const dbUrl = process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL
    || process.env.POSTGRES_URL_NON_POOLING;
if (!dbUrl) { console.error('ERROR: No database URL found. Set DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL.'); /* don't exit here so serverless can still start for static assets */ }
const pool = dbUrl ? new Pool({ connectionString: dbUrl }) : null;
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

app.use(express.json({
    verify: (req, res, buffer) => {
        if (req.originalUrl.startsWith('/api/stripe/webhook')) req.rawBody = Buffer.from(buffer);
    }
}));
app.use(cookieParser());

// Security headers for production
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (req.path.startsWith('/api/admin')) res.setHeader('Cache-Control', 'no-store');
    next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'].includes(file.mimetype))
        return cb(new Error('Upload a JPG, PNG, GIF, WebP, or AVIF image.'));
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
            product_type VARCHAR(100) DEFAULT '',
            stock INTEGER DEFAULT 0,
            categories JSONB DEFAULT '[]',
            product_images JSONB DEFAULT '[]',
            size_inventory JSONB DEFAULT '{}',
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            order_number VARCHAR(50) UNIQUE NOT NULL,
            user_id INTEGER REFERENCES users(id),
            customer_email VARCHAR(255) DEFAULT '',
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
            discount_amount DECIMAL(10,2) DEFAULT 0,
            discount_code VARCHAR(50) DEFAULT '',
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
        CREATE TABLE IF NOT EXISTS uploaded_images (
            id UUID PRIMARY KEY,
            content_type VARCHAR(50) NOT NULL,
            image_data BYTEA NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
    await pool.query(`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS product_images JSONB DEFAULT '[]';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS categories JSONB DEFAULT '[]';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type VARCHAR(100) DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS size_inventory JSONB DEFAULT '{}';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_carrier VARCHAR(50) DEFAULT '';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255) DEFAULT '';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code VARCHAR(50) DEFAULT '';
        UPDATE products
        SET categories = jsonb_build_array(category)
        WHERE category IS NOT NULL AND category <> '' AND categories = '[]'::jsonb;
        UPDATE settings
        SET value = 'shopdavidmyalik@gmail.com', updated_at = NOW()
        WHERE key = 'contact_email' AND value = 'contact@davidmyalik.com';
    `);

    // Basic migrations left out for brevity in this serverless-friendly copy
}

function initializeDatabase() {
    if (!dbInitialization) {
        dbInitialization = initDb().catch(error => {
            dbInitialization = null;
            throw error;
        });
    }
    return dbInitialization;
}

function ensureDatabaseInitialized(req, res, next) {
    if (!pool) return next();
    initializeDatabase().then(next).catch(error => {
        console.error('Database initialization error:', error.message);
        res.status(503).json({ error: 'Database services are temporarily unavailable.' });
    });
}

// ─── AUTH MIDDLEWARE ───────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const token = req.cookies.auth_token;
    if (!token || !JWT_SECRET) { req.user = null; return next(); }
    try { req.user = jwt.verify(token, JWT_SECRET); }
    catch { req.user = null; }
    next();
}
function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!pool) return res.status(503).json({ error: 'Account services are temporarily unavailable.' });
    next();
}
async function requireAdmin(req, res, next) {
    if (!req.user || !ADMIN_ROLES.has(req.user.role))
        return res.status(403).json({ error: 'Forbidden' });
    if (!pool) return res.status(503).json({ error: 'Admin services are unavailable.' });
    try {
        const result = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
        if (!result.rows.length || !ADMIN_ROLES.has(result.rows[0].role))
            return res.status(403).json({ error: 'Forbidden' });
        req.user.role = result.rows[0].role;
        next();
    } catch (error) {
        console.error('Admin authorization error:', error.message);
        res.status(503).json({ error: 'Admin services are unavailable.' });
    }
}
app.use(authMiddleware);
app.use('/api', ensureDatabaseInitialized);
app.use('/api/admin', requireAdmin);

function safeUser(user) {
    return {
        id: user.id,
        email: user.email,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        role: user.role,
        phone: user.phone || ''
    };
}

function normalizeProduct(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return { error: 'Provide product details.' };

    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const description = typeof input.description === 'string' ? input.description : '';
    const legacyCategory = typeof input.category === 'string' ? input.category.trim() : '';
    const productType = typeof input.productType === 'string' ? input.productType.trim() : '';
    const categoriesInput = input.categories === undefined ? (legacyCategory ? [legacyCategory] : []) : input.categories;
    if (!Array.isArray(categoriesInput) || categoriesInput.length > 20
        || categoriesInput.some(category => typeof category !== 'string' || !category.trim() || category.trim().length > 100))
        return { error: 'Choose up to 20 valid product categories.' };
    const categories = [...new Set(categoriesInput.map(category => category.trim()))];
    const category = categories[0] || '';
    const imageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : '';
    const price = typeof input.price === 'number'
        ? input.price
        : typeof input.price === 'string' && input.price.trim() !== '' ? Number(input.price) : NaN;
    const salePrice = input.salePrice === null || input.salePrice === '' || input.salePrice === undefined
        ? null
        : typeof input.salePrice === 'number'
            ? input.salePrice
            : typeof input.salePrice === 'string' && input.salePrice.trim() !== '' ? Number(input.salePrice) : NaN;
    const sizeInventory = input.sizeInventory;
    const productImages = input.productImages === undefined ? [] : input.productImages;

    if (!name || name.length > 255) return { error: 'Product name is required and must be at most 255 characters.' };
    if (!Number.isFinite(price) || price < 0) return { error: 'Enter a valid product price.' };
    if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice < 0))
        return { error: 'Enter a valid sale price.' };
    if (description.length > 10000 || imageUrl.length > 500 || productType.length > 100)
        return { error: 'One or more product fields are too long.' };
    if (typeof input.isActive !== 'boolean') return { error: 'Product visibility must be selected.' };
    if (!Array.isArray(productImages) || productImages.length > 19
        || productImages.some(image => typeof image !== 'string' || image.length > 500))
        return { error: 'Product images must be a list of at most 20 valid image URLs.' };
    if (sizeInventory !== null && (typeof sizeInventory !== 'object' || Array.isArray(sizeInventory)
        || Object.values(sizeInventory).some(value => !Number.isInteger(Number(value)) || Number(value) < 0)))
        return { error: 'Size inventory must contain non-negative whole numbers.' };

    const rawStock = sizeInventory
        ? Object.values(sizeInventory).reduce((total, value) => total + Number(value), 0)
        : typeof input.stock === 'number'
            ? input.stock
            : typeof input.stock === 'string' && input.stock.trim() !== '' ? Number(input.stock) : NaN;
    if (!Number.isInteger(rawStock) || rawStock < 0 || rawStock > 2147483647)
        return { error: 'Stock must be a non-negative whole number.' };

    return {
        values: [
            name, description, price, salePrice, imageUrl, category, productType, rawStock, JSON.stringify(categories),
            JSON.stringify(productImages), JSON.stringify(sizeInventory || {}),
            input.isActive
        ]
    };
}

function setAuthCookie(req, res, user) {
    const token = jwt.sign(safeUser(user), JWT_SECRET, { expiresIn: '12h' });
    res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || req.secure,
        sameSite: 'lax',
        maxAge: 12 * 60 * 60 * 1000,
        path: '/'
    });
}

async function readSettings(keys) {
    if (!pool || !keys.length) return {};
    const result = await pool.query('SELECT key, value FROM settings WHERE key = ANY($1::text[])', [keys]);
    return Object.fromEntries(result.rows.map(row => [row.key, row.value]));
}

function validEmail(email) {
    return typeof email === 'string' && email.length <= 255
        && /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email);
}

const rateLimitBuckets = new Map();
function rateLimit(limit, windowMs) {
    return (req, res, next) => {
        const now = Date.now();
        const routePath = req.route && req.route.path ? req.route.path : req.path;
        const key = `${req.method}:${req.baseUrl || ''}${routePath}:${req.ip || req.socket.remoteAddress}`;
        let bucket = rateLimitBuckets.get(key);
        if (!bucket || now - bucket.startedAt >= windowMs) {
            bucket = { startedAt: now, count: 0 };
            rateLimitBuckets.set(key, bucket);
        }
        if (bucket.count >= limit) {
            res.setHeader('Retry-After', Math.ceil((windowMs - (now - bucket.startedAt)) / 1000));
            return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
        }
        bucket.count += 1;
        if (rateLimitBuckets.size > 5000) {
            for (const [bucketKey, value] of rateLimitBuckets) {
                if (now - value.startedAt >= windowMs) rateLimitBuckets.delete(bucketKey);
            }
        }
        next();
    };
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

app.post('/api/auth/login', rateLimit(10, 15 * 60 * 1000), async (req, res) => {
    if (!JWT_SECRET) return res.status(503).json({ error: 'Sign in is not configured on this server.' });
    if (!pool) return res.status(503).json({ error: 'Account services are temporarily unavailable.' });
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!validEmail(email) || !password) return res.status(400).json({ error: 'Enter a valid email and password.' });
    try {
        const result = await pool.query(
            'SELECT id, email, password_hash, first_name, last_name, role FROM users WHERE email = $1',
            [email]
        );
        const user = result.rows[0];
        if (!user || !await bcrypt.compare(password, user.password_hash))
            return res.status(401).json({ error: 'Email or password is incorrect.' });
        setAuthCookie(req, res, user);
        res.json({ user: safeUser(user) });
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ error: 'Unable to sign in right now.' });
    }
});

app.post('/api/auth/signup', rateLimit(8, 60 * 60 * 1000), async (req, res) => {
    if (!JWT_SECRET) return res.status(503).json({ error: 'Account creation is not configured on this server.' });
    if (!pool) return res.status(503).json({ error: 'Account services are temporarily unavailable.' });
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
    if (!validEmail(email) || password.length < 12 || password.length > 128
        || !firstName || firstName.length > 100 || !lastName || lastName.length > 100) {
        return res.status(400).json({ error: 'Enter a valid name and email, and use a password of at least 12 characters.' });
    }
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const role = process.env.BOOTSTRAP_ADMIN_EMAIL
            && email === process.env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase()
            ? 'owner'
            : 'customer';
        const result = await pool.query(
            'INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, first_name, last_name, role',
            [email, passwordHash, firstName, lastName, role]
        );
        const user = result.rows[0];
        setAuthCookie(req, res, user);
        res.status(201).json({ user: safeUser(user) });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
        console.error('Signup error:', error.message);
        res.status(500).json({ error: 'Unable to create your account right now.' });
    }
});

const PASSWORD_RESET_MESSAGE = 'If an account with that email exists, a password reset link will be sent shortly.';
app.post('/api/auth/forgot-password', rateLimit(5, 60 * 60 * 1000), async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!validEmail(email)) return res.status(200).json({ message: PASSWORD_RESET_MESSAGE });
    if (!pool) return res.status(503).json({ error: 'Password reset is temporarily unavailable.' });
    try {
        const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (result.rows.length) {
            const userId = result.rows[0].id;
            const token = crypto.randomBytes(32).toString('hex');
            const storedToken = crypto.createHash('sha256').update(token).digest('hex');
            await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
            await pool.query(
                'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')',
                [userId, storedToken]
            );
            const baseUrl = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
            const link = `${baseUrl}/forgot-password?token=${encodeURIComponent(token)}`;
            const sent = await sendEmail({
                to: email,
                subject: 'Reset your DAVID MYALIK password',
                text: `We received a request to reset your password. Open this link within one hour to choose a new password:\n\n${link}\n\nIf you did not request this, you can ignore this email.`
            });
            if (!sent) console.error('Password reset email could not be delivered.');
        }
        res.json({ message: PASSWORD_RESET_MESSAGE });
    } catch (error) {
        console.error('Password reset request error:', error.message);
        res.json({ message: PASSWORD_RESET_MESSAGE });
    }
});

app.post('/api/auth/reset-password', rateLimit(10, 60 * 60 * 1000), async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!/^[a-f0-9]{64}$/i.test(token) || password.length < 12 || password.length > 128)
        return res.status(400).json({ error: 'Use a valid reset link and a password of at least 12 characters.' });
    let client;
    try {
        const storedToken = crypto.createHash('sha256').update(token).digest('hex');
        client = await pool.connect();
        await client.query('BEGIN');
        const result = await client.query(
            'SELECT id, user_id FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW() FOR UPDATE',
            [storedToken]
        );
        if (!result.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'This reset link is invalid or expired. Request a new one.' });
        }
        const passwordHash = await bcrypt.hash(password, 12);
        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, result.rows[0].user_id]);
        await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [result.rows[0].user_id]);
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('Password reset error:', error.message);
        res.status(500).json({ error: 'Unable to reset your password right now.' });
    } finally {
        if (client) client.release();
    }
});

app.get('/api/auth/me', (req, res) => res.json({ user: req.user ? safeUser(req.user) : null }));
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('auth_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || req.secure,
        sameSite: 'lax',
        path: '/'
    });
    res.json({ ok: true });
});

app.get('/api/orders', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, order_number, status, total, tracking_number, shipping_carrier,
                   COALESCE(items, '[]'::jsonb) AS items, created_at
            FROM orders
            WHERE user_id = $1 AND status NOT IN ('abandoned', 'checkout_failed')
            ORDER BY created_at DESC, id DESC
        `, [req.user.id]);
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(result.rows);
    } catch (error) {
        console.error('Customer order list error:', error.message);
        res.status(500).json({ error: 'Unable to load your orders.' });
    }
});

app.get('/api/orders/:id', requireAuth, async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid order ID.' });
    try {
        const result = await pool.query(`
            SELECT id, order_number, status, subtotal, shipping_cost, total,
                   shipping_first_name, shipping_last_name, shipping_address,
                   shipping_city, shipping_state, shipping_zip, shipping_country,
                   tracking_number, shipping_carrier, COALESCE(items, '[]'::jsonb) AS items,
                   created_at, updated_at
            FROM orders
            WHERE id = $1 AND user_id = $2
        `, [id, req.user.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Order not found.' });
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Customer order detail error:', error.message);
        res.status(500).json({ error: 'Unable to load this order.' });
    }
});

app.get('/api/user/stats', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.created_at AS member_since,
                   COUNT(o.id) FILTER (WHERE o.status NOT IN ('abandoned', 'checkout_failed'))::integer AS total_orders,
                   COALESCE(SUM(o.total) FILTER (
                       WHERE o.status NOT IN ('pending', 'pending_payment', 'abandoned', 'cancelled')
                   ), 0)::numeric AS total_spent
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id AND o.status NOT IN ('abandoned', 'checkout_failed')
            WHERE u.id = $1
            GROUP BY u.id, u.created_at
        `, [req.user.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Account not found.' });
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({
            totalOrders: result.rows[0].total_orders,
            totalSpent: Number(result.rows[0].total_spent),
            memberSince: result.rows[0].member_since
        });
    } catch (error) {
        console.error('Customer statistics error:', error.message);
        res.status(500).json({ error: 'Unable to load your account statistics.' });
    }
});

app.get('/api/user/addresses', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, first_name, last_name, address_line1, address_line2,
                   city, state, zip, country, is_default
            FROM user_addresses
            WHERE user_id = $1
            ORDER BY is_default DESC, id DESC
        `, [req.user.id]);
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(result.rows);
    } catch (error) {
        console.error('Customer address list error:', error.message);
        res.status(500).json({ error: 'Unable to load your saved addresses.' });
    }
});

function normalizeAddress(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Enter a valid address.' };
    const fields = {
        first_name: input.firstName,
        last_name: input.lastName,
        address_line1: input.addressLine1,
        address_line2: input.addressLine2 || '',
        city: input.city,
        state: input.state || '',
        zip: input.zip,
        country: input.country || 'US'
    };
    const limits = {
        first_name: 100, last_name: 100, address_line1: 255, address_line2: 255,
        city: 100, state: 100, zip: 20, country: 100
    };
    for (const [key, value] of Object.entries(fields)) {
        if (typeof value !== 'string' || value.trim().length > limits[key]
            || (['first_name', 'last_name', 'address_line1', 'city', 'zip'].includes(key) && !value.trim()))
            return { error: 'Complete the required address fields and keep each value within its limit.' };
        fields[key] = value.trim();
    }
    return { fields };
}

app.post('/api/user/addresses', requireAuth, async (req, res) => {
    const address = normalizeAddress(req.body);
    if (address.error) return res.status(400).json({ error: address.error });
    const isDefault = req.body.isDefault === true;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        if (isDefault) await client.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [req.user.id]);
        const fields = address.fields;
        const result = await client.query(`
            INSERT INTO user_addresses
                (user_id, first_name, last_name, address_line1, address_line2, city, state, zip, country, is_default)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, first_name, last_name, address_line1, address_line2, city, state, zip, country, is_default
        `, [
            req.user.id, fields.first_name, fields.last_name, fields.address_line1, fields.address_line2,
            fields.city, fields.state, fields.zip, fields.country, isDefault
        ]);
        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Customer address creation error:', error.message);
        res.status(500).json({ error: 'Unable to save this address.' });
    } finally {
        if (client) client.release();
    }
});

app.delete('/api/user/addresses/:id', requireAuth, async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid address ID.' });
    try {
        const result = await pool.query(
            'DELETE FROM user_addresses WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Address not found.' });
        res.json({ ok: true });
    } catch (error) {
        console.error('Customer address deletion error:', error.message);
        res.status(500).json({ error: 'Unable to remove this address.' });
    }
});

app.patch('/api/user/addresses/:id/default', requireAuth, async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid address ID.' });
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const owned = await client.query(
            'SELECT id FROM user_addresses WHERE id = $1 AND user_id = $2 FOR UPDATE',
            [id, req.user.id]
        );
        if (!owned.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Address not found.' });
        }
        await client.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [req.user.id]);
        const result = await client.query(
            'UPDATE user_addresses SET is_default = true WHERE id = $1 AND user_id = $2 RETURNING id, is_default',
            [id, req.user.id]
        );
        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Customer default address error:', error.message);
        res.status(500).json({ error: 'Unable to update your default address.' });
    } finally {
        if (client) client.release();
    }
});

app.put('/api/user/profile', requireAuth, async (req, res) => {
    const body = req.body || {};
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!firstName || firstName.length > 100 || !lastName || lastName.length > 100 || phone.length > 50)
        return res.status(400).json({ error: 'Enter a valid first name, last name, and phone number.' });
    try {
        const result = await pool.query(`
            UPDATE users SET first_name = $1, last_name = $2, phone = $3
            WHERE id = $4
            RETURNING id, email, first_name, last_name, phone, role
        `, [firstName, lastName, phone, req.user.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Account not found.' });
        setAuthCookie(req, res, result.rows[0]);
        res.json({ user: safeUser(result.rows[0]) });
    } catch (error) {
        console.error('Customer profile update error:', error.message);
        res.status(500).json({ error: 'Unable to update your profile.' });
    }
});

app.put('/api/user/password', requireAuth, rateLimit(5, 15 * 60 * 1000), async (req, res) => {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (newPassword.length < 12 || newPassword.length > 128)
        return res.status(400).json({ error: 'Your new password must be between 12 and 128 characters.' });
    try {
        const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Account not found.' });
        if (!await bcrypt.compare(currentPassword, result.rows[0].password_hash))
            return res.status(400).json({ error: 'Your current password is incorrect.' });
        const hash = await bcrypt.hash(newPassword, 12);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
        res.json({ ok: true });
    } catch (error) {
        console.error('Customer password update error:', error.message);
        res.status(500).json({ error: 'Unable to update your password.' });
    }
});

app.get('/api/settings/all', async (req, res) => {
    try {
        const settings = await readSettings(PUBLIC_SETTING_KEYS);
        settings.contact_email = validEmail(settings.contact_email)
            ? settings.contact_email
            : 'shopdavidmyalik@gmail.com';
        res.json(settings);
    }
    catch (error) {
        console.error('Public settings error:', error.message);
        res.status(500).json({ error: 'Unable to load store settings.' });
    }
});

app.get('/api/settings/shipping', async (req, res) => {
    try {
        const settings = await readSettings(['shipping_cost', 'free_shipping_threshold']);
        res.json({
            shippingCost: Number.parseFloat(settings.shipping_cost) || 0,
            freeShippingThreshold: Number.parseFloat(settings.free_shipping_threshold) || 0
        });
    } catch (error) {
        console.error('Shipping settings error:', error.message);
        res.status(500).json({ error: 'Unable to load shipping settings.' });
    }
});

async function getValidDiscount(code, subtotal) {
    if (!code) return { code: '', amount: 0 };
    const result = await pool.query(`
        SELECT code, type, value, min_order_amount, usage_limit, usage_count, expires_at
        FROM discount_codes
        WHERE UPPER(code) = UPPER($1) AND is_active = true
        LIMIT 1
    `, [code]);
    const discount = result.rows[0];
    if (!discount) throw new Error('This discount code is invalid or inactive.');
    if (discount.expires_at && new Date(discount.expires_at).getTime() <= Date.now())
        throw new Error('This discount code has expired.');
    if (discount.usage_limit !== null && Number(discount.usage_count) >= Number(discount.usage_limit))
        throw new Error('This discount code has reached its usage limit.');
    if (subtotal < Number(discount.min_order_amount || 0))
        throw new Error(`This code requires a minimum order of $${Number(discount.min_order_amount).toFixed(2)}.`);
    const value = Number(discount.value);
    if (!Number.isFinite(value) || value <= 0 || !['percentage', 'fixed'].includes(discount.type))
        throw new Error('This discount code is invalid.');
    const amount = discount.type === 'percentage'
        ? subtotal * Math.min(value, 100) / 100
        : Math.min(subtotal, value);
    return { code: discount.code, amount: Math.round(amount * 100) / 100 };
}

function normalizeCheckoutCart(input) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 50)
        return { error: 'Your cart is empty or contains too many items.' };
    const entries = new Map();
    for (const item of input) {
        const id = Number(item && item.id);
        const quantity = Number(item && item.qty);
        const size = item && typeof item.size === 'string' ? item.size.trim() : '';
        if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100)
            return { error: 'Your cart contains an invalid product or quantity.' };
        if (size.length > 20) return { error: 'A selected size is invalid.' };
        const key = `${id}:${size}`;
        const previous = entries.get(key) || { id, quantity: 0, size };
        previous.quantity += quantity;
        if (previous.quantity > 100) return { error: 'A product quantity cannot exceed 100.' };
        entries.set(key, previous);
    }
    return { entries: [...entries.values()] };
}

function normalizeShipping(input) {
    const result = normalizeAddress({
        firstName: input && input.firstName,
        lastName: input && input.lastName,
        addressLine1: input && input.address,
        city: input && input.city,
        state: input && input.state,
        zip: input && input.zip,
        country: input && input.country
    });
    return result;
}

app.post('/api/discounts/validate', rateLimit(20, 15 * 60 * 1000), async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().slice(0, 50) : '';
    const subtotal = Number(req.body?.subtotal);
    if (!code || !Number.isFinite(subtotal) || subtotal < 0 || subtotal > 100000)
        return res.status(400).json({ error: 'Enter a valid discount code and order subtotal.' });
    try {
        const result = await getValidDiscount(code, subtotal);
        const row = await pool.query(
            'SELECT type, value FROM discount_codes WHERE UPPER(code) = UPPER($1) LIMIT 1',
            [result.code]
        );
        res.json({
            code: result.code,
            type: row.rows[0].type,
            value: Number(row.rows[0].value),
            discountAmount: result.amount
        });
    } catch (error) {
        if (error.message.startsWith('This discount') || error.message.startsWith('This code'))
            return res.status(400).json({ error: error.message });
        console.error('Discount validation error:', error.message);
        res.status(500).json({ error: 'Unable to validate this discount code.' });
    }
});

app.post('/api/checkout', rateLimit(10, 15 * 60 * 1000), async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Online checkout is not configured yet. Please try again later.' });
    const cart = normalizeCheckoutCart(req.body && req.body.cart);
    const shipping = normalizeShipping(req.body && req.body.shipping);
    const checkoutEmail = req.user
        ? req.user.email
        : typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (cart.error) return res.status(400).json({ error: cart.error });
    if (shipping.error) return res.status(400).json({ error: shipping.error });
    if (!validEmail(checkoutEmail)) return res.status(400).json({ error: 'Enter a valid email address for order updates.' });
    try {
        const settings = await readSettings([
            'shipping_cost', 'free_shipping_threshold', 'min_order_amount',
            'guest_checkout_enabled', 'allow_backorders'
        ]);
        if (!req.user && settings.guest_checkout_enabled === 'false')
            return res.status(401).json({ error: 'Please sign in before placing an order.' });

        const productIds = [...new Set(cart.entries.map(item => item.id))];
        const productsResult = await pool.query(
            'SELECT id, name, description, price, sale_price, image_url, stock, size_inventory, is_active FROM products WHERE id = ANY($1::int[])',
            [productIds]
        );
        const products = new Map(productsResult.rows.map(product => [product.id, product]));
        const quantityByProduct = new Map();
        for (const item of cart.entries)
            quantityByProduct.set(item.id, (quantityByProduct.get(item.id) || 0) + item.quantity);
        const orderItems = [];
        let subtotalCents = 0;
        for (const item of cart.entries) {
            const product = products.get(item.id);
            if (!product || !product.is_active)
                return res.status(400).json({ error: 'One or more items in your cart are no longer available.' });
            if (settings.allow_backorders !== 'true'
                && Number(product.stock) < quantityByProduct.get(item.id))
                return res.status(409).json({ error: `${product.name} does not have enough stock available.` });
            const inventory = typeof product.size_inventory === 'string'
                ? JSON.parse(product.size_inventory || '{}')
                : product.size_inventory || {};
            if (Object.keys(inventory).length && !item.size)
                return res.status(400).json({ error: `Select a size for ${product.name}.` });
            if (item.size && !Object.prototype.hasOwnProperty.call(inventory, item.size))
                return res.status(400).json({ error: `The selected size for ${product.name} is unavailable.` });
            if (item.size && settings.allow_backorders !== 'true' && Number(inventory[item.size]) < item.quantity)
                return res.status(409).json({ error: `There is not enough stock in size ${item.size} for ${product.name}.` });
            const regularPrice = Number(product.price);
            const salePrice = product.sale_price === null ? null : Number(product.sale_price);
            const price = salePrice !== null && salePrice < regularPrice ? salePrice : regularPrice;
            if (!Number.isFinite(price) || price < 0)
                return res.status(400).json({ error: 'A product in your cart has an invalid price.' });
            const priceCents = Math.round(price * 100);
            subtotalCents += priceCents * item.quantity;
            orderItems.push({
                id: product.id,
                product_name: product.name,
                product_image: product.image_url || '',
                quantity: item.quantity,
                size: item.size,
                price_at_purchase: (priceCents / 100).toFixed(2)
            });
        }
        const subtotal = subtotalCents / 100;
        const minimum = Number(settings.min_order_amount) || 0;
        if (subtotal < minimum) return res.status(400).json({ error: `The minimum order amount is $${minimum.toFixed(2)}.` });
        const freeShippingThreshold = Number(settings.free_shipping_threshold) || 0;
        const shippingCost = freeShippingThreshold > 0 && subtotal >= freeShippingThreshold
            ? 0
            : Math.max(0, Number(settings.shipping_cost) || 0);
        const discountCode = typeof req.body?.discountCode === 'string' ? req.body.discountCode.trim().slice(0, 50) : '';
        const discount = await getValidDiscount(discountCode, subtotal);
        const total = Math.max(0, Math.round((subtotal + shippingCost - discount.amount) * 100) / 100);
        if (total <= 0) return res.status(400).json({ error: 'Order total must be greater than zero.' });
        const prefix = (settings.order_prefix || 'DM').replace(/[^A-Za-z0-9-]/g, '').slice(0, 10) || 'DM';
        const orderNumber = `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const baseUrl = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

        const orderResult = await pool.query(`
            INSERT INTO orders
                (order_number, user_id, status, subtotal, shipping_cost, total, customer_email,
                 shipping_first_name, shipping_last_name, shipping_address, shipping_city,
                 shipping_state, shipping_zip, shipping_country, discount_amount, discount_code, items)
            VALUES ($1, $2, 'pending_payment', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
            RETURNING id
        `, [
            orderNumber, req.user ? req.user.id : null, subtotal, shippingCost, total,
            checkoutEmail,
            shipping.fields.first_name, shipping.fields.last_name, shipping.fields.address_line1,
            shipping.fields.city, shipping.fields.state, shipping.fields.zip, shipping.fields.country,
            discount.amount, discount.code, JSON.stringify(orderItems)
        ]);
        const orderId = orderResult.rows[0].id;
        try {
            const description = orderItems.map(item =>
                `${item.product_name}${item.size ? ` (${item.size})` : ''} × ${item.quantity}`
            ).join(', ').slice(0, 500);
            const session = await stripe.checkout.sessions.create({
                mode: 'payment',
                customer_email: checkoutEmail,
                line_items: [{
                    quantity: 1,
                    price_data: {
                        currency: 'usd',
                        unit_amount: Math.round(total * 100),
                        product_data: { name: `DAVID MYALIK Order ${orderNumber}`, description }
                    }
                }],
                metadata: { order_id: String(orderId) },
                success_url: `${baseUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}#shop`,
                cancel_url: `${baseUrl}/?checkout=cancelled#shop`
            });
            await pool.query('UPDATE orders SET stripe_session_id = $1 WHERE id = $2', [session.id, orderId]);
            res.json({ url: session.url });
        } catch (error) {
            await pool.query("UPDATE orders SET status = 'checkout_failed', updated_at = NOW() WHERE id = $1", [orderId]);
            throw error;
        }
    } catch (error) {
        if (error.message.startsWith('This discount') || error.message.startsWith('This code'))
            return res.status(400).json({ error: error.message });
        console.error('Checkout creation error:', error.message);
        res.status(500).json({ error: 'Unable to start checkout. Please try again.' });
    }
});

app.post('/api/checkout/direct', (req, res) => {
    res.status(503).json({ error: 'Direct unpaid checkout is disabled. Configure Stripe to accept orders securely.' });
});

async function finalizePaidOrder(session, userId = null, fromWebhook = false) {
    if (session.payment_status !== 'paid' || !session.metadata?.order_id)
        throw Object.assign(new Error('Payment has not completed.'), { status: 409 });
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const orderResult = await client.query(
            'SELECT id, user_id, order_number, status, subtotal, shipping_cost, discount_amount, total, items, discount_code FROM orders WHERE id = $1 AND stripe_session_id = $2 FOR UPDATE',
            [session.metadata.order_id, session.id]
        );
        if (!orderResult.rows.length) throw Object.assign(new Error('Order not found.'), { status: 404 });
        const order = orderResult.rows[0];
        if (order.user_id && !fromWebhook && (userId === null || Number(order.user_id) !== Number(userId)))
            throw Object.assign(new Error('Order not found.'), { status: 404 });
        if (Number(session.amount_total) !== Math.round(Number(order.total) * 100)
            || session.currency !== 'usd')
            throw Object.assign(new Error('Payment details do not match this order.'), { status: 409 });
        if (order.status === 'pending_payment') {
            const paidEmail = typeof session.customer_details?.email === 'string'
                ? session.customer_details.email.trim().toLowerCase()
                : '';
            if (paidEmail) {
                await client.query(
                    'UPDATE orders SET customer_email = $1 WHERE id = $2 AND customer_email = $3',
                    [paidEmail, order.id, '']
                );
            }
            const items = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]');
            let inventoryIssue = false;
            for (const item of items) {
                const product = await client.query(
                    'SELECT stock, size_inventory FROM products WHERE id = $1 FOR UPDATE',
                    [item.id]
                );
                if (!product.rows.length || Number(product.rows[0].stock) < Number(item.quantity)) {
                    inventoryIssue = true;
                    continue;
                }
                const inventory = typeof product.rows[0].size_inventory === 'string'
                    ? JSON.parse(product.rows[0].size_inventory || '{}')
                    : product.rows[0].size_inventory || {};
                if (item.size && Number(inventory[item.size]) < Number(item.quantity)) {
                    inventoryIssue = true;
                    continue;
                }
                if (item.size) inventory[item.size] = Number(inventory[item.size]) - Number(item.quantity);
                const totalStock = item.size
                    ? Object.values(inventory).reduce((sum, quantity) => sum + Number(quantity || 0), 0)
                    : Number(product.rows[0].stock) - Number(item.quantity);
                await client.query(
                    'UPDATE products SET stock = $1, size_inventory = $2::jsonb WHERE id = $3',
                    [totalStock, JSON.stringify(inventory), item.id]
                );
            }
            const status = inventoryIssue ? 'paid_stock_issue' : 'processing';
            await client.query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', [status, order.id]);
            if (order.discount_code) {
                await client.query(
                    'UPDATE discount_codes SET usage_count = usage_count + 1 WHERE UPPER(code) = UPPER($1)',
                    [order.discount_code]
                );
            }
            if (order.user_id) {
                await client.query(`
                    INSERT INTO user_addresses
                        (user_id, first_name, last_name, address_line1, city, state, zip, country, is_default)
                    SELECT $1, shipping_first_name, shipping_last_name, shipping_address, shipping_city,
                           shipping_state, shipping_zip, shipping_country,
                           NOT EXISTS (SELECT 1 FROM user_addresses WHERE user_id = $1)
                    FROM orders WHERE id = $2
                      AND NOT EXISTS (
                          SELECT 1 FROM user_addresses
                          WHERE user_id = $1 AND address_line1 = shipping_address
                            AND city = shipping_city AND zip = shipping_zip
                      )
                `, [order.user_id, order.id]);
            }
        }
        await client.query('COMMIT');
        return { id: order.id, order_number: order.order_number };
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        if (client) client.release();
    }
}

app.post('/api/checkout/complete', rateLimit(20, 15 * 60 * 1000), async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Payment verification is not configured.' });
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId))
        return res.status(400).json({ error: 'Invalid checkout session.' });
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const order = await finalizePaidOrder(session, req.user ? req.user.id : null);
        res.json({ order });
    } catch (error) {
        console.error('Checkout payment confirmation error:', error.message);
        res.status(error.status || 500).json({
            error: error.status ? error.message : 'Unable to confirm your payment. Contact support if your payment was completed.'
        });
    }
});

app.post('/api/stripe/webhook', rateLimit(100, 60 * 1000), async (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET)
        return res.status(503).json({ error: 'Payment webhook is not configured.' });
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.rawBody,
            req.headers['stripe-signature'],
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch {
        return res.status(400).json({ error: 'Invalid payment webhook signature.' });
    }
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        try {
            const session = await stripe.checkout.sessions.retrieve(event.data.object.id);
            if (session.payment_status === 'paid') await finalizePaidOrder(session, null, true);
        } catch (error) {
            console.error('Stripe webhook order processing error:', error.message);
            return res.status(500).json({ error: 'Unable to process paid order.' });
        }
    }
    res.json({ received: true });
});

app.get('/api/settings/grind', async (req, res) => {
    try {
        const settings = await readSettings(['grind_title', 'grind_text', 'grind_quote', 'grind_image', 'grind_link_url', 'grind_link_text']);
        res.json({
            title: settings.grind_title || '',
            text: settings.grind_text || '',
            quote: settings.grind_quote || '',
            image: settings.grind_image || '',
            linkUrl: settings.grind_link_url || '',
            linkText: settings.grind_link_text || ''
        });
    } catch (error) {
        console.error('Story settings error:', error.message);
        res.status(500).json({ error: 'Unable to load store content.' });
    }
});

app.get('/api/settings/socials', async (req, res) => {
    try {
        const settings = await readSettings(['socials']);
        let socials = [];
        if (settings.socials) {
            try {
                const parsed = JSON.parse(settings.socials);
                if (Array.isArray(parsed)) {
                    socials = parsed.filter(item => item && typeof item === 'object').map(item => ({
                        name: typeof item.name === 'string' ? item.name.slice(0, 40) : '',
                        icon: typeof item.icon === 'string' ? item.icon.slice(0, 30) : '',
                        enabled: item.enabled === true || item.enabled === 'true',
                        url: typeof item.url === 'string' && /^https:\/\/[^\s]+$/i.test(item.url) ? item.url : ''
                    })).filter(item => item.name && item.url);
                }
            } catch (error) {
                console.error('Invalid social settings JSON:', error.message);
            }
        }
        res.json(socials);
    } catch (error) {
        console.error('Social settings error:', error.message);
        res.status(500).json({ error: 'Unable to load social links.' });
    }
});

app.get('/api/admin/settings', async (req, res) => {
    try { res.json(await readSettings(ADMIN_SETTING_KEYS)); }
    catch (error) {
        console.error('Admin settings error:', error.message);
        res.status(500).json({ error: 'Unable to load settings.' });
    }
});

app.get('/api/admin/stripe-status', (req, res) => {
    const key = process.env.STRIPE_SECRET_KEY || '';
    res.json({
        configured: Boolean(stripe),
        mode: key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : null,
        webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET)
    });
});

app.put('/api/admin/settings/socials', async (req, res) => {
    const allowedIcons = new Set(['youtube', 'instagram', 'twitter', 'discord', 'tiktok', 'facebook']);
    const socials = req.body && req.body.socials;
    if (!Array.isArray(socials) || socials.length > 20)
        return res.status(400).json({ error: 'Provide a list of up to 20 social links.' });
    const normalized = [];
    for (const item of socials) {
        if (!item || typeof item !== 'object' || Array.isArray(item)
            || typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 40
            || typeof item.icon !== 'string' || !allowedIcons.has(item.icon)
            || typeof item.url !== 'string' || item.url.length > 500
            || (item.enabled !== true && item.enabled !== false)) {
            return res.status(400).json({ error: 'One or more social links are invalid.' });
        }
        let url = '';
        if (item.url.trim()) {
            try {
                const parsed = new URL(item.url.trim());
                if (parsed.protocol !== 'https:') throw new Error('Use secure HTTPS links.');
                url = parsed.href;
            } catch {
                return res.status(400).json({ error: 'Social links must be valid HTTPS URLs.' });
            }
        }
        normalized.push({ name: item.name.trim(), icon: item.icon, url, enabled: item.enabled });
    }
    try {
        await pool.query(
            `INSERT INTO settings (key, value, updated_at) VALUES ('socials', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [JSON.stringify(normalized)]
        );
        await adminLog(req, 'update_socials', `Updated ${normalized.length} social link(s)`);
        res.json({ ok: true });
    } catch (error) {
        console.error('Save social links error:', error.message);
        res.status(500).json({ error: 'Unable to save social links.' });
    }
});

app.put('/api/admin/settings/grind', async (req, res) => {
    const body = req.body || {};
    const fields = {
        grind_title: [body.title, 100],
        grind_text: [body.text, 10000],
        grind_quote: [body.quote, 1000],
        grind_image: [body.image, 500],
        grind_link_url: [body.linkUrl, 500],
        grind_link_text: [body.linkText, 80]
    };
    for (const [value, max] of Object.values(fields)) {
        if (typeof value !== 'string' || value.length > max)
            return res.status(400).json({ error: 'One or more story section fields are invalid or too long.' });
    }
    const image = body.image.trim();
    const link = body.linkUrl.trim();
    const safeLocalOrHttps = value => !value
        || (/^\/(?!\/)[^\s\\]*$/.test(value))
        || /^https:\/\/[^\s]+$/i.test(value);
    if (!safeLocalOrHttps(image) || !safeLocalOrHttps(link))
        return res.status(400).json({ error: 'Story links and images must use HTTPS or a local site path.' });
    try {
        for (const [key, [value]] of Object.entries(fields)) {
            await pool.query(
                'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
                [key, value.trim()]
            );
        }
        await adminLog(req, 'update_story_section', 'Updated the storefront story section');
        res.json({ ok: true });
    } catch (error) {
        console.error('Save story section error:', error.message);
        res.status(500).json({ error: 'Unable to save the story section.' });
    }
});

app.get('/api/admin/reviews', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, reviewer_name, reviewer_location, rating, review_text, is_approved, created_at FROM product_reviews ORDER BY created_at DESC, id DESC');
        res.setHeader('Cache-Control', 'no-store');
        res.json(result.rows);
    } catch (error) {
        console.error('Admin reviews error:', error.message);
        res.status(500).json({ error: 'Unable to load reviews.' });
    }
});

function normalizeReview(input) {
    const body = input || {};
    const name = typeof body.reviewer_name === 'string' ? body.reviewer_name.trim() : '';
    const location = typeof body.reviewer_location === 'string' ? body.reviewer_location.trim() : '';
    const text = typeof body.review_text === 'string' ? body.review_text.trim() : '';
    const rating = Number(body.rating);
    if (!name || name.length > 255 || location.length > 255 || !text || text.length > 5000
        || !Number.isInteger(rating) || rating < 1 || rating > 5
        || typeof body.is_approved !== 'boolean') return null;
    return [name, location, rating, text, body.is_approved];
}

app.post('/api/admin/reviews', async (req, res) => {
    const review = normalizeReview(req.body);
    if (!review) return res.status(400).json({ error: 'Enter a valid name, review, and 1–5 star rating.' });
    try {
        const result = await pool.query(`
            INSERT INTO product_reviews (reviewer_name, reviewer_location, rating, review_text, is_approved)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, reviewer_name, reviewer_location, rating, review_text, is_approved, created_at
        `, review);
        await adminLog(req, 'review_created', `Created review ID ${result.rows[0].id}`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Admin review creation error:', error.message);
        res.status(500).json({ error: 'Unable to save this review.' });
    }
});

app.put('/api/admin/reviews/:id', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const review = normalizeReview(req.body);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid review ID.' });
    if (!review) return res.status(400).json({ error: 'Enter a valid name, review, and 1–5 star rating.' });
    try {
        const result = await pool.query(`
            UPDATE product_reviews
            SET reviewer_name = $1, reviewer_location = $2, rating = $3, review_text = $4, is_approved = $5
            WHERE id = $6
            RETURNING id, reviewer_name, reviewer_location, rating, review_text, is_approved, created_at
        `, [...review, id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Review not found.' });
        await adminLog(req, 'review_updated', `Updated review ID ${id}`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin review update error:', error.message);
        res.status(500).json({ error: 'Unable to update this review.' });
    }
});

app.delete('/api/admin/reviews/:id', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid review ID.' });
    try {
        const result = await pool.query('DELETE FROM product_reviews WHERE id = $1 RETURNING id', [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Review not found.' });
        await adminLog(req, 'review_deleted', `Deleted review ID ${id}`);
        res.json({ ok: true });
    } catch (error) {
        console.error('Admin review deletion error:', error.message);
        res.status(500).json({ error: 'Unable to delete this review.' });
    }
});

app.get('/api/admin/contact-submissions', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, email, subject, message, order_number, status, created_at FROM contact_submissions ORDER BY created_at DESC, id DESC LIMIT 500');
        res.setHeader('Cache-Control', 'no-store');
        res.json(result.rows);
    } catch (error) {
        console.error('Admin contact list error:', error.message);
        res.status(500).json({ error: 'Unable to load contact submissions.' });
    }
});

app.put('/api/admin/contact-submissions/:id/status', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const status = req.body && req.body.status;
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid submission ID.' });
    if (!['new', 'read', 'replied'].includes(status)) return res.status(400).json({ error: 'Invalid contact status.' });
    try {
        const result = await pool.query(
            'UPDATE contact_submissions SET status = $1 WHERE id = $2 RETURNING id, status',
            [status, id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Contact submission not found.' });
        await adminLog(req, 'contact_status_updated', `Updated contact submission ${id} to ${status}`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin contact status error:', error.message);
        res.status(500).json({ error: 'Unable to update contact status.' });
    }
});

app.get('/api/admin/discounts', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, code, type, value, min_order_amount, usage_limit, usage_count, is_active, expires_at, created_at FROM discount_codes ORDER BY created_at DESC, id DESC'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Admin discounts error:', error.message);
        res.status(500).json({ error: 'Unable to load discount codes.' });
    }
});

app.post('/api/admin/discounts', async (req, res) => {
    const body = req.body || {};
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const type = body.type;
    const value = Number(body.value);
    const minOrderAmount = body.minOrderAmount === undefined ? 0 : Number(body.minOrderAmount);
    const usageLimit = body.usageLimit === null || body.usageLimit === undefined || body.usageLimit === ''
        ? null : Number(body.usageLimit);
    const expiresAt = body.expiresAt || null;
    if (!/^[A-Z0-9_-]{3,50}$/.test(code) || !['percentage', 'fixed'].includes(type)
        || !Number.isFinite(value) || value <= 0 || value > (type === 'percentage' ? 100 : 100000)
        || !Number.isFinite(minOrderAmount) || minOrderAmount < 0 || minOrderAmount > 100000
        || (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1 || usageLimit > 10000000))
        || (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()))
        || (body.isActive !== undefined && typeof body.isActive !== 'boolean')) {
        return res.status(400).json({ error: 'Check the discount code, type, value, minimum order, usage limit, and expiration date.' });
    }
    try {
        const result = await pool.query(`
            INSERT INTO discount_codes (code, type, value, min_order_amount, usage_limit, is_active, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, code, type, value, min_order_amount, usage_limit, usage_count, is_active, expires_at, created_at
        `, [code, type, value, minOrderAmount, usageLimit, body.isActive !== false, expiresAt]);
        await adminLog(req, 'discount_created', `Created discount code ${code}`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'That discount code already exists.' });
        console.error('Admin discount creation error:', error.message);
        res.status(500).json({ error: 'Unable to create the discount code.' });
    }
});

app.patch('/api/admin/discounts/:id/toggle', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid discount ID.' });
    try {
        const result = await pool.query(
            'UPDATE discount_codes SET is_active = NOT is_active WHERE id = $1 RETURNING id, code, is_active',
            [id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Discount code not found.' });
        await adminLog(req, 'discount_toggled', `Changed discount code ${result.rows[0].code} active status`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin discount toggle error:', error.message);
        res.status(500).json({ error: 'Unable to change the discount status.' });
    }
});

app.delete('/api/admin/discounts/:id', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid discount ID.' });
    try {
        const result = await pool.query('DELETE FROM discount_codes WHERE id = $1 RETURNING code', [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Discount code not found.' });
        await adminLog(req, 'discount_deleted', `Deleted discount code ${result.rows[0].code}`);
        res.json({ ok: true });
    } catch (error) {
        console.error('Admin discount deletion error:', error.message);
        res.status(500).json({ error: 'Unable to delete the discount code.' });
    }
});

app.put('/api/admin/orders/:id/status', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const body = req.body || {};
    const allowedStatuses = new Set(['pending', 'processing', 'shipped', 'delivered', 'cancelled']);
    const allowedCarriers = new Set(['', 'usps', 'ups', 'fedex', 'dhl', 'other']);
    const status = typeof body.status === 'string' ? body.status : '';
    const trackingNumber = typeof body.trackingNumber === 'string' ? body.trackingNumber.trim() : '';
    const shippingCarrier = typeof body.shippingCarrier === 'string' ? body.shippingCarrier : '';
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid order ID.' });
    if (!allowedStatuses.has(status) || !allowedCarriers.has(shippingCarrier)
        || trackingNumber.length > 200 || (trackingNumber && !shippingCarrier)) {
        return res.status(400).json({ error: 'Check the order status, carrier, and tracking number.' });
    }
    try {
        const result = await pool.query(`
            UPDATE orders
            SET status = $1, tracking_number = $2, shipping_carrier = $3, updated_at = NOW()
            WHERE id = $4
            RETURNING id, order_number, status, tracking_number, shipping_carrier
        `, [status, trackingNumber, shippingCarrier, id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Order not found.' });
        await adminLog(req, 'update_order', `Updated order ${result.rows[0].order_number} to ${status}`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin order update error:', error.message);
        res.status(500).json({ error: 'Unable to update this order.' });
    }
});

app.delete('/api/admin/orders/:id', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid order ID.' });
    try {
        const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING order_number', [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Order not found.' });
        await adminLog(req, 'delete_order', `Deleted order ${result.rows[0].order_number}`);
        res.json({ ok: true });
    } catch (error) {
        console.error('Admin order deletion error:', error.message);
        res.status(500).json({ error: 'Unable to delete this order.' });
    }
});

app.get('/api/admin/categories', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT category, categories FROM products'
        );
        const categories = new Set();
        for (const row of result.rows) {
            if (row.category) categories.add(row.category);
            const values = Array.isArray(row.categories) ? row.categories : [];
            values.forEach(category => {
                if (typeof category === 'string' && category.trim()) categories.add(category.trim());
            });
        }
        DEFAULT_PRODUCT_CATEGORIES.forEach(category => categories.add(category));
        res.json([...categories].sort((a, b) => a.localeCompare(b)));
    } catch (error) {
        console.error('Admin categories error:', error.message);
        res.status(500).json({ error: 'Unable to load product categories.' });
    }
});

app.get('/api/admin/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY created_at DESC, id DESC');
        res.json(result.rows);
    } catch (error) {
        console.error('Admin products error:', error.message);
        res.status(500).json({ error: 'Unable to load products. Check the database schema and server logs.' });
    }
});

app.get('/api/admin/products/:id', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid product ID.' });
    try {
        const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin product details error:', error.message);
        res.status(500).json({ error: 'Unable to load product details.' });
    }
});

app.post('/api/admin/products', async (req, res) => {
    const product = normalizeProduct(req.body);
    if (product.error) return res.status(400).json({ error: product.error });
    try {
        const result = await pool.query(`
            INSERT INTO products
                (name, description, price, sale_price, image_url, category, product_type, stock, categories, product_images, size_inventory, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12)
            RETURNING *
        `, product.values);
        await adminLog(req, 'product_created', `Created product ${result.rows[0].name} (ID ${result.rows[0].id})`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Admin product creation error:', error.message);
        res.status(500).json({ error: 'Unable to create product.' });
    }
});

app.put('/api/admin/products/:id', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid product ID.' });
    const product = normalizeProduct(req.body);
    if (product.error) return res.status(400).json({ error: product.error });
    try {
        const result = await pool.query(`
            UPDATE products
            SET name = $1, description = $2, price = $3, sale_price = $4, image_url = $5,
                category = $6, product_type = $7, stock = $8, categories = $9::jsonb, product_images = $10::jsonb,
                size_inventory = $11::jsonb, is_active = $12
            WHERE id = $13
            RETURNING *
        `, [...product.values, id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });
        await adminLog(req, 'product_updated', `Updated product ${result.rows[0].name} (ID ${id})`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin product update error:', error.message);
        res.status(500).json({ error: 'Unable to update product.' });
    }
});

app.delete('/api/admin/products/:id', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid product ID.' });
    try {
        const result = await pool.query('UPDATE products SET is_active = false WHERE id = $1 RETURNING name', [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });
        await adminLog(req, 'product_deactivated', `Deactivated product ${result.rows[0].name} (ID ${id})`);
        res.json({ ok: true });
    } catch (error) {
        console.error('Admin product deactivation error:', error.message);
        res.status(500).json({ error: 'Unable to deactivate product.' });
    }
});

app.delete('/api/admin/products/:id/permanent', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid product ID.' });
    try {
        const linkedOrder = await pool.query(`
            SELECT 1
            FROM orders o
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END
            ) AS item
            WHERE item->>'id' = $1
            LIMIT 1
        `, [String(id)]);
        if (linkedOrder.rows.length)
            return res.status(409).json({ error: 'Products included in existing orders cannot be permanently deleted.' });
        const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING name', [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });
        await adminLog(req, 'product_deleted', `Permanently deleted product ${result.rows[0].name} (ID ${id})`);
        res.json({ ok: true });
    } catch (error) {
        console.error('Admin product deletion error:', error.message);
        res.status(500).json({ error: 'Unable to permanently delete product.' });
    }
});

app.patch('/api/admin/products/:id/reactivate', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid product ID.' });
    try {
        const result = await pool.query('UPDATE products SET is_active = true WHERE id = $1 RETURNING name', [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });
        await adminLog(req, 'product_reactivated', `Reactivated product ${result.rows[0].name} (ID ${id})`);
        res.json({ ok: true });
    } catch (error) {
        console.error('Admin product reactivation error:', error.message);
        res.status(500).json({ error: 'Unable to reactivate product.' });
    }
});

app.post('/api/admin/products/:id/duplicate', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid product ID.' });
    try {
        const result = await pool.query(`
            INSERT INTO products
                (name, description, price, sale_price, image_url, category, product_type, stock, categories, product_images, size_inventory, is_active)
            SELECT name || ' (Copy)', description, price, sale_price, image_url, category, product_type,
                   0, categories, product_images, '{}'::jsonb, false
            FROM products
            WHERE id = $1
            RETURNING *
        `, [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });
        await adminLog(req, 'product_duplicated', `Duplicated product ${id} as ID ${result.rows[0].id}`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Admin product duplication error:', error.message);
        res.status(500).json({ error: 'Unable to duplicate product.' });
    }
});

app.patch('/api/admin/products/:id/stock', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const stock = Number(req.body && req.body.stock);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid product ID.' });
    if (!Number.isInteger(stock) || stock < 0) return res.status(400).json({ error: 'Stock must be a non-negative whole number.' });
    try {
        const result = await pool.query('UPDATE products SET stock = $1 WHERE id = $2 RETURNING id, stock', [stock, id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });
        await adminLog(req, 'product_stock_updated', `Updated stock for product ID ${id} to ${stock}`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Admin product stock error:', error.message);
        res.status(500).json({ error: 'Unable to update product stock.' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, email, first_name, last_name, role, created_at
            FROM users
            ORDER BY created_at DESC, id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Admin users error:', error.message);
        res.status(500).json({ error: 'Unable to load users. Check the database schema and server logs.' });
    }
});

app.get('/api/admin/users/:id', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid user ID.' });
    try {
        const [userResult, addressResult, orderResult] = await Promise.all([
            pool.query(
                'SELECT id, email, first_name, last_name, phone, role, created_at FROM users WHERE id = $1',
                [id]
            ),
            pool.query(
                'SELECT first_name, last_name, address_line1, address_line2, city, state, zip, country FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, id DESC',
                [id]
            ),
            pool.query(
                'SELECT id, order_number, status, total, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
                [id]
            )
        ]);
        if (!userResult.rows.length) return res.status(404).json({ error: 'User not found.' });
        res.json({ user: userResult.rows[0], addresses: addressResult.rows, orders: orderResult.rows });
    } catch (error) {
        console.error('Admin user detail error:', error.message);
        res.status(500).json({ error: 'Unable to load user details.' });
    }
});

app.get('/api/admin/logs', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, user_name, action, details, created_at FROM admin_logs ORDER BY created_at DESC, id DESC LIMIT 200'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Admin activity log error:', error.message);
        res.status(500).json({ error: 'Unable to load activity.' });
    }
});

app.get('/api/admin/orders', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.id, o.order_number, o.user_id, o.status, o.subtotal, o.shipping_cost,
                   o.total, o.shipping_first_name, o.shipping_last_name, o.shipping_address,
                   o.shipping_city, o.shipping_state, o.shipping_zip, o.shipping_country,
                   o.tracking_number, o.shipping_carrier,
                   COALESCE(o.items, '[]'::jsonb) AS items, o.created_at, o.updated_at,
                   COALESCE(u.email, o.customer_email) AS user_email,
                   u.first_name AS user_first_name, u.last_name AS user_last_name
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            ORDER BY o.created_at DESC, o.id DESC
        `);
        res.setHeader('Cache-Control', 'no-store');
        res.json(result.rows);
    } catch (error) {
        console.error('Admin orders error:', error.message);
        res.status(500).json({ error: 'Unable to load orders. Check the database schema and server logs.' });
    }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const settings = await readSettings(['low_stock_threshold']);
        const lowStockThreshold = Number.parseInt(settings.low_stock_threshold, 10) || 5;
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*)::integer FROM orders) AS total_orders,
                (SELECT COUNT(*)::integer FROM users) AS total_users,
                (SELECT COUNT(*)::integer FROM products) AS total_products,
                (SELECT COUNT(*)::integer FROM orders WHERE status = 'pending') AS pending_orders,
                (SELECT COUNT(*)::integer FROM users WHERE created_at >= date_trunc('month', NOW())) AS new_users_this_month,
                (SELECT COALESCE(SUM(total), 0)::numeric FROM orders
                    WHERE status NOT IN ('pending', 'pending_payment', 'abandoned', 'cancelled', 'checkout_failed')) AS total_revenue,
                (SELECT COALESCE(SUM(total), 0)::numeric FROM orders
                    WHERE status NOT IN ('pending', 'pending_payment', 'abandoned', 'cancelled', 'checkout_failed')
                    AND created_at >= date_trunc('month', NOW())) AS monthly_revenue,
                (SELECT COUNT(*)::integer FROM products
                    WHERE is_active = true AND stock > 0 AND stock <= $1) AS low_stock_count
        `, [lowStockThreshold]);
        const row = result.rows[0];
        res.json({
            totalOrders: row.total_orders,
            totalUsers: row.total_users,
            totalProducts: row.total_products,
            pendingOrders: row.pending_orders,
            newUsersThisMonth: row.new_users_this_month,
            totalRevenue: Number(row.total_revenue),
            monthlyRevenue: Number(row.monthly_revenue),
            lowStockCount: row.low_stock_count
        });
    } catch (error) {
        console.error('Admin statistics error:', error.message);
        res.status(500).json({ error: 'Unable to load dashboard statistics.' });
    }
});

app.get('/api/admin/stats/revenue-chart', async (req, res) => {
    const requestedDays = Number.parseInt(req.query.days, 10) || 30;
    const days = Math.min(Math.max(requestedDays, 1), 365);
    try {
        const result = await pool.query(`
            SELECT series.day::date AS date,
                   COALESCE(SUM(o.total), 0)::numeric AS revenue,
                   COUNT(o.id)::integer AS orders
            FROM generate_series(
                CURRENT_DATE - ($1::integer - 1),
                CURRENT_DATE,
                INTERVAL '1 day'
            ) AS series(day)
            LEFT JOIN orders o
                ON o.created_at::date = series.day::date
                AND o.status NOT IN ('pending', 'pending_payment', 'abandoned', 'cancelled', 'checkout_failed')
            GROUP BY series.day
            ORDER BY series.day
        `, [days]);
        res.setHeader('Cache-Control', 'no-store');
        res.json(result.rows.map(row => ({
            date: row.date.toISOString().slice(0, 10),
            revenue: Number(row.revenue),
            orders: row.orders
        })));
    } catch (error) {
        console.error('Admin revenue chart error:', error.message);
        res.status(500).json({ error: 'Unable to load revenue data.' });
    }
});

app.get('/api/admin/stats/top-products', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT item->>'id' AS product_id,
                   item->>'product_name' AS name,
                   item->>'product_image' AS image,
                   SUM(COALESCE((item->>'quantity')::integer, 0))::integer AS total_qty,
                   SUM(COALESCE((item->>'quantity')::numeric, 0)
                       * COALESCE((item->>'price_at_purchase')::numeric, 0)) AS total_revenue
            FROM orders o
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.items, '[]'::jsonb)) AS item
            WHERE o.status NOT IN ('pending', 'pending_payment', 'abandoned', 'cancelled', 'checkout_failed')
              AND item->>'id' IS NOT NULL
            GROUP BY item->>'id', item->>'product_name', item->>'product_image'
            ORDER BY total_qty DESC
            LIMIT 5
        `);
        res.setHeader('Cache-Control', 'no-store');
        res.json(result.rows);
    } catch (error) {
        console.error('Admin top products error:', error.message);
        res.status(500).json({ error: 'Unable to load top products.' });
    }
});

app.put('/api/admin/settings/bulk', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Settings storage is unavailable.' });
    const settings = req.body && req.body.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings))
        return res.status(400).json({ error: 'Provide settings to save.' });
    const entries = Object.entries(settings);
    if (!entries.length || entries.some(([key, value]) =>
        !ADMIN_SETTING_KEYS.includes(key) || key === 'smtp_pass'
        || (typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number')
        || String(value).length > 10000)) {
        return res.status(400).json({ error: 'One or more settings are not allowed or are too long.' });
    }
    try {
        for (const [key, value] of entries) {
            await pool.query(
                'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
                [key, String(value)]
            );
        }
        await adminLog(req, 'update_settings', `Updated ${entries.length} store setting(s)`);
        res.json({ ok: true });
    } catch (error) {
        console.error('Save settings error:', error.message);
        res.status(500).json({ error: 'Unable to save settings.' });
    }
});

app.post('/api/admin/email/test', async (req, res) => {
    try {
        const settings = await getSmtpSettings();
        const recipient = settings.admin_notification_email || process.env.SMTP_USER;
        if (!recipient) return res.status(503).json({ error: 'Set SMTP_USER or an admin notification email first.' });
        const sent = await sendEmail({
            to: recipient,
            subject: 'Store email test',
            text: 'Your store email settings are working.'
        });
        if (!sent) return res.status(503).json({ error: 'Email could not be sent. Check the email setup and server logs.' });
        res.json({ ok: true });
    } catch (error) {
        console.error('Test email error:', error.message);
        res.status(500).json({ error: 'Unable to send a test email right now.' });
    }
});

app.post('/api/contact', rateLimit(5, 15 * 60 * 1000), async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'The contact form is temporarily unavailable. Please email us directly.' });
    const { name, email, subject, message, orderNumber } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 255
        || !validEmail(email) || typeof message !== 'string' || !message.trim() || message.trim().length > 10000
        || (subject !== undefined && (typeof subject !== 'string' || subject.length > 500))
        || (orderNumber !== undefined && (typeof orderNumber !== 'string' || orderNumber.length > 100))) {
        return res.status(400).json({ error: 'Please check the name, email, and message fields.' });
    }
    try {
        const safeSubject = (subject || 'General question').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
        const saved = await pool.query(
            'INSERT INTO contact_submissions (name, email, subject, message, order_number) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [name.trim(), email.trim().toLowerCase(), (subject || '').trim(), message.trim(), (orderNumber || '').trim()]
        );
        const settings = await getSmtpSettings();
        const recipient = process.env.CONTACT_FORM_EMAIL || settings.contact_form_email || settings.smtp_user;
        if (!recipient || !await sendEmail({
            to: recipient,
            subject: `New contact form message: ${safeSubject}`,
            replyTo: email.trim().toLowerCase(),
            text: `From: ${name.trim()} <${email.trim()}>\nOrder number: ${(orderNumber || 'Not provided').trim()}\n\n${message.trim()}`
        })) {
            console.error(`Contact submission ${saved.rows[0].id} saved but notification email was not sent.`);
            return res.status(503).json({ error: 'Your message was saved, but email delivery is not configured. Please use the contact email shown on this site.' });
        }
        const template = settings.email_contact_auto_reply_body;
        if (settings.email_contact_auto_reply_enabled === 'true' && template) {
            const reply = template
                .replace(/\{\{customer_name\}\}/g, name.trim())
                .replace(/\{\{subject\}\}/g, (subject || '').trim());
            await sendEmail({
                to: email.trim(),
                subject: settings.email_contact_auto_reply_subject || 'We received your message',
                text: reply
            });
        }
        res.status(201).json({ ok: true });
    } catch (error) {
        console.error('Contact form error:', error.message);
        res.status(500).json({ error: 'Unable to send your message right now.' });
    }
});

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
    const keys = [
        'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from_name',
        'smtp_from_email', 'contact_form_email', 'admin_notification_email',
        'email_contact_auto_reply_enabled', 'email_contact_auto_reply_subject',
        'email_contact_auto_reply_body'
    ];
    const s = await readSettings(keys);
    s.smtp_host = process.env.SMTP_HOST || s.smtp_host || 'smtp.gmail.com';
    s.smtp_port = process.env.SMTP_PORT || s.smtp_port || '587';
    s.smtp_secure = process.env.SMTP_SECURE || s.smtp_secure || 'false';
    s.smtp_user = process.env.SMTP_USER || s.smtp_user || '';
    s.smtp_pass = process.env.SMTP_PASS || '';
    s.smtp_from_name = process.env.SMTP_FROM_NAME || s.smtp_from_name || 'David Myalik Store';
    s.smtp_from_email = process.env.SMTP_FROM_EMAIL || s.smtp_from_email || s.smtp_user;
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
async function sendEmail({ to, subject, text, html, replyTo }) {
    try {
        const s = await getSmtpSettings();
        const transporter = buildTransporter(s);
        if (!transporter) return false;
        await transporter.sendMail({
            from: `"${s.smtp_from_name || 'David Myalik Store'}" <${s.smtp_from_email || s.smtp_user}>`,
            to, subject, text, replyTo,
            html: html || `<pre style="font-family:sans-serif;white-space:pre-wrap;">${escapeHtml(text)}</pre>`
        });
        return true;
    } catch (e) { console.error('Email send error:', e && e.message); return false; }
}

// ─── SIMPLE ROUTES USED BY FRONTEND ──────────────────────────────────────
async function serveAdminPage(req, res, next) {
    if (!req.user || !ADMIN_ROLES.has(req.user.role))
        return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    if (!pool) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    try {
        await initializeDatabase();
        const result = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
        if (!result.rows.length || !ADMIN_ROLES.has(result.rows[0].role))
            return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    } catch (error) {
        console.error('Admin page authorization error:', error.message);
        return res.status(503).sendFile(path.join(__dirname, 'public', '500.html'));
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
}
app.get('/admin', serveAdminPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin.html', serveAdminPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
function serveDashboardPage(req, res, next) {
    if (!req.user) return res.redirect('/login');
    res.setHeader('Cache-Control', 'no-store');
    next();
}
app.get('/dashboard', serveDashboardPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/dashboard.html', serveDashboardPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get(['/shop', '/shop.html'], (req, res) => res.redirect(301, '/#shop'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.post('/api/admin/upload', (req, res, next) => {
    upload.single('image')(req, res, error => {
        if (!error) return next();
        return res.status(400).json({ error: error.message || 'Unable to process image upload.' });
    });
}, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
        const id = crypto.randomUUID();
        await pool.query(
            'INSERT INTO uploaded_images (id, content_type, image_data) VALUES ($1, $2, $3)',
            [id, req.file.mimetype, req.file.buffer]
        );
        res.status(201).json({ url: `/api/product-images/${id}` });
    } catch (error) {
        console.error('Product image upload error:', error.message);
        res.status(500).json({ error: 'Unable to save this image. Please try again.' });
    }
});

app.get('/api/product-images/:id', async (req, res) => {
    if (!pool) return res.status(503).end();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id))
        return res.status(404).end();
    try {
        const result = await pool.query(
            'SELECT content_type, image_data FROM uploaded_images WHERE id = $1',
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).end();
        const image = result.rows[0];
        res.setHeader('Content-Type', image.content_type);
        res.setHeader('Content-Length', image.image_data.length);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.end(image.image_data);
    } catch (error) {
        console.error('Product image fetch error:', error.message);
        res.status(500).end();
    }
});

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Provide a lightweight /api/checkout-status to let frontend poll
app.get('/api/checkout-status', requireAdmin, async (req, res) => {
    try {
        const sessionId = req.query.session_id;
        if (!sessionId) return res.json({ status: 'unknown' });
        if (!pool) return res.json({ status: 'unknown' });
        const r = await pool.query('SELECT status FROM orders WHERE stripe_session_id = $1', [sessionId]);
        if (!r.rows.length) return res.json({ status: 'not_found' });
        const order = r.rows[0];
        return res.json({ status: order.status });
    } catch (e) { console.error('checkout-status error', e.message); res.status(500).json({ error: 'server error' }); }
});

// Add a cancel endpoint so frontend can mark a pre-created order as abandoned
app.post('/api/checkout/cancel', requireAdmin, async (req, res) => {
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
        if (!pool) return res.status(503).json({ error: 'Product catalog is temporarily unavailable.' });
        const r = await pool.query(
            'SELECT id, name, description, price, sale_price, image_url, category, categories, product_type, stock, is_active, created_at, product_images, size_inventory FROM products WHERE is_active = true ORDER BY created_at DESC'
        );
        res.json(r.rows);
    } catch (err) {
        console.error('Public products error:', err.message);
        res.status(500).json({ error: 'Unable to load products.' });
    }
});

app.get('/api/reviews', async (req, res) => {
    try {
        if (!pool) return res.status(503).json({ error: 'Reviews are temporarily unavailable.' });
        const result = await pool.query(`
            SELECT reviewer_name, reviewer_location, rating, review_text, created_at
            FROM product_reviews
            WHERE is_approved = true
            ORDER BY created_at DESC, id DESC
            LIMIT 100
        `);
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json(result.rows);
    } catch (error) {
        console.error('Public reviews error:', error.message);
        res.status(500).json({ error: 'Unable to load reviews.' });
    }
});

app.post('/api/newsletter/subscribe', rateLimit(5, 60 * 60 * 1000), async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!pool) return res.status(503).json({ error: 'Newsletter signup is temporarily unavailable.' });
    try {
        await pool.query(`
            INSERT INTO newsletter_subscribers (email, is_active)
            VALUES ($1, true)
            ON CONFLICT (email) DO UPDATE SET is_active = true
        `, [email]);
        res.status(200).json({ ok: true, message: "You're in. Welcome to the culture." });
    } catch (error) {
        console.error('Newsletter subscription error:', error.message);
        res.status(500).json({ error: 'Unable to subscribe right now. Please try again later.' });
    }
});

app.get('/api/order-tracking/:orderNumber', rateLimit(10, 15 * 60 * 1000), async (req, res) => {
    const orderNumber = typeof req.params.orderNumber === 'string' ? req.params.orderNumber.trim().toUpperCase() : '';
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
    if (!orderNumber || orderNumber.length > 50 || !validEmail(email))
        return res.status(400).json({ error: 'Enter a valid order number and email address.' });
    if (!pool) return res.status(503).json({ error: 'Order tracking is temporarily unavailable.' });
    try {
        const result = await pool.query(`
            SELECT o.id, o.order_number, o.status, o.total, o.shipping_first_name,
                   o.shipping_last_name, o.shipping_address, o.shipping_city, o.shipping_state,
                   o.shipping_zip, o.shipping_country, o.tracking_number, o.shipping_carrier,
                   o.created_at, COALESCE(o.items, '[]'::jsonb) AS items
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            WHERE UPPER(o.order_number) = $1
              AND LOWER(COALESCE(NULLIF(o.customer_email, ''), u.email, '')) = $2
              AND o.status NOT IN ('abandoned', 'checkout_failed')
            LIMIT 1
        `, [orderNumber, email]);
        if (!result.rows.length) return res.status(404).json({ error: 'Order not found.' });
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Order tracking error:', error.message);
        res.status(500).json({ error: 'Unable to look up this order.' });
    }
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
    '/terms': 'legal.html',
    '/privacy-policy': 'legal.html',
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
    initializeDatabase().then(() => {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT}`);
        });
    }).catch(err => {
        console.error('DB init failed:', err && err.message);
        process.exit(1);
    });
} else {
    // allow serverless platforms to import the Express app
    initializeDatabase().catch(err => console.error('DB init (import) error:', err && err.message));
    module.exports = app;
}
