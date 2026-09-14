// ماتریس دسترسی نقش‌ها — ادمین: دسترسی کامل | کارکنان: دسترسی به بخش خود
// این فایل pure است و هم در کلاینت و هم در middleware استفاده می‌شود

export type Role = 'admin' | 'manager' | 'operator' | 'viewer'
export type Department = 'general' | 'production' | 'sales' | 'inventory' | 'finance' | 'hr'

export const ROLES: Role[] = ['admin', 'manager', 'operator', 'viewer']

export const ROLE_LABELS: Record<Role, { fa: string; ps: string; en: string }> = {
  admin: { fa: 'مدیر سیستم (ادمین)', ps: 'سیسټم مدیر', en: 'System Admin' },
  manager: { fa: 'مدیر', ps: 'مدیر', en: 'Manager' },
  operator: { fa: 'کارمند', ps: 'کارکوونکی', en: 'Staff' },
  viewer: { fa: 'ناظر (فقط خواندن)', ps: 'لیدونکی', en: 'Viewer (read-only)' },
}

export const ROLE_BADGE: Record<Role, string> = {
  admin: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300',
  manager: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-300',
  operator: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300',
  viewer: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-300',
}

export const DEPARTMENTS: Department[] = ['general', 'production', 'sales', 'inventory', 'finance', 'hr']

export const DEPARTMENT_LABELS: Record<Department, { fa: string; ps: string; en: string }> = {
  general: { fa: 'عمومی', ps: 'عمومي', en: 'General' },
  production: { fa: 'تولید', ps: 'تولید', en: 'Production' },
  sales: { fa: 'فروش', ps: 'پلورنه', en: 'Sales' },
  inventory: { fa: 'انبار', ps: 'ګدام', en: 'Warehouse' },
  finance: { fa: 'مالی', ps: 'مالي', en: 'Finance' },
  hr: { fa: 'منابع بشری', ps: 'منابع انساني', en: 'HR' },
}

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as string[]).includes(v)
}

export function isDepartment(v: unknown): v is Department {
  return typeof v === 'string' && (DEPARTMENTS as string[]).includes(v)
}

export interface AccessUser {
  role: string
  department: string
}

const ADMIN_MGR = ['admin', 'manager']

/**
 * آیا کاربر به ماژول دسترسی دارد؟
 * - admin: همه چیز (دسترسی کامل)
 * - manager: همه ماژول‌های کاری + فعالیت‌ها (بدون مدیریت کاربران سیستم)
 * - operator: داشبورد + ماژول‌های بخش خود
 * - viewer: داشبورد + گزارشات (فقط خواندن)
 */
export function canAccess(user: AccessUser, tab: string): boolean {
  const { role, department } = user
  if (role === 'admin') return true
  const adminMgr = ADMIN_MGR.includes(role)

  switch (tab) {
    case 'dashboard':
      return true
    case 'products':
      return adminMgr || ['inventory', 'production', 'sales'].includes(department)
    case 'materials':
      return adminMgr || ['inventory', 'production'].includes(department)
    case 'formulas':
      return adminMgr || department === 'production'
    case 'production':
      return adminMgr || department === 'production'
    case 'sales':
      return adminMgr || ['sales', 'finance'].includes(department)
    case 'inventory':
      return adminMgr || ['inventory', 'sales'].includes(department)
    case 'finance':
      return adminMgr || department === 'finance'
    case 'hr':
      return adminMgr || department === 'hr'
    case 'reports':
      return adminMgr || role === 'viewer' || department === 'finance'
    case 'settings':
      return adminMgr
    case 'users':
      return role === 'admin'
    case 'audit':
      return adminMgr
    default:
      return false
  }
}

/** برچسب قابل نمایش نقش/بخش برای کلید زبان فعلی */
export function roleLabel(role: string, lang: 'fa' | 'ps' | 'en'): string {
  return isRole(role) ? ROLE_LABELS[role][lang] : role
}

export function departmentLabel(department: string, lang: 'fa' | 'ps' | 'en'): string {
  return isDepartment(department) ? DEPARTMENT_LABELS[department][lang] : department
}
