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
      'SELECT id, name, email, password_hash, business_name, is_admin FROM professionals WHERE email = $1',
      [email]
    );
    const professional = rows[0];
    if (!professional) throw new HttpError(401, 'E-mail ou senha inválidos.');

    const valid = await bcrypt.compare(password, professional.password_hash);
    if (!valid) throw new HttpError(401, 'E-mail ou senha inválidos.');

    const token = jwt.sign({ sub: professional.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    res.cookie('nailflow_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      token,
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
      'SELECT id, name, email, business_name, phone_whatsapp, avatar_b64, is_admin FROM professionals WHERE id = $1',
      [req.professionalId]
    );
    if (!rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

const MAX_AVATAR_B64_BYTES = 400_000;

const updateMeSchema = z.object({
  name:            z.string().min(1, 'Nome obrigatório').max(100),
  business_name:   z.string().min(1, 'Nome do negócio obrigatório').max(100),
  phone_whatsapp:  z.string().min(10, 'WhatsApp inválido (mínimo 10 dígitos)').max(20),
  email:           z.string().email('E-mail inválido').max(200),
  avatar_b64:      z.union([z.string().max(MAX_AVATAR_B64_BYTES, 'Imagem muito grande.'), z.null()]).optional(),
});

export async function updateMe(req, res, next) {
  try {
    const { name, business_name, phone_whatsapp, email, avatar_b64 } = updateMeSchema.parse(req.body);
    const hasAvatar = Object.prototype.hasOwnProperty.call(req.body, 'avatar_b64');

    const { rows: conflict } = await pool.query(
      'SELECT id FROM professionals WHERE email = $1 AND id != $2',
      [email, req.professionalId]
    );
    if (conflict.length > 0) throw new HttpError(409, 'Este e-mail já está em uso por outra conta.');

    let rows;
    if (hasAvatar) {
      ({ rows } = await pool.query(
        `UPDATE professionals
           SET name = $1, business_name = $2, phone_whatsapp = $3, email = $4, avatar_b64 = $5
         WHERE id = $6
         RETURNING id, name, email, business_name, phone_whatsapp, avatar_b64`,
        [name, business_name, phone_whatsapp, email, avatar_b64 ?? null, req.professionalId]
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE professionals
           SET name = $1, business_name = $2, phone_whatsapp = $3, email = $4
         WHERE id = $5
         RETURNING id, name, email, business_name, phone_whatsapp, avatar_b64`,
        [name, business_name, phone_whatsapp, email, req.professionalId]
      ));
    }

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
