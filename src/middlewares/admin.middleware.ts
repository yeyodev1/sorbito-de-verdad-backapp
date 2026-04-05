import { HttpStatusCode } from 'axios';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types/AuthRequest';

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.accountType;
  if (role !== 'admin' && role !== 'owner') {
    res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Acceso solo para administradores' });
    return;
  }
  next();
}

export function requireOwner(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.accountType !== 'owner') {
    res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Acceso solo para el propietario' });
    return;
  }
  next();
}
