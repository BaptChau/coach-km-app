// ui, vehicles, waivers and admin stores.
import { createPinia, setActivePinia } from 'pinia'
import * as api from '@/api'
import { httpError, serverTrip, tripInput, vehicle } from '@/test/api-mock'
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

describe('waivers lock ↔ trips', () => {
  it('waive → create refused locally → withdraw → create allowed', async () => {
    vi.mocked(api.trips.listByYear).mockResolvedValue([serverTrip(tripInput, { id: 5 })])
    const trips = useTripsStore()
    await trips.loadYear(2026)
    const waivers = useWaiversStore()
    vi.mocked(api.waivers.create).mockResolvedValue({ ...waiver, year: 2026 })
    await waivers.waive(2026)

    await expect(trips.create(tripInput)).rejects.toMatchObject({
      status: 409,
      message: 'Année 2026 clôturée : vous avez renoncé au remboursement.',
    })
    await expect(trips.update(5, { purpose: 'Match' })).rejects.toMatchObject({ status: 409 })
    await expect(trips.remove(5)).rejects.toMatchObject({ status: 409 })
    expect(api.trips.create).not.toHaveBeenCalled()
    expect(api.trips.update).not.toHaveBeenCalled()
    expect(api.trips.remove).not.toHaveBeenCalled()
    expect(trips.trips.map((t) => t.id)).toEqual([5])
    expect(trips.pendingCount).toBe(0)

    vi.mocked(api.waivers.remove).mockResolvedValue()
    await waivers.withdraw(2026)
    vi.mocked(api.trips.create).mockResolvedValue(serverTrip(tripInput, { id: 6 }))
    await expect(trips.create(tripInput)).resolves.toMatchObject({ id: 6 })
    expect(api.trips.create).toHaveBeenCalledOnce()
  })

  it('refuses to move a trip into a waived year', async () => {
    vi.mocked(api.trips.listByYear).mockResolvedValue([serverTrip(tripInput, { id: 5 })])
    const trips = useTripsStore()
    await trips.loadYear(2026)
    useWaiversStore().items = [waiver] // 2025 waived
    await expect(trips.update(5, { date: '2025-12-31' })).rejects.toMatchObject({ status: 409 })
    expect(api.trips.update).not.toHaveBeenCalled()
  })

  it('a 409 from the server reloads the waivers (year locked on another device)', async () => {
    const trips = useTripsStore()
    await trips.loadYear(2026)
    vi.mocked(api.trips.create).mockRejectedValue(
      httpError(409, "this year's reimbursement was waived"),
    )
    vi.mocked(api.waivers.list).mockResolvedValue([{ ...waiver, year: 2026 }])

    await expect(trips.create(tripInput)).rejects.toMatchObject({ status: 409 })
    await vi.waitFor(() => expect(trips.isYearLocked(2026)).toBe(true))
    vi.mocked(api.trips.create).mockClear()
    await expect(trips.create(tripInput)).rejects.toMatchObject({ status: 409 })
    expect(api.trips.create).not.toHaveBeenCalled()
  })
})

describe('admin store: receipts and the coaches list', () => {
  const rowOf = (id: number, w: Waiver | null): CoachYear => ({
    coach: { id, firstName: `C${id}` } as Coach,
    totalKm: 1000,
    totalAmount: 636,
    waiver: w ? { ...w } : null,
  })

  it('issuing a receipt updates the listed coach, and a refetch shows the server state', async () => {
    vi.mocked(api.admin.coaches).mockResolvedValueOnce([rowOf(7, waiver), rowOf(8, null)])
    const admin = useAdminStore()
    await admin.coaches(2025)
    vi.mocked(api.admin.issueReceipt).mockResolvedValue(receipt)

    await admin.issueReceipt(7, 2025)
    const rows = admin.coachesByYear[2025]!
    expect(rows[0]?.waiver?.receipt).toEqual(receipt)
    expect(rows[1]?.waiver).toBeNull()
    // The receipts list was never loaded: it is not created half-empty.
    expect(admin.receiptsByYear[2025]).toBeUndefined()

    vi.mocked(api.admin.coaches).mockResolvedValueOnce([
      rowOf(7, { ...waiver, receipt }),
      rowOf(8, { ...waiver, receipt: null }),
    ])
    await admin.coaches(2025)
    expect(admin.coachesByYear[2025]?.map((r) => !!r.waiver?.receipt)).toEqual([true, false])
    expect(admin.loading).toBe(false)
  })

  it('leaves the list untouched when the server refuses the receipt', async () => {
    vi.mocked(api.admin.coaches).mockResolvedValueOnce([rowOf(7, waiver)])
    const admin = useAdminStore()
    await admin.coaches(2025)
    vi.mocked(api.admin.issueReceipt).mockRejectedValue(
      httpError(409, 'a receipt was already issued for this coach and year'),
    )
    await expect(admin.issueReceipt(7, 2025)).rejects.toMatchObject({ status: 409 })
    expect(admin.coachesByYear[2025]?.[0]?.waiver?.receipt).toBeNull()
  })

  it('reset forgets every year', async () => {
    vi.mocked(api.admin.coaches).mockResolvedValueOnce([rowOf(7, waiver)])
    const admin = useAdminStore()
    await admin.coaches(2025)
    admin.reset()
    expect(admin.coachesByYear).toEqual({})
  })
})
