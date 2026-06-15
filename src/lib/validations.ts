// Zod Validation Schemas - Vault Caixa Alerta
import { z } from 'zod'

// Transaction schemas
export const transactionSchema = z.object({
  type: z.enum(['income', 'expense'], {
    required_error: 'Tipo de transação é obrigatório',
  }),
  amount: z
    .number({
      required_error: 'Valor é obrigatório',
      invalid_type_error: 'Valor deve ser um número',
    })
    .positive('Valor deve ser maior que zero')
    .max(999999999, 'Valor muito alto'),
  description: z
    .string({
      required_error: 'Descrição é obrigatória',
    })
    .min(3, 'Descrição deve ter pelo menos 3 caracteres')
    .max(200, 'Descrição muito longa'),
  category: z.string({
    required_error: 'Categoria é obrigatória',
  }),
  date: z.string().optional(),
  source_id: z.string().optional(),
})

export type TransactionInput = z.infer<typeof transactionSchema>

// Financial goal schemas
export const financialGoalSchema = z.object({
  title: z
    .string({
      required_error: 'Título é obrigatório',
    })
    .min(3, 'Título deve ter pelo menos 3 caracteres')
    .max(100, 'Título muito longo'),
  targetAmount: z
    .number({
      required_error: 'Valor da meta é obrigatório',
    })
    .positive('Valor deve ser maior que zero'),
  currentAmount: z.number().nonnegative('Valor atual não pode ser negativo').optional(),
  deadline: z.string().optional(),
})

export type FinancialGoalInput = z.infer<typeof financialGoalSchema>

// Profile schemas
export const profileSchema = z.object({
  fullName: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(100).optional(),
  companyName: z.string().min(2, 'Nome da empresa deve ter pelo menos 2 caracteres').max(100).optional(),
  phone: z
    .string()
    .regex(/^\+?[\d\s-()]+$/, 'Formato de telefone inválido')
    .optional(),
})

export type ProfileInput = z.infer<typeof profileSchema>

// Auth schemas
export const signupSchema = z.object({
  email: z
    .string({
      required_error: 'Email é obrigatório',
    })
    .email('Email inválido'),
  password: z
    .string({
      required_error: 'Senha é obrigatória',
    })
    .min(6, 'Senha deve ter pelo menos 6 caracteres')
    .max(100, 'Senha muito longa'),
  fullName: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').optional(),
  companyName: z.string().optional(),
})

export const loginSchema = z.object({
  email: z
    .string({
      required_error: 'Email é obrigatório',
    })
    .email('Email inválido'),
  password: z.string({
    required_error: 'Senha é obrigatória',
  }),
})

export type SignupInput = z.infer<typeof signupSchema>
export type LoginInput = z.infer<typeof loginSchema>

// Signup form (UI) — adds required full name + password confirmation.
export const signupFormSchema = z
  .object({
    fullName: z
      .string({ required_error: 'Nome é obrigatório' })
      .min(2, 'Informe seu nome completo'),
    email: z.string({ required_error: 'E-mail é obrigatório' }).email('E-mail inválido'),
    password: z
      .string({ required_error: 'Senha é obrigatória' })
      .min(6, 'A senha deve ter pelo menos 6 caracteres')
      .max(100, 'Senha muito longa'),
    confirmPassword: z.string({ required_error: 'Confirme a senha' }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'As senhas não coincidem',
    path: ['confirmPassword'],
  })

export type SignupFormInput = z.infer<typeof signupFormSchema>

// Reset-password form — new password + confirmation.
export const resetPasswordSchema = z
  .object({
    password: z
      .string({ required_error: 'Senha é obrigatória' })
      .min(6, 'A senha deve ter pelo menos 6 caracteres')
      .max(100, 'Senha muito longa'),
    confirmPassword: z.string({ required_error: 'Confirme a senha' }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'As senhas não coincidem',
    path: ['confirmPassword'],
  })

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

// Categories
export const TRANSACTION_CATEGORIES = [
  'Vendas',
  'Fornecedores',
  'Fixo',
  'Variável',
  'Receita',
  'Salários',
  'Aluguel',
  'Serviços',
  'Marketing',
  'Impostos',
  'Outros',
] as const

export const transactionCategorySchema = z.enum(TRANSACTION_CATEGORIES)

// ============================================================
// TAX SCHEMAS
// ============================================================

// Tax Settings Schema
export const taxSettingsSchema = z.object({
  regime: z.enum(['simples_nacional', 'presumido', 'real', 'mei'], {
    required_error: 'Regime tributário é obrigatório',
  }),
  simples_anexo: z.enum(['I', 'II', 'III', 'IV', 'V']).optional(),
  iss_rate: z
    .number()
    .min(0, 'Taxa de ISS não pode ser negativa')
    .max(10, 'Taxa de ISS muito alta')
    .optional()
    .default(2.0),
  iss_municipality: z.string().optional(),
  has_employees: z.boolean().optional().default(false),
  employee_count: z.number().nonnegative('Número de funcionários não pode ser negativo').optional().default(0),
  prolabore_amount: z.number().nonnegative('Pró-labore não pode ser negativo').optional(),
})

export type TaxSettingsInput = z.infer<typeof taxSettingsSchema>

// Tax Calculation Schema
export const taxCalculationSchema = z.object({
  month: z.number().int().min(1, 'Mês inválido').max(12, 'Mês inválido'),
  year: z.number().int().min(2020, 'Ano inválido').max(2100, 'Ano inválido'),
  das_amount: z.number().nonnegative('Valor de DAS não pode ser negativo').optional(),
  iss_amount: z.number().nonnegative('Valor de ISS não pode ser negativo').optional(),
  inss_amount: z.number().nonnegative('Valor de INSS não pode ser negativo').optional(),
  irpj_amount: z.number().nonnegative('Valor de IRPJ não pode ser negativo').optional(),
})

export type TaxCalculationInput = z.infer<typeof taxCalculationSchema>

// Tax Payment Schema
export const taxPaymentSchema = z.object({
  calculation_id: z.string().uuid().optional(),
  tax_type: z.enum(['das', 'darf_irpj', 'darf_iss', 'darf_inss', 'other'], {
    required_error: 'Tipo de imposto é obrigatório',
  }),
  amount: z.number().positive('Valor deve ser maior que zero'),
  due_date: z.string({
    required_error: 'Data de vencimento é obrigatória',
  }),
  payment_code: z.string().optional(),
})

export type TaxPaymentInput = z.infer<typeof taxPaymentSchema>
