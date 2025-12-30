import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';

// IMPORT ROUTES
import authRoutes from './routes/auth.routes';
import leadsRoutes from './routes/leads.routes';
import teamRoutes from './routes/team.routes';
import salesRoutes from './routes/sales.routes';
import aiRoutes from './routes/ai.routes';
import dashboardRoutes from './routes/dashboard.routes';
import activitiesRoutes from './routes/activities.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// =======================================================================
// 1. LOGGER MIDDLEWARE (CCTV) - WAJIB PALING ATAS
// =======================================================================
// Ini memastikan setiap request yang masuk (sukses/gagal) tercatat di terminal
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`📢 [LOG MASUK] ${req.method} ${req.url}`);
  next();
});

// =======================================================================
// 2. CONFIG DASAR
// =======================================================================
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =======================================================================
// 3. STATIC FOLDER (AGAR ATTACHMENT BISA DIBUKA)
// =======================================================================
// Pastikan folder 'uploads' sudah dibuat manual di root project
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  // Fungsi ini akan dijalankan setiap kali ada yang akses file di folder uploads
  setHeaders: (res, filePath) => {
    const lowerPath = filePath.toLowerCase();
    
    // Jika file berakhiran .pdf
    if (lowerPath.endsWith('.pdf')) {
      // 1. Beritahu browser ini tipe PDF
      res.setHeader('Content-Type', 'application/pdf');
      // 2. Beritahu browser untuk MENAMPILKANNYA (inline), bukan download
      res.setHeader('Content-Disposition', 'inline');
    }
  }
}));

// =======================================================================
// 4. ROUTES
// =======================================================================
app.get('/', (req: Request, res: Response) => {
  res.json({ 
    message: 'CRM Backend API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/ai', aiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/activities', activitiesRoutes);

// =======================================================================
// 5. GLOBAL ERROR HANDLER (JARING PENGAMAN TERAKHIR)
// =======================================================================
// Jika Multer gagal upload atau Controller crash, error akan masuk ke sini
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("🔥 [FATAL SERVER ERROR]:", err); // Mencetak error merah di terminal

  // Error spesifik Multer (File terlalu besar)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File terlalu besar (Maksimal 10MB)' });
  }

  // Error umum lainnya
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: err.message || 'Something went wrong'
  });
});

// =======================================================================
// 6. 404 HANDLER (ROUTE TIDAK DITEMUKAN)
// =======================================================================
app.use((req: Request, res: Response) => {
  console.log(`❌ [404] Route not found: ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

// =======================================================================
// 7. START SERVER
// =======================================================================
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`👀 Logger is ACTIVE - Terminal will show requests...`);
});

export default app;