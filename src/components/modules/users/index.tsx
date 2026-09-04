'use client'

// ماژول مدیریت کاربران — ایجاد حساب برای کارکنان بخش‌ها، تعیین نقش و وضعیت (فقط ادمین)
import { useMemo, useState } from 'react'
import {
  Pencil,
  Plus,
  Power,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { apiDelete, apiPost, apiPut } from '@/lib/api'
import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import { formatNumber, toJalaliStr } from '@/lib/format'
import {
  DEPARTMENTS,
  DEPARTMENT_LABELS,
  ROLES,
  ROLE_BADGE,
  ROLE_LABELS,
  type Department,
  type Role,
} from '@/lib/rbac'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { EmptyState, PageHeader, StatCard, TableSkeleton } from '@/components/shared/common'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface UserRow {
  id: string
  username: string
  fullName: string
  role: Role
  department: Department
  active: boolean
  createdAt: string
  updatedAt: string
}

const ACTIVE_BADGE =
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
const INACTIVE_BADGE = 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300'

export default function UsersModule() {
  const { t } = useI18n()
  const me = useAppStore((s) => s.user)

  const { data, error, refetch } = useFetch<UserRow[]>('/api/users')
  const users = useMemo(() => (Array.isArray(data) ? data : []), [data])
  const accessDenied = !!error && error.includes('403')

  // ---------- فیلترها ----------
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [deptFilter, setDeptFilter] = useState('all')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (q && !u.username.toLowerCase().includes(q) && !u.fullName.toLowerCase().includes(q))
        return false
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (deptFilter !== 'all' && u.department !== deptFilter) return false
      return true
    })
  }, [users, search, roleFilter, deptFilter])

  // ---------- آمار ----------
  const activeCount = users.filter((u) => u.active).length
  const operatorCount = users.filter((u) => u.role === 'operator').length
  const adminMgrCount = users.filter((u) => u.role === 'admin' || u.role === 'manager').length

  // ---------- دیالوگ ایجاد/ویرایش ----------
  const [dlgOpen, setDlgOpen] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [fName, setFName] = useState('')
  const [fUsername, setFUsername] = useState('')
  const [fPassword, setFPassword] = useState('')
  const [fRole, setFRole] = useState<Role>('operator')
  const [fDept, setFDept] = useState<Department>('general')
  const [fActive, setFActive] = useState(true)
  const [saving, setSaving] = useState(false)

  const isEditingSelf = !!editing && editing.id === me?.id

  function openNew() {
    setEditing(null)
    setFName('')
    setFUsername('')
    setFPassword('')
    setFRole('operator')
    setFDept('general')
    setFActive(true)
    setDlgOpen(true)
  }

  function openEdit(u: UserRow) {
    setEditing(u)
    setFName(u.fullName)
    setFUsername(u.username)
    setFPassword('')
    setFRole(u.role)
    setFDept(u.department)
    setFActive(u.active)
    setDlgOpen(true)
  }

  const PASSWORD_MSG = t(
    'رمز عبور باید حداقل ۶ حرف باشد',
    'د پټ نوم باید لږ تر لږه ۶ توري وي',
    'Password must be at least 6 characters'
  )

  async function submit() {
    const name = fName.trim()
    if (!name) {
      toast.error(t('نام کامل الزامی است', 'مکمل نوم ضروري دی', 'Full name is required'))
      return
    }
    if (!editing && fUsername.trim().length < 3) {
      toast.error(
        t(
          'نام کاربری باید حداقل ۳ حرف باشد',
          'د کاروونکي نوم باید لږ تر لږه ۳ توري وي',
          'Username must be at least 3 characters'
        )
      )
      return
    }
    if (!editing && (!fPassword || fPassword.length < 6)) {
      toast.error(PASSWORD_MSG)
      return
    }
    if (editing && fPassword && fPassword.length < 6) {
      toast.error(PASSWORD_MSG)
      return
    }
    // بخش فقط برای نقش کارمند معنا دارد؛ سایر نقش‌ها عمومی می‌مانند
    const dept: Department = fRole === 'operator' ? fDept : 'general'
    setSaving(true)
    try {
      if (editing) {
        const body: {
          fullName: string
          role: Role
          department: Department
          password?: string
        } = { fullName: name, role: fRole, department: dept }
        if (fPassword) body.password = fPassword
        await apiPut(`/api/users/${editing.id}`, body)
        toast.success(t('کاربر ویرایش شد', 'کاروونکی سم شو', 'User updated'))
      } else {
        await apiPost('/api/users', {
          username: fUsername.trim(),
          fullName: name,
          password: fPassword,
          role: fRole,
          department: dept,
          active: fActive,
        })
        toast.success(t('کاربر ایجاد شد', 'کاروونکی جوړ شو', 'User created'))
      }
      setDlgOpen(false)
      refetch()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('خطا در ثبت', 'خطا په ثبت کې', 'Error saving')
      )
    } finally {
      setSaving(false)
    }
  }

  // ---------- فعال/غیرفعال ----------
  async function toggleActive(u: UserRow) {
    try {
      await apiPut(`/api/users/${u.id}`, { active: !u.active })
      toast.success(
        u.active
          ? t('کاربر غیرفعال شد', 'کاروونکی غیرفعال شو', 'User deactivated')
          : t('کاربر فعال شد', 'کاروونکی فعال شو', 'User activated')
      )
      refetch()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t('خطا در تغییر وضعیت', 'د حالت په بدلولو کې خطا', 'Error changing status')
      )
    }
  }

  // ---------- حذف ----------
  async function deleteUser(u: UserRow) {
    try {
      await apiDelete(`/api/users/${u.id}`)
      toast.success(t('کاربر حذف شد', 'کاروونکی ړنګ شو', 'User deleted'))
      refetch()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('خطا در حذف', 'خطا په ړنګولو کې', 'Error deleting')
      )
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('مدیریت کاربران و دسترسی‌ها', 'د کاروونکو او لاسرسي مدیریت', 'Users & Access Management')}
        subtitle={t(
          'ایجاد حساب برای کارکنان بخش‌ها، تعیین نقش و فعال/غیرفعال کردن دسترسی‌ها (فقط مدیر سیستم)',
          'د برخو کارکوونکو لپاره حساب جوړول، رول ټاکل او لاسرسي فعال/غیرفعالول (یوازې سیسټم مدیر)',
          'Create accounts for department staff, assign roles and toggle access (admin only)'
        )}
        icon={UserCog}
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" />
            {t('کاربر جدید', 'نوی کاروونکی', 'New User')}
          </Button>
        }
      />

      {/* ---------- آمار ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title={t('کل کاربران', 'ټول کاروونکي', 'Total Users')}
          value={formatNumber(users.length)}
          icon={Users}
          tone="green"
        />
        <StatCard
          title={t('کاربران فعال', 'فعال کاروونکي', 'Active Users')}
          value={formatNumber(activeCount)}
          icon={UserCheck}
          tone="blue"
        />
        <StatCard
          title={t('کارمندان بخش‌ها', 'د برخو کارکوونکي', 'Department Staff')}
          value={formatNumber(operatorCount)}
          icon={UserCog}
          tone="amber"
        />
        <StatCard
          title={t('ادمین و مدیران', 'ادمین او مدیران', 'Admins & Managers')}
          value={formatNumber(adminMgrCount)}
          icon={ShieldCheck}
          tone="slate"
        />
      </div>

      {/* ---------- جدول کاربران ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px] sm:max-w-xs">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="ps-8"
                placeholder={t(
                  'جستجوی نام یا نام کاربری...',
                  'د نوم یا د کاروونکي نوم لټون...',
                  'Search name or username...'
                )}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[175px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('همه نقش‌ها', 'ټول رولونه', 'All roles')}</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(ROLE_LABELS[r].fa, ROLE_LABELS[r].ps, ROLE_LABELS[r].en)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t('همه بخش‌ها', 'ټولې برخې', 'All departments')}
                </SelectItem>
                {DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {t(DEPARTMENT_LABELS[d].fa, DEPARTMENT_LABELS[d].ps, DEPARTMENT_LABELS[d].en)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {accessDenied ? (
            <EmptyState label={t('دسترسی محدود', 'محدود لاسرسی', 'Access restricted')} />
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-8">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <Button variant="outline" size="sm" onClick={refetch}>
                {t('تلاش مجدد', 'بیا هڅه', 'Retry')}
              </Button>
            </div>
          ) : data === null ? (
            <TableSkeleton rows={5} />
          ) : filtered.length === 0 ? (
            <EmptyState label={t('کاربری یافت نشد', 'کاروونکی نه موندل شو', 'No users found')} />
          ) : (
            <div className="max-h-96 overflow-y-auto overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('کاربر', 'کاروونکی', 'User')}</TableHead>
                    <TableHead>{t('نقش', 'رول', 'Role')}</TableHead>
                    <TableHead>{t('بخش', 'برخه', 'Department')}</TableHead>
                    <TableHead>{t('وضعیت', 'حالت', 'Status')}</TableHead>
                    <TableHead>{t('تاریخ ایجاد', 'د جوړولو نېټه', 'Created At')}</TableHead>
                    <TableHead className="text-end">{t('عملیات', 'کړنې', 'Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => {
                    const isSelf = u.id === me?.id
                    return (
                      <TableRow key={u.id} className={cn(!u.active && 'opacity-60')}>
                        <TableCell>
                          <p className="font-medium">{u.fullName}</p>
                          <p
                            dir="ltr"
                            className="font-mono text-xs text-muted-foreground text-start"
                          >
                            {u.username}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={ROLE_BADGE[u.role]}>
                            {t(
                              ROLE_LABELS[u.role].fa,
                              ROLE_LABELS[u.role].ps,
                              ROLE_LABELS[u.role].en
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {t(
                              DEPARTMENT_LABELS[u.department].fa,
                              DEPARTMENT_LABELS[u.department].ps,
                              DEPARTMENT_LABELS[u.department].en
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={u.active ? ACTIVE_BADGE : INACTIVE_BADGE}
                          >
                            {u.active
                              ? t('فعال', 'فعال', 'Active')
                              : t('غیرفعال', 'غیرفعال', 'Inactive')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {toJalaliStr(u.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={t('ویرایش', 'سمون', 'Edit')}
                              onClick={() => openEdit(u)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={isSelf}
                              title={
                                isSelf
                                  ? t(
                                      'حساب خودتان — غیرقابل تغییر',
                                      'ستاسو حساب — نه بدلیږي',
                                      'Your own account — cannot be changed'
                                    )
                                  : u.active
                                    ? t('غیرفعال‌کردن', 'غیرفعالول', 'Deactivate')
                                    : t('فعال‌کردن', 'فعالول', 'Activate')
                              }
                              onClick={() => toggleActive(u)}
                            >
                              <Power
                                className={cn(
                                  'h-4 w-4',
                                  u.active
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-emerald-600 dark:text-emerald-400'
                                )}
                              />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-red-500 hover:text-red-600"
                                  disabled={isSelf}
                                  title={
                                    isSelf
                                      ? t(
                                          'حساب خودتان — قابل حذف نیست',
                                          'ستاسو حساب — ړنګېدلی نه شي',
                                          'Your own account — cannot be deleted'
                                        )
                                      : t('حذف', 'ړنګول', 'Delete')
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {t('حذف کاربر', 'د کاروونکي ړنګول', 'Delete User')}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t(
                                      'آیا از حذف کاربر',
                                      'له کاروونکي ړنګولو څخه ډاډه یاست',
                                      'Are you sure you want to delete'
                                    )}{' '}
                                    «{u.fullName}» ({u.username})؟{' '}
                                    {t(
                                      'این عمل قابل بازگشت نیست.',
                                      'دا کړنه بیرته نه ګرځي.',
                                      'This action cannot be undone.'
                                    )}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>
                                    {t('لغو', 'لغوه', 'Cancel')}
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:text-white dark:hover:bg-red-700"
                                    onClick={() => deleteUser(u)}
                                  >
                                    {t('حذف', 'ړنګول', 'Delete')}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- دیالوگ ایجاد/ویرایش کاربر ---------- */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t('ویرایش کاربر', 'د کاروونکي سمون', 'Edit User')
                : t('کاربر جدید', 'نوی کاروونکی', 'New User')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>{t('نام کامل *', 'مکمل نوم *', 'Full name *')}</Label>
              <Input value={fName} onChange={(e) => setFName(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('نام کاربری *', 'د کاروونکي نوم *', 'Username *')}</Label>
                <Input
                  dir="ltr"
                  className="font-mono"
                  value={fUsername}
                  onChange={(e) => setFUsername(e.target.value)}
                  disabled={!!editing}
                />
                {editing && (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'نام کاربری قابل تغییر نیست',
                      'د کاروونکي نوم نه بدلیږي',
                      'Username cannot be changed'
                    )}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>
                  {editing
                    ? t('رمز جدید (اختیاری)', 'نوی پټ نوم (اختیاري)', 'New password (optional)')
                    : t('رمز عبور *', 'پټ نوم *', 'Password *')}
                </Label>
                <Input
                  dir="ltr"
                  type="password"
                  className="font-mono"
                  value={fPassword}
                  onChange={(e) => setFPassword(e.target.value)}
                  autoComplete="new-password"
                />
                {editing && (
                  <p className="text-xs text-muted-foreground">
                    {t('خالی = بدون تغییر', 'تش = له بدلون پرته', 'Empty = unchanged')}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('نقش', 'رول', 'Role')}</Label>
                <Select
                  value={fRole}
                  onValueChange={(v) => setFRole(v as Role)}
                  disabled={isEditingSelf}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(ROLE_LABELS[r].fa, ROLE_LABELS[r].ps, ROLE_LABELS[r].en)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isEditingSelf && (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'تغییر نقش خودتان مجاز نیست',
                      'د خپل رول بدلون اجازه نه لري',
                      'You cannot change your own role'
                    )}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{t('بخش', 'برخه', 'Department')}</Label>
                <Select
                  value={fRole === 'operator' ? fDept : 'general'}
                  onValueChange={(v) => setFDept(v as Department)}
                  disabled={fRole !== 'operator'}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {t(
                          DEPARTMENT_LABELS[d].fa,
                          DEPARTMENT_LABELS[d].ps,
                          DEPARTMENT_LABELS[d].en
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fRole !== 'operator' && (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'بخش فقط برای نقش کارمند تعیین می‌شود (سایر نقش‌ها: عمومی)',
                      'برخه یوازې د کارکوونکي رول لپاره ټاکل کیږي (نور رولونه: عمومي)',
                      'Department only applies to staff role (others: general)'
                    )}
                  </p>
                )}
              </div>
            </div>
            {!editing && (
              <div className="flex items-center gap-2">
                <Switch id="user-active" checked={fActive} onCheckedChange={setFActive} />
                <Label htmlFor="user-active">{t('فعال', 'فعال', 'Active')}</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(false)}>
              {t('لغو', 'لغوه', 'Cancel')}
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving
                ? t('در حال ثبت...', 'په ثبت کې...', 'Saving...')
                : editing
                  ? t('ذخیره تغییرات', 'بدلونونه خوندي کړه', 'Save Changes')
                  : t('ایجاد کاربر', 'کاروونکی جوړ کړه', 'Create User')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
