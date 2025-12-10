// src/routes/leads.routes.ts
import { Router, Request, Response, NextFunction } from 'express';
// HANYA impor controller dengan cara ini:
import * as leadsController from '../controllers/leads.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { authorizeRole } from '../middleware/role.middleware';
import { upload } from '../middleware/upload.middleware';
import multer from 'multer';


const router = Router();

const uploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: `Upload Error: ${err.message}` });
      }
      return res.status(400).json({ message: `File Error: ${err.message}` });
    }
    next();
  });
};

// 1. Terapkan autentikasi SATU KALI untuk semua rute di file ini
router.use(authenticateToken);

// 2. Rute paling spesifik (tanpa parameter dinamis)
router.get('/', leadsController.getAllLeads);
router.post('/', authorizeRole('ADMIN', 'SALES'), leadsController.createLead);

// 3. Rute spesifik '/by-status' (sebelum rute dinamis)
router.get('/by-status', leadsController.getLeadsByStatus);

// 4. Rute aktivitas BARU (lebih spesifik dari /:id)
// Ini harus ada SEBELUM /:id
router.get('/:leadId/activities', leadsController.getLeadActivities);
router.post('/:leadId/activities', leadsController.createLeadActivity);
router.get('/:leadId/notes', leadsController.getLeadNotes);
router.post(
  '/:leadId/notes', 
  upload.single('attachment'), // 'attachment' adalah nama field file
  leadsController.createLeadNote
);

// Rute ini harus lebih spesifik (3 level) jadi letakkan di sini
router.get('/:leadId/notes/:noteId', leadsController.getLeadNoteById);
router.patch(
  '/:leadId/notes/:noteId', 
  upload.single('attachment'), 
  leadsController.updateLeadNote
);
router.delete('/:leadId/notes/:noteId', leadsController.deleteLeadNote);

// Rute untuk Meeting
router.get('/:leadId/meetings', leadsController.getLeadMeetings);
router.get('/:leadId/meetings/:meetingId', leadsController.getLeadMeetingById);
router.patch('/:leadId/meetings/:meetingId', leadsController.updateLeadMeeting);
router.delete('/:leadId/meetings/:meetingId', leadsController.deleteLeadMeeting);
// ---

// Rute untuk Call
router.get('/:leadId/calls', leadsController.getLeadCalls);
router.get('/:leadId/calls/:callId', leadsController.getLeadCallById);
router.patch('/:leadId/calls/:callId', leadsController.updateLeadCall);
router.delete('/:leadId/calls/:callId', leadsController.deleteLeadCall);
// ---

// Rute untuk Email
router.get('/:leadId/emails', leadsController.getLeadEmails);
router.get('/:leadId/emails/:emailId', leadsController.getLeadEmailById);
router.patch(
  '/:leadId/emails/:emailId', 
  authenticateToken, 
  uploadMiddleware, // <--- TAMBAHKAN INI AGAR req.body TERBACA
  leadsController.updateLeadEmail
);
router.delete('/:leadId/emails/:emailId', leadsController.deleteLeadEmail);
// ---

router.post(
  '/:id/email', 
  authenticateToken, 
  uploadMiddleware, // Middleware upload
  leadsController.sendLeadEmail
);

// Rute untuk Invoice
router.post(
  '/:leadId/invoices',
  authenticateToken,
  leadsController.createLeadInvoice 
);
router.get(
  '/:leadId/invoices', 
  authenticateToken, 
  leadsController.getLeadInvoices
);
router.get('/:leadId/invoices/:invoiceId', leadsController.getLeadInvoiceById);
router.patch('/:leadId/invoices/:invoiceId', leadsController.updateLeadInvoice);
router.delete('/:leadId/invoices/:invoiceId', leadsController.deleteLeadInvoice);
// ---

// 5. Rute dinamis /:id (PALING AKHIR)
// Rute ini akan menangkap semua yang tidak cocok di atas
router.get('/:id', leadsController.getLeadById);
router.put('/:id', authorizeRole('ADMIN', 'SALES'), leadsController.updateLead);
router.patch('/:id', authorizeRole('ADMIN', 'SALES'), leadsController.updateLead); 
router.delete('/:id', authorizeRole('ADMIN'), leadsController.deleteLead);

export default router;