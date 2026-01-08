// src/middleware/upload.middleware.ts
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Konfigurasi penyimpanan
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Simpan file di folder 'uploads/'
  },
  filename: function (req, file, cb) {
    // Buat nama file yang unik (Contoh: 17123456789-namareport.pdf)
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

// Filter file untuk hanya mengizinkan tipe tertentu (opsional tapi disarankan)
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
  const mimetype = allowedTypes.test(file.mimetype);
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Error: File type not supported! Only images, PDFs, and DOCs are allowed.'));
};

export const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Batas 10MB
  fileFilter: fileFilter
});

const avatarDir = path.join(process.cwd(), 'public/uploads/avatars');

// Buat folder otomatis jika belum ada
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, avatarDir);
  },
  filename: (req, file, cb) => {
    // Nama file: avatar-{timestamp}.ext
    const uniqueSuffix = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `avatar-${uniqueSuffix}${ext}`);
  }
});

// Filter KHUSUS GAMBAR saja
const imageFilter = (req: any, file: any, cb: any) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Hanya file gambar yang diperbolehkan!'), false);
  }
};

// Export variable baru 'uploadAvatarMiddleware'
export const uploadAvatarMiddleware = multer({ 
  storage: avatarStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 2 * 1024 * 1024 } // Maksimal 2MB cukup untuk foto
});