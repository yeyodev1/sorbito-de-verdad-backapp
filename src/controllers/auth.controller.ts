import { HttpStatusCode } from 'axios';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { User } from '../models/User.model';
import { AuthRequest } from '../types/AuthRequest';
import { emailService } from '../services/email.service';

const signToken = (userId: string, email: string, role: string) =>
  jwt.sign(
    { userId, email, accountType: role },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' }
  );

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'Nombre, email y contraseña son requeridos' });
      return;
    }
    const existing = await User.findOne({ email });
    if (existing) {
      res.status(HttpStatusCode.Conflict).send({ success: false, message: 'Este email ya está registrado' });
      return;
    }
    const user = await User.create({ name, email, password });
    const token = signToken(String(user._id), user.email, user.role);

    // Fire-and-forget: don't block registration if email fails
    const origin = req.headers.origin as string | undefined;
    emailService.sendWelcome(user.email, user.name, origin).catch((err) => {
      console.error('[Auth] sendWelcome failed:', err?.message || err);
    });

    res.status(HttpStatusCode.Created).send({
      success: true,
      data: { token, user: { id: user._id, name: user.name, email: user.email, role: user.role } },
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'Email y contraseña son requeridos' });
      return;
    }
    const user = await User.findOne({ email, isActive: true });
    if (!user || !(await user.comparePassword(password))) {
      res.status(HttpStatusCode.Unauthorized).send({ success: false, message: 'Credenciales inválidas' });
      return;
    }
    const token = signToken(String(user._id), user.email, user.role);
    res.send({
      success: true,
      data: { token, user: { id: user._id, name: user.name, email: user.email, role: user.role } },
    });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user?.userId).select('-password');
    if (!user) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Usuario no encontrado' });
      return;
    }
    res.send({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'El email es requerido' });
      return;
    }

    const user = await User.findOne({ email, isActive: true });
    // Always respond OK to avoid user enumeration
    if (!user) {
      res.send({ success: true, message: 'Si el email existe, recibirás un enlace de recuperación.' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await user.save({ validateBeforeSave: false });

    const frontendOrigin = req.headers.origin as string | undefined;
    const emailResult = await emailService.sendPasswordReset(user.email, user.name, token, frontendOrigin);
    if (!emailResult.success) {
      // Roll back token so the user can try again
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      res.status(HttpStatusCode.InternalServerError).send({ success: false, message: 'No se pudo enviar el email. Inténtalo de nuevo.' });
      return;
    }

    res.send({ success: true, message: 'Si el email existe, recibirás un enlace de recuperación.' });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'Token y nueva contraseña son requeridos' });
      return;
    }
    if (password.length < 6) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'La contraseña debe tener al menos 6 caracteres' });
      return;
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'Token inválido o expirado' });
      return;
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    const jwtToken = signToken(String(user._id), user.email, user.role);
    res.send({
      success: true,
      message: 'Contraseña actualizada correctamente',
      data: { token: jwtToken, user: { id: user._id, name: user.name, email: user.email, role: user.role } },
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'Contraseña actual y nueva son requeridas' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'La nueva contraseña debe tener al menos 6 caracteres' });
      return;
    }

    const user = await User.findById(req.user?.userId);
    if (!user || !(await user.comparePassword(currentPassword))) {
      res.status(HttpStatusCode.Unauthorized).send({ success: false, message: 'Contraseña actual incorrecta' });
      return;
    }

    user.password = newPassword;
    await user.save();
    res.send({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    next(error);
  }
};
