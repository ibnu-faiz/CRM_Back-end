import express from "express";
import { getInvoiceSettings, updateInvoiceSettings } from "../controllers/setting.controller";
import { authenticateToken } from '../middleware/auth.middleware';

const router = express.Router();

// Endpoint: /api/settings/invoice
router.get("/invoice", authenticateToken, getInvoiceSettings);
router.put("/invoice", authenticateToken, updateInvoiceSettings);

export default router;