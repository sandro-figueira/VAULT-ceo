import { describe, it, expect } from 'vitest'
import { parseAmount, parseDate, parseCSV, parseOFX } from '@/utils/parsers'

// A File-like helper for parsers that read .text()/.arrayBuffer().
function makeFile(content: string, name: string): File {
  return new File([content], name, { type: 'text/plain' })
}

describe('parseAmount', () => {
  it('trusts real numbers (Excel cells) without inflating them', () => {
    expect(parseAmount(1234.56)).toBe(1234.56)
    expect(parseAmount(50)).toBe(50)
    expect(parseAmount(-50.0)).toBe(-50)
  })

  it('parses dot-decimal strings without multiplying by 100', () => {
    // The old parser turned "50.00" into 5000 — this is the core bug.
    expect(parseAmount('50.00')).toBe(50)
    expect(parseAmount('-50.00')).toBe(-50)
    expect(parseAmount('1234.56')).toBe(1234.56)
  })

  it('parses Brazilian comma-decimal strings', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56)
    expect(parseAmount('R$ 1.500,00')).toBe(1500)
    expect(parseAmount('0,99')).toBe(0.99)
  })

  it('treats a dotted/comma thousands group as an integer', () => {
    expect(parseAmount('1.500')).toBe(1500)
    expect(parseAmount('1.234.567')).toBe(1234567)
    expect(parseAmount('1,234,567')).toBe(1234567)
  })

  it('handles US grouped format with dot decimal', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56)
  })

  it('detects negatives from parentheses and debit suffix', () => {
    expect(parseAmount('(100,00)')).toBe(-100)
    expect(parseAmount('100,00 D')).toBe(-100)
    expect(parseAmount('100,00 C')).toBe(100)
  })

  it('returns null for non-amounts', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount(null)).toBeNull()
    expect(parseAmount(undefined)).toBeNull()
  })
})

describe('parseDate', () => {
  it('parses Brazilian DD/MM/YYYY', () => {
    expect(parseDate('15/01/2024')).toBe('2024-01-15T00:00:00.000Z')
  })

  it('parses DD-MM-YYYY and 2-digit years', () => {
    expect(parseDate('15-01-2024')).toBe('2024-01-15T00:00:00.000Z')
    expect(parseDate('15/01/24')).toBe('2024-01-15T00:00:00.000Z')
  })

  it('parses ISO YYYY-MM-DD', () => {
    expect(parseDate('2024-01-15')).toBe('2024-01-15T00:00:00.000Z')
  })

  it('parses Excel serial numbers', () => {
    // 45307 = 2024-01-16
    expect(parseDate(45307).slice(0, 10)).toBe('2024-01-16')
  })
})

describe('parseCSV', () => {
  it('parses a dot-decimal fintech export correctly (no 100x inflation)', async () => {
    const csv = [
      'date,title,amount',
      '2024-01-15,Mercado,-50.00',
      '2024-01-16,Cliente Pix,1200.00',
    ].join('\n')

    const result = await parseCSV(makeFile(csv, 'nubank.csv'))
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ amount: 50, type: 'expense', description: 'Mercado' })
    expect(result[1]).toMatchObject({ amount: 1200, type: 'income' })
  })

  it('parses Brazilian comma-decimal headers', async () => {
    const csv = [
      'Data;Histórico;Valor',
      '15/01/2024;Pagamento Fornecedor;-1.234,56',
      '16/01/2024;Recebimento Cliente;2.000,00',
    ].join('\n')

    const result = await parseCSV(makeFile(csv, 'itau.csv'))
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ amount: 1234.56, type: 'expense' })
    expect(result[1]).toMatchObject({ amount: 2000, type: 'income' })
  })

  it('supports separate credit/debit columns', async () => {
    const csv = [
      'Data,Descrição,Crédito,Débito',
      '15/01/2024,Venda,500.00,',
      '16/01/2024,Aluguel,,1500.00',
    ].join('\n')

    const result = await parseCSV(makeFile(csv, 'split.csv'))
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ amount: 500, type: 'income' })
    expect(result[1]).toMatchObject({ amount: 1500, type: 'expense' })
  })
})

describe('parseOFX', () => {
  it('parses SGML OFX without closing field tags', async () => {
    const ofx = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240115120000
<TRNAMT>-150.75
<FITID>ABC123
<NAME>Supermercado Pao
<MEMO>Compra cartao
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240116
<TRNAMT>2500.00
<FITID>XYZ789
<NAME>Pix Recebido
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

    const result = await parseOFX(makeFile(ofx, 'extrato.ofx'))
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      amount: 150.75,
      type: 'expense',
      fitid: 'ABC123',
    })
    expect(result[0].description).toContain('Supermercado')
    expect(result[1]).toMatchObject({ amount: 2500, type: 'income', fitid: 'XYZ789' })
    expect(result[0].date.slice(0, 10)).toBe('2024-01-15')
  })

  it('honors TRNTYPE=DEBIT when amount is unsigned', async () => {
    const ofx = `<OFX><STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240115
<TRNAMT>99.90
<FITID>F1
<MEMO>Taxa
</STMTTRN></OFX>`

    const result = await parseOFX(makeFile(ofx, 'fee.ofx'))
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ amount: 99.9, type: 'expense' })
  })
})
