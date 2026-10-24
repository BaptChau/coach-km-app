// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import * as api from '@/api'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { useUiStore } from '@/stores/ui'
import { httpError } from '@/test/api-mock'
import {
  coachUser,
  freshPinia,
  mountInApp,
  presidentUser,
  signIn,
  testRouter,
} from '@/test/app-test'
import type { CoachYear, Receipt } from '@/types'
import AdminView from './AdminView.vue'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

const YEAR = 2025
const receipt: Receipt = {
  id: 4,
  number: '2025-0001',
  year: YEAR,
  coachId: 11,
  amount: 100,
  waivedAt: '2026-01-02T10:00:00Z',
  issuedAt: '2026-01-05T10:00:00Z',
  issuedBy: 1,
}

function row(id: number, first: string, waiver: CoachYear['waiver']): CoachYear {
  return {
    coach: {
      ...coachUser,
      id,
      firstName: first,
      lastName: 'Martin',
      registrationNumber: `56550060000${id}`,
    },
    totalKm: 300,
    totalAmount: 190.8,
    waiver,
  }
}

function rows(): CoachYear[] {
  return [
    row(10, 'Alice', {
      year: YEAR,
      km: 300,
      amount: 190.8,
      waivedAt: receipt.waivedAt,
      receipt: null,
    }),
    row(11, 'Bruno', { year: YEAR, km: 150, amount: 100, waivedAt: receipt.waivedAt, receipt }),
    row(12, 'Chloé', null),
  ]
}

async function render() {
  const pinia = freshPinia()
  signIn(presidentUser)
  useUiStore().year = YEAR
  vi.mocked(api.admin.coaches).mockResolvedValue(rows())
  const router = testRouter()
  await router.push('/admin')
  const wrapper = mountInApp(AdminView, pinia, router, { attach: true })
  await flushPromises()
  return wrapper
}

const names = (w: Awaited<ReturnType<typeof render>>) =>
  w.findAll('[data-testid="coach-card"]').map((c) => c.text().split(' Martin')[0])

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

describe('AdminView', () => {
  it('lists every coach with a status chip and filters them', async () => {
    const wrapper = (mounted = await render())
    expect(api.admin.coaches).toHaveBeenCalledWith(YEAR)
    expect(names(wrapper)).toEqual(['Alice', 'Bruno', 'Chloé'])
    expect(wrapper.findAll('[data-testid="coach-status"]').map((c) => c.text())).toEqual([
      'À émettre',
      'Reçu émis',
      'Sans renonciation',
    ])
    expect(wrapper.find('[data-testid="filter-toIssue"]').text()).toBe('À émettre (1)')

    await wrapper.find('[data-testid="filter-toIssue"]').trigger('click')
    expect(names(wrapper)).toEqual(['Alice'])
    await wrapper.find('[data-testid="filter-issued"]').trigger('click')
    expect(names(wrapper)).toEqual(['Bruno'])
    await wrapper.find('[data-testid="filter-noWaiver"]').trigger('click')
    expect(names(wrapper)).toEqual(['Chloé'])
    await wrapper.find('[data-testid="filter-all"]').trigger('click')
    expect(names(wrapper)).toHaveLength(3)
  })

  it('issues a receipt after a confirmation, then offers the download', async () => {
    const issued: Receipt = { ...receipt, id: 5, number: '2025-0002', coachId: 10 }
    vi.mocked(api.admin.issueReceipt).mockResolvedValue(issued)
    vi.mocked(api.waivers.receiptPdf).mockResolvedValue({
      blob: new Blob(['x']),
      filename: 'r.pdf',
    })
    const wrapper = (mounted = await render())

    await wrapper.find('[data-testid="issue-receipt"]').trigger('click')
    await flushPromises()
    const dialog = new DOMWrapper(document.body).find('[data-testid="confirm-dialog"]')
    expect(dialog.text()).toContain('Alice Martin')
    expect(api.admin.issueReceipt).not.toHaveBeenCalled()
    await dialog.find('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()

    expect(api.admin.issueReceipt).toHaveBeenCalledWith({ coachId: 10, year: YEAR })
    expect(useUiStore().current?.message).toContain('Reçu n° 2025-0002 émis')
    expect(wrapper.find('[data-testid="issue-receipt"]').exists()).toBe(false)
    const downloads = wrapper.findAll('[data-testid="download-receipt"]')
    expect(downloads).toHaveLength(2)
    await downloads[0]!.trigger('click')
    await flushPromises()
    expect(api.waivers.receiptPdf).toHaveBeenCalledWith(5)
  })

  it('shows the 503 (association not configured) in French', async () => {
    vi.mocked(api.admin.issueReceipt).mockRejectedValue(
      httpError(
        503,
        'association details are not configured on the server (ASSOCIATION_* settings)',
      ),
    )
    const wrapper = (mounted = await render())
    await wrapper.find('[data-testid="issue-receipt"]').trigger('click')
    await flushPromises()
    await new DOMWrapper(document.body).find('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(useUiStore().current?.message).toContain('informations de l’association')
    expect(useUiStore().current?.color).toBe('error')
  })
})
