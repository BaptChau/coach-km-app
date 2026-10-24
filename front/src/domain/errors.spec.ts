import { ApiRequestError } from '@/api/client'
import { describeError, errorMessage, GENERIC_ERROR, NETWORK_ERROR } from './errors'

const http = (status: number, msg: string | null) =>
  new ApiRequestError('http', status, msg ?? `HTTP ${status}`, msg)

describe('describeError', () => {
  it.each<[number, string, string, string | null]>([
    [409, 'email already registered', 'Cet e-mail est déjà inscrit', 'email'],
    [
      409,
      'registrationNumber already registered',
      'Ce numéro de licence est déjà inscrit',
      'registrationNumber',
    ],
    [
      400,
      'registrationNumber has an invalid format',
      '13 chiffres, commençant par 5655006',
      'registrationNumber',
    ],
    [401, 'invalid email or password', 'E-mail ou mot de passe incorrect.', null],
    [
      400,
      'distanceKm must be > 0 and <= 100000',
      'Indiquez une distance entre 0 et 100 000 km',
      'distanceKm',
    ],
    [
      400,
      'fiscalHorsepower (CV) is required for a car or motorcycle',
      'Indiquez la puissance fiscale (CV)',
      'fiscalHorsepower',
    ],
    [400, 'vehicleId must be one of your vehicles', 'Choisissez un de vos véhicules', 'vehicleId'],
    [
      400,
      'label is required (max 100 characters)',
      'Indiquez un libellé (100 caractères max.)',
      'label',
    ],
  ])('%i %s', (status, msg, want, field) => {
    expect(describeError(http(status, msg))).toEqual({ message: want, field })
  })

  it('explains the vehicle conflicts in French', () => {
    expect(
      errorMessage(http(409, 'vehicle is used by trips; delete or reassign them first')),
    ).toMatch(/utilisé par des trajets/)
    expect(
      errorMessage(
        http(
          409,
          'vehicle is used in a year whose reimbursement was waived; only its label can change',
        ),
      ),
    ).toMatch(/seul son libellé/)
  })

  it('maps the waiver and receipt messages', () => {
    expect(
      errorMessage(
        http(
          400,
          'set your postal address (PATCH /auth/me) first: it is printed on the tax receipt',
        ),
      ),
    ).toMatch(/adresse postale/)
    expect(errorMessage(http(409, 'a tax receipt was already issued for this year'))).toMatch(
      /déjà émis/,
    )
    expect(
      errorMessage(
        http(503, 'association details are not configured on the server (ASSOCIATION_* settings)'),
      ),
    ).toMatch(/association/)
    expect(
      errorMessage(
        http(409, "this year's reimbursement was waived; its trips can no longer change"),
      ),
    ).toMatch(/Année clôturée/)
  })

  it('keeps a French message from a store as is', () => {
    const msg = 'Année 2025 clôturée : vous avez renoncé au remboursement.'
    expect(errorMessage(new ApiRequestError('http', 409, msg, msg))).toBe(msg)
  })

  it('falls back on the status, the network and unknown errors', () => {
    expect(errorMessage(new ApiRequestError('network', null, 'Network Error'))).toBe(NETWORK_ERROR)
    expect(errorMessage(new ApiRequestError('timeout', null, 'timeout'))).toBe(NETWORK_ERROR)
    expect(errorMessage(http(500, null))).toMatch(/serveur/)
    expect(errorMessage(http(403, 'forbidden'))).toBe('Action réservée au président.')
    expect(errorMessage(new Error('boom'))).toBe(GENERIC_ERROR)
    expect(errorMessage('nope', 'Autre')).toBe('Autre')
  })
})
