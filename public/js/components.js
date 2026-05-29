async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        return data.user;
    } catch { return null; }
}

function renderNav(currentUser, options = {}) {
    const isStore = options.isStore || false;
    const container = document.getElementById('site-nav');
    if (!container) return;

    let authHTML = '';
    let mobileAuthHTML = '';
    if (currentUser) {
        const dashLink = (currentUser.role === 'admin' || currentUser.role === 'owner') ? '/admin' : '/dashboard';
        const dashLabel = (currentUser.role === 'admin' || currentUser.role === 'owner') ? 'ADMIN' : 'DASHBOARD';
        authHTML = `
            <a href="${dashLink}" class="nav-link">${dashLabel}</a>
            <a href="#" class="nav-link" onclick="doLogout(event)" style="color:#ef4444;">LOGOUT</a>
        `;
        mobileAuthHTML = `<a href="${dashLink}" class="mobile-link" style="font-size:24px;font-family:var(--font-display);text-transform:uppercase;">Dashboard</a>`;
    } else {
        authHTML = `
            <a href="/login" class="nav-link">LOGIN</a>
            <a href="/signup" class="btn btn-primary btn-sm" style="padding:8px 20px;font-size:11px;">SIGN UP</a>
        `;
        mobileAuthHTML = `
            <a href="/login" class="mobile-link" style="font-size:24px;font-family:var(--font-display);text-transform:uppercase;">Login</a>
            <a href="/signup" class="mobile-link" style="font-size:24px;font-family:var(--font-display);text-transform:uppercase;color:var(--primary);">Sign Up</a>
        `;
    }

    const shopHref = isStore ? '#shop' : '/#shop';
    const aboutHref = isStore ? '#about' : '/#about';
    const contactHref = isStore ? '#contact' : '/#contact';

    container.innerHTML = `
        <nav class="nav-auth">
            <div class="nav-auth-inner">
                <a href="/" class="nav-brand">DAVID <span>MYALIK</span></a>
                <div class="nav-links" id="nav-desktop">
                    <a href="${shopHref}" class="nav-link">SHOP</a>
                    <a href="${aboutHref}" class="nav-link">ABOUT</a>
                    <a href="${contactHref}" class="nav-link">CONTACT</a>
                    ${authHTML}
                    ${isStore ? `
                    <button id="cart-btn" style="position:relative;background:none;border:none;color:white;cursor:pointer;" aria-label="Cart">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
                        <span id="cart-count" style="position:absolute;top:-8px;right:-8px;background:var(--primary);font-size:9px;font-weight:900;padding:2px 6px;border-radius:50%;font-family:var(--font-mono);display:none;">0</span>
                    </button>` : ''}
                </div>
                <button class="mobile-menu-toggle" id="mobile-menu-btn" aria-label="Menu">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
            </div>
        </nav>
        <div id="mobile-menu" class="mobile-menu-overlay">
            <button id="close-menu-btn" class="mobile-close-btn">✕</button>
            <a href="${shopHref}" class="mobile-link" style="font-size:48px;font-family:var(--font-display);text-transform:uppercase;">Shop</a>
            <a href="${aboutHref}" class="mobile-link" style="font-size:48px;font-family:var(--font-display);text-transform:uppercase;">About</a>
            <a href="${contactHref}" class="mobile-link" style="font-size:48px;font-family:var(--font-display);text-transform:uppercase;">Contact</a>
            <div style="display:flex;gap:16px;margin-top:16px;">${mobileAuthHTML}</div>
        </div>
    `;

    const menuBtn = document.getElementById('mobile-menu-btn');
    const closeMenuBtn = document.getElementById('close-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    menuBtn.addEventListener('click', () => mobileMenu.classList.add('open'));
    function closeMobileMenu() { mobileMenu.classList.remove('open'); }
    closeMenuBtn.addEventListener('click', closeMobileMenu);
    document.querySelectorAll('.mobile-link').forEach(l => l.addEventListener('click', closeMobileMenu));
}

const SOCIAL_ICONS = {
    youtube: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="var(--navy-light)"/></svg>',
    instagram: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
    twitter: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    discord: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/></svg>',
    tiktok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.48v-7.15a8.16 8.16 0 005.58 2.19v-3.44a4.85 4.85 0 01-2-.59z"/></svg>',
    facebook: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>'
};

async function renderFooter() {
    const container = document.getElementById('site-footer');
    if (!container) return;

    let socials = [];
    try {
        const res = await fetch('/api/settings/socials');
        const data = await res.json();
        if (Array.isArray(data)) socials = data;
    } catch(e) {}

    const enabledSocials = socials.filter(s => s.enabled && s.url);
    const socialIconsHTML = enabledSocials.map(s =>
        `<a href="${s.url.replace(/"/g, '&quot;')}" target="_blank" class="footer-social" aria-label="${s.name.replace(/"/g, '&quot;')}">${SOCIAL_ICONS[s.icon] || ''}</a>`
    ).join('');

    const socialLinksHTML = enabledSocials.slice(0, 3).map(s =>
        `<a href="${s.url.replace(/"/g, '&quot;')}" target="_blank" class="footer-link">${s.name.replace(/</g, '&lt;')}</a>`
    ).join('');

    container.innerHTML = `
        <footer class="site-footer">
            <div class="footer-inner">
                <div class="footer-top">
                    <div>
                        <div class="footer-brand">DAVID <span class="text-red">MYALIK</span></div>
                        <p class="footer-desc">Drift culture apparel for those who live life sideways. Born from the smoke, built for the streets.</p>
                    </div>
                    <div>
                        <div class="footer-col-title">Company</div>
                        <a href="/#about" class="footer-link">About Us</a>
                        <a href="/#contact" class="footer-link">Contact</a>
                        ${socialLinksHTML}
                    </div>
                    <div>
                        <div class="footer-col-title">Support</div>
                        <a href="/help-center" class="footer-link">Help Center</a>
                        <a href="/shipping-info" class="footer-link">Shipping Info</a>
                        <a href="/returns" class="footer-link">Returns & Exchanges</a>
                    </div>
                </div>
                <div class="footer-bottom">
                    <p class="footer-copy">&copy; ${new Date().getFullYear()} Sideways Always. All Rights Reserved.</p>
                    <div class="footer-socials">
                        ${socialIconsHTML}
                    </div>
                </div>
            </div>
        </footer>
    `;
}

async function doLogout(e) {
    if (e) e.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
}

function showToast(msg, type) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
