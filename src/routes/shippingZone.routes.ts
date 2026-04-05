import { Router } from 'express';
import {
  getShippingZones,
  createShippingZone,
  updateShippingZone,
  deleteShippingZone,
} from '../controllers/shippingZone.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const shippingZoneRouter = Router();

shippingZoneRouter.get('/', getShippingZones);
shippingZoneRouter.post('/', authMiddleware, createShippingZone);
shippingZoneRouter.put('/:id', authMiddleware, updateShippingZone);
shippingZoneRouter.delete('/:id', authMiddleware, deleteShippingZone);

export default shippingZoneRouter;
