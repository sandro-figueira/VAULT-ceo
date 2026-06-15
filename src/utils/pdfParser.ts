import { parseAmount, parseDate, type ImportedTransaction } from './parsers'
import { categorizeTransaction } from './categorizer'

/**
 * Authorized reading of password-protected bank statement PDFs.
 *
 * SECURITY: the password lives only in memory for the duration of a parse call.
 * It is never persisted (Supabase / localStorage / sessionStorage), never put in
 * the returned transactions, and never logged. We do NOT attempt to crack,
 * brute-force or strip the password — we only open the document with the
 * password the user explicitly provided.
 */

/** Thrown when the PDF is encrypted and no (or empty) password was supplied. */
export class PdfPasswordRequiredError extends Error {
  constructor() {
    super('Este PDF está protegido por senha.')
    this.name = 'PdfPasswordRequiredError'
  }
}

/** Thrown when the supplied password is wrong. Message is user-facing. */
export class PdfPasswordIncorrectError extends Error {
  constructor() {
    super('Senha incorreta. Tente novamente.')
    this.name = 'PdfPasswordIncorrectError'
  }
}

// pdf.js PasswordException codes.
const PDF_NEED_PASSWORD = 1
const PDF_INCORRECT_PASSWORD = 2

let pdfjsCache: typeof import('pdfjs-dist') | null = null
async function getPdfjs() {
  if (pdfjsCache) return pdfjsCache
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    // Worker is emitted as a separate asset by Vite; loaded lazily so importing
    // this module (e.g. in tests) doesn't pull in the worker.
    const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  }
  pdfjsCache = pdfjs
  return pdfjs
}

interface TextItemLike {
  str?: string
  transform?: number[]
}

/**
 * Rebuild text lines from pdf.js text items. Items carry their position in a
 * transform matrix ([a,b,c,d,e,f] → e=x, f=y); we group by rounded y to form
 * lines and sort by x so columns read left-to-right.
 */
function reconstructLines(items: TextItemLike[]): string {
  const rows = new Map<number, { x: number; str: string }[]>()
  for (const it of items) {
    if (typeof it.str !== 'string' || it.str === '' || !it.transform) continue
    const y = Math.round(it.transform[5])
    const x = it.transform[4]
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y)!.push({ x, str: it.str })
  }
  const ys = [...rows.keys()].sort((a, b) => b - a) // top of page first
  return ys
    .map((y) =>
      rows.get(y)!
        .sort((a, b) => a.x - b.x)
        .map((s) => s.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .join('\n')
}

// Matches Brazilian money tokens, optionally signed / parenthesized / suffixed
// with D (débito) or C (crédito): "1.234,56", "-50,00", "(1.000,00)", "99,90 D".
const MONEY_RE = /-?\(?\s*R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}\)?\s*[DC]?/gi
const DATE_AT_START_RE = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/

/**
 * Heuristically extract transactions from raw statement text. Bank PDFs have no
 * standard layout, so this is intentionally conservative and the user always
 * reviews the result in the preview before saving.
 *
 * For each line starting with a date we take the description up to the first
 * monetary token, and the first monetary token as the amount (the value usually
 * precedes the running balance). Sign comes from the token itself
 * (minus / parentheses / trailing "D").
 */
export function extractTransactionsFromText(
  text: string,
  account?: string
): ImportedTransaction[] {
  const transactions: ImportedTransaction[] = []
  const currentYear = new Date().getFullYear()

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue // ignore empty lines

    const dateMatch = line.match(DATE_AT_START_RE)
    if (!dateMatch) continue

    const monies = line.match(MONEY_RE)
    if (!monies || monies.length === 0) continue

    // First money token is the transaction amount; a second one is usually the balance.
    const amountToken = monies[0]
    const amount = parseAmount(amountToken)
    if (amount === null || amount === 0) continue

    // Description = text between the date and the first money token.
    const firstMoneyIdx = line.indexOf(amountToken)
    let description = line
      .slice(dateMatch[0].length, firstMoneyIdx >= 0 ? firstMoneyIdx : undefined)
      .replace(/\s+/g, ' ')
      .trim()
    if (!description) description = 'Sem descrição'

    // Normalize a year-less date (DD/MM) using the current year.
    let dateRaw = dateMatch[1]
    if (/^\d{1,2}\/\d{1,2}$/.test(dateRaw)) dateRaw = `${dateRaw}/${currentYear}`
    const date = parseDate(dateRaw)

    const type: 'income' | 'expense' = amount < 0 ? 'expense' : 'income'
    const category = categorizeTransaction(description, type)

    transactions.push({
      date,
      amount: Math.abs(amount),
      description,
      type,
      category,
      account,
    })
  }

  return transactions
}

/** True when the PDF requires a password to open. */
export async function isPdfEncrypted(file: File): Promise<boolean> {
  try {
    await parsePDF(file)
    return false
  } catch (err) {
    return err instanceof PdfPasswordRequiredError
  }
}

/**
 * Open a (optionally password-protected) PDF and extract its transactions.
 *
 * @param password supplied by the user; used only in memory for this call.
 * @throws PdfPasswordRequiredError  when encrypted and no password was given.
 * @throws PdfPasswordIncorrectError when the password is wrong.
 * @throws Error                     with a friendly message for invalid/empty PDFs.
 */
export async function parsePDF(file: File, password?: string): Promise<ImportedTransaction[]> {
  const pdfjs = await getPdfjs()
  const data = new Uint8Array(await file.arrayBuffer())

  let doc
  try {
    doc = await pdfjs.getDocument({ data, password }).promise
  } catch (err: any) {
    if (err?.name === 'PasswordException') {
      if (err.code === PDF_INCORRECT_PASSWORD) throw new PdfPasswordIncorrectError()
      if (err.code === PDF_NEED_PASSWORD) throw new PdfPasswordRequiredError()
    }
    throw new Error(`Não foi possível abrir o PDF "${file.name}". O arquivo pode estar corrompido.`)
  }

  try {
    let fullText = ''
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const content = await page.getTextContent()
      fullText += reconstructLines(content.items as TextItemLike[]) + '\n'
    }

    const transactions = extractTransactionsFromText(fullText)
    if (transactions.length === 0) {
      throw new Error(
        `Não encontramos transações no PDF "${file.name}". ` +
        `Se for um PDF escaneado (imagem), o texto não pode ser extraído.`
      )
    }
    return transactions
  } finally {
    await doc.destroy()
  }
}
