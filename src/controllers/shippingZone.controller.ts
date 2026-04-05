import { HttpStatusCode } from 'axios';
import { Request, Response, NextFunction } from 'express';
import { ShippingZone } from '../models/ShippingZone.model';
import { AuthRequest } from '../types/AuthRequest';

export const getShippingZones = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const zones = await ShippingZone.find({ isActive: true }).sort({ price: 1 });
    res.send({ success: true, data: zones });
  } catch (error) {
    next(error);
  }
};

export const createShippingZone = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!['admin', 'owner'].includes(req.user?.accountType ?? '')) {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }
    const zone = await ShippingZone.create(req.body);
    res.status(HttpStatusCode.Created).send({ success: true, data: zone });
  } catch (error) {
    next(error);
  }
};

export const updateShippingZone = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!['admin', 'owner'].includes(req.user?.accountType ?? '')) {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }
    const zone = await ShippingZone.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!zone) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Zona no encontrada' });
      return;
    }
    res.send({ success: true, data: zone });
  } catch (error) {
    next(error);
  }
};

export const deleteShippingZone = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!['admin', 'owner'].includes(req.user?.accountType ?? '')) {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }
    const zone = await ShippingZone.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!zone) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Zona no encontrada' });
      return;
    }
    res.send({ success: true, message: 'Zona eliminada' });
  } catch (error) {
    next(error);
  }
};
