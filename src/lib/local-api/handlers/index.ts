'use client'

/**
 * رجیستری مسیرهای API محلی — تجمیع هندلرهای همهٔ ماژول‌ها
 * ترتیب مهم است: مسیرهای دقیق‌تر (با پارامتر) قبل از مسیرهای عمومی.
 */

import { type RouteDef } from '../types'
import { routes as authRoutes } from './auth'
import { routes as usersRoutes } from './users'
import { routes as auditRoutes } from './audit'
import { routes as settingsRoutes } from './settings'
import { routes as systemRoutes } from './system'
import { routes as exchangeRateRoutes } from './exchange-rate'
import { routes as downloadRoutes } from './download'
import { routes as backupRoutes } from './backup'
import { routes as productsRoutes } from './products'
import { routes as categoriesRoutes } from './categories'
import { routes as rawMaterialsRoutes } from './raw-materials'
import { routes as suppliersRoutes } from './suppliers'
import { routes as formulasRoutes } from './formulas'
import { routes as productionRoutes } from './production'
import { routes as inventoryRoutes } from './inventory'
import { routes as warehousesRoutes } from './warehouses'
import { routes as salesRoutes } from './sales'
import { routes as customersRoutes } from './customers'
import { routes as expensesRoutes } from './expenses'
import { routes as employeesRoutes } from './employees'
import { routes as attendanceRoutes } from './attendance'
import { routes as salariesRoutes } from './salaries'
import { routes as dashboardRoutes } from './dashboard'
import { routes as reportsRoutes } from './reports'

/**
 * ترتیب ثبت:
 *  1. مسیرهای خاص (production/:id/complete، admin/backup، system/*، auth/*)
 *  2. مسیرهای CRUD با :id
 *  3. مسیرهای کولکشن
 * چون هر regex کاملاً لنگر شده است (^...$)، تداخلی وجود ندارد.
 */
export const allRoutes: RouteDef[] = [
  ...authRoutes,
  ...systemRoutes,
  ...downloadRoutes,
  ...backupRoutes,
  ...productionRoutes, // شامل :id/complete
  ...exchangeRateRoutes,
  ...usersRoutes,
  ...auditRoutes,
  ...settingsRoutes,
  ...productsRoutes,
  ...categoriesRoutes,
  ...rawMaterialsRoutes,
  ...suppliersRoutes,
  ...formulasRoutes,
  ...inventoryRoutes,
  ...warehousesRoutes,
  ...salesRoutes,
  ...customersRoutes,
  ...expensesRoutes,
  ...employeesRoutes,
  ...attendanceRoutes,
  ...salariesRoutes,
  ...dashboardRoutes,
  ...reportsRoutes,
]
