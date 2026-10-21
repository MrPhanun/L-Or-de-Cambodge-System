/* Which environment this copy of the site is.
   'development' : first visit loads demo accounts, products and orders (safe to wipe).
   'production'  : first visit shows "Set up your shop" so the owner creates their own admin account; no demo data.
   Each website address (and each browser) keeps its own separate data. */
window.APP_CONFIG = { ENV: 'development' };
