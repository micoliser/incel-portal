/**
 * Mirror of the dataset created by `manage.py seed_e2e`
 * (api/accounts/management/commands/seed_e2e.py). Keep the two in step.
 */

export const PASSWORD = "E2e-Portal!2026";

export const USERS = {
  // A Django superuser with the ordinary Staff role, as in production.
  admin: { email: "admin@e2e.test", name: "Ada Admin", roleLabel: "Staff" },
  director: { email: "director@e2e.test", name: "Dele Director", roleLabel: "ED" },
  manager: { email: "manager@e2e.test", name: "Mary Manager", roleLabel: "Line Manager" },
  supervisor: { email: "supervisor@e2e.test", name: "Sam Supervisor", roleLabel: "Supervisor" },
  lead: { email: "lead@e2e.test", name: "Lola Lead", roleLabel: "Team Lead" },
  staff: { email: "staff@e2e.test", name: "Stan Staff", roleLabel: "Staff" },
  peer: { email: "peer@e2e.test", name: "Pat Peer", roleLabel: "Staff" },
  warehouse: { email: "warehouse@e2e.test", name: "Wale Warehouse", roleLabel: "Staff" },
  itmanager: { email: "itmanager@e2e.test", name: "Ife Itmanager", roleLabel: "Line Manager" },
  itstaff: { email: "itstaff@e2e.test", name: "Tolu Technician", roleLabel: "Staff" },
  hrmanager: { email: "hrmanager@e2e.test", name: "Hana Hrmanager", roleLabel: "Line Manager" },
  finance: { email: "finance@e2e.test", name: "Femi Finance", roleLabel: "Staff" },
  clerk: { email: "clerk@e2e.test", name: "Chidi Clerk", roleLabel: "Staff" },
  inbox: { email: "inbox@e2e.test", name: "Ina Inbox", roleLabel: "Staff" },
  changer: { email: "changer@e2e.test", name: "Chika Changer", roleLabel: "Staff" },
} as const;

export type Role = keyof typeof USERS;

/** Deactivated account: cannot sign in. */
export const FORMER_USER = { email: "former@e2e.test", name: "Fola Former" };

export const DEPARTMENTS = ["Finance", "Human Resources", "IT", "Operations"] as const;

export const APPS = {
  payroll: "Payroll Hub", // open to everyone
  fleet: "Fleet Tracker", // Operations only; Wale Warehouse explicitly denied
  itConsole: "IT Console", // IT only; Pat Peer explicitly allowed
  ledger: "Finance Ledger", // Finance only, in maintenance
  archive: "Legacy Archive", // inactive and hidden
} as const;

export const TASKS = {
  // Mary Manager -> Stan Staff
  pending: "Prepare weekly stock report",
  inProgress: "Update vendor contact list",
  underReview: "Draft safety checklist",
  completed: "Archive delivery notes",
  overdue: "Submit fuel receipts",
  // Stan Staff -> Pat Peer
  createdByStaff: "Review shift roster",
  createdByStaffInReview: "Count pallet returns",
  // Neither involves Stan
  otherTeam: "Reconcile warehouse stock", // Sam Supervisor -> Wale Warehouse
  itOnly: "Patch office routers", // Ife Itmanager -> Tolu Technician
} as const;

export const SCHEDULES = {
  active: "Daily vehicle inspection",
  paused: "Daily fuel log",
  ended: "Daily yard sweep",
} as const;

export const TODOS = {
  today: "Call the tyre supplier",
  upcoming: "Book forklift training",
  overdue: "Renew parking permit",
  completed: "Hand in timesheet",
  undated: "Tidy desk drawers",
  peerOnly: "Peer private reminder",
} as const;

export const REPORTS = {
  staffToday: ["Morning dispatch round", "Stock count"],
  peerToday: "Returns processing",
  itToday: "Printer repairs",
  staffYesterday: "Yard tidy",
} as const;

export const TICKETS = {
  open: "Laptop will not join the VPN",
  inProgress: "Email signature is wrong",
  resolved: "Monitor flickers on startup",
  hr: "Leave balance looks wrong",
  peer: "Request for a second monitor",
} as const;

export const INVENTORY = {
  assignedToStaff: { name: "Dell Latitude 5440", code: "100001" },
  available: { name: "HP EliteBook 840", code: "100002" },
  assignedToOps: { name: "Standing Desk", code: "100003" },
  inMaintenance: { name: "Lenovo ThinkPad T14", code: "100004" },
  retired: { name: "Office Chair", code: "100005" },
  assignedToPeer: { name: "MacBook Air M2", code: "100006" },
  categories: ["Furniture", "Laptops", "Vehicles"],
} as const;

/**
 * Credit clients. Wale Warehouse (a member of a "manage" unit) and Sam
 * Supervisor (supervisor of a "supervisor manages" unit) manage them; the rest
 * of Logistics and Mary Manager view; IT and Finance staff have no access.
 * Ordered by name, as the list shows them.
 */
export const CLIENTS = {
  overLimit: { name: "Desert Rose Travel", tin: "10000002", currency: "USD" }, // 20,000 limit, 25,000 used
  active: { name: "Harbour Logistics Ltd", tin: "10000001", currency: "NGN" }, // 5,000,000 limit, 1,250,000 used
  inactive: { name: "Old Mill Supplies", tin: "10000003", currency: "NGN" },
} as const;
