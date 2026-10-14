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
let dbInitialization = null;

// Support Vercel/Neon environment variable names alongside standard DATABASE_URL
const dbUrl = process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL
    || process.env.POSTGRES_URL_NON_POOLING;
if (!dbUrl) { console.error('ERROR: No database URL found. Set DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL.'); /* don't exit here so serverless can still start for static assets */ }
const pool = dbUrl ? new Pool({ connectionString: dbUrl }) : null;

app.use(express.json());
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
            product_images JSONB DEFAULT '[]',
            size_inventory JSONB DEFAULT '{}',
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
    await pool.query(`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS product_images JSONB DEFAULT '[]';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS size_inventory JSONB DEFAULT '{}';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_carrier VARCHAR(50) DEFAULT '';
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
        role: user.role
    };
}

function normalizeProduct(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return { error: 'Provide product details.' };

    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const description = typeof input.description === 'string' ? input.description : '';
    const category = typeof input.category === 'string' ? input.category.trim() : '';
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
    if (description.length > 10000 || category.length > 100 || imageUrl.length > 500)
        return { error: 'One or more product fields are too long.' };
    if (typeof input.isActive !== 'boolean') return { error: 'Product visibility must be selected.' };
    if (!Array.isArray(productImages) || productImages.length > 20
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
            name, description, price, salePrice, imageUrl, category, rawStock,
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
        const key = `${req.method}:${req.path}:${req.ip || req.socket.remoteAddress}`;
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

app.get('/api/settings/all', async (req, res) => {
    try { res.json(await readSettings(PUBLIC_SETTING_KEYS)); }
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

app.get('/api/admin/categories', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category <> '' ORDER BY category"
        );
        res.json(result.rows.map(row => row.category));
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
                (name, description, price, sale_price, image_url, category, stock, product_images, size_inventory, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
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
                category = $6, stock = $7, product_images = $8::jsonb, size_inventory = $9::jsonb,
                is_active = $10
            WHERE id = $11
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
                (name, description, price, sale_price, image_url, category, stock, product_images, size_inventory, is_active)
            SELECT name || ' (Copy)', description, price, sale_price, image_url, category,
                   0, product_images, '{}'::jsonb, false
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
                   u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name
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
                    WHERE status NOT IN ('pending', 'pending_payment', 'abandoned', 'cancelled')) AS total_revenue,
                (SELECT COALESCE(SUM(total), 0)::numeric FROM orders
                    WHERE status NOT IN ('pending', 'pending_payment', 'abandoned', 'cancelled')
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
                AND o.status NOT IN ('pending', 'pending_payment', 'abandoned', 'cancelled')
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
            WHERE o.status NOT IN ('pending', 'pending_payment', 'abandoned', 'cancelled')
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
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));
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
            'SELECT id, name, description, price, sale_price, image_url, category, stock, is_active, created_at, product_images, size_inventory FROM products WHERE is_active = true ORDER BY created_at DESC'
        );
        res.json(r.rows);
    } catch (err) {
        console.error('Public products error:', err.message);
        res.status(500).json({ error: 'Unable to load products.' });
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
