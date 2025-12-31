// src/routes/dashboardRoutes.ts
import express from 'express';
import { getDashboardStats, getLeadsChart , getRevenueChart, getRecentDeals, getPipelineStats, getLeadsSourceChart, getQuarterSummary} from '../controllers/dashboard.controller';
import { authenticateToken } from '../middleware/auth.middleware'
const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', authenticateToken, getDashboardStats);

router.get('/leads-chart', authenticateToken, getLeadsChart);

router.get('/revenue-chart', authenticateToken, getRevenueChart);

router.get('/recent-deals', authenticateToken, getRecentDeals);

router.get('/pipeline-stats', authenticateToken, getPipelineStats);

router.get('/leads-source', authenticateToken, getLeadsSourceChart);

router.get('/quarter-summary', authenticateToken, getQuarterSummary);

export default router;