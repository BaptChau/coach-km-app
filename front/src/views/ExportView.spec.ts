// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import * as api from '@/api'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { useUiStore } from '@/stores/ui'
import { coachUser, freshPinia, mountInApp, signIn, testRouter, ROUTE_WAIT } from '@/test/app-test'
import type { Coach, Summary, Waiver } from '@/types'
import ExportView from './ExportView.vue'

vi.mock('@/api', async (orig) => ({
  ...(await import('@/test/api-mock')).mockApi(await orig()),
  exportApi: { download: vi.fn() },
}))

const YEAR = 2025
const withAddress: Coach = {
  ...coachUser,
  address: { line: '1 rue du Stade', postalCode: '55000', city: 'Bar-le-Duc' },
}
const summary: Summary = {
  year: YEAR,
  baremeSource: 'Barème',
  totalKm: 1200,
  totalAmount: 755.16,
  byMonth: [],
  byVehicle: [],
}
const waived: Waiver = {
  year: YEAR,
  km: 1200,
  amount: 755.16,
  waivedAt: '2026-01-10T18:00:00Z',
  receipt: null,
}

async function render(user: Coach, waivers: Waiver[] = []) {
  const pinia = freshPinia()
  signIn(user)
  useUiStore().year = YEAR
  vi.mocked(api.summary.get).mockResolvedValue(summary)
  vi.mocked(api.waivers.list).mockResolvedValue(waivers)
  const router = testRouter()
  await router.push('/export')
  const wrapper = mountInApp(ExportView, pinia, router, { attach: true })
  await flushPromises()
  return { wrapper, router }
}

let mounted: { unmount: () => void } | null = null
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('ExportView', () => {
  it('downloads the PDF and the CSV of the selected year', async () => {
    const blob = new Blob(['x'])
    vi.mocked(api.exportApi.download).mockResolvedValue({ blob, filename: 'recap.pdf' })
    const { wrapper } = await render(withAddress)
    mounted = wrapper
    await wrapper.find('[data-testid="download-pdf"]').trigger('click')
    await flushPromises()
    expect(api.exportApi.download).toHaveBeenCalledWith(YEAR, 'pdf')
    expect(api.saveBlob).toHaveBeenCalledWith(blob, 'recap.pdf')
    await wrapper.find('[data-testid="download-csv"]').trigger('click')
    await flushPromises()
    expect(api.exportApi.download).toHaveBeenCalledWith(YEAR, 'csv')
  })

  it('without an address, sends the coach to Profil first', async () => {
    const { wrapper, router } = await render(coachUser)
    mounted = wrapper
    expect(wrapper.find('[data-testid="waiver-address"]').text()).toContain('adresse postale')
    expect(wrapper.find('[data-testid="waiver-start"]').exists()).toBe(false)
    await wrapper.find('[data-testid="waiver-to-profile"]').trigger('click')
    await vi.waitFor(
      () => expect(router.currentRoute.value.fullPath).toBe('/profil?retour=export'),
      ROUTE_WAIT,
    )
  })

  it('waives after a confirmation that warns about the locked trips', async () => {
    vi.mocked(api.waivers.create).mockResolvedValue(waived)
    const { wrapper } = await render(withAddress)
    mounted = wrapper
    const start = wrapper.find('[data-testid="waiver-start"]')
    expect(start.text()).toMatch(/Renoncer au remboursement de 755,16\s€/)
    await start.trigger('click')
    await flushPromises()

    const dialog = new DOMWrapper(document.body).find('[data-testid="confirm-dialog"]')
    expect(dialog.text()).toContain('Les trajets de 2025 seront verrouillés')
    expect(api.waivers.create).not.toHaveBeenCalled()
    await dialog.find('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()

    expect(api.waivers.create).toHaveBeenCalledWith(YEAR)
    expect(wrapper.find('[data-testid="waiver-waived"]').text()).toContain(
      'Renonciation enregistrée',
    )
    expect(wrapper.find('[data-testid="waiver-withdraw"]').exists()).toBe(true)
  })

  it('withdraws a waiver before the receipt', async () => {
    vi.mocked(api.waivers.remove).mockResolvedValue(undefined)
    const { wrapper } = await render(withAddress, [waived])
    mounted = wrapper
    await wrapper.find('[data-testid="waiver-withdraw"]').trigger('click')
    await flushPromises()
    expect(api.waivers.remove).toHaveBeenCalledWith(YEAR)
    expect(wrapper.find('[data-testid="waiver-start"]').exists()).toBe(true)
  })

  it('shows the receipt number and downloads the receipt', async () => {
    const blob = new Blob(['pdf'])
    vi.mocked(api.waivers.receiptPdf).mockResolvedValue({ blob, filename: 'recu.pdf' })
    const receipt = {
      id: 9,
      number: '2025-0001',
      year: YEAR,
      coachId: coachUser.id,
      amount: 755.16,
      waivedAt: waived.waivedAt,
      issuedAt: '2026-01-17T10:00:00Z',
      issuedBy: 1,
    }
    const { wrapper } = await render(withAddress, [{ ...waived, receipt }])
    mounted = wrapper
    expect(wrapper.find('[data-testid="waiver-receipt"]').text()).toContain(
      'Reçu émis n° 2025-0001',
    )
    await wrapper.find('[data-testid="receipt-download"]').trigger('click')
    await flushPromises()
    expect(api.waivers.receiptPdf).toHaveBeenCalledWith(9)
    expect(api.saveBlob).toHaveBeenCalledWith(blob, 'recu.pdf')
  })
})
