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
      'SELECT id, name, email, password_hash, business_name FROM professionals WHERE email = $1',
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
      token, // também retornado no corpo para clientes que preferem Authorization header
      professional: {
        id: professional.id,
        name: professional.name,
        email: professional.email,
        businessName: professional.business_name,
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
      'SELECT id, name, email, business_name, phone_whatsapp FROM professionals WHERE id = $1',
      [req.professionalId]
    );
    if (!rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}
