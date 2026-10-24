// ui, vehicles, waivers and admin stores.
import { createPinia, setActivePinia } from 'pinia'
import * as api from '@/api'
import { serverTrip, tripInput, vehicle } from '@/test/api-mock'
import type { Coach, CoachYear, Receipt, Waiver } from '@/types'
import {
  useAdminStore,
  useAuthStore,
  useTripsStore,
  useUiStore,
  useVehiclesStore,
  useWaiversStore,
} from '.'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

const waiver: Waiver = {
  year: 2025,
  km: 1000,
  amount: 636,
  waivedAt: '2026-01-05T00:00:00Z',
  receipt: null,
}
const receipt: Receipt = {
  id: 3,
  number: '2025-0001',
  year: 2025,
  coachId: 7,
  amount: 636,
  waivedAt: '2026-01-05T00:00:00Z',
  issuedAt: '2026-02-01T00:00:00Z',
  issuedBy: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.token = 'jwt'
  auth.coach = { id: 7, role: 'president' } as Coach
})

describe('ui store', () => {
  it('defaults to the current year and queues snackbars with an action', async () => {
    const ui = useUiStore()
    expect(ui.year).toBe(new Date().getFullYear())
    const handler = vi.fn()
    const id = ui.notify('Trajet enregistré', { action: { label: 'Annuler', handler } })
    ui.notify('Autre')
    expect(ui.current?.message).toBe('Trajet enregistré')
    await ui.runAction(id)
    expect(handler).toHaveBeenCalledOnce()
    expect(ui.current?.message).toBe('Autre')
    ui.dismiss()
    expect(ui.current).toBeNull()
  })
})

describe('vehicles store', () => {
  it('lists, indexes and picks the last used vehicle', async () => {
    const other = { ...vehicle, id: 2, label: 'Vélo' }
    vi.mocked(api.vehicles.list).mockResolvedValue([vehicle, other])
    const vehicles = useVehiclesStore()
    await vehicles.load()
    expect(vehicles.byId(2)?.label).toBe('Vélo')
    expect(vehicles.lastUsedVehicleId).toBeNull()

    vehicles.markUsed(2)
    expect(vehicles.lastUsedVehicleId).toBe(2)

    vi.mocked(api.trips.listByYear).mockResolvedValue([serverTrip(tripInput, { vehicleId: 1 })])
    await useTripsStore().loadYear(2026)
    expect(vehicles.lastUsedVehicleId).toBe(1)

    vi.mocked(api.vehicles.remove).mockResolvedValue()
    await vehicles.remove(2)
    expect(vehicles.items).toHaveLength(1)
  })
})

describe('waivers store', () => {
  it('waives, locks and withdraws a year', async () => {
    vi.mocked(api.waivers.create).mockResolvedValue(waiver)
    vi.mocked(api.waivers.remove).mockResolvedValue()
    const waivers = useWaiversStore()
    await waivers.waive(2025)
    expect(waivers.lockedYears).toEqual([2025])
    expect(useTripsStore().isYearLocked(2025)).toBe(true)
    await waivers.withdraw(2025)
    expect(waivers.isLocked(2025)).toBe(false)
  })

  it('downloads a receipt', async () => {
    const blob = new Blob(['%PDF'])
    vi.mocked(api.waivers.receiptPdf).mockResolvedValue({ blob, filename: 'recu.pdf' })
    await useWaiversStore().downloadReceipt(3)
    expect(api.saveBlob).toHaveBeenCalledWith(blob, 'recu.pdf')
  })
})

describe('admin store', () => {
  it('loads coaches and issues a receipt', async () => {
    const row: CoachYear = {
      coach: { id: 7 } as Coach,
      totalKm: 1000,
      totalAmount: 636,
      waiver: { ...waiver },
    }
    vi.mocked(api.admin.coaches).mockResolvedValue([row])
    vi.mocked(api.admin.receipts).mockResolvedValue([])
    vi.mocked(api.admin.issueReceipt).mockResolvedValue(receipt)
    const admin = useAdminStore()
    await admin.coaches(2025)
    await admin.receipts(2025)
    await admin.issueReceipt(7, 2025)
    expect(api.admin.issueReceipt).toHaveBeenCalledWith({ coachId: 7, year: 2025 })
    expect(admin.coachesByYear[2025]?.[0]?.waiver?.receipt?.number).toBe('2025-0001')
    expect(admin.receiptsByYear[2025]).toHaveLength(1)
  })
})
