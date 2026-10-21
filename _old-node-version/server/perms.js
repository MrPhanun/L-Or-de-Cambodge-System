'use strict';

const PERMISSIONS = {
  'pos.sell': 'Use POS checkout', 'orders.view': 'View orders', 'orders.fulfil': 'Update order status',
  'refund.process': 'Refunds & exchanges', 'refund.any': 'Refund beyond the window',
  'inventory.view': 'View stock', 'inventory.edit': 'Adjust stock & purchasing',
  'customers.manage': 'Manage customers', 'appointments.manage': 'Manage appointments',
  'alteration.manage': 'Alteration tickets', 'rental.manage': 'Rental check-out / check-in',
  'tailoring.manage': 'Tailoring management', 'shift.manage': 'Clock-in & cash shifts',
  'performance.view': 'Own performance', 'products.edit': 'Edit products & categories',
  'promos.manage': 'Promotions', 'reports.view': 'Reports', 'audit.view': 'Activity log',
  'staff.manage': 'Manage staff & roles', 'settings.edit': 'Edit settings'
};

const ROLE_PERMS = {
  client: [],
  seller: ['pos.sell', 'orders.view', 'orders.fulfil', 'refund.process', 'inventory.view', 'customers.manage',
    'appointments.manage', 'alteration.manage', 'rental.manage', 'shift.manage', 'performance.view'],
  tailor: ['alteration.manage', 'inventory.view', 'appointments.manage', 'orders.view', 'shift.manage', 'performance.view'],
  manager: ['pos.sell', 'orders.view', 'orders.fulfil', 'refund.process', 'refund.any', 'inventory.view', 'inventory.edit',
    'customers.manage', 'appointments.manage', 'alteration.manage', 'rental.manage', 'tailoring.manage', 'products.edit',
    'promos.manage', 'reports.view', 'audit.view', 'shift.manage', 'performance.view'],
  admin: Object.keys(PERMISSIONS)
};

const ROLES = { client: 1, seller: 2, tailor: 3, manager: 4, admin: 5 };
// Which sign-in tab / view each role belongs to
const VIEW_OF = { client: 'client', seller: 'seller', tailor: 'seller', manager: 'admin', admin: 'admin' };
const HOME_OF = { client: '/client.html', seller: '/seller.html', admin: '/admin.html' };

module.exports = { PERMISSIONS, ROLE_PERMS, ROLES, VIEW_OF, HOME_OF };
