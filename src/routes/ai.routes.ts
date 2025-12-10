import { Router } from 'express';
import { chatWithAI } from '../controllers/ai.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Endpoint Chat (Diproteksi login)
router.post('/chat', authenticateToken, chatWithAI);

export default router;