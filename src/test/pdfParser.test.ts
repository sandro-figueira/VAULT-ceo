import { describe, it, expect } from 'vitest'
import {
  extractTransactionsFromText,
  PdfPasswordRequiredError,
  PdfPasswordIncorrectError,
} from '@/utils/pdfParser'

describe('extractTransactionsFromText', () => {
  it('extracts date, description, amount and direction from statement lines', () => {
    const text = [
      'Extrato Conta Corrente - Banco Exemplo',
      'Período: 01/01/2024 a 31/01/2024',
      '15/01/2024  Pagamento Fornecedor ABC      -1.234,56     5.000,00',
      '16/01/2024  Recebimento Cliente XYZ        2.000,00     7.000,00',
      'Saldo final                                             7.000,00',
    ].join('\n')

    const result = extractTransactionsFromText(text)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ amount: 1234.56, type: 'expense', description: expect.stringContaining('Fornecedor') })
    expect(result[1]).toMatchObject({ amount: 2000, type: 'income', description: expect.stringContaining('Cliente') })
    expect(result[0].date.slice(0, 10)).toBe('2024-01-15')
  })

  it('treats parentheses and trailing D as debit (saída)', () => {
    const text = [
      '10/02/2024  Tarifa bancaria        (15,90)',
      '11/02/2024  Compra cartao          99,90 D',
      '12/02/2024  Deposito               500,00 C',
    ].join('\n')

    const result = extractTransactionsFromText(text)
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ amount: 15.9, type: 'expense' })
    expect(result[1]).toMatchObject({ amount: 99.9, type: 'expense' })
    expect(result[2]).toMatchObject({ amount: 500, type: 'income' })
  })

  it('ignores lines without a leading date or without a value', () => {
    const text = [
      'Cabeçalho qualquer sem data',
      '15/01/2024 Linha sem valor monetário',
      '20/01/2024 Pagamento válido 123,45',
      '',
    ].join('\n')

    const result = extractTransactionsFromText(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ amount: 123.45 })
  })

  it('propagates the account when provided', () => {
    const text = '15/01/2024 Compra 50,00 D'
    const result = extractTransactionsFromText(text, '001/12345-6')
    expect(result[0].account).toBe('001/12345-6')
  })
})

describe('PDF password errors', () => {
  it('exposes a user-facing message for an incorrect password', () => {
    expect(new PdfPasswordIncorrectError().message).toBe('Senha incorreta. Tente novamente.')
  })

  it('flags a required password distinctly', () => {
    expect(new PdfPasswordRequiredError()).toBeInstanceOf(PdfPasswordRequiredError)
    expect(new PdfPasswordRequiredError().name).toBe('PdfPasswordRequiredError')
  })
})
