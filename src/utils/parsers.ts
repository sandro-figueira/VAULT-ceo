import Papa from 'papaparse'
import { categorizeTransaction } from './categorizer'

export interface ImportedTransaction {
  date: string
  amount: number
  description: string
  type: 'income' | 'expense'
  category: string
  fitid?: string
  source_id?: string
  account?: string       // bank/account identifier detected from the file (OFX ACCTID, "Conta" column…)
  confidence?: 'high' | 'medium' | 'low'
  installment?: { current: number; total: number }
  isRecurring?: boolean
  senderDomain?: string  // domain of the Gmail sender — used to save email rules
  anomaly?: string       // non-null when transaction looks unusual vs user history
  raw?: any
}

// ──────────────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────────────

/** Normalize a header/key for accent- and case-insensitive comparison. */
const normalizeKey = (key: string): string =>
  key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

/**
 * Parse a monetary value coming from CSV/XLSX into a signed number.
 *
 * Handles the formats real bank/fintech exports actually use:
 *   - Brazilian:  "1.234,56", "R$ 1.500,00", "1.000"
 *   - US/dot:     "1234.56", "-50.00"  (Nubank, English exports, Excel cells)
 *   - Numbers:    1234.56  (Excel stores amounts as real JS numbers)
 *   - Negatives:  "-100", "(100,00)", "100,00 D"
 *
 * The previous implementation blindly stripped every "." which multiplied any
 * dot-decimal value (and every Excel numeric cell) by 100. We instead detect
 * which separator is the decimal one based on its position.
 *
 * @returns the signed number, or null when the value isn't a real amount.
 */
export const parseAmount = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null

  // Excel cells (and already-parsed values) arrive as real numbers — trust them.
  if (typeof raw === 'number') return isNaN(raw) ? null : raw

  let s = String(raw).trim()
  if (!s) return null

  // Detect sign: leading minus, accounting parentheses, or a trailing "D" (debit).
  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1) }
  if (/-/.test(s)) negative = true
  if (/(^|\s)D\.?$/i.test(s.trim())) negative = true   // "100,00 D" → debit
  // A trailing "C" means credit/positive — nothing to do.

  // Keep only digits and the two possible separators.
  s = s.replace(/[^0-9.,]/g, '')
  if (!s) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')

  let normalized: string
  if (lastComma > -1 && lastDot > -1) {
    // Both present → the right-most separator is the decimal one.
    normalized = lastComma > lastDot
      ? s.replace(/\./g, '').replace(',', '.')   // BR: 1.234,56
      : s.replace(/,/g, '')                       // US: 1,234.56
  } else if (lastComma > -1) {
    // Only commas: decimal when a single comma is followed by 1–2 digits.
    const decimals = s.length - lastComma - 1
    const single = s.indexOf(',') === lastComma
    normalized = single && decimals > 0 && decimals <= 2
      ? s.replace(',', '.')
      : s.replace(/,/g, '')   // thousands grouping ("1.234" / "1,234,567")
  } else if (lastDot > -1) {
    // Only dots: decimal when a single dot is followed by 1–2 digits.
    const decimals = s.length - lastDot - 1
    const single = s.indexOf('.') === lastDot
    normalized = single && decimals > 0 && decimals <= 2
      ? s
      : s.replace(/\./g, '')  // thousands grouping ("1.500" / "1.234.567")
  } else {
    normalized = s
  }

  const value = parseFloat(normalized)
  if (isNaN(value)) return null
  return negative ? -Math.abs(value) : value
}

/**
 * Parse a date coming from CSV/XLSX into an ISO string. Handles DD/MM/YYYY
 * (and DD-MM-YYYY, 2-digit years), YYYY-MM-DD, and Excel serial numbers.
 * Falls back to "now" only as a last resort so a single bad cell never throws.
 */
export const parseDate = (raw: unknown): string => {
  if (raw === null || raw === undefined || raw === '') return new Date().toISOString()

  // Excel serial date (days since 1899-12-30).
  if (typeof raw === 'number') {
    const excelEpoch = Date.UTC(1899, 11, 30)
    const d = new Date(excelEpoch + raw * 86400000)
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  }

  const s = String(raw).trim()

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YY (Brazilian day-first).
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (dmy) {
    let [, day, month, year] = dmy
    if (year.length === 2) year = Number(year) > 50 ? `19${year}` : `20${year}`
    const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    const parsed = new Date(iso)
    if (!isNaN(parsed.getTime())) return parsed.toISOString()
  }

  // YYYY-MM-DD (and full ISO timestamps).
  const ymd = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/)
  if (ymd) {
    const [, year, month, day] = ymd
    const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`)
    if (!isNaN(parsed.getTime())) return parsed.toISOString()
  }

  const fallback = new Date(s)
  return isNaN(fallback.getTime()) ? new Date().toISOString() : fallback.toISOString()
}

// ──────────────────────────────────────────────────────────────────────────
// Automatic column detection (tolerant to metadata rows before the header)
// ──────────────────────────────────────────────────────────────────────────

// Logical field a spreadsheet/CSV column maps to.
type FieldKind = 'date' | 'amount' | 'credit' | 'debit' | 'description' | 'account' | 'type'

// Column-name candidates across pt-BR / en bank & fintech exports.
// "Prefix" lists match when the header starts with the candidate (so "Valor (R$)"
// or "Data Lançamento" are recognized). "Exact" lists must match the whole header
// to avoid false positives (e.g. a "Pagamento" column matching "pago").
const DATE_FIELDS = ['date', 'data', 'dt', 'competencia', 'vencimento']
const AMOUNT_FIELDS = ['amount', 'valor', 'quantia', 'value', 'vlr', 'montante', 'preco', 'total']
const DESCRIPTION_FIELDS = [
  'description', 'descricao', 'memo', 'historico', 'lancamento', 'title', 'titulo',
  'detalhes', 'estabelecimento', 'nome', 'observacao', 'referencia', 'beneficiario', 'favorecido',
]
const CREDIT_FIELDS = ['credito', 'credit', 'entrada', 'receita', 'recebido', 'creditos']
const DEBIT_FIELDS = ['debito', 'debit', 'saida', 'despesa', 'pago', 'debitos']
const ACCOUNT_FIELDS = ['conta', 'account', 'conta corrente', 'agencia/conta', 'ag/conta', 'numero da conta']
const TYPE_FIELDS = ['tipo', 'type', 'natureza', 'd/c', 'c/d', 'debito/credito', 'entrada/saida', 'operacao']

const startsWithAny = (n: string, list: string[]): boolean =>
  list.some((c) => { const cn = normalizeKey(c); return n === cn || n.startsWith(cn) })
const equalsAny = (n: string, list: string[]): boolean =>
  list.some((c) => n === normalizeKey(c))

/** Map a header cell to a logical field, or null when it isn't recognized. */
const classifyHeader = (raw: unknown): FieldKind | null => {
  const n = normalizeKey(String(raw ?? ''))
  if (!n) return null
  if (n.includes('saldo')) return null            // running balance — never the amount
  if (startsWithAny(n, DATE_FIELDS)) return 'date'
  if (equalsAny(n, CREDIT_FIELDS)) return 'credit'
  if (equalsAny(n, DEBIT_FIELDS)) return 'debit'
  if (startsWithAny(n, AMOUNT_FIELDS)) return 'amount'
  if (equalsAny(n, ACCOUNT_FIELDS)) return 'account'
  if (equalsAny(n, TYPE_FIELDS)) return 'type'
  if (startsWithAny(n, DESCRIPTION_FIELDS)) return 'description'
  return null
}

// A row already mapped to logical fields.
interface NormalizedRow {
  date?: any; amount?: any; credit?: any; debit?: any
  description?: any; account?: any; type?: any
}

const isEmptyRow = (cells: any[]): boolean =>
  !cells || cells.every((c) => c === null || c === undefined || String(c).trim() === '')

/**
 * Locate the header row in a matrix (array of rows). Many bank exports prepend
 * title/period/account metadata before the real header, so we can't assume row 0.
 * The header is the first row that exposes both a date column and a value column.
 */
const findHeaderRow = (matrix: any[][]): number => {
  const limit = Math.min(matrix.length, 30)
  for (let i = 0; i < limit; i++) {
    const kinds = (matrix[i] || []).map(classifyHeader)
    const hasDate = kinds.includes('date')
    const hasValue = kinds.includes('amount') || kinds.includes('credit') || kinds.includes('debit')
    if (hasDate && hasValue) return i
    if (hasDate && kinds.includes('description') && kinds.filter(Boolean).length >= 2) return i
  }
  return -1
}

/**
 * Convert a raw matrix (CSV/XLSX as array-of-arrays) into normalized rows by
 * auto-detecting the header. Returns null when no usable header (date + value)
 * is found, so callers can surface a friendly error.
 */
export const matrixToNormalizedRows = (matrix: any[][]): NormalizedRow[] | null => {
  const rows = (matrix || []).filter((r) => Array.isArray(r) && !isEmptyRow(r))
  if (rows.length === 0) return []

  const headerRow = findHeaderRow(rows)
  if (headerRow === -1) return null

  const kinds = rows[headerRow].map(classifyHeader)
  const out: NormalizedRow[] = []

  for (let i = headerRow + 1; i < rows.length; i++) {
    const cells = rows[i]
    if (isEmptyRow(cells)) continue              // ignore blank lines

    const norm: NormalizedRow = {}
    kinds.forEach((kind, idx) => {
      if (!kind) return
      const value = cells[idx]
      if (value === undefined || value === null || String(value).trim() === '') return
      if (kind === 'description') {
        // Multiple description columns get concatenated for a richer label.
        norm.description = [norm.description, value].filter((v) => v != null && String(v).trim() !== '').join(' ')
      } else if (norm[kind] === undefined) {
        norm[kind] = value
      }
    })
    out.push(norm)
  }

  return out
}

/**
 * Turn a normalized row into an ImportedTransaction (or null to skip it).
 * Shared by parseCSV and parseXLSX so both formats behave identically.
 */
const rowToTransaction = (row: NormalizedRow): ImportedTransaction | null => {
  // Single amount column first; fall back to separate credit/debit columns.
  let amount = parseAmount(row.amount)
  if (amount === null) {
    const credit = parseAmount(row.credit)
    const debit = parseAmount(row.debit)
    if (credit !== null && credit !== 0) amount = Math.abs(credit)
    else if (debit !== null && debit !== 0) amount = -Math.abs(debit)
  }

  if (amount === null || amount === 0) return null

  // An explicit type/nature column overrides the sign when the amount is unsigned.
  if (amount > 0 && row.type != null) {
    const tn = normalizeKey(String(row.type))
    if (/^(d|debito|saida|despesa|debit)/.test(tn)) amount = -amount
  }

  const date = parseDate(row.date)
  const description = (row.description != null ? String(row.description) : '').trim() || 'Sem descrição'
  const type: 'income' | 'expense' = amount < 0 ? 'expense' : 'income'
  const category = categorizeTransaction(description, type)
  const account = row.account != null && String(row.account).trim() !== '' ? String(row.account).trim() : undefined

  return {
    date,
    amount: Math.abs(amount),
    description,
    type,
    category,
    account,
    raw: row,
  }
}

/**
 * Read a file as text, decoding latin1/windows-1252 when UTF-8 fails. OFX 1.x
 * files are frequently exported in ISO-8859-1, which corrupts accented
 * descriptions (and therefore categorization) when forced through UTF-8.
 */
const readFileAsText = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  if (utf8.includes('\uFFFD')) {
    try {
      return new TextDecoder('windows-1252').decode(buffer)
    } catch {
      return utf8
    }
  }
  return utf8
}

// ──────────────────────────────────────────────────────────────────────────
// Parsers
// ──────────────────────────────────────────────────────────────────────────

export const parseCSV = (file: File): Promise<ImportedTransaction[]> => {
  return new Promise((resolve, reject) => {
    // Parse without a header so we can locate the real header ourselves —
    // many bank CSVs prepend title/period/account metadata rows.
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: 'greedy',
      complete: (results) => {
        try {
          const rows = matrixToNormalizedRows(results.data as any[][])
          if (rows === null) {
            reject(new Error(
              `Não encontramos colunas de data e valor em "${file.name}". ` +
              `Confira se o arquivo é um extrato bancário válido.`
            ))
            return
          }
          const transactions = rows
            .map(rowToTransaction)
            .filter(Boolean) as ImportedTransaction[]
          resolve(transactions)
        } catch (error) {
          reject(error)
        }
      },
      error: () => {
        reject(new Error(`Não foi possível ler o arquivo CSV "${file.name}". Ele pode estar corrompido.`))
      },
    })
  })
}

export const parseOFX = async (file: File): Promise<ImportedTransaction[]> => {
  const text = await readFileAsText(file)

  if (!/<OFX[\s>]/i.test(text) && !/<STMTTRN>/i.test(text)) {
    throw new Error(`O arquivo "${file.name}" não parece ser um OFX válido.`)
  }

  // Account identifier from the statement header (BANKACCTFROM/CCACCTFROM).
  const acctId = text.match(/<ACCTID>([^<\r\n]+)/i)?.[1]?.trim()
  const bankId = text.match(/<BANKID>([^<\r\n]+)/i)?.[1]?.trim()
  const account = acctId ? (bankId ? `${bankId}/${acctId}` : acctId) : undefined

  const transactions: ImportedTransaction[] = []

  // Split on the opening tag so we tolerate files that omit the closing
  // </STMTTRN> (some bank exporters do). Each chunk holds one transaction.
  const chunks = text.split(/<STMTTRN>/i).slice(1)

  for (const chunk of chunks) {
    // Cut at the closing tag when present; otherwise stop at the next aggregate.
    const content = chunk.split(/<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>/i)[0]

    const getValue = (tag: string): string | null => {
      // OFX can use "<TAG>value" (SGML) or "<TAG>value</TAG>" (XML/OFX 2.x).
      const match = content.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i'))
      return match ? match[1].trim() : null
    }

    const amountRaw = getValue('TRNAMT')
    const dateRaw = getValue('DTPOSTED') || getValue('DTUSER')

    if (!amountRaw || !dateRaw) continue

    let amount = parseAmount(amountRaw)
    if (amount === null) continue

    // OFX TRNAMT is normally signed, but some banks emit a positive value and
    // rely on TRNTYPE. Honor an explicit debit type when the sign is missing.
    const trntype = (getValue('TRNTYPE') || '').toUpperCase()
    if (amount > 0 && /DEBIT|FEE|PAYMENT|CHECK|ATM|WITHDRAWAL|DIRECTDEBIT|SRVCHG/.test(trntype)) {
      amount = -amount
    }

    // OFX date: YYYYMMDD or YYYYMMDDHHMMSS[.xxx][tz]
    const year = dateRaw.substring(0, 4)
    const month = dateRaw.substring(4, 6)
    const day = dateRaw.substring(6, 8)
    let date: string
    const parsed = new Date(`${year}-${month}-${day}`)
    date = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()

    const name = getValue('NAME') || ''
    const memo = getValue('MEMO') || ''
    const fitid = getValue('FITID') || undefined

    // Use NAME + MEMO for a richer description, avoiding duplicates.
    const parts = [name, memo].filter(Boolean)
    const description = (parts[0] === parts[1] ? parts[0] : parts.join(' - ')) || 'Sem descrição'

    const type: 'income' | 'expense' = amount < 0 ? 'expense' : 'income'
    const category = categorizeTransaction(description, type)

    transactions.push({
      date,
      amount: Math.abs(amount),
      description,
      type,
      category,
      fitid,
      account,
      raw: chunk,
    })
  }

  return transactions
}

export const parseXLSX = async (file: File): Promise<ImportedTransaction[]> => {
  const { read, utils } = await import('xlsx')

  const buffer = await file.arrayBuffer()
  let workbook
  try {
    workbook = read(buffer, { type: 'array' })
  } catch {
    throw new Error(`Não foi possível ler a planilha "${file.name}". O arquivo pode estar corrompido.`)
  }

  // Use the first sheet.
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error(`A planilha "${file.name}" está vazia.`)

  const sheet = workbook.Sheets[sheetName]
  // Read as a matrix (raw values) so we can auto-detect the header even when
  // the sheet has title/metadata rows above it, and keep numbers/dates intact.
  const matrix = utils.sheet_to_json<any[]>(sheet, { header: 1, raw: true, blankrows: false })

  const rows = matrixToNormalizedRows(matrix)
  if (rows === null) {
    throw new Error(`Não encontramos colunas de data e valor na planilha "${file.name}".`)
  }

  return rows
    .map(rowToTransaction)
    .filter(Boolean) as ImportedTransaction[]
}
