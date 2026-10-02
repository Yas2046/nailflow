import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function login(req, res, next) {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const { rows } = await pool.query(
      'SELECT id, name, email, password_hash, business_name, is_admin, blocked_at, token_version FROM professionals WHERE email = $1',
      [email]
    );
    const professional = rows[0];
    // Mensagem sempre igual (e-mail inexistente, senha errada ou conta
    // bloqueada): não revela qual dessas situações ocorreu.
    const invalidCredentials = () => new HttpError(401, 'Credenciais inválidas ou acesso indisponível.');
    if (!professional) throw invalidCredentials();

    const valid = await bcrypt.compare(password, professional.password_hash);
    if (!valid) throw invalidCredentials();
    if (professional.blocked_at !== null) throw invalidCredentials();

    const token = jwt.sign({ sub: professional.id, ver: professional.token_version }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    res.cookie('nailflow_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // O frontend usa so o cookie httpOnly; devolver o token tambem no corpo
    // expunha ele em texto plano a qualquer leitor da resposta (log, extensao
    // de navegador etc.), enfraquecendo a protecao do httpOnly.
    res.json({
      professional: {
        id: professional.id,
        name: professional.name,
        email: professional.email,
        businessName: professional.business_name,
        isAdmin: professional.is_admin ?? false,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de login inválidos.'));
    next(err);
  }
}

export async function logout(req, res) {
  res.clearCookie('nailflow_token');
  res.status(204).end();
}

export async function me(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, business_name, phone_whatsapp, avatar_b64, is_admin, slug, bio, public_theme FROM professionals WHERE id = $1',
      [req.professionalId]
    );
    if (!rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// Abaixo do limite de corpo do express.json() (100KB), com folga para os demais
// campos: assim o limite da foto é alcançável (400 com mensagem) em vez de o
// corpo ser cortado antes com 413.
export const MAX_AVATAR_B64_BYTES = 90_000;
export const AVATAR_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
export const PUBLIC_THEMES = ['vinho', 'verde', 'azul'];
export const MAX_BIO_LENGTH = 280;

export const updateMeSchema = z.object({
  name:            z.string().min(1, 'Nome obrigatório').max(100),
  business_name:   z.string().min(1, 'Nome do negócio obrigatório').max(100),
  phone_whatsapp:  z.string().min(10, 'WhatsApp inválido (mínimo 10 dígitos)').max(20),
  email:           z.string().email('E-mail inválido').max(200),
  avatar_b64:      z.union([
                     z.string()
                       .max(MAX_AVATAR_B64_BYTES, 'Imagem muito grande.')
                       .regex(AVATAR_DATA_URL_RE, 'Formato de imagem inválido. Use JPEG, PNG ou WebP.'),
                     z.null(),
                   ]).optional(),
  bio:             z.union([z.string().trim().max(MAX_BIO_LENGTH, `A apresentação deve ter no máximo ${MAX_BIO_LENGTH} caracteres.`), z.null()]).optional(),
  public_theme:    z.enum(PUBLIC_THEMES, { errorMap: () => ({ message: 'Cor da página inválida.' }) }).optional(),
});

const IDENTITY_KEYS = ['name', 'business_name', 'phone_whatsapp', 'email'];
const OPTIONAL_KEYS = ['avatar_b64', 'bio', 'public_theme'];
const optionalOnlySchema = updateMeSchema.pick({ avatar_b64: true, bio: true, public_theme: true });

export async function updateMe(req, res, next) {
  try {
    const body = req.body ?? {};
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

    // Os dados de identidade continuam tudo-ou-nada (mesma validação de sempre).
    // Sem nenhum deles no corpo, só bio/tema/foto são atualizados -- assim a
    // profissional pode salvar a página pública antes de informar o WhatsApp.
    const touchesIdentity = IDENTITY_KEYS.some(has);
    if (!touchesIdentity && !OPTIONAL_KEYS.some(has)) {
      throw new HttpError(400, 'Nenhum campo para atualizar.');
    }
    const { name, business_name, phone_whatsapp, email, avatar_b64, bio, public_theme } =
      touchesIdentity ? updateMeSchema.parse(body) : optionalOnlySchema.parse(body);

    const sets = [];
    const values = [];
    if (touchesIdentity) {
      const { rows: conflict } = await pool.query(
        'SELECT id FROM professionals WHERE email = $1 AND id != $2',
        [email, req.professionalId]
      );
      if (conflict.length > 0) throw new HttpError(409, 'Este e-mail já está em uso por outra conta.');
      values.push(name, business_name, phone_whatsapp, email);
      sets.push('name = $1', 'business_name = $2', 'phone_whatsapp = $3', 'email = $4');
    }
    // Campos opcionais só são alterados quando enviados no corpo.
    const addOptional = (column, value) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (has('avatar_b64')) addOptional('avatar_b64', avatar_b64 ?? null);
    if (has('bio')) addOptional('bio', bio ? bio : null);
    if (has('public_theme') && public_theme) addOptional('public_theme', public_theme);
    values.push(req.professionalId);

    const { rows } = await pool.query(
      `UPDATE professionals SET ${sets.join(', ')} WHERE id = $${values.length}
       RETURNING id, name, email, business_name, phone_whatsapp, avatar_b64, slug, bio, public_theme`,
      values
    );

    if (!rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError)
      return next(new HttpError(400, err.errors[0]?.message ?? 'Dados inválidos.'));
    next(err);
  }
}

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const registerSchema = z.object({
  email:        z.string().email('E-mail inválido.').max(200).transform((v) => v.trim().toLowerCase()),
  password:     z.string().min(8, 'A senha deve ter no mínimo 8 caracteres.').max(100),
  businessName: z.string().min(2, 'Nome do negócio obrigatório (mínimo 2 caracteres).').max(100).transform((v) => v.trim()),
  slug:         z.string()
                  .min(3, 'Slug deve ter no mínimo 3 caracteres.')
                  .max(50, 'Slug deve ter no máximo 50 caracteres.')
                  .transform((v) => v.trim().toLowerCase())
                  .refine((v) => slugRegex.test(v), {
                    message: 'Slug inválido. Use apenas letras minúsculas, números e hífens (sem início/fim com hífen).',
                  }),
});

export async function register(req, res, next) {
  try {
    const { email, password, businessName, slug } = registerSchema.parse(req.body);

    // Verificar unicidade de email e slug em paralelo
    const [emailCheck, slugCheck] = await Promise.all([
      pool.query('SELECT id FROM professionals WHERE email = $1', [email]),
      pool.query('SELECT id FROM professionals WHERE slug = $1', [slug]),
    ]);

    if (emailCheck.rows.length > 0) throw new HttpError(409, 'Este e-mail já está cadastrado.');
    if (slugCheck.rows.length > 0) throw new HttpError(409, 'Este slug já está em uso. Escolha outro.');

    const passwordHash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `INSERT INTO professionals (name, email, password_hash, business_name, slug, wa_instance_name)
       VALUES ($1, $2, $3, $4, $5, NULL)
       RETURNING id, name, email, business_name`,
      [businessName, email, passwordHash, businessName, slug]
    );

    const professional = rows[0];
    res.status(201).json({
      message: 'Cadastro realizado com sucesso.',
      professional: {
        id: professional.id,
        name: professional.name,
        email: professional.email,
        businessName: professional.business_name,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError)
      return next(new HttpError(400, err.errors[0]?.message ?? 'Dados de cadastro inválidos.'));
    next(err);
  }
}

// ── Regras de confirmação e sinal (por profissional) ───────────────────────
// Sinal por Pix manual: só com confirmação automática (o horário é confirmado
// quando a profissional marca o pagamento como recebido). O prazo de pagamento
// é fixo (2 horas) e não é configurável. Os valores são validados aqui; o
// frontend nunca define quanto será cobrado de cada cliente.
const DEPOSIT_PERCENTAGES = [30, 50, 100];
const MIN_FIXED_DEPOSIT_CENTS = 100;       // R$ 1,00
const MAX_FIXED_DEPOSIT_CENTS = 1_000_000; // R$ 10.000,00
const PIX_KEY_RE = /^[A-Za-z0-9@.+_-]{5,77}$/;

const bookingSettingsSchema = z.object({
  confirmation_mode: z.enum(['manual', 'automatic'], { errorMap: () => ({ message: 'Modo de confirmação inválido.' }) }).optional(),
  deposit_required: z.boolean({ invalid_type_error: 'Valor inválido para cobrança de sinal.' }).optional(),
  deposit_type: z.enum(['percentage', 'fixed'], { errorMap: () => ({ message: 'Tipo de sinal inválido.' }) }).optional(),
  deposit_value: z.number({ invalid_type_error: 'Valor do sinal inválido.' }).int('Valor do sinal inválido.').optional(),
  pix_key: z.union([z.string().trim().max(120, 'Chave Pix inválida.'), z.null()]).optional(),
}).strict();

const BOOKING_SETTINGS_COLUMNS = 'confirmation_mode, deposit_required, deposit_type, deposit_value, pix_key';

export async function getBookingSettings(req, res, next) {
  try {
    const { rows } = await pool.query(`SELECT ${BOOKING_SETTINGS_COLUMNS} FROM professionals WHERE id = $1`, [req.professionalId]);
    if (!rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

function validateDepositSettings(s) {
  if (s.deposit_type != null || s.deposit_value != null) {
    if (s.deposit_type == null || s.deposit_value == null) {
      throw new HttpError(400, 'Informe o tipo e o valor do sinal.');
    }
    if (s.deposit_type === 'percentage' && !DEPOSIT_PERCENTAGES.includes(s.deposit_value)) {
      throw new HttpError(400, 'O percentual do sinal deve ser 30%, 50% ou 100%.');
    }
    if (s.deposit_type === 'fixed' && (s.deposit_value < MIN_FIXED_DEPOSIT_CENTS || s.deposit_value > MAX_FIXED_DEPOSIT_CENTS)) {
      throw new HttpError(400, 'O valor fixo do sinal deve ficar entre R$ 1,00 e R$ 10.000,00.');
    }
  }
  if (s.pix_key != null && !PIX_KEY_RE.test(s.pix_key)) {
    throw new HttpError(400, 'Chave Pix inválida. Use CPF/CNPJ, e-mail, telefone ou chave aleatória, sem espaços.');
  }
  if (s.deposit_required) {
    if (s.confirmation_mode !== 'automatic') {
      throw new HttpError(400, 'Para cobrar sinal, a confirmação precisa ser automática: o horário é confirmado quando você marca o pagamento como recebido.');
    }
    if (s.deposit_type == null) throw new HttpError(400, 'Informe o tipo e o valor do sinal.');
    if (!s.pix_key) throw new HttpError(400, 'Informe a chave Pix para cobrar o sinal.');
  }
}

export async function updateBookingSettings(req, res, next) {
  try {
    const body = bookingSettingsSchema.parse(req.body ?? {});
    const keys = Object.keys(body);
    if (keys.length === 0) throw new HttpError(400, 'Nenhum campo para atualizar.');

    const { rows: cur } = await pool.query(`SELECT ${BOOKING_SETTINGS_COLUMNS} FROM professionals WHERE id = $1`, [req.professionalId]);
    if (!cur[0]) throw new HttpError(404, 'Profissional não encontrada.');

    const merged = { ...cur[0], ...body };
    if (typeof merged.pix_key === 'string' && merged.pix_key === '') merged.pix_key = null;
    validateDepositSettings(merged);

    const sets = [];
    const values = [];
    for (const key of ['confirmation_mode', 'deposit_required', 'deposit_type', 'deposit_value', 'pix_key']) {
      if (key in body) {
        values.push(merged[key]);
        sets.push(`${key} = $${values.length}`);
      }
    }
    values.push(req.professionalId);
    const { rows } = await pool.query(
      `UPDATE professionals SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${BOOKING_SETTINGS_COLUMNS}`,
      values
    );
    if (!rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, err.issues[0]?.message || 'Dados inválidos.'));
    next(err);
  }
}
