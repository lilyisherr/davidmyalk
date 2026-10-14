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

    const shopHref = isStore ? '#shop' : '/shop.html#shop';
    const aboutHref = isStore ? '#about' : '/#about';
    const contactHref = '/contact';

    container.innerHTML = `
        <nav class="nav-auth">
            <div class="nav-auth-inner">
                <a href="/" class="nav-brand">DAVID <span>MYALIK</span></a>
                <div class="nav-links" id="nav-desktop">
                    <a href="${shopHref}" class="nav-link">SHOP</a>
                    <a href="${aboutHref}" class="nav-link">ABOUT</a>
                    <a href="${contactHref}" class="nav-link">CONTACT</a>
                    <a href="javascript:void(0)" class="nav-link" onclick="document.getElementById('size-guide-modal')&&(document.getElementById('size-guide-modal').style.display='flex')" style="font-family:var(--font-mono);font-size:11px;text-transform:uppercase;letter-spacing:0.12em;">SIZE GUIDE</a>
                    ${authHTML}
                    ${isStore ? `
                    <button id="cart-btn" style="position:relative;background:none;border:none;color:white;cursor:pointer;" aria-label="Cart">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1.5"></circle><circle cx="19" cy="21" r="1.5"></circle><path d="M2.5 3h2l2.4 10.2a1 1 0 0 0 1 .8h9.8a1 1 0 0 0 1-.8L18.5 6H5"></path></svg>
                        <span id="cart-count" style="position:absolute;top:-8px;right:-8px;background:var(--primary);font-size:9px;font-weight:900;padding:2px 6px;border-radius:50%;font-family:var(--font-mono);">0</span>
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
    youtube: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .5 6.186C0 8.07 0 12 0 12s0 3.93.5 5.814a3.016 3.016 0 0 0 2.123 2.136c1.872.505 9.377.505 9.377.505s7.505 0 9.377-.505a3.016 3.016 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    instagram: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
    twitter: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231L18.244 2.25zm-1.16 17.17h1.833L7.084 4.68H5.17l11.914 14.74z"/></svg>',
    discord: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.3732a18.6972 18.6972 0 00-10.6876-.002c-.1636-.5146-.3973-1.004-.6084-1.3794a.0741.0741 0 00-.0786-.0371A19.78 19.78 0 003.683 4.3698a.072.072 0 00-.037.0272C.105 9.1145 0 13.1495 0 17.1548a.0829.0829 0 00.0317.067c2.1688 1.6057 4.2707 2.5583 6.3189 3.1883a.079.079 0 00.0858-.0335c.487-.665 1.053-1.5375 1.444-2.2304a.0739.0739 0 00-.0404-.1047c-.816-.3091-1.564-.7003-2.288-1.1453a.0736.0736 0 01-.0073-.1237c.1537-.1143.3068-.2341.4549-.3563a.0749.0749 0 01.0784-.0122c4.768 2.1795 9.9293 2.1795 14.6846 0a.0749.0749 0 01.0784.0122c.1481.1222.3012.2419.4549.3563a.0736.0736 0 01-.0073.1237c-.7234.445-.4715.8361-2.2879 1.1453a.0739.0739 0 00-.0404.1047c.3919.693 957 1.5655 1.444 2.2304a.079.079 0 00.0858.0335c2.0498-.6301 4.1517-1.5826 6.3189-3.1883a.0829.0829 0 00.0318-.067c0-4.0053-.105-8.0403-3.646-12.7584a.0715.0715 0 00-.037-.0272zm-12.32 14.3633c-1.23 0-2.248-1.1239-2.248-2.5078s1.017-2.5078 2.248-2.5078c1.231 0 2.25 1.1239 2.248 2.5078 0 1.3839-1.017 2.5078-2.248 2.5078zm9.984 0c-1.23 0-2.248-1.1239-2.248-2.5078s1.018-2.5078 2.248-2.5078c1.231 0 2.249 1.1239 2.249 2.5078s-1.018 2.5078-2.249 2.5078z"/></svg>',
    tiktok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.61 0 1.18.19 1.65.52V8.91a6.19 6.19 0 00-1.65-.21A6.16 6.16 0 006.55 15.1 6.16 6.16 0 0012.72 21.3a6.15 6.15 0 005.87-3.85V6.69h.99z"/></svg>',
    facebook: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.952h-1.513c-1.49 0-1.953.925-1.953 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>'
};

async function renderFooter() {
    const container = document.getElementById('site-footer');
    if (!container) return;

    let socials = [];
    try {
        const socialsRes = await fetch('/api/settings/socials');
        const socialsData = await socialsRes.json();
        if (Array.isArray(socialsData)) socials = socialsData;
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
                        <a href="/shop.html" class="footer-link">Shop</a>
                        <a href="/#about" class="footer-link">About Us</a>
                        <a href="/contact" class="footer-link">Contact</a>
                        <a href="/tracking" class="footer-link">Track Order</a>
                        ${socialLinksHTML}
                    </div>
                    <div>
                        <div class="footer-col-title">Support</div>
                        <a href="/contact" class="footer-link">Help Center</a>
                        <a href="/shipping-info" class="footer-link">Shipping Info</a>
                        <a href="javascript:void(0)" onclick="openSizeGuideGlobal()" class="footer-link">Size Guide</a>
                    </div>
                    <div>
                        <div class="footer-col-title">Legal</div>
                        <a href="/privacy-policy" class="footer-link">Privacy Policy</a>
                        <a href="/terms" class="footer-link">Terms of Service</a>
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

const SIZE_GUIDE_MODAL_HTML = `
<div id="size-guide-modal-global" style="display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.92);align-items:center;justify-content:center;padding:16px;" onclick="if(event.target===this){closeSizeGuideGlobal();}">
  <div style="background:var(--navy-light);width:100%;max-width:680px;border:1px solid rgba(255,255,255,0.08);max-height:92vh;overflow-y:auto;position:relative;">
    <div style="padding:24px 32px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:var(--navy-light);z-index:2;">
      <div>
        <h2 style="font-family:'Anton',sans-serif;font-size:26px;margin:0;text-transform:uppercase;">SIZE <span style="color:#FF0000;">GUIDE</span></h2>
        <p style="font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.5);font-size:10px;margin:4px 0 0;letter-spacing:0.12em;">GARMENT MEASUREMENTS · INCHES / CM</p>
      </div>
      <button onclick="closeSizeGuideGlobal()" style="background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:20px;padding:4px 8px;">✕</button>
    </div>
    <div style="padding:32px;">
      <div style="margin-bottom:36px;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.18em;color:#FF0000;margin-bottom:16px;">T-SHIRTS &amp; LONG SLEEVES</div>
        <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-family:'JetBrains Mono',monospace;font-size:12px;">
          <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
            <th style="text-align:left;padding:10px 12px;color:rgba(255,255,255,0.5);font-weight:400;">SIZE</th>
            <th style="text-align:center;padding:10px 12px;color:rgba(255,255,255,0.5);font-weight:400;">CHEST WIDTH*</th>
            <th style="text-align:center;padding:10px 12px;color:rgba(255,255,255,0.5);font-weight:400;">LENGTH</th>
            <th style="text-align:center;padding:10px 12px;color:rgba(255,255,255,0.5);font-weight:400;">SHOULDER</th>
          </tr></thead>
          <tbody>
            <tr><td style="padding:10px 12px;font-weight:700;">XS</td><td style="padding:10px 12px;text-align:center;">17" / 43 cm</td><td style="padding:10px 12px;text-align:center;">26" / 66 cm</td><td style="padding:10px 12px;text-align:center;">16" / 41 cm</td></tr>
            <tr><td style="padding:10px 12px;font-weight:700;">S</td><td style="padding:10px 12px;text-align:center;">18" / 46 cm</td><td style="padding:10px 12px;text-align:center;">27" / 69 cm</td><td style="padding:10px 12px;text-align:center;">17" / 43 cm</td></tr>
            <tr><td style="padding:10px 12px;font-weight:700;">M</td><td style="padding:10px 12px;text-align:center;">20" / 51 cm</td><td style="padding:10px 12px;text-align:center;">28" / 71 cm</td><td style="padding:10px 12px;text-align:center;">18" / 46 cm</td></tr>
            <tr><td style="padding:10px 12px;font-weight:700;">L</td><td style="padding:10px 12px;text-align:center;">22" / 56 cm</td><td style="padding:10px 12px;text-align:center;">29" / 74 cm</td><td style="padding:10px 12px;text-align:center;">20" / 51 cm</td></tr>
            <tr><td style="padding:10px 12px;font-weight:700;">XL</td><td style="padding:10px 12px;text-align:center;">24" / 61 cm</td><td style="padding:10px 12px;text-align:center;">30" / 76 cm</td><td style="padding:10px 12px;text-align:center;">21" / 53 cm</td></tr>
            <tr><td style="padding:10px 12px;font-weight:700;">2XL</td><td style="padding:10px 12px;text-align:center;">26" / 66 cm</td><td style="padding:10px 12px;text-align:center;">31" / 79 cm</td><td style="padding:10px 12px;text-align:center;">23" / 58 cm</td></tr>
          </tbody>
        </table></div>
      </div>
      <div style="margin-bottom:36px;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.18em;color:#FF0000;margin-bottom:16px;">HOODIES &amp; SWEATSHIRTS</div>
        <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-family:'JetBrains Mono',monospace;font-size:12px;">
          <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
            <th style="text-align:left;padding:10px 12px;color:rgba(255,255,255,0.5);font-weight:400;">SIZE</th>
            <th style="text-align:center;padding:10px 12px;color:rgba(255,255,255,0.5);font-weight:400;">CHEST WIDTH*</th>
            <th style="text-align:center;padding:10px 12px;color:rgba(255,255,255,0.5);font-weight:400;">LENGTH</th>
            <th style="text-align:center;padding:10px 12px;color:rgba(255,255,255,0.5);font-weight:400;">SLEEVE</th>
          </tr></thead>
          <tbody>
            <tr><td style="padding:10px 12px;font-weight:700;">XS</td><td style="padding:10px 12px;text-align:center;">18" / 46 cm</td><td style="padding:10px 12px;text-align:center;">25" / 64 cm</td><td style="padding:10px 12px;text-align:center;">32" / 81 cm</td></tr>
            <tr><td style="padding:10px 12px;font-weight:700;">S</td><td style="padding:10px 12px;text-align:center;">19" / 48 cm</td><td style="padding:10px 12px;text-align:center;">26" / 66 cm</td><td style="padding:10px 12px;text-align:center;">33" / 84 cm</td></tr>
            <tr><td style="padding:10px 12px;font-weight:700;">M</td><td style="padding:10px 12px;text-align:center;">21" / 53 cm</td><td style="padding:10px 12px;text-align:center;">27" / 69 cm</td><td style="padding:10px 12px;text-align:center;">34" / 86 cm</td></tr>
            <tr><td style="padding:10px 12px;font-weight:700;">L</td><td style="padding:10px 12px;text-align:center;">23" / 58 cm</td><td style="padding:10px 12px;text-align:center;">28" / 71 cm</td><td style="padding:10px 12px;text-align:center;">35" / 89 cm</td></tr>
            <tr><td style="padding:10px 12px;font-weight:700;">XL</td><td style="padding:10px 12px;text-align:center;">25" / 64 cm</td><td style="padding:10px 12px;text-align:center;">29" / 74 cm</td><td style="padding:10px 12px;text-align:center;">36" / 91 cm</td></tr>
            <tr><td style="padding:10px 12px;font-weight:700;">2XL</td><td style="padding:10px 12px;text-align:center;">27" / 69 cm</td><td style="padding:10px 12px;text-align:center;">30" / 76 cm</td><td style="padding:10px 12px;text-align:center;">37" / 94 cm</td></tr>
          </tbody>
        </table></div>
      </div>
      <div style="padding:16px;background:rgba(255,0,0,0.05);border:1px solid rgba(255,0,0,0.15);">
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.15em;color:#FF0000;margin-bottom:8px;">FIT NOTE</div>
        <p style="font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.5);font-size:11px;line-height:1.7;margin:0;">These are general reference measurements, not manufacturer-verified specs. Garment fit can vary by product and supplier; check a product-specific chart when available and compare with a similar garment you own.</p>
      </div>
      <p style="font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.5);font-size:10px;line-height:1.7;margin:20px 0 0;">*Chest width is measured flat, straight across from armpit seam to armpit seam; it is not body circumference. Body length is measured from the high shoulder point to the hem. Hoodie sleeve is measured from center back neck to cuff.</p>
    </div>
  </div>
</div>`;

function openSizeGuideGlobal() {
    const existing = document.getElementById('size-guide-modal');
    if (existing) { existing.style.display = 'flex'; return; }
    if (!document.getElementById('size-guide-modal-global')) {
        document.body.insertAdjacentHTML('beforeend', SIZE_GUIDE_MODAL_HTML);
    }
    document.getElementById('size-guide-modal-global').style.display = 'flex';
}
function closeSizeGuideGlobal() {
    const m = document.getElementById('size-guide-modal-global');
    if (m) m.style.display = 'none';
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

(function(){
    const fixStyles = document.createElement('style');
    fixStyles.textContent = `
        #size-guide-modal,
        #size-guide-modal-global { z-index: 100000 !important; }
        #checkout-modal { z-index: 100000 !important; }
    `;
    document.head.appendChild(fixStyles);

    function refreshCartPricesAndTotals() {
        if (!Array.isArray(window.cart) || !Array.isArray(window.products)) return;
        const nextCart = window.cart
            .map((item) => {
                const product = window.products.find((p) => String(p.id) === String(item.id || item.productId));
                if (!product || product.is_active === false) return null;
                const price = Number(product.price ?? item.unitPrice ?? 0);
                const qty = Number(item.qty ?? item.quantity ?? 1) || 1;
                return {
                    ...item,
                    id: item.id ?? product.id,
                    productId: item.productId ?? product.id,
                    qty,
                    unitPrice: Number.isFinite(price) ? price : 0,
                    selectedSize: item.selectedSize || item.size || null,
                    lineTotal: Number.isFinite(price) ? price * qty : 0
                };
            })
            .filter(Boolean);

        if (nextCart.length !== window.cart.length || nextCart.some((item, index) => {
            const current = window.cart[index];
            return !current || current.id !== item.id || Number(current.lineTotal || 0) !== Number(item.lineTotal || 0);
        })) {
            window.cart = nextCart;
            if (typeof window.saveCart === 'function') window.saveCart();
            if (typeof window.updateCartUI === 'function') window.updateCartUI();
        }
    }

    function recoverCheckoutButtonState() {
        const btn = document.getElementById('place-order-btn');
        if (!btn) return;
        const label = (btn.textContent || '').trim().toLowerCase();
        if (label.includes('processing') || label.includes('checking')) {
            btn.textContent = 'RESUME PAYMENT';
            btn.disabled = false;
        }
    }

    window.addEventListener('load', () => {
        refreshCartPricesAndTotals();
        recoverCheckoutButtonState();

        if (typeof window.loadCart === 'function') {
            const originalLoadCart = window.loadCart;
            window.loadCart = function () {
                const result = originalLoadCart.apply(this, arguments);
                refreshCartPricesAndTotals();
                return result;
            };
        }

        if (typeof window.saveCart === 'function') {
            const originalSaveCart = window.saveCart;
            window.saveCart = function () {
                const result = originalSaveCart.apply(this, arguments);
                refreshCartPricesAndTotals();
                return result;
            };
        }

        if (typeof window.handleCheckoutReturn === 'function') {
            const originalHandleCheckoutReturn = window.handleCheckoutReturn;
            window.handleCheckoutReturn = async function () {
                try {
                    const btn = document.getElementById('place-order-btn');
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = 'CHECKING ORDER...';
                    }
                    const res = await fetch('/api/checkout-status');
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.status === 'processing') {
                            if (btn) {
                                btn.textContent = 'RESUME PAYMENT';
                                btn.disabled = false;
                            }
                            return;
                        }
                        if (data && data.status === 'paid') {
                            if (btn) {
                                btn.textContent = 'PAID';
                                btn.disabled = true;
                            }
                            return;
                        }
                    }
                } catch (e) {}
                return originalHandleCheckoutReturn.apply(this, arguments);
            };
        } else {
            window.handleCheckoutReturn = async function () {
                const btn = document.getElementById('place-order-btn');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'PLACE ORDER';
                }
                try {
                    const res = await fetch('/api/checkout-status');
                    if (!res.ok) return;
                    const data = await res.json();
                    if (data && data.status === 'processing') {
                        if (btn) {
                            btn.textContent = 'RESUME PAYMENT';
                            btn.disabled = false;
                        }
                        return;
                    }
                    if (data && data.status === 'paid' && btn) {
                        btn.textContent = 'PAID';
                        btn.disabled = true;
                    }
                } catch (e) {}
            };
        }
    });
})();
