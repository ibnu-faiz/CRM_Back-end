// src/routes/dashboardRoutes.ts
import express from 'express';
import { getDashboardStats, getLeadsChart , getRevenueChart} from '../controllers/dashboard.controller';
import { authenticateToken } from '../middleware/auth.middleware'
const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', authenticateToken, getDashboardStats);

router.get('/leads-chart', authenticateToken, getLeadsChart);

router.get('/revenue-chart', authenticateToken, getRevenueChart);

export default router;