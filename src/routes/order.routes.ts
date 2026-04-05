import { Router } from 'express';
import {
  createOrder,
  getMyOrders,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  createPayphoneOrder,
  getPaymentStatus,
  confirmPayphonePayment,
} from '../controllers/order.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const orderRouter = Router();

orderRouter.use(authMiddleware);

orderRouter.post('/', createOrder);
orderRouter.post('/payphone', createPayphoneOrder);
orderRouter.post('/confirm-payment', confirmPayphonePayment);
orderRouter.get('/my', getMyOrders);
orderRouter.get('/admin', getAllOrders);
orderRouter.get('/:id/payment-status', getPaymentStatus);
orderRouter.get('/:id', getOrderById);
orderRouter.patch('/:id/status', updateOrderStatus);

export default orderRouter;
