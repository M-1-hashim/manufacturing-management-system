'use client'

// ماژول منابع بشری — کارکنان، حاضری، معاش و اجرت
import { useMemo, useState } from 'react'
import {
  Banknote,
  CalendarCheck,
  Pencil,
  Plus,
  Power,
  Printer,
  Trash2,
  UserCheck,
  UserX,
  Users,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import { formatMoney, formatNumber, jalaliMonthName, STATUS_COLORS, toJalaliStr } from '@/lib/format'
import { cn } from '@/lib/utils'
import { amountToWords } from '@/lib/amount-words'
import { EmptyState, PageHeader, StatCard, TableSkeleton } from '@/components/shared/common'
import {
  DocCell,
  DocRow,
  DocTable,
  DocAmountWords,
  DocNotes,
  DocTotals,
  PrintDocDialog,
} from '@/components/shared/print-doc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// ---------- انواع ----------
interface Emp {
  id: string
  name: string
  position: string
  phone?: string | null
  salary: number
  hireDate: string
  active: boolean
  _count?: { attendance: number; salaries: number }
}
interface Att {
  id: string
  employeeId: string
  date: string
  status: string
  shift?: string | null
  notes?: string | null
  employee?: { name: string; position: string }
}
interface Sal {
  id: string
  employeeId: string
  month: string
  amount: number
  date: string
  notes?: string | null
  employee?: { name: string }
}

// درخواست JSON با پیام خطای دری
async function jsonReq(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error || `خطا در اجراؤات (${res.status})`)
  return json
}

// تاریخ امروز به شکل YYYY-MM-DD (به وقت محلی)
function toISODate(d: Date) {
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const STATUS_LABELS: Record<string, string> = {
  present: 'حاضر',
  absent: 'غایب',
  leave: 'رخصتی',
}
const ACTIVE_BADGE =
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
const INACTIVE_BADGE = 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'

export default function HrModule() {
  const { t } = useI18n()
  const [tab, setTab] = useState('employees')

  const { data: empData, refetch: refetchEmps } = useFetch<Emp[]>('/api/employees')
  const employees = useMemo(() => (Array.isArray(empData) ? empData : []), [empData])

  // ---------- حضور ----------
  const [attEmpFilter, setAttEmpFilter] = useState('all')
  const [attDays, setAttDays] = useState('7')
  const attUrl = `/api/attendance?days=${attDays}${
    attEmpFilter !== 'all' ? `&employeeId=${attEmpFilter}` : ''
  }`
  const { data: attData, loading: attLoading, refetch: refetchAtt } = useFetch<Att[]>(attUrl)
  const attendance = useMemo(() => (Array.isArray(attData) ? attData : []), [attData])

  const [qEmp, setQEmp] = useState('')
  const [qStatus, setQStatus] = useState('present')
  const [qShift, setQShift] = useState('none')
  const [qSaving, setQSaving] = useState(false)

  // ---------- معاش ----------
  const { data: salData, refetch: refetchSal } = useFetch<Sal[]>('/api/salaries')
  const salaries = useMemo(() => (Array.isArray(salData) ? salData : []), [salData])
  const [payOpen, setPayOpen] = useState(false)
  const [pEmpId, setPEmpId] = useState('')
  const [pMonth, setPMonth] = useState('')
  const [pAmount, setPAmount] = useState('')
  const [pNotes, setPNotes] = useState('')
  const [pSaving, setPSaving] = useState(false)

  // چاپ — فیش معاش و گزارش حاضری
  const [printSal, setPrintSal] = useState<Sal | null>(null)
  const [attPrintOpen, setAttPrintOpen] = useState(false)

  // ---------- کارکنان ----------
  const [searchText, setSearchText] = useState('')
  const [empOpen, setEmpOpen] = useState(false)
  const [empEditing, setEmpEditing] = useState<Emp | null>(null)
  const [eName, setEName] = useState('')
  const [ePosition, setEPosition] = useState('')
  const [ePhone, setEPhone] = useState('')
  const [eSalary, setESalary] = useState('')
  const [eHire, setEHire] = useState('')
  const [eActive, setEActive] = useState(true)
  const [eSaving, setESaving] = useState(false)

  const filteredEmps = useMemo(() => {
    const q = searchText.trim()
    if (!q) return employees
    return employees.filter(
      (e) =>
        e.name.includes(q) ||
        e.position.includes(q) ||
        (e.phone ?? '').includes(q)
    )
  }, [employees, searchText])

  const activeEmps = employees.filter((e) => e.active)
  const totalSalaries = activeEmps.reduce((s, e) => s + e.salary, 0)
  const isToday = (d: string) => new Date(d).toDateString() === new Date().toDateString()
  const presentToday = attendance.filter((a) => a.status === 'present' && isToday(a.date)).length
  const absentToday = attendance.filter((a) => a.status === 'absent' && isToday(a.date)).length

  const monthsByEmp = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of salaries) map.set(s.employeeId, (map.get(s.employeeId) ?? 0) + 1)
    return map
  }, [salaries])
  const totalPaid = salaries.reduce((s, x) => s + x.amount, 0)

  // ---------- اجراؤات کارکنان ----------
  function openNewEmp() {
    setEmpEditing(null)
    setEName('')
    setEPosition('')
    setEPhone('')
    setESalary('')
    setEHire(toISODate(new Date()))
    setEActive(true)
    setEmpOpen(true)
  }
  function openEditEmp(e: Emp) {
    setEmpEditing(e)
    setEName(e.name)
    setEPosition(e.position)
    setEPhone(e.phone ?? '')
    setESalary(String(e.salary))
    setEHire(toISODate(new Date(e.hireDate)))
    setEActive(e.active)
    setEmpOpen(true)
  }
  async function submitEmp() {
    if (!eName.trim() || !ePosition.trim()) {
      toast.error(t('نام و وظیفه الزامی است', 'نوم او دنده ضروري ده', 'Name and position are required'))
      return
    }
    const salary = Number(eSalary)
    if (!salary || isNaN(salary) || salary <= 0) {
      toast.error(t('معاش باید زیادتر از صفر باشد', 'معاش باید له صفر لوی وي', 'Salary must be greater than zero'))
      return
    }
    setESaving(true)
    try {
      const body = {
        name: eName,
        position: ePosition,
        phone: ePhone || null,
        salary,
        hireDate: eHire || undefined,
        active: eActive,
      }
      if (empEditing) {
        await jsonReq(`/api/employees/${empEditing.id}`, 'PUT', body)
        toast.success(t('کارمند تصحیح شد', 'کوونکی سمون وخوړ', 'Employee updated'))
      } else {
        await jsonReq('/api/employees', 'POST', body)
        toast.success(t('کارمند ثبت شد', 'کوونکی ثبت شو', 'Employee created'))
      }
      setEmpOpen(false)
      refetchEmps()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('خطا در ثبت', 'خطا په ثبت کې', 'Error saving'))
    } finally {
      setESaving(false)
    }
  }
  async function toggleActive(e: Emp) {
    try {
      await jsonReq(`/api/employees/${e.id}`, 'PUT', { active: !e.active })
      toast.success(
        e.active
          ? t('کارمند غیرفعال شد', 'کوونکی غیرفعال شو', 'Employee deactivated')
          : t('کارمند فعال شد', 'کوونکی فعال شو', 'Employee activated')
      )
      refetchEmps()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('خطا در تغییر وضعیت', 'خطا', 'Error'))
    }
  }
  async function deleteEmp(e: Emp) {
    try {
      await jsonReq(`/api/employees/${e.id}`, 'DELETE')
      toast.success(t('کارمند حذف شد', 'کوونکی ړنګ شو', 'Employee deleted'))
      refetchEmps()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('خطا در حذف', 'خطا په ړنګولو کې', 'Error deleting'))
    }
  }

  // ---------- ثبت حاضری ----------
  async function submitAttendance() {
    if (!qEmp) {
      toast.error(t('کارمند را انتخاب کنید', 'کوونکی وټاکنئ', 'Select an employee'))
      return
    }
    setQSaving(true)
    try {
      await jsonReq('/api/attendance', 'POST', {
        employeeId: qEmp,
        status: qStatus,
        shift: qShift === 'none' ? null : qShift,
        date: new Date().toISOString(),
      })
      toast.success(t('حاضری ثبت شد', 'حاضره ثبت شوه', 'Attendance recorded'))
      refetchAtt()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('خطا در ثبت', 'خطا په ثبت کې', 'Error saving'))
    } finally {
      setQSaving(false)
    }
  }
  async function deleteAtt(a: Att) {
    try {
      await jsonReq(`/api/attendance/${a.id}`, 'DELETE')
      toast.success(t('رکورد حذف شد', 'ریکارډ ړنګ شو', 'Record deleted'))
      refetchAtt()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('خطا در حذف', 'خطا په ړنګولو کې', 'Error deleting'))
    }
  }

  // ---------- پرداخت معاش ----------
  function openPay() {
    setPEmpId('')
    setPMonth('')
    setPAmount('')
    setPNotes('')
    setPayOpen(true)
  }
  async function submitPay() {
    if (!pEmpId) {
      toast.error(t('کارمند را انتخاب کنید', 'کوونکی وټاکنئ', 'Select an employee'))
      return
    }
    if (!/^\d{4}-\d{2}$/.test(pMonth.trim())) {
      toast.error(t('ماه باید به شکل 1403-01 باشد', 'میاشت باید په 1403-01 شکل وي', 'Month must be like 1403-01'))
      return
    }
    const amount = Number(pAmount)
    if (!amount || isNaN(amount) || amount <= 0) {
      toast.error(t('مبلغ باید زیادتر از صفر باشد', 'مبلغ باید له صفر لوی وي', 'Amount must be greater than zero'))
      return
    }
    setPSaving(true)
    try {
      await jsonReq('/api/salaries', 'POST', {
        employeeId: pEmpId,
        month: pMonth.trim(),
        amount,
        notes: pNotes || null,
      })
      toast.success(t('پرداخت معاش ثبت شد', 'د معاش ورکول ثبت شول', 'Salary payment recorded'))
      setPayOpen(false)
      refetchSal()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('خطا در ثبت', 'خطا په ثبت کې', 'Error saving'))
    } finally {
      setPSaving(false)
    }
  }
  async function deleteSal(s: Sal) {
    try {
      await jsonReq(`/api/salaries/${s.id}`, 'DELETE')
      toast.success(t('پرداخت حذف شد', 'پرداخت ړنګ شو', 'Payment deleted'))
      refetchSal()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('خطا در حذف', 'خطا په ړنګولو کې', 'Error deleting'))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('منابع بشری', 'انساني سرچینې', 'Human Resources')}
        subtitle={t(
          'مدیریت کارکنان، حاضری و معاش و اجرت',
          'د کارکوونکیو، حاضرو او معاشونو مدیریت',
          'Employees, attendance and payroll'
        )}
        icon={Users}
        actions={
          tab === 'employees' ? (
            <Button onClick={openNewEmp}>
              <Plus className="h-4 w-4" />
              {t('کارمند جدید', 'نوی کوونکی', 'New Employee')}
            </Button>
          ) : tab === 'salaries' ? (
            <Button onClick={openPay}>
              <Plus className="h-4 w-4" />
              {t('پرداخت معاش', 'معاش ورکړه', 'Pay Salary')}
            </Button>
          ) : undefined
        }
      />

      {/* ---------- آمار ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title={t('کارکنان فعال', 'فعال کوونکي', 'Active Employees')}
          value={formatNumber(activeEmps.length)}
          hint={t(`${employees.length} کل`, `${employees.length} ټول`, `${employees.length} total`)}
          icon={Users}
          tone="green"
        />
        <StatCard
          title={t('مجموع معاش ماهانه', 'میاشتنی معاشونه', 'Monthly Payroll')}
          value={formatMoney(totalSalaries)}
          icon={Wallet}
          tone="blue"
        />
        <StatCard
          title={t('حاضران امروز', 'د نن حاضران', 'Present Today')}
          value={formatNumber(presentToday)}
          icon={UserCheck}
          tone="green"
        />
        <StatCard
          title={t('غایبان امروز', 'د نن غیرحاضران', 'Absent Today')}
          value={formatNumber(absentToday)}
          icon={UserX}
          tone="red"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3 sm:w-[440px]">
          <TabsTrigger value="employees">{t('کارکنان', 'کارکوونکي', 'Employees')}</TabsTrigger>
          <TabsTrigger value="attendance">{t('حاضری', 'حاضره او غیرحاضره', 'Attendance')}</TabsTrigger>
          <TabsTrigger value="salaries">{t('معاش و اجرت', 'معاشونه', 'Payroll')}</TabsTrigger>
        </TabsList>

        {/* ================= کارکنان ================= */}
        <TabsContent value="employees" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <Input
                className="sm:max-w-xs"
                placeholder={t('جستجوی نام، وظیفه یا تیلفون...', 'د نوم، دندې یا تیلفون لټون...', 'Search name, position or phone...')}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </CardHeader>
            <CardContent>
              {empData === null ? (
                <TableSkeleton rows={5} />
              ) : filteredEmps.length === 0 ? (
                <EmptyState label={t('کارمندی یافت نشد', 'کوونکی نه موندل شو', 'No employees found')} />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('نام', 'نوم', 'Name')}</TableHead>
                        <TableHead>{t('وظیفه', 'دنده', 'Position')}</TableHead>
                        <TableHead>{t('تیلفون', 'تیلفون', 'Phone')}</TableHead>
                        <TableHead>{t('معاش', 'معاش', 'Salary')}</TableHead>
                        <TableHead>{t('تاریخ استخدام', 'د استخدام نېټه', 'Hire Date')}</TableHead>
                        <TableHead>{t('وضعیت', 'حالت', 'Status')}</TableHead>
                        <TableHead>{t('اجراؤات', 'کړنې', 'Actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEmps.map((e) => (
                        <TableRow key={e.id} className={cn(!e.active && 'opacity-60')}>
                          <TableCell className="font-medium">{e.name}</TableCell>
                          <TableCell className="text-sm">{e.position}</TableCell>
                          <TableCell dir="ltr" className="text-sm font-mono rtl:text-right">
                            {e.phone || '—'}
                          </TableCell>
                          <TableCell className="font-semibold whitespace-nowrap">
                            {formatMoney(e.salary)}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {toJalaliStr(e.hireDate)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={e.active ? ACTIVE_BADGE : INACTIVE_BADGE}>
                              {e.active
                                ? t('فعال', 'فعال', 'Active')
                                : t('غیرفعال', 'غیرفعال', 'Inactive')}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-start gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title={t('تصحیح', 'سمون', 'Edit')}
                                onClick={() => openEditEmp(e)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title={
                                  e.active
                                    ? t('غیرفعال‌کردن', 'غیرفعالول', 'Deactivate')
                                    : t('فعال‌کردن', 'فعالول', 'Activate')
                                }
                                onClick={() => toggleActive(e)}
                              >
                                <Power
                                  className={cn(
                                    'h-4 w-4',
                                    e.active
                                      ? 'text-amber-600 dark:text-amber-400'
                                      : 'text-emerald-600 dark:text-emerald-400'
                                  )}
                                />
                              </Button>
                              {(e._count?.attendance ?? 0) + (e._count?.salaries ?? 0) === 0 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-red-500 hover:text-red-600"
                                  title={t('حذف', 'ړنګول', 'Delete')}
                                  onClick={() => deleteEmp(e)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= حاضری ================= */}
        <TabsContent value="attendance" className="mt-4 space-y-4">
          {/* پنل ثبت سریع */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-primary" />
                {t('ثبت حاضری امروز', 'د نن حاضره ثبت کړه', "Record Today's Attendance")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                <div className="space-y-1.5">
                  <Label>{t('کارمند', 'کوونکی', 'Employee')}</Label>
                  <Select value={qEmp} onValueChange={setQEmp}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('انتخاب کارمند', 'کوونکی وټاکنئ', 'Select employee')} />
                    </SelectTrigger>
                    <SelectContent className="max-h-56">
                      {activeEmps.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name} — {e.position}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('وضعیت', 'حالت', 'Status')}</Label>
                  <RadioGroup value={qStatus} onValueChange={setQStatus} className="flex items-center gap-3 h-9">
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="present" id="st-present" />
                      <Label htmlFor="st-present" className="font-normal cursor-pointer">
                        {t('حاضر', 'حاضر', 'Present')}
                      </Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="absent" id="st-absent" />
                      <Label htmlFor="st-absent" className="font-normal cursor-pointer">
                        {t('غایب', 'غایب', 'Absent')}
                      </Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="leave" id="st-leave" />
                      <Label htmlFor="st-leave" className="font-normal cursor-pointer">
                        {t('رخصتی', 'رخصتي', 'Leave')}
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('شیفت', 'شفت', 'Shift')}</Label>
                  <Select value={qShift} onValueChange={setQShift}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('بدون شیفت', 'بې شفته', 'None')}</SelectItem>
                      <SelectItem value="صبح">{t('صبح', 'سهار', 'Morning')}</SelectItem>
                      <SelectItem value="عصر">{t('عصر', 'ماښام', 'Evening')}</SelectItem>
                      <SelectItem value="شب">{t('شب', 'شپه', 'Night')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={submitAttendance} disabled={qSaving}>
                  {qSaving
                    ? t('در حال ثبت...', 'په ثبت کې...', 'Saving...')
                    : t('ثبت حاضری', 'حاضره ثبت کړه', 'Record Attendance')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* سابقه حضور */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">
                  {t('سابقه حاضری', 'د حاضرو سابقه', 'Attendance History')}
                </CardTitle>
                <div className="ms-auto flex flex-wrap items-center gap-2">
                  <Select value={attEmpFilter} onValueChange={setAttEmpFilter}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-56">
                      <SelectItem value="all">{t('همه کارکنان', 'ټول کوونکي', 'All employees')}</SelectItem>
                      {employees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={attDays} onValueChange={setAttDays}>
                    <SelectTrigger className="w-[110px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">{t('۷ روز', '۷ ورځې', '7 days')}</SelectItem>
                      <SelectItem value="14">{t('۱۴ روز', '۱۴ ورځې', '14 days')}</SelectItem>
                      <SelectItem value="30">{t('۳۰ روز', '۳۰ ورځې', '30 days')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={() => setAttPrintOpen(true)}>
                    <Printer className="h-4 w-4" />
                    {t('گزارش حاضری', 'د حاضرو راپور', 'Attendance report')}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {attLoading && !attData ? (
                <TableSkeleton rows={6} />
              ) : attendance.length === 0 ? (
                <EmptyState label={t('سابقه‌ای ثبت نشده', 'سابقه نه ده ثبت شوې', 'No attendance records')} />
              ) : (
                <div className="max-h-96 overflow-y-auto overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('نام', 'نوم', 'Name')}</TableHead>
                        <TableHead>{t('تاریخ', 'نېټه', 'Date')}</TableHead>
                        <TableHead>{t('وضعیت', 'حالت', 'Status')}</TableHead>
                        <TableHead>{t('شیفت', 'شفت', 'Shift')}</TableHead>
                        <TableHead>{t('اجراؤات', 'کړنې', 'Actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendance.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <span className="font-medium">{a.employee?.name ?? '—'}</span>
                            <span className="text-xs text-muted-foreground block">
                              {a.employee?.position}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {toJalaliStr(a.date)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={STATUS_COLORS[a.status] ?? ''}>
                              {STATUS_LABELS[a.status] ?? a.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{a.shift ?? '—'}</TableCell>
                          <TableCell>
                            <div className="flex justify-start">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-500 hover:text-red-600"
                                onClick={() => deleteAtt(a)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= معاش و اجرت ================= */}
        <TabsContent value="salaries" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-primary" />
                  {t('سابقه پرداخت‌ها', 'د پرداختونو سابقه', 'Payment History')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {salData === null ? (
                  <TableSkeleton rows={5} />
                ) : salaries.length === 0 ? (
                  <EmptyState label={t('پرداختی ثبت نشده', 'پرداخت نه دی ثبت شوی', 'No payments recorded')} />
                ) : (
                  <div className="max-h-96 overflow-y-auto overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('کارمند', 'کوونکی', 'Employee')}</TableHead>
                          <TableHead>{t('ماه', 'میاشت', 'Month')}</TableHead>
                          <TableHead>{t('مبلغ', 'مبلغ', 'Amount')}</TableHead>
                          <TableHead>{t('تاریخ پرداخت', 'د پرداخت نېټه', 'Paid At')}</TableHead>
                          <TableHead>{t('اجراؤات', 'کړنې', 'Actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {salaries.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="font-medium">{s.employee?.name ?? '—'}</TableCell>
                            <TableCell dir="ltr" className="font-mono text-xs rtl:text-right">
                              {s.month}
                            </TableCell>
                            <TableCell className="font-semibold whitespace-nowrap">
                              {formatMoney(s.amount)}
                            </TableCell>
                            <TableCell className="text-xs whitespace-nowrap">
                              {toJalaliStr(s.date)}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-start">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  title={t('چاپ فیش معاش', 'د معاش فیش چاپ', 'Print salary slip')}
                                  onClick={() => setPrintSal(s)}
                                >
                                  <Printer className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-red-500 hover:text-red-600"
                                  onClick={() => deleteSal(s)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* خلاصه پرداخت‌ها */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {t('خلاصه پرداخت', 'د پرداخت خلاصه', 'Payment Summary')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg bg-emerald-500/10 px-3 py-2.5 flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">
                    {t('مجموع پرداخت‌شده', 'ټول پرداخت شوی', 'Total Paid')}
                  </span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    {formatMoney(totalPaid)}
                  </span>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {employees.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {t('کارمندی ثبت نشده', 'کوونکی نه دی ثبت شوی', 'No employees')}
                    </p>
                  ) : (
                    employees.map((e) => {
                      const n = monthsByEmp.get(e.id) ?? 0
                      return (
                        <div
                          key={e.id}
                          className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{e.name}</p>
                            <p className="text-xs text-muted-foreground">{e.position}</p>
                          </div>
                          {n > 0 ? (
                            <Badge
                              variant="outline"
                              className="shrink-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                            >
                              {formatNumber(n)} {t('ماه پرداخت‌شده', 'میاشتې پرداخت شوې', 'months paid')}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                            >
                              {t('معاش پرداخت نشده', 'معاش نه دی پرداخت شوی', 'Unpaid')}
                            </Badge>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ---------- دیالوگ کارمند ---------- */}
      <Dialog open={empOpen} onOpenChange={setEmpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {empEditing
                ? t('تصحیح کارمند', 'د کوونکي سمون', 'Edit Employee')
                : t('کارمند جدید', 'نوی کوونکی', 'New Employee')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('نام *', 'نوم *', 'Name *')}</Label>
                <Input value={eName} onChange={(e) => setEName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('وظیفه *', 'دنده *', 'Position *')}</Label>
                <Input value={ePosition} onChange={(e) => setEPosition(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('تیلفون', 'تیلفون', 'Phone')}</Label>
                <Input dir="ltr" className="font-mono" value={ePhone} onChange={(e) => setEPhone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('معاش ماهانه (؋)', 'میاشتنی معاش (؋)', 'Monthly Salary (؋)')}</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  dir="ltr"
                  value={eSalary}
                  onChange={(e) => setESalary(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="space-y-1.5">
                <Label>{t('تاریخ استخدام', 'د استخدام نېټه', 'Hire Date')}</Label>
                <Input type="date" dir="ltr" value={eHire} onChange={(e) => setEHire(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 h-9">
                <Switch id="emp-active" checked={eActive} onCheckedChange={setEActive} />
                <Label htmlFor="emp-active">{t('فعال', 'فعال', 'Active')}</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmpOpen(false)}>
              {t('لغو', 'لغوه', 'Cancel')}
            </Button>
            <Button onClick={submitEmp} disabled={eSaving}>
              {eSaving
                ? t('در حال ثبت...', 'په ثبت کې...', 'Saving...')
                : empEditing
                  ? t('ذخیره تغییرات', 'بدلونونه خوندي کړه', 'Save Changes')
                  : t('ثبت کارمند', 'کوونکی ثبت کړه', 'Create Employee')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- دیالوگ پرداخت معاش ---------- */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('پرداخت معاش', 'معاش ورکړه', 'Pay Salary')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>{t('کارمند', 'کوونکی', 'Employee')}</Label>
              <Select
                value={pEmpId}
                onValueChange={(v) => {
                  setPEmpId(v)
                  const emp = employees.find((e) => e.id === v)
                  if (emp) setPAmount(String(emp.salary))
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('انتخاب کارمند', 'کوونکی وټاکنئ', 'Select employee')} />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {activeEmps.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} — {e.position}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('ماه (شمسی)', 'میاشت (شمسي)', 'Month (Shamsi)')}</Label>
                <Input
                  dir="ltr"
                  className="font-mono"
                  placeholder="1403-01"
                  value={pMonth}
                  onChange={(e) => setPMonth(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('الگو: 1403-01', 'بڼه: 1403-01', 'Pattern: 1403-01')}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>{t('مبلغ (؋)', 'مبلغ (؋)', 'Amount (؋)')}</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  dir="ltr"
                  value={pAmount}
                  onChange={(e) => setPAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('یادداشت', 'یادښت', 'Notes')}</Label>
              <Textarea rows={2} value={pNotes} onChange={(e) => setPNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              {t('لغو', 'لغوه', 'Cancel')}
            </Button>
            <Button onClick={submitPay} disabled={pSaving}>
              {pSaving
                ? t('در حال ثبت...', 'په ثبت کې...', 'Saving...')
                : t('ثبت پرداخت', 'پرداخت ثبت کړه', 'Record Payment')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- چاپ فیش معاش ---------- */}
      <SalarySlipDialog
        payment={printSal}
        employees={employees}
        onClose={() => setPrintSal(null)}
      />

      {/* ---------- چاپ گزارش حاضری ---------- */}
      <AttendanceReportDialog
        open={attPrintOpen}
        rows={attendance}
        onClose={() => setAttPrintOpen(false)}
      />
    </div>
  )
}

// برچسب ماه پرداخت مثل «1403-01 (حمل)»
function monthJalaliLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim())
  if (!m) return month
  return `${month} (${jalaliMonthName(parseInt(m[2], 10))})`
}

// ================= چاپ فیش معاش =================
function SalarySlipDialog({
  payment,
  employees,
  onClose,
}: {
  payment: Sal | null
  employees: Emp[]
  onClose: () => void
}) {
  const { t, lang } = useI18n()
  if (!payment) return null

  const emp = employees.find((e) => e.id === payment.employeeId)
  const empName = emp?.name ?? payment.employee?.name ?? '—'

  return (
    <PrintDocDialog
      open
      onClose={onClose}
      docType={t('فیش معاش', 'د معاش فیش', 'Salary Slip')}
      docTypeEn="SALARY SLIP"
      docNumber={`SL-${payment.id.slice(-6).toUpperCase()}`}
      date={payment.date}
      meta={[
        [
          { label: t('کارمند', 'کوونکی', 'Employee'), value: empName },
          { label: t('وظیفه', 'دنده', 'Position'), value: emp?.position ?? '—' },
          { label: t('تیلفون', 'تیلفون', 'Phone'), value: emp?.phone || '—', ltr: true },
          { label: t('ماه (شمسی)', 'میاشت (شمسي)', 'Month (Shamsi)'), value: monthJalaliLabel(payment.month) },
          { label: t('مبلغ پرداخت‌شده', 'پرداخت شوی مبلغ', 'Paid amount'), value: formatMoney(payment.amount) },
          { label: t('تاریخ پرداخت', 'د پرداخت نېټه', 'Paid at'), value: toJalaliStr(payment.date) },
        ],
      ]}
    >
      <DocTotals
        rows={[
          {
            label: t('معاش اساسی', 'بنسټیز معاش', 'Base salary'),
            value: emp ? formatMoney(emp.salary) : '—',
          },
        ]}
        grandLabel={t('پرداخت‌شده', 'پرداخت شوی', 'Paid')}
        grandValue={formatMoney(payment.amount)}
      />
      <DocAmountWords text={amountToWords(payment.amount, 'AFN', lang)} />
      {payment.notes && <DocNotes>{payment.notes}</DocNotes>}
    </PrintDocDialog>
  )
}

// ================= چاپ گزارش حاضری =================
function AttendanceReportDialog({
  open,
  rows,
  onClose,
}: {
  open: boolean
  rows: Att[]
  onClose: () => void
}) {
  const { t } = useI18n()
  const counts = useMemo(
    () => ({
      present: rows.filter((a) => a.status === 'present').length,
      absent: rows.filter((a) => a.status === 'absent').length,
      leave: rows.filter((a) => a.status === 'leave').length,
    }),
    [rows]
  )

  return (
    <PrintDocDialog
      open={open}
      onClose={onClose}
      docType={t('گزارش حاضری', 'د حاضرو راپور', 'Attendance Report')}
      docTypeEn="ATTENDANCE REPORT"
    >
      <DocTable
        minWidth={560}
        head={[
          { label: '#', className: 'w-8 text-center' },
          { label: t('نام کارمند', 'د کوونکي نوم', 'Employee') },
          { label: t('تاریخ', 'نېټه', 'Date'), className: 'text-center' },
          { label: t('وضعیت', 'حالت', 'Status'), className: 'text-center' },
          { label: t('شیفت', 'شفت', 'Shift'), className: 'text-center' },
        ]}
      >
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5} className="border-t border-neutral-200 py-4 text-center text-neutral-400">
              {t('سابقه‌ای ثبت نشده', 'سابقه نه ده ثبت شوې', 'No attendance records')}
            </td>
          </tr>
        ) : (
          rows.map((a, i) => (
            <DocRow key={a.id} index={i}>
              <DocCell className="text-center text-neutral-400">{formatNumber(i + 1)}</DocCell>
              <DocCell className="font-medium">{a.employee?.name ?? '—'}</DocCell>
              <DocCell className="text-center">{toJalaliStr(a.date)}</DocCell>
              <DocCell className="text-center">{STATUS_LABELS[a.status] ?? a.status}</DocCell>
              <DocCell className="text-center">{a.shift ?? '—'}</DocCell>
            </DocRow>
          ))
        )}
      </DocTable>
      <DocTotals
        rows={[
          {
            label: t('حاضر', 'حاضر', 'Present'),
            value: formatNumber(counts.present),
            tone: 'success',
          },
          {
            label: t('غایب', 'غایب', 'Absent'),
            value: formatNumber(counts.absent),
            tone: 'danger',
          },
          {
            label: t('رخصتی', 'رخصتي', 'Leave'),
            value: formatNumber(counts.leave),
          },
        ]}
        grandLabel={t('مجموع', 'مجموع', 'Total')}
        grandValue={formatNumber(rows.length)}
      />
    </PrintDocDialog>
  )
}
